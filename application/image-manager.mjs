import {validateImageDelivery,imageObjectKey,imageSourceURL} from '../domain/image-delivery.mjs';
import {contentHash} from '../domain/content-contract.mjs';
import {unpackImageBase} from '../domain/image-archive.mjs';
import {createImageStore} from './image-store.mjs';

// 下载槽同时约束待处理包；最多两个包在途，一次只解包、保存一个包。
export function createImageManager({store=createImageStore(),fetcher=(...args)=>fetch(...args),allowedOrigins=[],downloadURLs={},concurrency=2}={}){
  const listeners=new Set(),available=new Set(),verified=new Map(),urls=new Map(),jobs=new Map(),pending=new Map(),requested=new Set();
  let index,rows=new Map(),packs=new Map(),active=0,checking=0,paused=false,processing=Promise.resolve(),epoch=0,networkBytes=0,cacheMs=0,cacheError=null,full=false;
  const clock=()=>performance.now();
  const errorCode=error=>error?.name==='QuotaExceededError'?'image_storage_full':error?.name==='TimeoutError'?'image_timeout':error?.name==='AbortError'?'image_cancelled':String(error?.message??'image_cache_failed');
  function status(){
    const tasks=[...jobs.values()],working=tasks.filter(job=>!['done','failed','cancelled','queued'].includes(job.phase));
    const failed=tasks.filter(job=>job.phase==='failed');
    const busy=checking||tasks.some(job=>job.phase==='queued')||working.length;
    const phase=paused?'cancelled':busy?(working[0]?.phase??'checking'):failed.length||cacheError?'error':index&&requested.size?'ready':'idle';
    return {phase,completed:[...requested].filter(key=>verified.has(key)).length,total:requested.size,
      bytes:tasks.reduce((sum,job)=>sum+(['failed','cancelled'].includes(job.phase)?0:job.bytes),0),
      totalBytes:tasks.reduce((sum,job)=>sum+job.row.bytes,0),networkBytes,cacheCheckMs:Math.round(cacheMs),checking,failed:failed.length+(cacheError?1:0),
      error:cacheError??failed[0]?.error??null,full,
      tasks:tasks.map(({id,phase,bytes,row,error,times,processed})=>({id,phase,bytes,totalBytes:row.bytes,error,times:{...times},processed:processed??0,objects:Object.keys(row.objects??{}).length}))};
  }
  function notify(){const state=status();for(const listener of listeners)listener(state);}
  function expose(){
    const result={};
    for(const [name,row] of Object.entries(index?.files??{})){
      const key=imageObjectKey(name,row),blob=verified.get(key);
      if(blob){if(!urls.has(key))urls.set(key,URL.createObjectURL(blob));result[name]=urls.get(key);}
    }
    return result;
  }
  function publish(){const result=expose();for(const listener of available)listener(result);notify();}
  function configure(value){
    validateImageDelivery(value);if(index===value)return;
    for(const job of jobs.values())job.controller?.abort();
    epoch++;index=value;rows=new Map(Object.entries(value.files).map(([name,row])=>[imageObjectKey(name,row),row]));
    packs=new Map();for(const pack of value.baseline.packages)for(const key of Object.keys(pack.objects))packs.set(key,pack);
    jobs.clear();pending.clear();requested.clear();paused=false;cacheError=null;full=false;networkBytes=0;cacheMs=0;notify();
  }
  async function download(job){
    const target=imageSourceURL(downloadURLs[job.url]??job.url);
    if(!allowedOrigins.includes(target.origin))throw new Error('image_source_not_allowed');
    const started=clock();job.phase='downloading';notify();
    const response=await fetcher(target.href,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.any([job.controller.signal,AbortSignal.timeout(120000)])});
    if(!response.ok)throw new Error(response.status===404?'image_not_found':'image_download_failed');
    if(response.url&&!allowedOrigins.includes(new URL(response.url).origin))throw new Error('image_source_not_allowed');
    const reader=response.body.getReader(),chunks=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;job.bytes+=value.length;networkBytes+=value.length;
      if(job.bytes>job.row.bytes){await reader.cancel();throw new Error('image_hash_mismatch');}chunks.push(value);notify();
    }}finally{reader.releaseLock();}
    job.times.download=clock()-started;job.phase='verifying';notify();const checkingAt=clock();
    const bytes=new Uint8Array(job.bytes);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    if(bytes.length!==job.row.bytes||await contentHash(bytes)!==job.row.sha256)throw new Error('image_hash_mismatch');
    job.times.verify=clock()-checkingAt;return bytes;
  }
  async function run(job,generation){
    try{
      const bytes=await download(job);
      // 已下载包仍占一个槽，避免快网把整套资源堆在待处理队列。
      job.phase='waiting';notify();const previous=processing;let release;
      processing=new Promise(resolve=>{release=resolve;});await previous;
      try{
        if(job.controller.signal.aborted||generation!==epoch)throw new DOMException('stopped','AbortError');
        let entries;const unpackAt=clock();
        if(job.row.objects){job.phase='unpacking';notify();entries=await unpackImageBase(bytes,job.row,processed=>{job.processed=processed;notify();});}
        else entries=new Map([[job.id,new Blob([bytes],{type:job.id.endsWith('.png')?'image/png':'image/webp'})]]);
        job.times.unpack=clock()-unpackAt;job.phase='saving';notify();const savingAt=clock();
        if(job.row.objects)await store.pack(job.id,entries);else await store.put(job.id,entries.get(job.id));
        job.times.save=clock()-savingAt;
        for(const [key,blob] of entries)verified.set(key,blob);
        job.phase='done';if(generation===epoch)publish();
      }finally{release();}
    }catch(error){
      job.error=errorCode(error);job.phase=job.error==='image_cancelled'?'cancelled':'failed';
      if(job.error==='image_storage_full'){cancel();cacheError=job.error;}
    }finally{active--;job.resolve();if(generation===epoch)notify();pump();}
  }
  function pump(){
    if(paused)return;
    while(active<Math.max(1,Math.min(2,concurrency))){
      const job=[...jobs.values()].filter(job=>job.phase==='queued').sort((a,b)=>a.priority-b.priority)[0];
      if(!job)break;
      active++;job.controller=new AbortController();job.phase='downloading';void run(job,epoch);
    }
  }
  async function need(key,priority){
    requested.add(key);if(verified.has(key))return;
    const waiting=jobs.get(packs.get(key)?.sha256??key);if(waiting)waiting.priority=Math.min(waiting.priority,priority);
    if(pending.has(key))return pending.get(key);
    const generation=epoch;
    const task=(async()=>{
      checking++;notify();let blob;const cacheAt=clock();
      try{const saved=await store.get(key),row=rows.get(key);if(saved instanceof Blob&&saved.size===row.bytes&&await contentHash(await saved.arrayBuffer())===row.sha256)blob=saved;}
      finally{checking--;cacheMs+=clock()-cacheAt;notify();}
      if(generation!==epoch)return;
      if(blob){verified.set(key,blob);publish();return;}
      if(paused)return;
      const pack=packs.get(key),id=pack?.sha256??key;
      let job=jobs.get(id);
      if(!job){
        let resolve;const promise=new Promise(done=>{resolve=done;});
        job={id,url:pack?.url??index.cdn_base_url+'objects/'+key,row:pack??rows.get(key),phase:'queued',priority,bytes:0,times:{},promise,resolve};jobs.set(id,job);
      }else job.priority=Math.min(job.priority,priority);
      if(!paused)pump();
      return job.promise;
    })().catch(error=>{cacheError=errorCode(error);notify();}).finally(()=>{if(pending.get(key)===task)pending.delete(key);});
    pending.set(key,task);return task;
  }
  async function request(names,{priority=1,complete=false}={}){
    if(!index)return {};
    const generation=epoch;
    if(complete)full=true;
    await Promise.all(names.filter(name=>index.files[name]).map(name=>need(imageObjectKey(name,index.files[name]),priority)));
    if(generation!==epoch)return {};
    if(complete&&[...rows.keys()].every(key=>verified.has(key)))await store.setMeta('initialized',true);
    notify();return expose();
  }
  function cancel(){
    paused=true;for(const job of jobs.values()){
      if(job.phase==='queued'){job.phase='cancelled';job.resolve();}
      else job.controller?.abort();
    }notify();
  }
  return {
    configure,request,
    prioritizeView(){for(const job of jobs.values())if(job.phase==='queued'&&job.priority>0)job.priority=Math.max(2,job.priority);},
    async prepare(value){configure(value);await Promise.all([...jobs.values()].map(job=>job.promise));jobs.clear();pending.clear();requested.clear();paused=false;cacheError=null;verified.clear();return request(Object.keys(value.files),{complete:true});},
    async retry(){
      await Promise.all([...pending.values()]);
      paused=false;cacheError=null;
      for(const [id,job] of jobs)if(['failed','cancelled'].includes(job.phase))jobs.delete(id);
      return request(Object.keys(index?.files??{}).filter(name=>requested.has(imageObjectKey(name,index.files[name]))),{complete:full});
    },
    complete:()=>{paused=false;return request(Object.keys(index?.files??{}),{priority:3,complete:true});},cancel,
    async clear(){cancel();await Promise.all([...pending.values()]);await store.clear();verified.clear();for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();publish();},
    status,subscribe(listener){listeners.add(listener);listener(status());return()=>listeners.delete(listener);},
    onAvailable(listener){available.add(listener);return()=>available.delete(listener);},
    dispose(){cancel();for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();},
  };
}
