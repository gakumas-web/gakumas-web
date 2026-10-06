import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createImageManager} from '../application/image-manager.mjs';
import {validateImageDelivery} from '../domain/image-delivery.mjs';
import {unpackImageBase} from '../domain/image-archive.mjs';
const fixture=JSON.parse(readFileSync(new URL('./contracts/image-delivery-v1.json',import.meta.url)));
const clone=value=>structuredClone(value);
function memory(){
  const objects=new Map(),meta=new Map();
  return {objects,metadata:meta,get:async key=>objects.get(key),meta:async key=>meta.get(key),
    put:async(key,value)=>{objects.set(key,value);},setMeta:async(key,value)=>{meta.set(key,value);},
    pack:async(key,entries)=>{for(const [name,blob] of entries)objects.set(name,blob);meta.set('pack:'+key,true);}};
}
function network(){
  const calls=[];let broken=null;
  return {calls,break(url){broken=url;},fetch:async(url,options)=>{
    calls.push(url);assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');
    assert.ok(!url.includes('account')&&!options.body);
    if(url===broken)return new Response('broken',{status:503});
    const value=fixture.packages[url]??fixture.objects[url.split('/').at(-1)];
    return new Response(value?Buffer.from(value,'base64'):'missing',{status:value?200:404});
  }};
}
function manager(store,net){return createImageManager({store,fetcher:net.fetch,allowedOrigins:['https://release.example.invalid','https://cdn.example.invalid']});}

test('镜像传输保留原索引身份，仍校验副本字节且拒绝未镜像来源',async()=>{
  const index=clone(fixture.versions.one),original=JSON.stringify(index),source=index.baseline.packages[0].url;
  const target='https://pages.example.invalid/repo/image-files/base.tar.gz',calls=[];
  const images=createImageManager({store:memory(),allowedOrigins:['https://pages.example.invalid'],downloadURLs:{[source]:target},
    fetcher:async url=>{calls.push(url);return new Response(Buffer.from(fixture.packages[source],'base64'));}});
  await images.prepare(index);assert.equal(images.status().phase,'ready');assert.deepEqual(calls,[target]);assert.equal(JSON.stringify(index),original);images.dispose();
  const bad=createImageManager({store:memory(),allowedOrigins:['https://pages.example.invalid'],downloadURLs:{[source]:target},fetcher:async()=>new Response('broken')});
  await bad.prepare(index);assert.equal(bad.status().error,'image_hash_mismatch');bad.dispose();
});

test('首次仅下载基础包，重载不联网，新版本只下载缺失对象，合并后老用户不重下基础包',async()=>{
  const store=memory(),net=network();let images=manager(store,net);
  let urls=await images.prepare(fixture.versions.one);
  assert.equal(images.status().phase,'ready');assert.equal(Object.keys(urls).length,1);assert.equal(net.calls.length,1);assert.match(net.calls[0],/release/);
  images.dispose();images=manager(store,net);await images.prepare(fixture.versions.one);assert.equal(net.calls.length,1);
  urls=await images.prepare(fixture.versions.two);assert.equal(Object.keys(urls).length,2);assert.equal(net.calls.length,2);assert.match(net.calls[1],/cdn.*objects/);
  await images.prepare(fixture.versions.three);assert.equal(net.calls.length,2);images.dispose();
  const freshNet=network(),fresh=manager(memory(),freshNet);await fresh.prepare(fixture.versions.three);
  assert.equal(freshNet.calls.length,1);assert.match(freshNet.calls[0],/release.*three/);fresh.dispose();
});

test('基础包中断不退回 CDN，重试复用已完成分段',async()=>{
  const store=memory(),net=network(),images=manager(store,net),index=fixture.versions.multi;
  net.break(index.baseline.packages[1].url);await images.prepare(index);
  assert.equal(images.status().phase,'error');assert.equal(store.metadata.get('initialized'),undefined);
  assert.equal(store.objects.size,1);assert.equal(net.calls.length,2);
  net.break(null);await images.prepare(index);assert.equal(images.status().phase,'ready');
  assert.equal(net.calls.length,3);assert.equal(net.calls.filter(url=>url===index.baseline.packages[0].url).length,1);images.dispose();
});

test('增量失败保留旧图，重试只下载缺失图片；缓存对象损坏也重新校验',async()=>{
  const store=memory(),net=network(),images=manager(store,net);
  await images.prepare(fixture.versions.one);
  const row=fixture.versions.two.files['ui-icons/second.png'],url=fixture.versions.two.cdn_base_url+'objects/'+row.sha256+'.png';
  net.break(url);let urls=await images.prepare(fixture.versions.two);assert.equal(images.status().phase,'error');assert.equal(Object.keys(urls).length,1);
  net.break(null);await images.prepare(fixture.versions.two);assert.equal(images.status().phase,'ready');
  store.objects.set(row.sha256+'.png',new Blob(['bad']));await images.prepare(fixture.versions.two);
  assert.equal(net.calls.filter(value=>value===url).length,3);images.dispose();
});

