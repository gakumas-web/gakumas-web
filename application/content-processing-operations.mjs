import {validateContentBundle,validateContentPart} from '../domain/content-contract.mjs';

// 缓存最多两套发行分包；复用已经通过完整合同校验的解析结果。
export function createContentOperations(){
  const parsed=new Map();
  function remember(hash,value){parsed.delete(hash);parsed.set(hash,value);while(parsed.size>12)parsed.delete(parsed.keys().next().value);}
  return async({kind,args})=>{
    if(kind==='bundle')return validateContentBundle(args.bundle,args.webVersion,(name,value)=>remember(JSON.parse(args.bundle.manifest).files[name].sha256,value));
    if(kind==='part'){
      const result=await validateContentPart(args.name,args.bytes,args.manifest);remember(args.manifest.files[args.name].sha256,result.value);return {text:result.text};
    }
    if(kind==='cached')return parsed.get(args.hash);
    if(kind==='parse'){const value=JSON.parse(args.text);remember(args.hash,value);return value;}
  };
}
