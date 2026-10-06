import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentManager} from '../application/content-manager.mjs';
import {contentFixture,memoryContentStore} from './fixtures/content.mjs';

const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
function closedResponse(body,status,signal){
  if(signal.aborted)throw signal.reason;
  const bytes=new TextEncoder().encode(body);
  return new Response(new ReadableStream({start(stream){stream.enqueue(bytes);stream.close();}}),{status});
}
for(const mode of ['503','timeout','abort','hash','cached']){
  test(`公共资料失败后同批迟到进度不能改变终态：${mode}`,async()=>{
    const cached=mode==='cached',old=cached?await contentFixture('old',{stable:true}):null;
    const fixture=await contentFixture('next',{stable:cached,characters:{hski:'新名称'}});
    const store=memoryContentStore(old?{...old.bundle,origin:'local'}:undefined),states=[];
    let started,release,fail=true;
    const entered=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    const manager=createContentManager({channelURL:'https://example.invalid/content/channel.json',store,install:()=>{},fetcher:async(url,{signal})=>{
      const name=new URL(url).pathname.split('/').at(-1);
      if(fail&&name==='catalog.json'){
        started();await gate;
        if(mode==='timeout'||mode==='abort')throw new DOMException('合成请求中止',mode==='timeout'?'TimeoutError':'AbortError');
        if(mode==='hash')return closedResponse(fixture.files[name].replace('新名称','错名称'),200,signal);
        return closedResponse('unavailable',503,signal);
      }
      const body=name==='channel.json'?JSON.stringify(fixture.channel):name==='manifest.json'?fixture.raw:fixture.files[name];
      // 已关闭的正文仍会继续执行读取与校验后的微任务，网络中止无法撤回它们。
      return (async()=>closedResponse(body,200,signal))();
    }});
    manager.subscribe(state=>states.push(state));
    if(cached)await manager.initialize();
    const rejected=(cached?manager.refresh():manager.initialize()).catch(error=>error);
    await entered;release();assert.ok(await rejected instanceof Error);await settle();
    const terminal=states.findIndex(state=>state.error);
    assert.ok(terminal>=0);assert.equal(manager.status().phase,cached?'ready':'unavailable');
    assert.deepEqual(states.slice(terminal),[states[terminal]],'已关闭任务不得再发布进度、修改总量或校验阶段');
    assert.equal(store.writes,0);assert.equal(manager.status().version,cached?'old':null);
    if(cached)assert.equal(store.value.manifest_sha256,old.bundle.manifest_sha256);
    fail=false;await manager.refresh();await settle();
    assert.equal(store.writes,1);assert.equal(manager.status().error,null);
    assert.equal(manager.status().phase,cached?'update-ready':'ready');
  });
}