test('空间不足不宣称就绪，也不继续消耗增量流量',async()=>{
  const store=memory(),net=network(),images=manager({...store,pack:async()=>{throw new DOMException('full','QuotaExceededError');}},net);
  await images.prepare(fixture.versions.two);assert.equal(images.status().error,'image_storage_full');assert.ok(net.calls.length<=2);assert.equal(store.metadata.get('initialized'),undefined);images.dispose();
});

test('未允许的来源和不匹配的基础包不能进入缓存',async()=>{
  const store=memory(),net=network(),images=createImageManager({store,fetcher:net.fetch,allowedOrigins:[]});
  await images.prepare(fixture.versions.one);assert.equal(images.status().error,'image_source_not_allowed');assert.equal(net.calls.length,0);images.dispose();
  const pack=fixture.versions.one.baseline.packages[0];
  await assert.rejects(unpackImageBase(Buffer.from('bad'),pack));
  const bad=clone(fixture.versions.one);bad.baseline.packages[0].objects={};assert.throws(()=>validateImageDelivery(bad));
});

test('基础图片未重复存到 CDN，局部缓存丢失从相关基础分段恢复',async()=>{
  const store=memory(),net=network(),images=manager(store,net);
  await images.prepare(fixture.versions.two);
  const key=fixture.versions.one.files['ui-icons/first.png'].sha256+'.png';store.objects.delete(key);
  const before=net.calls.length;await images.prepare(fixture.versions.two);
  assert.equal(images.status().phase,'ready');assert.equal(net.calls.length,before+1);assert.match(net.calls.at(-1),/release/);
  images.dispose();
});

test('两个下载槽与单写入队列有界，后处理结束前不积压第三个包',async()=>{
  const index=clone(fixture.versions.multi),store=memory(),calls=[],gates=new Map();
  const third=new Uint8Array([1,2,3]);const hash=await crypto.subtle.digest('SHA-256',third);const sha=Buffer.from(hash).toString('hex');
  index.files['ui-icons/third.png']={sha256:sha,bytes:3};index.cdn_objects.push(sha+'.png');
  let writing=0,maxWriting=0,unlock;const saving=new Promise(resolve=>{unlock=resolve;});
  const images=createImageManager({store:{...store,pack:async(...args)=>{writing++;maxWriting=Math.max(maxWriting,writing);await saving;await store.pack(...args);writing--;}},
    allowedOrigins:['https://release.example.invalid','https://cdn.example.invalid'],
    fetcher:async url=>{calls.push(url);if(calls.length<=2)await new Promise(resolve=>gates.set(url,resolve));return new Response(fixture.packages[url]?Buffer.from(fixture.packages[url],'base64'):third);}});
  const done=images.prepare(index);
  for(let i=0;i<100&&calls.length<2;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(calls.length,2);for(const resolve of gates.values())resolve();
  for(let i=0;i<100&&!writing;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(calls.length,2);assert.equal(writing,1);unlock();await done;
  assert.equal(maxWriting,1);assert.equal(calls.length,3);assert.equal(images.status().phase,'ready');
  assert.equal(images.status().bytes,images.status().totalBytes);assert.ok(images.status().tasks.every(task=>task.times.download>=0));images.dispose();
});

test('停止任务可结束等待，重试只获取未成功对象',async()=>{
  const store=memory(),index=clone(fixture.versions.multi);let first=true;
  const images=createImageManager({store,allowedOrigins:['https://release.example.invalid'],fetcher:async(url,options)=>{
    if(first)await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true}));
    return new Response(Buffer.from(fixture.packages[url],'base64'));
  }});
  const task=images.prepare(index);await new Promise(resolve=>setTimeout(resolve,5));images.cancel();await task;
  assert.equal(images.status().phase,'cancelled');first=false;await images.retry();assert.equal(images.status().phase,'ready');images.dispose();
});

test('响应流超时不能冒充用户停止或图片已经就绪',async()=>{
  const images=createImageManager({store:memory(),allowedOrigins:['https://release.example.invalid'],fetcher:async()=>new Response(new ReadableStream({start(controller){controller.error(new DOMException('stream timeout','AbortError'));}}))});
  await images.prepare(fixture.versions.one);
  assert.equal(images.status().phase,'error');assert.equal(images.status().error,'image_timeout');assert.equal(images.status().completed,0);images.dispose();
});
