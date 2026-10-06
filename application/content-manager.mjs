import {markLoading} from './loading-metrics.mjs';
import {contentConfig} from '../content-config.mjs';
import {appURL,installContentResources} from '../resources.mjs';
import {WEB_VERSION} from './version.mjs';
import {readContentCache,writeContentCache} from './content-store.mjs';
import {contentScopes,contentLimits,ContentError,contentHash,validateContentManifest,validateContentChannel,validateContentPart,validateContentBundle} from '../domain/content-contract.mjs';

export async function readBounded(response,limit,onProgress=()=>{}){
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new ContentError('content_too_large');}chunks.push(value);onProgress(value.byteLength);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
export function createContentManager({channelURL,webVersion=WEB_VERSION,fetcher=(...args)=>fetch(...args),store={read:readContentCache,write:writeContentCache},install=installContentResources}={}){
  let current,startup,updating,controller,generation=0;
  const parsed=new Map(),listeners=new Set();
  let state={phase:'idle',version:null,availableVersion:null,cached:false,error:null,local:false,bytes:0,totalBytes:0};
  const notify=values=>{state={...state,...values};for(const listener of listeners)listener({...state});};
  async function request(url,limit,cache='default',onProgress){
    const response=await fetcher(url,{credentials:'omit',referrerPolicy:'no-referrer',cache,signal:AbortSignal.any([AbortSignal.timeout(45000),controller.signal])});
    if(!response.ok)throw new ContentError('content_unavailable');return readBounded(response,limit,onProgress);
  }
  async function activate(bundle,manifest,cached,epoch=generation){
    await install(JSON.parse(bundle.files['assets-index.json']));
    if(epoch!==generation)return;
    current={bundle,manifest};parsed.clear();markLoading('content-ready');
    notify({phase:'ready',version:manifest.version,availableVersion:null,cached,error:null,local:bundle.origin==='local'});
  }
  async function refresh(){
    if(updating)return updating;
    const epoch=generation;
    controller=new AbortController();const refreshController=controller;
    notify({phase:'checking',error:null,bytes:0,totalBytes:0});
    // 同轮失败中止后，已收到正文的并行任务也失去发布进度的权限。
    const canPublishProgress=()=>epoch===generation&&updating===task&&!refreshController.signal.aborted;
    const task=(async()=>{
      const channel=validateContentChannel(JSON.parse(decode(await request(channelURL,contentLimits.manifest,'no-store'))));
      if(current?.bundle.manifest_sha256===channel.sha256){notify({phase:'ready'});return state;}
      const manifestURL=new URL(channel.manifest,channelURL).href;
      const manifestBytes=await request(manifestURL,contentLimits.manifest,'no-store');
      if(await contentHash(manifestBytes)!==channel.sha256)throw new ContentError('content_hash_mismatch');
      const text=decode(manifestBytes),manifest=validateContentManifest(JSON.parse(text),webVersion);
      if(manifest.version!==channel.version)throw new ContentError('content_version_mismatch');
      const files={};notify({phase:'downloading',totalBytes:Object.values(manifest.files).reduce((sum,row)=>sum+row.bytes,0)});
      // 相同分包重新核验字节后复用；整套通过后才写入缓存并准备切换。
      for(const names of [contentScopes.slice(0,3).map(x=>x+'.json'),[...contentScopes.slice(3).map(x=>x+'.json'),'assets-index.json']]){
        await Promise.all(names.map(async name=>{
          const saved=current?.bundle.files[name];
          if(typeof saved==='string'&&current.manifest.files[name]?.sha256===manifest.files[name].sha256){
            try{files[name]=(await validateContentPart(name,new TextEncoder().encode(saved),manifest)).text;if(canPublishProgress())notify({totalBytes:state.totalBytes-manifest.files[name].bytes});return;}catch{}
          }
          const bytes=await request(new URL(name,manifestURL).href,manifest.files[name].bytes,'default',bytes=>{if(canPublishProgress())notify({phase:'downloading',bytes:state.bytes+bytes});});
          if(canPublishProgress())notify({phase:'verifying'});
          files[name]=(await validateContentPart(name,bytes,manifest)).text;
        }));
      }
      if(epoch!==generation)return state;
      const bundle={format:'gakumas-content-bundle',schema_version:1,manifest:text,manifest_sha256:channel.sha256,files,origin:'online'};
      notify({phase:'saving'});
      let cached=true;try{await store.write(bundle);}catch{cached=false;}
      if(epoch!==generation)return state;
      if(!current){await activate(bundle,manifest,cached,epoch);return state;}
      if(!cached)throw new ContentError('content_cache_failed');
      notify({phase:'update-ready',availableVersion:manifest.version,cached:true,error:null});return state;
    })().catch(error=>{refreshController.abort();if(epoch===generation)notify({phase:current?'ready':'unavailable',error:error instanceof ContentError?error.message:'content_unavailable'});throw error;}).finally(()=>{if(updating===task)updating=null;});
    updating=task;return task;
  }
  async function initialize(){
    if(current)return current;
    if(!startup){
      const task=(async()=>{
        const epoch=generation;
        notify({phase:'checking',error:null});
        let cached;try{cached=await store.read();}catch{}
        if(cached){
          try{const manifest=await validateContentBundle(cached,webVersion);if(epoch===generation&&!current)await activate(cached,manifest,true,epoch);}catch{}
        }
        if(current){if(!state.local)void refresh().catch(()=>{});return current;}
        await refresh();return current;
      })().finally(()=>{if(startup===task)startup=null;});
      startup=task;
    }
    return startup;
  }
  async function importBundle(bytes){
    if(bytes.byteLength>contentLimits.bundle)throw new ContentError('content_too_large');
    const bundle=JSON.parse(decode(bytes)),manifest=await validateContentBundle(bundle,webVersion);
    generation++;controller?.abort();bundle.origin='local';
    try{await store.write(bundle);}catch{
      notify({phase:current?'ready':'unavailable',error:'content_cache_failed'});throw new ContentError('content_cache_failed');
    }
    if(!current)await activate(bundle,manifest,true);
    else notify({phase:'update-ready',availableVersion:manifest.version,cached:true,error:null,local:true});
    return state;
  }
  return {initialize,refresh,importBundle,
    async take(scope){if(!contentScopes.includes(scope))throw new ContentError('content_scope_invalid');await initialize();if(!parsed.has(scope))parsed.set(scope,{...JSON.parse(current.bundle.files[scope+'.json']),releaseRevision:current.bundle.manifest_sha256});return parsed.get(scope);},
    status:()=>({...state}),subscribe(listener){listeners.add(listener);listener({...state});return()=>listeners.delete(listener);}};
}
const channelURL=new URL(contentConfig.channelURL,appURL('')).href;
export const contentManager=createContentManager({channelURL});
