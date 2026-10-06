import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentManager} from '../application/content-manager.mjs';
import {contentFixture,contentTransport,memoryContentStore} from './fixtures/content.mjs';

const options={channelURL:'https://example.invalid/content/channel.json',install:()=>{}};
test('整套内容校验后才缓存，多个页面共享同一次版本获取且不携带账号信息',async()=>{
  const fixture=await contentFixture(),calls=[],store=memoryContentStore();
  const manager=createContentManager({...options,fetcher:contentTransport(fixture,calls),store});
  const [catalog,effects]=await Promise.all([manager.take('catalog'),manager.take('effects')]);
  assert.equal(catalog.releaseRevision,effects.releaseRevision);assert.equal(store.writes,1);
  assert.equal(calls.length,8);assert.equal(manager.status().version,'v1');
  for(const {url,options:request} of calls){assert.equal(request.credentials,'omit');assert.equal(request.referrerPolicy,'no-referrer');assert.equal(new URL(url).search,'');assert.equal(request.body,undefined);}
});
test('损坏新分包不会替换旧缓存或当前版本',async()=>{
  const old=await contentFixture('v1'),next=await contentFixture('v2'),store=memoryContentStore({...old.bundle,origin:'local'});
  next.files['effects.json']+=' ';
  const manager=createContentManager({...options,fetcher:contentTransport(next),store});
  await manager.initialize();await assert.rejects(manager.refresh(),/content_(hash_mismatch|too_large)/);
  assert.equal(manager.status().version,'v1');assert.equal(store.value.manifest_sha256,old.bundle.manifest_sha256);assert.equal(store.writes,0);
});
test('最低 Web 版本不满足时停止更新，不下载数据分包',async()=>{
  const old=await contentFixture('v1'),next=await contentFixture('v2',{minimum:'999.0.0'}),calls=[],store=memoryContentStore({...old.bundle,origin:'local'});
  const manager=createContentManager({...options,fetcher:contentTransport(next,calls),store});
  await manager.initialize();await assert.rejects(manager.refresh(),/content_web_too_old/);
  assert.equal(calls.length,2);assert.equal(store.writes,0);assert.equal(manager.status().version,'v1');
});
test('新版本准备好后当前会话仍用旧整套数据，重新载入才切换',async()=>{
  const old=await contentFixture('v1'),next=await contentFixture('v2'),store=memoryContentStore({...old.bundle,origin:'local'});
  const manager=createContentManager({...options,fetcher:contentTransport(next),store});
  await manager.initialize();await manager.refresh();
  assert.equal(manager.status().availableVersion,'v2');assert.equal((await manager.take('catalog')).testVersion,'v1');
  const restarted=createContentManager({...options,fetcher:contentTransport(next),store});
  assert.equal((await restarted.take('effects')).testVersion,'v2');
});
test('内容源离线时使用已校验缓存，账号数据库不参与恢复',async()=>{
  const old=await contentFixture('v1'),store=memoryContentStore(old.bundle);
  const manager=createContentManager({...options,store,fetcher:async()=>{throw new Error('offline');}});
  assert.equal((await manager.take('catalog')).testVersion,'v1');
  await assert.rejects(manager.refresh());assert.equal(manager.status().version,'v1');assert.equal(store.writes,0);
});
test('本地导入优先于尚未结束的网络更新，旧网络结果不能覆盖本地版本',async()=>{
  const old=await contentFixture('v1'),remote=await contentFixture('v2'),local=await contentFixture('v3');
  const store=memoryContentStore({...old.bundle,origin:'local'}),base=contentTransport(remote);let unblock,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  const manager=createContentManager({...options,store,fetcher:async(url,...args)=>{
    if(url.endsWith('/effects.json')){started();await new Promise(resolve=>{unblock=resolve;});}return base(url,...args);
  }});
  await manager.initialize();const updating=manager.refresh();await waiting;
  await manager.importBundle(new TextEncoder().encode(JSON.stringify(local.bundle)));unblock();await updating;
  assert.equal(store.value.manifest_sha256,local.bundle.manifest_sha256);assert.equal(manager.status().availableVersion,'v3');
});
test('缓存写入失败不能宣称新版本已持久化或替换已有版本',async()=>{
  const old=await contentFixture('v1'),next=await contentFixture('v2');
  const manager=createContentManager({...options,fetcher:contentTransport(next),store:{read:async()=>({...old.bundle,origin:'local'}),write:async()=>{throw new Error('quota');}}});
  await manager.initialize();await assert.rejects(manager.refresh(),/content_cache_failed/);assert.equal(manager.status().version,'v1');assert.equal(manager.status().availableVersion,null);
});
test('当前格式 1 只下载变化分包，完整缓存后重启切换并可回退',async()=>{
  const old=await contentFixture('v1',{stable:true}),next=await contentFixture('v2',{stable:true,characters:{hski:'新名称'}});
  const calls=[],store=memoryContentStore({...old.bundle,origin:'local'});
  const manager=createContentManager({...options,fetcher:contentTransport(next,calls),store});
  await manager.initialize();await manager.refresh();
  assert.deepEqual(calls.map(x=>new URL(x.url).pathname.split('/').at(-1)),['channel.json','manifest.json','catalog.json']);
  assert.equal((await manager.take('catalog')).characters.hski,'测试角色');
  assert.equal(store.writes,1);assert.equal(manager.status().availableVersion,'v2');
  const restarted=createContentManager({...options,fetcher:contentTransport(next),store});
  assert.equal((await restarted.take('catalog')).characters.hski,'新名称');
  await restarted.importBundle(new TextEncoder().encode(JSON.stringify(old.bundle)));
  const rollback=createContentManager({...options,fetcher:async()=>{throw new Error('offline');},store});
  assert.equal((await rollback.take('catalog')).characters.hski,'测试角色');
});
test('当前格式 1 仅发布身份变化时不下载分包，旧程序拒绝该合同',async()=>{
  const old=await contentFixture('v1',{stable:true}),next=await contentFixture('v2',{stable:true}),calls=[];
  const manager=createContentManager({...options,fetcher:contentTransport(next,calls),store:memoryContentStore({...old.bundle,origin:'local'})});
  await manager.initialize();await manager.refresh();assert.equal(calls.length,2);
  const incompatibleCalls=[];
  const incompatible=createContentManager({...options,webVersion:'0.4.0',fetcher:contentTransport(next,incompatibleCalls),store:memoryContentStore()});
  await assert.rejects(incompatible.initialize(),/content_web_too_old/);assert.equal(incompatibleCalls.length,2);
});
test('复用前重新校验缓存字节，损坏分包只重新获取该文件',async()=>{
  const old=await contentFixture('v1',{stable:true}),next=await contentFixture('v2',{stable:true}),calls=[];
  const cached={...old.bundle,files:{...old.bundle.files},origin:'local'};
  const store=memoryContentStore(cached),manager=createContentManager({...options,fetcher:contentTransport(next,calls),store});
  await manager.initialize();cached.files['effects.json']+=' ';
  await manager.refresh();
  assert.deepEqual(calls.map(x=>new URL(x.url).pathname.split('/').at(-1)),['channel.json','manifest.json','effects.json']);
  assert.equal(store.value.files['effects.json'],next.files['effects.json']);
});
test('当前格式 1 的变化分包失败时，已复用的部分不会形成半套新缓存',async()=>{
  const old=await contentFixture('v1',{stable:true}),next=await contentFixture('v2',{stable:true,characters:{hski:'新名称'}});
  next.files['catalog.json']+=' ';
  const store=memoryContentStore({...old.bundle,origin:'local'}),manager=createContentManager({...options,fetcher:contentTransport(next),store});
  await manager.initialize();await assert.rejects(manager.refresh(),/content_(hash_mismatch|too_large)/);
  assert.equal(store.writes,0);assert.equal(store.value.manifest_sha256,old.bundle.manifest_sha256);
});
