import {features} from './features.mjs';
import {accountProducerLevelCap} from '../domain/catalog.mjs';
import {PREVIEW_ACCOUNT,accountProfile} from '../domain/account.mjs';
import {prepareAccountDirectory,combineAccountDirectory} from '../domain/account-import.mjs';
import {profileData,saveAccountDirectory,syncPreviewProducerExp} from './storage.mjs';
import {emptyLibrary,parseLibrary} from '../domain/personal-library.mjs';
import {libraryKey} from './personal-library.mjs';

export function previewLibrary(profile,snapshot,selectionSnapshot){
  const library=emptyLibrary(profile);
  library.tags=['竞技场主力','待优化','附魔测试','高分候选','培养收藏','选拔练习','未使用标签'];
  snapshot.memories.slice(0,24).forEach((memory,index)=>{if(index%4===3)return;library.memories[memory.key]=index%3===0?['竞技场主力','待优化','附魔测试']:index%3===1?['高分候选']:['培养收藏','附魔测试'];});
  selectionSnapshot.selectionMemories.slice(0,12).forEach((memory,index)=>{if(index%4===3)return;library.selectionMemories[memory.key]=index%2?['选拔练习']:['选拔练习','待优化'];});
  return parseLibrary(library,profile);
}
async function readPreviewAccount(){
  const response=await fetch(new URL('../resources/preview-account.json',import.meta.url),{credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok)throw Error('预览数据读取失败');const data=await response.json();
  if(data.format!==1||data.accountId!==PREVIEW_ACCOUNT)throw Error('预览数据格式无效');
  const bundle=await prepareAccountDirectory(data.documents);if(bundle.publicUserId!==PREVIEW_ACCOUNT)throw Error('预览账号标识无效');
  return combineAccountDirectory(bundle);
}
export async function ensurePreviewProducerExp(){
  if(!features.previewAccount)return false;
  const stored=await profileData(accountProfile(PREVIEW_ACCOUNT));if(!stored.ordinary?.snapshot)return false;
  // 优先采用当前已验证内容的上限；暂时无法载入内容时保留预览文件的有效经验。
  try{const {loadMaster}=await import('./master-loader.mjs');await loadMaster('account');}catch{}
  let producerExp=accountProducerLevelCap()?.totalExp;
  if(producerExp===undefined)producerExp=(await readPreviewAccount()).snapshot?.producerExp;
  if(producerExp===undefined)return false;
  return syncPreviewProducerExp(producerExp);
}
export async function installPreviewAccount(){
  if(!features.previewAccount)throw Error('此部署未启用预览账号');
  const profile=accountProfile(PREVIEW_ACCOUNT),stored=await profileData(profile);
  // 再次启用仅同步满级经验，保留用户试用时创建的标签和整理记录。
  if(stored.ordinary?.snapshot||stored.selection?.snapshot){await ensurePreviewProducerExp();return profile;}
  const next=await readPreviewAccount(),library=previewLibrary(profile,next.snapshot,next.selectionSnapshot);
  await saveAccountDirectory(profile,next,{settings:new Map([[libraryKey(profile),JSON.stringify(library)]])});return profile;
}
