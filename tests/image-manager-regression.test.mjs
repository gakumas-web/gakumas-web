import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createImageManager} from '../application/image-manager.mjs';
const fixture=JSON.parse(readFileSync(new URL('./contracts/image-delivery-v1.json',import.meta.url),'utf8'));
const origins=['https://release.example.invalid','https://cdn.example.invalid'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function gate(){let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};}
async function until(check){for(let i=0;i<200;i++){if(check())return;await sleep(2);}throw new Error('probe condition timed out');}
function memory(){const objects=new Map(),meta=new Map();return {objects,meta,get:async key=>objects.get(key),put:async(key,b)=>objects.set(key,b),setMeta:async(k,v)=>meta.set(k,v),pack:async(k,entries)=>{for(const [key,blob] of entries)objects.set(key,blob);meta.set(k,true);},clear:async()=>{objects.clear();meta.clear();}};}
function bytesFor(url){const value=fixture.packages[url]??fixture.objects[url.split('/').at(-1)];if(!value)throw new Error('no fixture '+url);return Buffer.from(value,'base64');}
function manager(store=memory(),fetcher=async url=>new Response(bytesFor(url))){return createImageManager({store,fetcher,allowedOrigins:origins});}
function extra(index,label,number){const raw=Uint8Array.of(number,number+1,number+2);return crypto.subtle.digest('SHA-256',raw).then(hash=>{const sha=Buffer.from(hash).toString('hex'),key=sha+'.png';index.files['ui-icons/'+label+'.png']={sha256:sha,bytes:raw.length};index.cdn_objects.push(key);return {key,raw,url:index.cdn_base_url+'objects/'+key,name:'ui-icons/'+label+'.png'};});}

test('SR-01: cache-check completion must not emit ready before a required download starts',async()=>{
 const images=manager(),states=[];images.subscribe(state=>states.push(state));
 try{await images.prepare(structuredClone(fixture.versions.one));
  const invalid=states.filter(s=>s.phase==='ready'&&s.completed<s.total).map(s=>({phase:s.phase,completed:s.completed,total:s.total,tasks:s.tasks.length}));
  assert.deepEqual(invalid,[],'ready must mean all requested objects are verified');
 }finally{images.dispose();}
});

test('SR-02: configure must settle callers waiting on queued jobs from the old generation',async()=>{
 const index=structuredClone(fixture.versions.multi);await extra(index,'third',7);let calls=0;
 const images=manager(memory(),async(_url,{signal})=>{calls++;return new Promise((_r,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true});});});
 try{images.configure(index);const old=images.request(Object.keys(index.files));
  await until(()=>calls===2&&images.status().tasks.some(t=>t.phase==='queued'));
  images.configure({...structuredClone(index),version:'next-generation'});
  const result=await Promise.race([old.then(()=> 'settled'),sleep(150).then(()=> 'still-pending')]);
  assert.equal(result,'settled','the third, queued old job has no resolver after jobs.clear()');
 }finally{images.dispose();}
});

test('SR-03: an old-generation storage failure must not cancel the new generation',async()=>{
 const store=memory(),saving=gate();let writes=0;
 const images=manager({...store,pack:async(...args)=>{writes++;if(writes===1){await saving.promise;throw new DOMException('full','QuotaExceededError');}return store.pack(...args);}});
 try{const index=structuredClone(fixture.versions.one);images.configure(index);const old=images.request(Object.keys(index.files));
  await until(()=>writes===1);images.configure({...structuredClone(index),version:'new-generation'});
  const current=images.request(Object.keys(index.files));saving.release();await Promise.all([old,current]);
  const s=images.status();assert.equal(s.phase,'ready',JSON.stringify({phase:s.phase,error:s.error,completed:s.completed,total:s.total}));
 }finally{saving.release();images.dispose();}
});

test('SR-04: clearing the manager then retrying must actually rebuild requested cache',async()=>{
 const store=memory();let downloads=0;const images=manager(store,async url=>{downloads++;return new Response(bytesFor(url));});
 try{await images.prepare(structuredClone(fixture.versions.one));assert.equal(store.objects.size,1);
  await images.clear();await images.retry();
  assert.equal(store.objects.size,1,JSON.stringify({downloads,status:images.status(),note:'Current UI reloads after clear, so this tests the manager API, not that UI flow.'}));
 }finally{images.dispose();}
});

test('SR-05: initialized-metadata failure must have observable handling',async t=>{
 const images=manager({...memory(),setMeta:async()=>{throw new Error('metadata-write-failed');}});
 try{let rejected=false;try{await images.prepare(structuredClone(fixture.versions.one));}catch{rejected=true;}
  const state=images.status();t.diagnostic(JSON.stringify({rejected,phase:state.phase,error:state.error,completed:state.completed,total:state.total}));
  assert.ok(!rejected||state.error||state.warning,'a rejected completion currently leaves ready/no error and escapes the UI void handler');
 }finally{images.dispose();}
});

