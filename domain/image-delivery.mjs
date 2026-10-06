// 统一图片交付合同：固定基础包、当前图片对象及缺失对象来源。
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const version=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const imageLimits={file:32*1024*1024,segment:40*1024*1024,archive:48*1024*1024,total:1024*1024*1024};
export const imageObjectKey=(name,row)=>row.sha256+'.'+name.split('.').at(-1);
export function imageSourceURL(value,base=false){
  if(typeof value!=='string')throw new Error('image_source_invalid');
  const url=new URL(value);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))||url.username||url.password||url.search||url.hash||url.pathname.toLowerCase().split('/').includes('latest')||(base&&!url.pathname.endsWith('/')))throw new Error('image_source_invalid');
  return url;
}
function rows(files,objects=false){
  if(!object(files)||!Object.keys(files).length||Object.keys(files).length>20000)throw new Error('image_files_invalid');
  let size=0;
  for(const [name,row] of Object.entries(files)){
    const valid=objects?/^[a-f0-9]{64}\.(webp|png)$/.test(name):/^(images\/img_[A-Za-z0-9_-]{1,180}\.webp|ui-icons\/[A-Za-z0-9_-]{1,180}\.(webp|png))$/.test(name);
    if(!valid||!object(row)||!hash(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<=0||row.bytes>imageLimits.file||(objects&&name.split('.')[0]!==row.sha256))throw new Error('image_files_invalid');
    size+=row.bytes;
  }
  if(size>imageLimits.total)throw new Error('image_files_invalid');return size;
}
export function validateImageDelivery(index){
  if(!object(index)||index.format!=='gakumas-assets-set'||index.schema_version!==1||!version(index.version))throw new Error('image_index_invalid');
  rows(index.files);imageSourceURL(index.cdn_base_url,true);
  const base=index.baseline;
  if(!object(base)||!version(base.version)||!Array.isArray(base.packages)||!base.packages.length||base.packages.length>256)throw new Error('image_base_invalid');
  const seen=new Map(),urls=new Set();let total=0;
  for(const pack of base.packages){
    if(!object(pack))throw new Error('image_base_invalid');imageSourceURL(pack.url);
    if(urls.has(pack.url)||!hash(pack.sha256)||!Number.isSafeInteger(pack.bytes)||pack.bytes<=0||pack.bytes>imageLimits.archive)throw new Error('image_base_invalid');
    urls.add(pack.url);const size=rows(pack.objects,true);if(size>imageLimits.file||Object.keys(pack.objects).length>4096)throw new Error('image_base_invalid');total+=size;
    for(const [key,row] of Object.entries(pack.objects)){if(seen.has(key))throw new Error('image_base_invalid');seen.set(key,row);}
  }
  if(total>imageLimits.total||seen.size>20000)throw new Error('image_base_invalid');
  const baselineKeys=new Set(seen.keys()),current=new Set();
  for(const [name,row] of Object.entries(index.files)){
    const key=imageObjectKey(name,row),old=seen.get(key);
    if(old&&(old.bytes!==row.bytes||old.sha256!==row.sha256))throw new Error('image_files_invalid');seen.set(key,row);current.add(key);
  }
  if(!Array.isArray(index.cdn_objects)||new Set(index.cdn_objects).size!==index.cdn_objects.length||index.cdn_objects.some(key=>typeof key!=='string'||!current.has(key)))throw new Error('image_files_invalid');
  const cdn=new Set(index.cdn_objects);
  if([...current].some(key=>!baselineKeys.has(key)&&!cdn.has(key)))throw new Error('image_files_invalid');
  return index;
}
