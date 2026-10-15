import test from 'node:test';
import assert from 'node:assert/strict';
import {inventory,captureHeader} from './fixtures.mjs';
import {prepareAccountDirectory,combineAccountDirectory} from '../domain/account-import.mjs';
import {accountProfile} from '../domain/account.mjs';
import {parsePreferences} from '../application/view-state.mjs';
import {createAccountSessionManager,AccountSessionError,readLastAccount,rememberAccount,persistAccountSession} from '../application/account-session.mjs';

const id='synthetic-session-a',other='synthetic-session-b',profile=accountProfile(id),otherProfile=accountProfile(other);
const bundle=await prepareAccountDirectory([inventory({publicUserId:id,memories:[{userMemoryId:'session-memory'}]}),{...captureHeader(),publicUserId:id,source:'selection_memory_list',count:0,selectionMemories:[],eventExpiredSelectionMemoryIds:[]}]);
const data=combineAccountDirectory(bundle),library=profile=>({profile,data:{tags:[]}});
const readProfile=async()=>({ordinary:{snapshot:data.snapshot},selection:{snapshot:data.selectionSnapshot}});
const preferences=()=>parsePreferences({tab:'supportCards',views:{memories:{query:'stored'}}});
const manager=options=>createAccountSessionManager({readProfile,preferences,library,previewEnabled:false,...options});

test('恢复完整会话并独立构建视图，存储中的快照不被修改',async()=>{
  const original=JSON.stringify(data),sessions=manager(),first=await sessions.restore(profile),second=await sessions.restore(profile);
  assert.equal(first.profile,profile);assert.equal(first.tab,'supportCards');assert.equal(first.snapshot.publicUserId,id);assert.equal(first.selectionSnapshot.publicUserId,id);assert.equal(first.library.profile,profile);
  first.views.memories.query='changed';assert.equal(second.views.memories.query,'stored');assert.equal(JSON.stringify(data),original);
});
test('普通或选拔快照的账号错配在安装标签库之前拒绝',async()=>{
  let loaded=false;
  for(const part of ['ordinary','selection']){
    const records=await readProfile();records[part]={snapshot:{...records[part].snapshot,publicUserId:other}};
    await assert.rejects(manager({readProfile:async()=>records,library:()=>{loaded=true;}}).restore(profile),AccountSessionError);
  }
  assert.equal(loaded,false);
});
test('同账号目录更新保留当前筛选，切换账号读取目标偏好，当前会话保持不变',async()=>{
  let saved=0;const sessions=manager({saveDirectory:async(target,next)=>{assert.equal(target,profile);assert.equal(next.snapshot.publicUserId,id);saved++;}});
  const current=await sessions.restore(profile);current.views.memories.query='unsaved';current.idolArt.card='upgraded';const before=JSON.stringify(current);
  const same=await sessions.importDirectory(bundle,current);assert.equal(same.views.memories.query,'unsaved');assert.equal(same.tab,'memories');assert.equal(same.idolArt.card,'upgraded');assert.notEqual(same.views,current.views);
  const switched=await sessions.importDirectory(bundle,{...current,profile:otherProfile});assert.equal(switched.views.memories.query,'stored');assert.equal(switched.tab,'memories');assert.equal(JSON.stringify(current),before);assert.equal(saved,2);
});
test('目录保存失败不构建新会话，不修改当前会话或读取新标签库',async()=>{
  const current=await manager().restore(profile),before=JSON.stringify(current);let loaded=false;
  const sessions=manager({saveDirectory:async()=>{throw new Error('synthetic storage failure');},library:()=>{loaded=true;}});
  await assert.rejects(sessions.importDirectory(bundle,current),/synthetic storage failure/);assert.equal(loaded,false);assert.equal(JSON.stringify(current),before);
});
test('备份恢复使用备份偏好，损坏偏好及标签库错误不丢弃库存',async()=>{
  const sessions=manager({importBackup:async()=>({...data,profile,preferences:parsePreferences({tab:'selectionMemories',views:{memories:{query:'backup'}}})})});
  const restored=await sessions.restoreBackup({});assert.equal(restored.tab,'selectionMemories');assert.equal(restored.views.memories.query,'backup');assert.equal(restored.library.profile,profile);
  const recovered=await manager({preferences:()=>parsePreferences('{'),library:()=>{throw new Error('synthetic library failure');}}).restore(profile);
  assert.equal(recovered.snapshot,data.snapshot);assert.equal(recovered.tab,'memories');assert.equal(recovered.library,null);assert.equal(recovered.warnings.length,2);
});
test('预览经验同步失败保留已存预览，空预览不冒充启用成功',async()=>{
  const previewProfile=accountProfile('synthetic-preview-account'),previewData={...data.snapshot,publicUserId:'synthetic-preview-account'};
  const sessions=manager({previewEnabled:true,installPreview:async()=>previewProfile,readProfile:async()=>({ordinary:{snapshot:previewData}}),refreshPreview:async()=>{throw new Error('synthetic preview failure');}});
  const ready=await sessions.enablePreview();assert.equal(ready.profile,previewProfile);assert.equal(ready.snapshot,previewData);assert.equal(ready.warnings.length,1);
  await assert.rejects(manager({installPreview:async()=>previewProfile,readProfile:async()=>({})}).enablePreview(),/预览档案未恢复/);
});
test('空会话没有账号数据或共享可变偏好，活动账号存储只修改所属键',async()=>{
  const sessions=manager(),first=sessions.empty(),second=await sessions.restore(null);first.views.memories.query='changed';assert.equal(second.views.memories.query,'');assert.equal(second.profile,null);assert.equal(second.snapshot,null);assert.equal(second.library,null);
  const values=new Map([['unrelated','keep']]),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const restored=await sessions.restore(profile);persistAccountSession(restored,storage);assert.equal(readLastAccount(storage),profile);assert.equal(JSON.parse(values.get(`gakumas-web:view:${profile}`)).views.memories.query,'stored');
  rememberAccount(null,storage);assert.equal(readLastAccount(storage),null);assert.equal(values.get('unrelated'),'keep');assert.ok(values.has(`gakumas-web:view:${profile}`));
  assert.equal(readLastAccount({getItem(){throw new Error('synthetic storage failure');}}),null);
});

test('生命周期来自工作副本和已提交导入，不从视图偏好或备份正文继承',async()=>{
  const tagged=await readProfile();tagged.ordinary.lifecycleId='stored-lifecycle';tagged.selection.lifecycleId='stored-lifecycle';
  const sessions=manager({readProfile:async()=>tagged,saveDirectory:async()=> 'committed-lifecycle',importBackup:async()=>({...data,profile,lifecycleId:'backup-target-lifecycle',preferences:{}})});
  assert.equal((await sessions.restore(profile)).lifecycleId,'stored-lifecycle');
  assert.equal((await sessions.importDirectory(bundle,sessions.empty())).lifecycleId,'committed-lifecycle');
  assert.equal((await sessions.restoreBackup({})).lifecycleId,'backup-target-lifecycle');
  assert.equal((await manager().restore(profile)).lifecycleId,null);assert.equal(sessions.empty().lifecycleId,null);
});
