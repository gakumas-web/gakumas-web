import {createContentOperations} from './content-processing-operations.mjs';
import {contentChunks} from './content-transfer.mjs';
const process=createContentOperations();
self.onmessage=async({data:{id,kind,args}})=>{
  try{
    const value=await process({kind,args});
    if((kind==='cached'||kind==='parse')&&value!==undefined){
      for(const chunk of contentChunks(value))self.postMessage({id,chunk});
      self.postMessage({id,complete:true});
    }else self.postMessage({id,value});
  }
  catch(error){self.postMessage({id,error:error.message});}
};
