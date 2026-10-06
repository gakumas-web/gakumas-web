import {validateImageDelivery,imageObjectKey,imageSourceURL} from '../domain/image-delivery.mjs';
import {contentHash} from '../domain/content-contract.mjs';
import {unpackImageBase} from '../domain/image-archive.mjs';
import {createImageStore} from './image-store.mjs';

export function createImageManager({store=createImageStore(),fetcher=(...args)=>fetch(...args),allowedOrigins=[],downloadURLs={}}={}){
  const listeners=new Set(),urls=new Map();let active,controller,installedIndex;
  let state={phase:'idle',completed:0,total:0,bytes:0,totalBytes:0,error:null};
  function notify(value){state={...state,...value};for(const listener of listeners)listener({...state});}
  async function download(url,row){
    const target=imageSourceURL(downloadURLs[url]??url);
    if(!allowedOrigins.includes(target.origin))throw new Error('image_source_not_allowed');
    const response=await fetcher(target.href,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])});
    if(!response.ok)throw new Error('image_download_failed');
    if(response.url&&!allowedOrigins.includes(new URL(response.url).origin))throw new Error('image_source_not_allowed');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
        if(size>row.bytes){await reader.cancel();throw new Error('image_hash_mismatch');}
        chunks.push(value);notify({bytes:size});
      }
    }finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    if(size!==row.bytes||await contentHash(bytes)!==row.sha256)throw new Error('image_hash_mismatch');
    return bytes;
  }
  async function perform(index){
    validateImageDelivery(index);installedIndex=index;controller=new AbortController();
    const required=new Map(Object.entries(index.files).map(([name,row])=>[imageObjectKey(name,row),row]));
    const verified=new Map();
    async function cached(key,row){
      if(verified.has(key))return verified.get(key);
      const blob=await store.get(key);
      const valid=blob instanceof Blob&&blob.size===row.bytes&&await contentHash(await blob.arrayBuffer())===row.sha256;
      verified.set(key,valid?blob:null);return valid?blob:null;
    }
    function expose(){
      const result={};
      for(const [name,row] of Object.entries(index.files)){
        const key=imageObjectKey(name,row),blob=verified.get(key);
        if(blob){if(!urls.has(key))urls.set(key,URL.createObjectURL(blob));result[name]=urls.get(key);}
      }
      return result;
    }
    notify({phase:'checking',completed:0,total:required.size,bytes:0,totalBytes:0,error:null});
    try{
      // 本机首次准备必须先完成基础包，失败不转为数千次 CDN 请求。
      if(!await store.meta('initialized')){
        let completed=0;
        for(const pack of index.baseline.packages){
          let complete=Boolean(await store.meta('pack:'+pack.sha256));
          if(complete)for(const [key,row] of Object.entries(pack.objects))if(!await cached(key,row)){complete=false;break;}
          if(!complete){
            notify({phase:'baseline',completed,total:index.baseline.packages.length,bytes:0,totalBytes:pack.bytes});
            const entries=await unpackImageBase(await download(pack.url,pack),pack);
            await store.pack(pack.sha256,entries);
            for(const [key,blob] of entries)verified.set(key,blob);
          }
          completed++;notify({completed});
        }
        await store.setMeta('initialized',true);
      }
      const cdn=new Set(index.cdn_objects),repair=new Set();
      for(const [key,row] of required)if(!await cached(key,row)&&!cdn.has(key))repair.add(key);
      // 基础图片未上传 CDN；浏览器局部清理缓存时只修复相关基础分段。
      for(const pack of index.baseline.packages){
        if(!Object.keys(pack.objects).some(key=>repair.has(key)))continue;
        notify({phase:'baseline',completed:0,total:1,bytes:0,totalBytes:pack.bytes});
        const entries=await unpackImageBase(await download(pack.url,pack),pack);
        await store.pack(pack.sha256,entries);for(const [key,blob] of entries)verified.set(key,blob);
      }
      const missing=[];
      for(const [key,row] of required)if(!await cached(key,row))missing.push([key,row]);
      let completed=0;
      for(const [key,row] of missing){
        notify({phase:'incremental',completed,total:missing.length,bytes:0,totalBytes:row.bytes});
        const bytes=await download(index.cdn_base_url+'objects/'+key,row);
        const blob=new Blob([bytes],{type:key.endsWith('.png')?'image/png':'image/webp'});
        await store.put(key,blob);verified.set(key,blob);completed++;
      }
      notify({phase:'ready',completed:required.size,total:required.size,bytes:0,totalBytes:0});
      return expose();
    }catch(error){
      // 已验证的分段与对象保留，重试只补齐缺失部分。
      notify({phase:'error',error:error?.name==='QuotaExceededError'?'image_storage_full':String(error?.message??'image_cache_failed')});
      return expose();
    }
  }
  return {
    prepare(index){
      if(active)return installedIndex===index?active:active.then(()=>this.prepare(index));
      const task=perform(index).finally(()=>{if(active===task)active=null;});active=task;return task;
    },
    retry(){if(!installedIndex)return Promise.resolve({});return this.prepare(installedIndex);},
    status:()=>({...state}),subscribe(listener){listeners.add(listener);listener({...state});return()=>listeners.delete(listener);},
    dispose(){controller?.abort();for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();},
  };
}