test('SR-06: foreground demand arriving during cache lookup must upgrade task priority',async()=>{
 const index=structuredClone(fixture.versions.multi),third=await extra(index,'third',11),fourth=await extra(index,'fourth',21);
 const store=memory(),checking=gate(),network=gate(),calls=[];let checks=0;
 const images=manager({...store,get:async key=>{checks++;await checking.promise;return store.get(key);}},async url=>{calls.push(url);if(calls.length<=2)await network.promise;return new Response(url===third.url?third.raw:url===fourth.url?fourth.raw:bytesFor(url));});
 try{images.configure(index);const complete=images.complete();await until(()=>checks===4);
  images.prioritizeView();const foreground=images.request([fourth.name],{priority:1});checking.release();await until(()=>calls.length===2);network.release();await Promise.all([complete,foreground]);
  assert.equal(calls[2],fourth.url,'priority=1 demand was lost while the same key was in pending cache checks');
 }finally{checking.release();network.release();images.dispose();}
});

test('SR-07 observation: warm-cache checks are bounded and publications are batched',async t=>{
 const index=structuredClone(fixture.versions.one),store=memory();
 const baseRow=index.files['ui-icons/first.png'];
 // 使用已知对象字节，仍经过生产哈希校验。
 store.objects.set(baseRow.sha256+'.png',new Blob([Buffer.from(fixture.objects[baseRow.sha256+'.png'],'base64')]));
 for(let i=0;i<139;i++){const item=await extra(index,'cached-'+i,i);store.objects.set(item.key,new Blob([item.raw]));}
 let checks=0,peak=0,published=0,downloads=0;const all=gate();
 const images=manager({...store,get:async key=>{checks++;peak=Math.max(peak,checks);await all.promise;const value=await store.get(key);checks--;return value;}},async url=>{downloads++;return new Response(bytesFor(url));});
 images.onAvailable(()=>published++);
 try{images.configure(index);const task=images.request(Object.keys(index.files));await until(()=>checks===8);all.release();await task;
  t.diagnostic(JSON.stringify({requested:images.status().total,peakConcurrentCacheChecks:peak,availabilityPublications:published,downloads}));
  assert.equal(downloads,0);assert.equal(images.status().completed,140);assert.ok(peak<=8);assert.ok(published<20);
 }finally{all.release();images.dispose();}
});

test('缓存读取和写入失败可重试，清理失败保留成功图片',async()=>{
 const index=structuredClone(fixture.versions.two),store=memory();let failGet=true,failPut=true,failClear=true;
 const images=manager({...store,get:async key=>{if(failGet)throw new Error('read-failed');return store.get(key);},put:async(...args)=>{if(failPut)throw new Error('write-failed');return store.put(...args);},clear:async()=>{if(failClear)throw new Error('clear-failed');return store.clear();}});
 try{
  await images.prepare(index);assert.equal(images.status().phase,'error');assert.equal(images.status().error,'read-failed');
  failGet=false;await images.retry();assert.equal(images.status().phase,'error');assert.equal(store.objects.size,1);
  failPut=false;await images.retry();assert.equal(images.status().phase,'ready');assert.equal(store.objects.size,2);
  await assert.rejects(images.clear(),/clear-failed/);assert.equal(images.status().error,'clear-failed');assert.equal(store.objects.size,2);
  await images.retry();assert.equal(images.status().phase,'ready');
  failClear=false;await images.clear();await images.retry();assert.equal(store.objects.size,2);assert.equal(images.status().phase,'ready');
 }finally{images.dispose();}
});

test('旧缓存检查迟到失败不改变新代状态和检查计数',async()=>{
 const gateOld=gate(),store=memory();let reads=0;
 const images=manager({...store,get:async key=>{if(++reads===1){await gateOld.promise;throw new Error('old-read');}return store.get(key);}});
 try{
  images.configure(structuredClone(fixture.versions.one));const old=images.request(['ui-icons/first.png']);await until(()=>reads===1);
  images.configure({...structuredClone(fixture.versions.one),version:'next'});await images.request(['ui-icons/first.png']);
  gateOld.release();await old;assert.equal(images.status().phase,'ready');assert.equal(images.status().error,null);assert.equal(images.status().checking,0);
 }finally{gateOld.release();images.dispose();}
});

test('增量订阅只发布变化名称，清空明确撤销地址，完整订阅保持兼容',async()=>{
 const images=manager(),deltas=[],snapshots=[];
 images.onAvailable(value=>deltas.push(value),{incremental:true});images.onAvailable(value=>snapshots.push(value));
 try{
  images.configure(structuredClone(fixture.versions.two));await images.request(['ui-icons/first.png']);
  assert.deepEqual(Object.keys(deltas.at(-1)),['ui-icons/first.png']);
  await images.request(['ui-icons/second.png']);assert.deepEqual(Object.keys(deltas.at(-1)),['ui-icons/second.png']);
  assert.equal(Object.keys(snapshots.at(-1)).length,2);assert.equal(images.status().completed,2);
  await images.request(['ui-icons/first.png']);assert.equal(images.status().completed,2);
  await images.clear();assert.ok(Object.values(deltas.at(-1)).every(value=>value===null));assert.deepEqual(snapshots.at(-1),{});
  await images.retry();assert.equal(images.status().completed,2);assert.equal(images.status().timing.outcome,'ready');assert.ok(images.status().timing.durationMs>=0);
 }finally{images.dispose();}
});
