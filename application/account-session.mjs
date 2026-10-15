import {features} from './features.mjs';
import {profileData,saveAccountDirectory} from './storage.mjs';
import {importAccountBackup} from './account-package-store.mjs';
import {PersonalLibrary} from './personal-library.mjs';
import {createViews,parsePreferences,restoreIdolArt,normalizeProfile,PROFILE_PREFERENCE_KEY} from './view-state.mjs';
import {accountProfile,profileAccountId,isPreviewAccount,validProfile,snapshotFitsProfile} from '../domain/account.mjs';
import {combineAccountDirectory} from '../domain/account-import.mjs';
import {restoreSelectionSnapshot} from '../domain/selection-memories.mjs';

export class AccountSessionError extends Error {}
export function readLastAccount(storage){
  try{return normalizeProfile((storage??globalThis.localStorage).getItem(PROFILE_PREFERENCE_KEY));}catch{return null;}
}
export function rememberAccount(profile,storage=globalThis.localStorage){
  if(validProfile(profile))storage.setItem(PROFILE_PREFERENCE_KEY,profile);else storage.removeItem(PROFILE_PREFERENCE_KEY);
}
export function persistAccountSession({profile,views,tab,idolArt},storage=globalThis.localStorage){
  if(!validProfile(profile))return;
  rememberAccount(profile,storage);storage.setItem(`gakumas-web:view:${profile}`,JSON.stringify({views,tab,idolArt}));
}
function readPreferences(profile){
  let raw;try{raw=globalThis.localStorage.getItem(`gakumas-web:view:${profile}`);}catch{}
  return parsePreferences(raw);
}
function loadLibrary(profile){const library=new PersonalLibrary(profile);library.load();return library;}
function emptySession(){return {profile:null,lifecycleId:null,snapshot:null,selectionSnapshot:null,views:createViews(),tab:'memories',idolArt:{},library:null,warnings:[]};}
function checkAccount(profile,{snapshot,selectionSnapshot}){
  if(!validProfile(profile))throw new AccountSessionError('采集数据缺少有效的游戏账号 ID。');
  if(snapshot&&!snapshotFitsProfile(snapshot,profile)||selectionSnapshot&&!snapshotFitsProfile(selectionSnapshot,profile))throw new AccountSessionError('档案中的游戏账号 ID 不匹配，已停止载入。');
}

// 先准备完整会话，再由装配入口一次性安装；这里不修改当前页面状态或操作 DOM。
export function createAccountSessionManager({readProfile=profileData,saveDirectory=saveAccountDirectory,importBackup=importAccountBackup,preferences=readPreferences,library=loadLibrary,
  previewEnabled=features.previewAccount,
  installPreview=async()=>{const module=await import('./preview-account.mjs');return module.installPreviewAccount();},
  refreshPreview=async()=>{const module=await import('./preview-account.mjs');return module.ensurePreviewProducerExp();},
}={}){
  function prepare(profile,data,saved,warnings=[]){
    checkAccount(profile,data);
    const snapshot=data.snapshot??null,selectionSnapshot=data.selectionSnapshot?restoreSelectionSnapshot(data.selectionSnapshot):null;
    const result={profile,lifecycleId:data.lifecycleId??null,snapshot,selectionSnapshot,views:createViews(saved.views),tab:saved.tab??'memories',idolArt:restoreIdolArt(saved.idolArt),library:null,warnings:[...warnings]};
    if(saved.recovered)result.warnings.push('视图偏好已恢复默认，账号数据保留。');
    try{result.library=library(profile);}catch{result.warnings.push('标签与收藏读取失败，已保留原数据，请检查账号数据包。');}
    return result;
  }
  async function restore(profile){
    if(profile===null)return emptySession();
    let {ordinary,selection}=await readProfile(profile);const warnings=[];
    if(previewEnabled&&isPreviewAccount(profileAccountId(profile))&&ordinary?.snapshot){
      try{if(await refreshPreview())ordinary=(await readProfile(profile)).ordinary;}
      catch{warnings.push('预览经验信息暂未补齐，请刷新后重试；已有数据保留。');}
    }
    return prepare(profile,{lifecycleId:ordinary?.lifecycleId??selection?.lifecycleId??null,snapshot:ordinary?.snapshot,selectionSnapshot:selection?.snapshot},preferences(profile),warnings);
  }
  return {
    restore,empty:emptySession,
    async importDirectory(bundle,current){
      const profile=accountProfile(bundle.publicUserId),{ordinary,selection}=await readProfile(profile);
      const next=combineAccountDirectory(bundle,{snapshot:ordinary?.snapshot,selectionSnapshot:selection?.snapshot?restoreSelectionSnapshot(selection.snapshot):null});
      checkAccount(profile,next);const lifecycleId=await saveDirectory(profile,next);
      // 更新当前账号保留正在使用的筛选；切换账号读取目标账号的独立偏好。
      const saved=profile===current.profile?{views:current.views,idolArt:current.idolArt}:preferences(profile);
      return {...prepare(profile,{...next,lifecycleId},{...saved,tab:next.snapshot?'memories':'selectionMemories'}),ignoredDetails:next.ignoredDetails};
    },
    async restoreBackup(payload){
      const next=await importBackup(payload);return prepare(next.profile,next,next.preferences);
    },
    async enablePreview(){
      const profile=await installPreview(),session=await restore(profile);
      if(!session.snapshot&&!session.selectionSnapshot)throw new AccountSessionError('预览档案未恢复');
      return session;
    },
  };
}
