import {parseLibrary} from '../domain/personal-library.mjs';
import {accountProfile,snapshotFitsProfile,validPublicUserId} from '../domain/account.mjs';
import {InputError} from '../domain/model.mjs';
import {restoreSelectionSnapshot} from '../domain/selection-memories.mjs';
import {restorePrepared,snapshotId} from './history.mjs';
import {defaults,createView,restoreIdolArt} from './view-state.mjs';

export class AccountPackageError extends Error {}
export const PACKAGE_FILE_LIMIT=300*1024*1024;
const PAYLOAD_LIMIT=200*1024*1024,ITERATIONS=600000;
const FORMAT='gakumas-web-account-package',VERSION=1,PACKED_LIMIT=PAYLOAD_LIMIT+1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const aad=()=>encoder.encode(`${FORMAT}:${VERSION}:AES-256-GCM:PBKDF2-SHA-256:${ITERATIONS}:gzip`);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const tabs=['memories','selectionMemories','idolCards','supportCards','idolCardSkins','achievements'];
function view(input={}){
  if(!record(input))throw new InputError();
  for(const [key,initial] of Object.entries(defaults())){
    const value=input[key];if(value===undefined)continue;
    if(Array.isArray(initial)){
      if(!Array.isArray(value)||value.length>2000||value.some(item=>typeof item!=='string'||item.length>4096))throw new InputError();
    }else if(typeof value!==typeof initial||typeof value==='string'&&value.length>4096||typeof value==='number'&&(!Number.isSafeInteger(value)||value<0))throw new InputError();
  }
  return createView(input);
}
export function packagePreferences(input={}){
  if(!record(input)||input.views!==undefined&&!record(input.views)||input.idolArt!==undefined&&!record(input.idolArt))throw new InputError();
  return {tab:tabs.includes(input.tab)?input.tab:'memories',views:Object.fromEntries(tabs.map(tab=>[tab,view(input.views?.[tab])])),idolArt:restoreIdolArt(input.idolArt)};
}

