import {ContentError} from '../domain/content-contract.mjs';
import {createContentOperations} from './content-processing-operations.mjs';
import {applyContentChunk} from './content-transfer.mjs';

export function createContentProcessor(){
  const pending=new Map(),local=typeof Worker==='undefined'?createContentOperations():null;let worker,sequence=0;
  function request(kind,args){
    if(local)return local({kind,args});
    if(!worker){
      worker=new Worker(new URL('./content-processing-worker.mjs',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{
        const task=pending.get(data.id);if(!task)return;
        if(data.chunk){task.value=applyContentChunk(task.value,data.chunk);return;}
        pending.delete(data.id);
        if(data.error)task.reject(new ContentError(data.error));else task.resolve(data.complete?task.value:data.value);
      };
      worker.onerror=worker.onmessageerror=()=>{worker.terminate();worker=null;for(const task of pending.values())task.reject(new ContentError('content_unavailable'));pending.clear();};
    }
    return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,kind,args});});
  }
  return {
    validateBundle:(bundle,webVersion)=>request('bundle',{bundle,webVersion}),
    validatePart:(name,bytes,manifest)=>request('part',{name,bytes,manifest}),
    async parsePart(text,hash){return await request('cached',{hash})??request('parse',{text,hash});},
  };
}
