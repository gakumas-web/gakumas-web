import {libraryKey} from './personal-library.mjs';
import {compareCapturedAt} from '../domain/model.mjs';
import {snapshotFitsProfile,validProfile} from '../domain/account.mjs';
import {snapshotId} from './history.mjs';
import {PROFILE_PREFERENCE_KEY} from './view-state.mjs';

// 当前独立格式使用专用存储，不读取或迁移早期工作副本。
function database() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('gakumas-web',1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      db.createObjectStore('profiles');
      db.createObjectStore('snapshots',{keyPath:['profile','id']}).createIndex('profile','profile');
    };
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function transaction(stores,mode,action) {
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);let result;
    tx.oncomplete=()=>resolve(typeof result==='function'?result():result?.result);
    tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    try{result=action(tx);}catch(error){tx.abort();reject(error);}
  });}finally{db.close();}
}
export function workspaceData(profile) {
  if(!validProfile(profile.replace(/^selection:/,'')))throw new Error('无效账号档案');
  return transaction(['profiles'],'readonly',tx=>tx.objectStore('profiles').get(profile));
}
// 同一只读事务恢复两类工作副本，避免串行打开数据库与等待两次事务。
export function profileData(profile){
  if(!validProfile(profile))return Promise.resolve({ordinary:undefined,selection:undefined});
  return transaction(['profiles'],'readonly',tx=>{
    const store=tx.objectStore('profiles'),ordinary=store.get(profile),selection=store.get('selection:'+profile);
    return ()=>({ordinary:ordinary.result,selection:selection.result});
  });
}

export async function snapshotHistory(profile) {
  return (await transaction(['snapshots'],'readonly',tx=>tx.objectStore('snapshots').index('profile').getAll(profile)))
    .sort((a,b)=>compareCapturedAt(b.snapshot.captured_at,a.snapshot.captured_at)||b.importedAt.localeCompare(a.importedAt));
}

// 主库存、历史和选拔列表／详情同一事务提交，失败时不留下半份账号数据。
export async function saveAccountDirectory(profile,{history=[],snapshot,selectionSnapshot},{settings}={}){
  const values=[...history,snapshot,selectionSnapshot].filter(Boolean);
  if(values.some(value=>!snapshotFitsProfile(value,profile)))throw new Error('快照账号与档案不匹配');
  const entries=await Promise.all(history.map(async value=>({profile,id:await snapshotId(value),snapshot:value,importedAt:new Date().toISOString()})));
  const previous=settings?new Map([...settings.keys()].map(key=>[key,localStorage.getItem(key)])):null;
  const touched=[];
  try{await transaction(['profiles','snapshots'],'readwrite',tx=>{
    const store=tx.objectStore('snapshots');
    for(const entry of new Map(entries.map(value=>[value.id,value])).values()){
      const request=store.get([profile,entry.id]);request.onsuccess=()=>{if(!request.result)store.add(entry);};
    }
    const profiles=tx.objectStore('profiles');
    if(snapshot)profiles.put({snapshot},profile);
    if(selectionSnapshot)profiles.put({snapshot:selectionSnapshot},'selection:'+profile);
    if(settings)for(const [key,value] of settings)if(previous.get(key)!==value){localStorage.setItem(key,value);touched.push(key);}
  });}catch(error){
    // localStorage 不属于 IndexedDB 事务；普通写入错误时恢复其导入前内容。
    // 先回收新增或扩大的值，再恢复较大的旧值；未成功写入的键不触碰。
    for(const key of touched.sort((a,b)=>(previous.get(a)?.length??0)-settings.get(a).length-((previous.get(b)?.length??0)-settings.get(b).length))){
      const value=previous.get(key);if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);
    }
    throw error;
  }
}


export async function storedProfiles(){
  return transaction(['profiles'],'readonly',tx=>tx.objectStore('profiles').getAllKeys());
}

function accountLocalKeys(profile){
  if(!validProfile(profile))throw new Error('无效账号档案');
  const keys=[];
  for(let index=0;index<localStorage.length;index++){
    const key=localStorage.key(index);
    if(key===`gakumas-web:view:${profile}`||key===`gakumas-web:saved-views:${profile}`||key===libraryKey(profile))keys.push(key);
  }
  return keys;
}

export async function accountDataSummary(profile){
  const settings=accountLocalKeys(profile).length;
  return transaction(['profiles','snapshots'],'readonly',tx=>{
    const ordinary=tx.objectStore('profiles').get(profile),selection=tx.objectStore('profiles').get('selection:'+profile);
    const history=tx.objectStore('snapshots').index('profile').count(IDBKeyRange.only(profile));
    const length=value=>Array.isArray(value)?value.length:0;
    return ()=>({memories:length(ordinary.result?.snapshot?.memories),selection:length(selection.result?.snapshot?.selectionMemories),
      details:length(selection.result?.snapshot?.details),history:history.result,settings});
  });
}

// 只删除精确档案键与带分隔符的笔记前缀，不使用清空整个数据库或站点的操作。
export async function clearAccountData(profile){
  const keys=accountLocalKeys(profile);
  if(localStorage.getItem(PROFILE_PREFERENCE_KEY)===profile)keys.push(PROFILE_PREFERENCE_KEY);
  const previous=new Map(keys.map(key=>[key,localStorage.getItem(key)])),removed=[];
  try{await transaction(['profiles','snapshots'],'readwrite',tx=>{
    const profiles=tx.objectStore('profiles'),snapshots=tx.objectStore('snapshots');
    profiles.delete(profile);profiles.delete('selection:'+profile);
    const cursor=snapshots.index('profile').openKeyCursor(IDBKeyRange.only(profile));
    cursor.onsuccess=()=>{const row=cursor.result;if(row){snapshots.delete(row.primaryKey);row.continue();}};
    for(const key of keys){localStorage.removeItem(key);removed.push(key);}
  });}catch(error){
    for(const key of removed){const value=previous.get(key);if(value!==null)localStorage.setItem(key,value);}
    throw error;
  }
}
