import {startLoading,finishLoading} from './loading-metrics.mjs';
import {validateImageDelivery,imageObjectKey,imageSourceURL} from '../domain/image-delivery.mjs';
import {contentHash} from '../domain/content-contract.mjs';
import {unpackImageBase} from '../domain/image-archive.mjs';
import {createImageStore} from './image-store.mjs';

// 下载槽同时约束待处理包；最多两个包在途，一次只解包、保存一个包。
export function createImageManager({store=createImageStore(),fetcher=(...args)=>fetch(...args),allowedOrigins=[],downloadURLs={},concurrency=2,cacheConcurrency=8}={}){
  const listeners=new Set(),available=new Map(),verified=new Map(),urls=new Map(),jobs=new Map(),pending=new Map(),requested=new Set(),demands=new Map(),cacheQueue=[],runs=new Set();
  let timing,currentView,completedCount=0,notificationTimer=null;
  let changedNames={};
  let cacheActive=0,cacheDirty=false,publishTimer=null,dirty=false,runId=0,keyNames=new Map(),exposed={};
  let index,rows=new Map(),packs=new Map(),active=0,checking=0,paused=false,processing=Promise.resolve(),epoch=0,networkBytes=0,cacheMs=0,cacheError=null,full=false;
  const clock=()=>performance.now();
  const errorCode=error=>error?.name==='QuotaExceededError'?'image_storage_full':error?.name==='TimeoutError'?'image_timeout':error?.name==='AbortError'?'image_cancelled':String(error?.message??'image_cache_failed');
  function status(){
    const tasks=[...jobs.values()],working=tasks.filter(job=>!['done','failed','cancelled','queued'].includes(job.phase));
    const failed=tasks.filter(job=>job.phase==='failed');
    const completed=completedCount;
    const busy=pending.size||checking||tasks.some(job=>job.phase==='queued')||working.length;
    const phase=paused?'cancelled':busy?(working[0]?.phase??'checking'):failed.length||cacheError?'error':index&&requested.size&&completed===requested.size?'ready':'idle';
    return {phase,completed,total:requested.size,runId,timing:timing?{...timing}:null,version:index?.version,cacheCheckConcurrency:cacheActive,cacheCheckQueued:cacheQueue.length,
      bytes:tasks.reduce((sum,job)=>sum+(['failed','cancelled'].includes(job.phase)?0:job.bytes),0),
      totalBytes:tasks.reduce((sum,job)=>sum+job.row.bytes,0),networkBytes,cacheCheckMs:Math.round(cacheMs),checking,failed:failed.length+(cacheError?1:0),
      error:cacheError??failed[0]?.error??null,full,
      tasks:tasks.map(({id,phase,bytes,row,error,times,processed})=>({id,phase,bytes,totalBytes:row.bytes,error,times:{...times},processed:processed??0,objects:Object.keys(row.objects??{}).length}))};
  }
  function notify(immediate=false){
    if(!immediate){if(!notificationTimer)notificationTimer=setTimeout(()=>notify(true),32);return;}
    clearTimeout(notificationTimer);notificationTimer=null;
    const state=status();for(const listener of listeners)listener(state);
  }
  function expose(){return {...exposed};}
  function remember(key,blob){
    if(requested.has(key)&&!verified.has(key))completedCount++;
    verified.set(key,blob);
    if(!urls.has(key))urls.set(key,URL.createObjectURL(blob));
    for(const name of keyNames.get(key)??[])changedNames[name]=exposed[name]=urls.get(key);
    dirty=true;
  }
  function flush(){
    clearTimeout(publishTimer);publishTimer=null;
    if(dirty){
      dirty=false;const changes=changedNames;changedNames={};let snapshot;
      for(const [listener,incremental] of available)listener(incremental?changes:(snapshot??=expose()));
    }
  }
  function publish(){if(!publishTimer)publishTimer=setTimeout(flush,16);notify();}
  function pumpCache(){
    const limit=Math.max(1,Math.min(32,cacheConcurrency));
    if(cacheActive>=limit)return;
    if(cacheDirty){cacheQueue.sort((a,b)=>(demands.get(a.key)??3)-(demands.get(b.key)??3));cacheDirty=false;}
    while(cacheQueue.length&&cacheActive<limit){
      const item=cacheQueue.shift();
      if(item.generation!==epoch||paused){item.resolve(false);continue;}
      cacheActive++;item.resolve(true);
    }
  }
  function releaseQueued(){for(const item of cacheQueue.splice(0))item.resolve(false);}
  function configure(value){
    validateImageDelivery(value);if(index===value)return;
    for(const job of jobs.values()){job.controller?.abort();job.resolve();}
    releaseQueued();flush();
    finishLoading(timing,'superseded');timing=null;
    epoch++;index=value;rows=new Map(Object.entries(value.files).map(([name,row])=>[imageObjectKey(name,row),row]));
    packs=new Map();for(const pack of value.baseline.packages)for(const key of Object.keys(pack.objects))packs.set(key,pack);
    keyNames=new Map();exposed={};
    for(const [name,row] of Object.entries(value.files)){const key=imageObjectKey(name,row);if(!keyNames.has(key))keyNames.set(key,[]);keyNames.get(key).push(name);}
    for(const [key,blob] of verified)if(rows.has(key))remember(key,blob);
    jobs.clear();pending.clear();requested.clear();completedCount=0;demands.clear();checking=0;runId++;paused=false;cacheError=null;full=false;networkBytes=0;cacheMs=0;flush();notify(true);
  }
  async function download(job,generation){
    const target=imageSourceURL(downloadURLs[job.url]??job.url);
    if(!allowedOrigins.includes(target.origin))throw new Error('image_source_not_allowed');
    const started=clock();job.phase='downloading';notify();
    const response=await fetcher(target.href,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.any([job.controller.signal,AbortSignal.timeout(120000)])});
    if(!response.ok)throw new Error(response.status===404?'image_not_found':'image_download_failed');
    if(response.url&&!allowedOrigins.includes(new URL(response.url).origin))throw new Error('image_source_not_allowed');
    const reader=response.body.getReader(),chunks=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;job.bytes+=value.length;if(generation===epoch)networkBytes+=value.length;
      if(job.bytes>job.row.bytes){await reader.cancel();throw new Error('image_hash_mismatch');}chunks.push(value);notify();
    }}finally{reader.releaseLock();}
    job.times.download=clock()-started;job.phase='verifying';notify();const checkingAt=clock();
    const bytes=new Uint8Array(job.bytes);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    if(bytes.length!==job.row.bytes||await contentHash(bytes)!==job.row.sha256)throw new Error('image_hash_mismatch');
    job.times.verify=clock()-checkingAt;return bytes;
  }
  async function run(job,generation){
    try{
      const bytes=await download(job,generation);
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
        if(generation===epoch)for(const [key,blob] of entries)remember(key,blob);
        job.phase='done';if(generation===epoch)publish();
      }finally{release();}
    }catch(error){
      job.error=error?.name==='AbortError'&&!job.controller.signal.aborted?'image_timeout':errorCode(error);
      job.phase=job.error==='image_cancelled'?'cancelled':'failed';
      if(generation===epoch&&job.error==='image_storage_full'){cacheError=job.error;cancel();}
    }finally{active--;job.resolve();if(generation===epoch)notify();pump();}
  }
  function pump(){
    if(paused)return;
    while(active<Math.max(1,Math.min(2,concurrency))){
      const job=[...jobs.values()].filter(job=>job.phase==='queued').sort((a,b)=>a.priority-b.priority)[0];
      if(!job)break;
      active++;job.controller=new AbortController();job.phase='downloading';const running=run(job,epoch);runs.add(running);void running.finally(()=>runs.delete(running));
    }
  }
  async function need(key,priority){
    if(!requested.has(key)&&verified.has(key))completedCount++;
    requested.add(key);demands.set(key,Math.min(demands.get(key)??Infinity,priority));cacheDirty=true;
    if(verified.has(key))return;
    const waiting=jobs.get(packs.get(key)?.sha256??key);if(waiting)waiting.priority=Math.min(waiting.priority,priority);
    if(pending.has(key))return pending.get(key);
    const generation=epoch,row=rows.get(key);
    // 先登记需求，再开始有限并发的缓存检查，避免检查与排队之间出现假就绪。
    const task=Promise.resolve().then(async()=>{
      const acquired=await new Promise(resolve=>{cacheQueue.push({key,generation,resolve});cacheDirty=true;pumpCache();});
      if(!acquired)return;
      let blob;const cacheAt=clock();
      if(generation===epoch){checking++;notify();}
      try{const saved=await store.get(key);if(saved instanceof Blob&&saved.size===row.bytes&&await contentHash(await saved.arrayBuffer())===row.sha256)blob=saved;}
      finally{cacheActive--;if(generation===epoch){checking--;cacheMs+=clock()-cacheAt;}pumpCache();}
      if(generation!==epoch)return;
      if(blob){remember(key,blob);publish();return;}
      if(paused)return;
      const pack=packs.get(key),id=pack?.sha256??key;
      let job=jobs.get(id);
      if(!job){
        let resolve;const promise=new Promise(done=>{resolve=done;});
        job={id,url:pack?.url??index.cdn_base_url+'objects/'+key,row:pack??row,phase:'queued',priority:demands.get(key),bytes:0,times:{},promise,resolve};jobs.set(id,job);
      }else job.priority=Math.min(job.priority,demands.get(key));
      pump();return job.promise;
    }).catch(error=>{if(generation===epoch){cacheError=errorCode(error);notify();}}).finally(()=>{
      if(pending.get(key)===task){pending.delete(key);if(!pending.size){flush();settleTiming();}notify();}
    });
    pending.set(key,task);notify();return task;
  }
  function settleTiming(){
    const state=status();if(['ready','error','cancelled'].includes(state.phase))finishLoading(timing,state.phase,{total:state.total});
  }
  async function request(names,{priority=1,complete=false}={}){
    if(!index)return {};
    const generation=epoch;
    if(!timing||timing.endedAt!==undefined||timing.view!==currentView||complete&&timing.mode!=='complete'){
      finishLoading(timing,'superseded');runId++;timing=startLoading('images',{run:runId,view:currentView,version:index.version,mode:complete?'complete':'required'});
    }
    if(complete)full=true;
    await Promise.all(names.filter(name=>index.files[name]).map(name=>need(imageObjectKey(name,index.files[name]),priority)));
    if(generation!==epoch)return {};
    settleTiming();notify(!pending.size);return expose();
  }
  function cancel(){
    paused=true;releaseQueued();flush();for(const job of jobs.values()){
      if(job.phase==='queued'){job.phase='cancelled';job.resolve();}
      else job.controller?.abort();
    }settleTiming();notify(true);
  }
  return {
    configure,request,
    prioritizeView(view){currentView=view;cacheDirty=true;for(const [key,priority] of demands)if(priority>0)demands.set(key,Math.max(2,priority));for(const job of jobs.values())if(job.phase==='queued'&&job.priority>0)job.priority=Math.max(2,job.priority);},
    async prepare(value){configure(value);await Promise.all([...jobs.values()].map(job=>job.promise));jobs.clear();pending.clear();requested.clear();completedCount=0;paused=false;cacheError=null;verified.clear();exposed={};runId++;return request(Object.keys(value.files),{complete:true});},
    async retry(){
      await Promise.all([...pending.values()]);
      paused=false;cacheError=null;runId++;
      for(const [id,job] of jobs)if(['failed','cancelled'].includes(job.phase))jobs.delete(id);
      return request(Object.keys(index?.files??{}).filter(name=>requested.has(imageObjectKey(name,index.files[name]))),{complete:full});
    },
    async complete(){runId++;if(paused||[...jobs.values()].some(job=>['failed','cancelled'].includes(job.phase)))await this.retry();return request(Object.keys(index?.files??{}),{priority:3,complete:true});},cancel,
    async clear(){
      cancel();await Promise.all([...pending.values(),...runs]);
      try{await store.clear();}catch(error){cacheError=errorCode(error);notify();throw error;}
      jobs.clear();pending.clear();verified.clear();completedCount=0;exposed={};networkBytes=0;cacheMs=0;cacheError=null;runId++;
      for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();changedNames=Object.fromEntries(Object.keys(index?.files??{}).map(name=>[name,null]));dirty=true;flush();notify(true);
    },
    status,subscribe(listener){listeners.add(listener);listener(status());return()=>listeners.delete(listener);},
    onAvailable(listener,{incremental=false}={}){available.set(listener,incremental);return()=>available.delete(listener);},
    dispose(){cancel();clearTimeout(publishTimer);clearTimeout(notificationTimer);for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();},
  };
}
