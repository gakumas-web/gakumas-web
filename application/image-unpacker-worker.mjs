import {unpackImageBase} from '../domain/image-archive.mjs';

self.onmessage=async({data:{bytes,pack}})=>{
  try{
    const entries=await unpackImageBase(bytes,pack,processed=>self.postMessage({type:'progress',processed}));
    self.postMessage({type:'complete',entries});
  }catch(error){self.postMessage({type:'error',error:error.message});}
};
