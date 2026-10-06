// 只解析本项目生成的 USTAR 普通文件；不接受路径扩展、链接或任意压缩包内容。
import {imageLimits} from './image-delivery.mjs';
import {contentHash} from './content-contract.mjs';
const decoder=new TextDecoder('utf-8',{fatal:true});
const text=bytes=>decoder.decode(bytes).replace(/\0.*$/s,'');
function octal(bytes){const value=text(bytes).trim();if(!/^[0-7]+$/.test(value))throw new Error('image_archive_invalid');return parseInt(value,8);}
export async function unpackImageBase(compressed,pack,onProgress=()=>{}){
  const objectCount=Object.keys(pack.objects).length;
  if(compressed.byteLength!==pack.bytes||await contentHash(compressed)!==pack.sha256)throw new Error('image_hash_mismatch');
  const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks=[];let length=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>imageLimits.segment){await reader.cancel();throw new Error('image_archive_too_large');}chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const entries=new Map();let manifest=false,ended=false;
  for(offset=0;offset+512<=length;){
    const header=bytes.subarray(offset,offset+512);
    if(header.every(value=>value===0)){
      if(length-offset<1024||!bytes.subarray(offset).every(value=>value===0))throw new Error('image_archive_invalid');
      ended=true;break;
    }
    const expected=octal(header.subarray(148,156));let sum=0;
    for(let index=0;index<512;index++)sum+=index>=148&&index<156?32:header[index];
    if(sum!==expected||![0,48].includes(header[156])||text(header.subarray(257,263))!=='ustar'||text(header.subarray(345,500)))throw new Error('image_archive_invalid');
    const name=text(header.subarray(0,100)),size=octal(header.subarray(124,136));offset+=512;
    if(size>imageLimits.file||offset+size>length)throw new Error('image_archive_invalid');
    const raw=bytes.subarray(offset,offset+size);offset+=Math.ceil(size/512)*512;
    if(name==='manifest.json'){
      if(manifest||entries.size)throw new Error('image_archive_invalid');
      const value=JSON.parse(decoder.decode(raw));
      if(value.format!=='gakumas-image-base'||value.schema_version!==1||!value.objects||Object.keys(value.objects).length!==Object.keys(pack.objects).length)throw new Error('image_archive_invalid');
      for(const [key,row] of Object.entries(pack.objects))if(value.objects[key]?.sha256!==row.sha256||value.objects[key]?.bytes!==row.bytes)throw new Error('image_archive_invalid');
      manifest=true;continue;
    }
    const key=name.startsWith('objects/')?name.slice(8):'',row=pack.objects[key];
    if(!manifest||!row||entries.has(key)||size!==row.bytes||await contentHash(raw)!==row.sha256)throw new Error('image_hash_mismatch');
    entries.set(key,new Blob([raw],{type:key.endsWith('.png')?'image/png':'image/webp'}));
    if(entries.size%32===0||entries.size===objectCount)onProgress(entries.size);
  }
  if(!ended||!manifest||entries.size!==Object.keys(pack.objects).length)throw new Error('image_archive_invalid');
  return entries;
}