// 数据包只携带规范化账号数据；外部附加字段、图片缓存和运行时凭据不进入工作副本。
export async function parseAccountBackup(input){
  if(!record(input)||input.format!=='gakumas-web-account-backup'||input.version!==VERSION||!validPublicUserId(input.publicUserId)
    ||!Number.isFinite(Date.parse(input.exportedAt))||!Array.isArray(input.snapshots)||input.snapshots.length>1000)throw new InputError();
  const profile=accountProfile(input.publicUserId),snapshots=[];
  for(const snapshot of input.snapshots)snapshots.push(await restorePrepared(snapshot));
  const selectionSnapshot=input.selectionSnapshot===null?null:restoreSelectionSnapshot(input.selectionSnapshot);
  if([...snapshots,selectionSnapshot].filter(Boolean).some(snapshot=>!snapshotFitsProfile(snapshot,profile)))throw new InputError();
  if(!snapshots.length&&!selectionSnapshot)throw new InputError();
  const ids=await Promise.all(snapshots.map(snapshotId));
  if(input.currentSnapshotId!==null&&!ids.includes(input.currentSnapshotId))throw new InputError();
  if(!Array.isArray(input.savedViews)||input.savedViews.length>1000)throw new InputError();
  const savedViews=input.savedViews.map(entry=>{
    if(!record(entry)||typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>60)throw new InputError();
    return {name:entry.name,view:view(entry.view)};
  });
  return {format:input.format,version:VERSION,publicUserId:input.publicUserId,exportedAt:input.exportedAt,
    currentSnapshotId:input.currentSnapshotId,snapshots:[...new Map(snapshots.map((snapshot,index)=>[ids[index],snapshot])).values()],
    selectionSnapshot,library:parseLibrary(input.library,profile),preferences:packagePreferences(input.preferences),savedViews};
}
function base64(bytes){
  const chunks=[];for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
  return btoa(chunks.join(''));
}
function unbase64(value,maxLength){
  if(typeof value!=='string'||value.length>maxLength||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new InputError();
  const bytes=Uint8Array.from(atob(value),letter=>letter.charCodeAt(0));
  if(base64(bytes)!==value)throw new InputError();return bytes;
}
export function inspectAccountPackage(input){
  if(!record(input)||input.format!==FORMAT||input.version!==VERSION||typeof input.encrypted!=='boolean')throw new AccountPackageError('不是受支持的账号数据包。');
  if((input.compression!=='gzip'||typeof input.data!=='string'||input.data.length>Math.ceil((PACKED_LIMIT+16)/3)*4))throw new AccountPackageError('数据包的压缩格式无效或不受支持。');
  if(input.encrypted){
    const info=input.encryption;
    if(!record(info)||info.algorithm!=='AES-GCM'||info.kdf!=='PBKDF2'||info.hash!=='SHA-256'||info.iterations!==ITERATIONS
      ||unbase64(info.salt,24).length!==16||unbase64(info.iv,16).length!==12||typeof input.data!=='string'||input.data.length>Math.ceil((PACKED_LIMIT+16)/3)*4)throw new AccountPackageError('数据包的加密格式无效或不受支持。');
  }
  return input.encrypted;
}
async function keyFromPassword(password,salt){
  if(!globalThis.crypto?.subtle)throw new AccountPackageError('当前浏览器不支持本地加密，请使用受支持的浏览器打开本地工作台。');
  if(typeof password!=='string'||!password.length||password.length>1024)throw new AccountPackageError('请输入数据包密码。');
  const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
// 解压时逐块限制展开体积，不先把不可信压缩内容完整读入内存。
async function transform(bytes,decompress=false){
  const Stream=decompress?globalThis.DecompressionStream:globalThis.CompressionStream;
  if(!Stream)throw new AccountPackageError('当前浏览器不支持数据包压缩，请使用新版浏览器。');
  const reader=new Blob([bytes]).stream().pipeThrough(new Stream('gzip')).getReader();
  const chunks=[];let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.length;
      if(size>(decompress?PAYLOAD_LIMIT:PACKED_LIMIT)){
        await reader.cancel();throw new AccountPackageError('账号数据超过 200 MiB，无法打包。');
      }
      chunks.push(value);
    }
  }catch(error){
    if(error instanceof AccountPackageError)throw error;
    throw new AccountPackageError('数据包压缩内容损坏，未导入任何数据。');
  }finally{reader.releaseLock();}
  const output=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}
  return output;
}
export async function encodeAccountPackage(input,password=''){
  const payload=await parseAccountBackup(input),bytes=encoder.encode(JSON.stringify(payload));
  if(bytes.length>PAYLOAD_LIMIT)throw new AccountPackageError('账号数据超过 200 MiB，无法打包。');
  if(password&&(password.length<8||password.length>1024))throw new AccountPackageError('加密密码需要 8–1024 个字符。');
  const packed=await transform(bytes);
  if(!password)return {format:FORMAT,version:VERSION,encrypted:false,compression:'gzip',data:base64(packed)};
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await keyFromPassword(password,salt);
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(),tagLength:128},key,packed);
  return {format:FORMAT,version:VERSION,encrypted:true,compression:'gzip',encryption:{algorithm:'AES-GCM',kdf:'PBKDF2',hash:'SHA-256',iterations:ITERATIONS,salt:base64(salt),iv:base64(iv)},data:base64(new Uint8Array(encrypted))};
}
export async function decodeAccountPackage(input,password=''){
  const encrypted=inspectAccountPackage(input);
  let content;
  if(encrypted){
    const salt=unbase64(input.encryption.salt,24),iv=unbase64(input.encryption.iv,16);
    const key=await keyFromPassword(password,salt),limit=PACKED_LIMIT;
    try{
      const data=unbase64(input.data,Math.ceil((limit+16)/3)*4);
      if(data.length<16||data.length>limit+16)throw new InputError();
      content=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(),tagLength:128},key,data);
    }catch{throw new AccountPackageError('密码错误或数据包已损坏，未导入任何数据。');}
  }else content=unbase64(input.data,Math.ceil(PACKED_LIMIT/3)*4);
  content=await transform(content,true);
  return parseAccountBackup(JSON.parse(decoder.decode(content)));
}
