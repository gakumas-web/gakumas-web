// 大分包分批回传，避免一次反序列化整棵对象树阻塞页面；分包校验仍由处理器完成。
const chunkLimit=64*1024;
export function* contentChunks(value,path=[],serialized=JSON.stringify(value)){
  if(serialized.length<=chunkLimit||value===null||typeof value!=='object'){
    yield {path,json:serialized};return;
  }
  yield {path,container:Array.isArray(value)?value.length:'object'};
  let entries=[],size=2;
  for(const [key,child] of Object.entries(value)){
    const json=JSON.stringify(child),entry=JSON.stringify(key)+':'+json;
    if(size+entry.length>chunkLimit&&entries.length){yield {path,patch:'{'+entries.join(',')+'}'};entries=[];size=2;}
    if(json.length>chunkLimit&&child!==null&&typeof child==='object')yield* contentChunks(child,[...path,key],json);
    else{entries.push(entry);size+=entry.length+1;}
  }
  if(entries.length)yield {path,patch:'{'+entries.join(',')+'}'};
}

export function applyContentChunk(root,chunk){
  if(chunk.patch!==undefined){
    const target=chunk.path.reduce((value,key)=>value[key],root);
    const patch=JSON.parse(chunk.patch);
    if(Object.hasOwn(patch,'__proto__'))Object.defineProperty(target,'__proto__',{value:patch.__proto__,writable:true,enumerable:true,configurable:true});
    Object.assign(target,patch);return root;
  }
  const value=chunk.json!==undefined?JSON.parse(chunk.json):chunk.container==='object'?{}:new Array(chunk.container);
  if(!chunk.path.length)return value;
  const parent=chunk.path.slice(0,-1).reduce((value,key)=>value[key],root);
  Object.defineProperty(parent,chunk.path.at(-1),{value,writable:true,enumerable:true,configurable:true});return root;
}
