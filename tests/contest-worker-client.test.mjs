import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createContestWorkerClient} from '../application/contest-worker-client.mjs';

// 替换浏览器 Worker 边界，协议派发、计时、结算和资源释放均使用正式客户端。
function setup(t){
  t.mock.timers.enable({apis:['setTimeout']});
  const worker={sent:[],terminated:0,postMessage(data){this.sent.push(data);},terminate(){this.terminated++;}};
  const client=createContestWorkerClient({createWorker:()=>worker,cancelMessage:'Search cancelled'});
  return {worker,client,message:data=>worker.onmessage({data})};
}

test('串行协议透传批次与会话参数，进度不会结算请求',async t=>{
  const p=setup(t),progress=[];
  for(const mode of ['batch-scores','session-start','session-advance','session-finish','optimization-validate']){
    const data={mode,runs:100,offset:4,seed:73,sessionId:'candidate-a',request:{params:{vocal:100}},options:[]},run=p.client.run(data,value=>progress.push(value));
    assert.equal(p.worker.sent.at(-1),data);p.message({type:'progress',completed:10});p.message({type:'result',result:{mode}});assert.deepEqual(await run,{mode});
  }
  assert.deepEqual(progress,[10,10,10,10,10]);t.mock.timers.tick(120001);assert.equal(p.worker.terminated,0);p.client.cancel();assert.equal(p.worker.terminated,1);
});

test('候选错误保留 code 和 details，后续请求可继续',async t=>{
  const p=setup(t),run=p.client.run({mode:'batch-scores',runs:1}),details=[{name:'unsupported'}];
  p.message({type:'error',code:'unsupported_entities',details});await assert.rejects(run,error=>error.code==='unsupported_entities'&&error.details===details);
  const next=p.client.run({mode:'session-start',runs:100});p.message({type:'result',result:123});assert.equal(await next,123);p.client.cancel();
});

test('取消立即拒绝并释放 Worker，迟到消息与重复取消无副作用',async t=>{
  const p=setup(t),progress=[],run=p.client.run({runs:1},value=>progress.push(value));p.client.cancel();
  await assert.rejects(run,{name:'AbortError',message:'Search cancelled'});p.message({type:'progress',completed:1});p.message({type:'result',result:1});p.client.cancel();t.mock.timers.tick(200000);
  assert.deepEqual(progress,[]);assert.equal(p.worker.terminated,1);await assert.rejects(p.client.run({runs:1}),{name:'AbortError'});
});

test('超时保留按模拟次数扩展的期限并释放 Worker',async t=>{
  const p=setup(t),run=p.client.run({runs:3000});t.mock.timers.tick(120000);assert.equal(p.worker.terminated,0);t.mock.timers.tick(60000);
  await assert.rejects(run,{code:'simulation_timeout'});assert.equal(p.worker.terminated,1);p.client.cancel();assert.equal(p.worker.terminated,1);
});

test('Worker 崩溃与消息发送异常都清理等待和计时器',async t=>{
  const p=setup(t),run=p.client.run({runs:1});let prevented=false;p.worker.onerror({preventDefault(){prevented=true;}});await assert.rejects(run,{code:'engine_failed'});assert.equal(prevented,true);assert.equal(p.worker.terminated,1);
  const worker={postMessage(){throw new Error('clone_failed');},terminate(){this.terminated=true;}},client=createContestWorkerClient({createWorker:()=>worker});
  await assert.rejects(client.run({}),{message:'clone_failed'});assert.equal(worker.terminated,true);t.mock.timers.tick(200000);
});
