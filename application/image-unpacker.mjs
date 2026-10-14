import {unpackImageBase} from '../domain/image-archive.mjs';

// 浏览器在后台线程整理图片包；无 Worker 的测试环境沿用同一解析器和校验。
export function unpackImageBaseAsync(bytes,pack,onProgress=()=>{}){
  if(typeof Worker==='undefined')return unpackImageBase(bytes,pack,onProgress);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./image-unpacker-worker.mjs',import.meta.url),{type:'module'});
    const finish=(error,entries)=>{worker.terminate();if(error)reject(error);else resolve(entries);};
    worker.onmessage=({data})=>{
      if(data.type==='progress')onProgress(data.processed);
      else if(data.type==='complete')finish(null,data.entries);
      else finish(new Error(data.error));
    };
    worker.onerror=()=>finish(new Error('image_cache_failed'));
    worker.onmessageerror=()=>finish(new Error('image_cache_failed'));
    worker.postMessage({bytes,pack},[bytes.buffer]);
  });
}
