import {validateImageDelivery} from './image-delivery.mjs';
// 公共内容与用户库存使用独立合同；这里不接收或发送账号数据。
export const contentScopes=['catalog','effects','abilities','progression','achievements'];
export const contentLimits={manifest:64*1024,part:32*1024*1024,total:64*1024*1024,bundle:128*1024*1024};
const hashPattern=/^[a-f0-9]{64}$/,versionPattern=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validVersion=value=>typeof value==='string'&&versionPattern.test(value);
const fileNames=[...contentScopes.map(scope=>scope+'.json'),'assets-index.json'];
export class ContentError extends Error{}
function fail(code){throw new ContentError(code);}
export function requireCompatible(minimum,current){
  if(!/^\d+\.\d+\.\d+$/.test(minimum))fail('content_manifest_invalid');
  const a=minimum.split('.').map(Number),b=current.split('.').map(Number);
  for(let i=0;i<3;i++){if(a[i]>b[i])fail('content_web_too_old');if(a[i]<b[i])return;}
}
export function validateContentManifest(value,webVersion){
  if(!object(value)||value.format!=='gakumas-content'||value.schema_version!==1)fail('content_format_unsupported');
  if(typeof value.version!=='string'||!versionPattern.test(value.version)||!value.master_revision||typeof value.master_revision!=='string')fail('content_manifest_invalid');
  requireCompatible(value.min_web_version,webVersion);
  requireCompatible('0.5.0',value.min_web_version);
  if(!object(value.files)||Object.keys(value.files).length!==fileNames.length||!fileNames.every(name=>Object.hasOwn(value.files,name)))fail('content_files_invalid');
  let total=0;
  for(const [name,row] of Object.entries(value.files)){
    if(!object(row)||!Number.isSafeInteger(row.bytes)||row.bytes<=0||row.bytes>contentLimits.part||!hashPattern.test(row.sha256))fail('content_files_invalid');
    if(name!=='assets-index.json'&&!hashPattern.test(row.revision))fail('content_files_invalid');
    total+=row.bytes;
  }
  if(total>contentLimits.total)fail('content_too_large');
  return value;
}
export function validateContentChannel(value){
  if(!object(value)||value.format!=='gakumas-content-channel'||value.schema_version!==1||!validVersion(value.version)||!hashPattern.test(value.sha256)||value.manifest!==`releases/${value.version}/manifest.json`)fail('content_channel_invalid');
  return value;
}
export async function contentHash(bytes){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export function validateContentAssets(index){
  try{return validateImageDelivery(index);}catch{fail('content_assets_invalid');}
}
export async function validateContentPart(name,bytes,manifest){
  const expected=manifest.files[name];
  if(!expected||bytes.byteLength!==expected.bytes||await contentHash(bytes)!==expected.sha256)fail('content_hash_mismatch');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);
  if(name==='assets-index.json')return {text,value:validateContentAssets(value)};
  const scope=name.replace(/\.json$/,'');
  if(!object(value)||value.scope!==scope||value.revision!==expected.revision)fail('content_version_mismatch');
  const required={catalog:['characters','idols','supports'],effects:['tables'],abilities:['tables'],progression:['progression'],achievements:['achievements']}[scope];
  if(!required||!required.every(key=>object(value[key])))fail('content_part_invalid');
  if(scope==='catalog'){
    if(!Array.isArray(value.idols.cards)||!Array.isArray(value.idols.skins)||!Array.isArray(value.supports.cards))fail('content_part_invalid');
  }else{
    const names={effects:['ProduceCard','ProduceItem','ProduceExamEffect'],abilities:['MemoryAbility','ProduceSkill','ProduceEffect'],progression:['IdolCard','SupportCard'],achievements:['Achievement','AchievementProgress','Mission','Item']}[scope];
    const tables=['effects','abilities'].includes(scope)?value.tables:scope==='progression'?value.progression.tables:value.achievements;
    if(!object(tables)||!names.every(name=>Array.isArray(tables[name])))fail('content_part_invalid');
  }
  return {text,value};
}
export async function validateContentBundle(value,webVersion){
  if(!object(value)||value.format!=='gakumas-content-bundle'||value.schema_version!==1||typeof value.manifest!=='string'||!object(value.files))fail('content_format_unsupported');
  const raw=new TextEncoder().encode(value.manifest);
  if(raw.byteLength>contentLimits.manifest||await contentHash(raw)!==value.manifest_sha256)fail('content_hash_mismatch');
  const manifest=validateContentManifest(JSON.parse(value.manifest),webVersion);
  if(Object.keys(value.files).length!==fileNames.length||!fileNames.every(name=>typeof value.files[name]==='string'))fail('content_files_invalid');
  for(const name of fileNames)await validateContentPart(name,new TextEncoder().encode(value.files[name]),manifest);
  return manifest;
}
