import {profileAccountId,snapshotFitsProfile} from '../domain/account.mjs';
import {parseSnapshot,validCapturedAt} from '../domain/model.mjs';
import {parseSelectionSnapshot} from '../domain/selection-memories.mjs';
import {parseLibrary} from '../domain/personal-library.mjs';

export const CUSTOM_TAG_EXPORT_FORMAT='gakumas-custom-tag-export';
export const CUSTOM_TAG_EXPORT_SCHEMA=1;
export class CustomTagExportError extends Error {}
const validKey=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const compare=(a,b)=>a<b?-1:a>b?1:0;
const fail=()=>{throw new CustomTagExportError('自定义标签数据、账号或快照信息无效，请重新打开导出。');};

function snapshotRows(snapshot,profile,kind){
  if(snapshot===null)return null;
  if(!snapshotFitsProfile(snapshot,profile)||!Array.isArray(snapshot[kind])||snapshot[kind].some(row=>!validKey(row?.key)))return fail();
  // 用现有完整采集合同验证快照，临时身份字段只用于验证，导出来源仅保留散列标识。
  const field=kind==='memories'?'userMemoryId':'userSelectionMemoryId';
  const input={...snapshot,[kind]:snapshot[kind].map(row=>({...row,[field]:row.key}))};
  const clean=kind==='memories'?parseSnapshot(input):parseSelectionSnapshot(input);
  return {captured_at:clean.captured_at,rows:clean[kind].map(row=>({key:row[field]}))};
}

// 只导出当前快照中带标签的记录；不携带标签库存、收藏、偏好或选拔详情。
export function createCustomTagExport({profile,snapshot=null,selectionSnapshot=null,library}={}, {now=new Date()}={}){
  const publicUserId=profileAccountId(profile);
  const exportedAt=now instanceof Date?(Number.isFinite(now.getTime())?now.toISOString():null):now;
  if(!publicUserId||!validCapturedAt(exportedAt))return fail();
  let tags,ordinary,selection;
  try{
    tags=parseLibrary(library,profile);
    ordinary=snapshotRows(snapshot,profile,'memories');
    selection=snapshotRows(selectionSnapshot,profile,'selectionMemories');
  }catch{return fail();}
  const tagged=(source,kind)=>(source?.rows??[]).flatMap(row=>{
    const customTags=tags[kind][row.key]??[];
    return customTags.length?[{key:row.key,customTags:[...customTags].sort(compare)}]:[];
  }).sort((a,b)=>compare(a.key,b.key));
  const memories=tagged(ordinary,'memories'),selectionMemories=tagged(selection,'selectionMemories');
  if(!memories.length&&!selectionMemories.length)throw new CustomTagExportError('当前账号没有可导出的自定义标签回忆。');
  // 两类工作副本使用不同的散列输入前缀，消费方必须按各自身份算法匹配。
  return structuredClone({format:CUSTOM_TAG_EXPORT_FORMAT,schema_version:CUSTOM_TAG_EXPORT_SCHEMA,publicUserId,exported_at:exportedAt,
    sources:{memories:ordinary?{captured_at:ordinary.captured_at,identity_type:'userMemoryId-sha256'}:null,
      selectionMemories:selection?{captured_at:selection.captured_at,identity_type:'selection-prefixed-userSelectionMemoryId-sha256'}:null},
    memories,selectionMemories});
}
