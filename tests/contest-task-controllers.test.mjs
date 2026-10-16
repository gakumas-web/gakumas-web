import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {createContestComputeGate} from '../application/contest-compute-gate.mjs';
import {createContestSimulationController} from '../application/contest-simulation-controller.mjs';
import {createContestMultiplierController} from '../application/contest-multiplier-controller.mjs';

// 仅替换 Worker 与存储边界，记录创建、状态转换、取消和过期过滤均走正式控制器。
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function transport(){
  const jobs=[];
  return {jobs,start(request,options){const job={...deferred(),request,options,cancelled:false,cancel(){this.cancelled=true;}};jobs.push(job);return job;}};
}
const input={request:{params:{vocal:100}},stage:{kind:'contest',id:'stage-a'},characterId:'synthetic-character',loadout:{memories:[]}};
const options={runs:100,multiCore:false,signature:'input-a'};
const result={runs:100,scores:[10,20],seed:1};

test('正式模拟固定历史归属，进度和完成结果进入同一生命周期',async()=>{
  const worker=transport(),events=[],writes=[],saved=deferred();
  const controller=createContestSimulationController({gate:createContestComputeGate(),profile:'synthetic-a',lifecycleId:'lifecycle-a',start:worker.start,remember:(profile,entry,lifecycleId)=>{writes.push({profile,entry,lifecycleId});return saved.promise;},onEvent:event=>events.push(event)});
  const run=controller.run(input,options);assert.equal(controller.running,true);
  await controller.run(input,options);assert.equal(worker.jobs.length,1);
  worker.jobs[0].options.onProgress(50);assert.deepEqual(events.at(-1),{type:'progress',count:50,runs:100});
  worker.jobs[0].resolve(result);await setImmediate();
  assert.equal(controller.running,true);assert.equal(controller.signature,'input-a');
  assert.equal(controller.entry.stageKey,'contest:stage-a');assert.deepEqual(controller.entry.result,result);
  assert.equal(writes[0].profile,'synthetic-a');assert.equal(writes[0].lifecycleId,'lifecycle-a');assert.equal(writes[0].entry,controller.entry);
  assert.notEqual(controller.entry.request,input.request);assert.notEqual(controller.entry.loadout,input.loadout);
  assert.equal(controller.restore(null,''),false);
  saved.resolve(true);await run;assert.equal(controller.running,false);
  assert.deepEqual(events.map(event=>event.type),['started','progress','completed','saved','idle']);
});

test('重跑停止或失败保留上次结果和签名，失败后可重新启动',async()=>{
  const worker=transport(),events=[],old={result:{runs:500}};
  const controller=createContestSimulationController({gate:createContestComputeGate(),profile:'synthetic-a',start:worker.start,remember:async()=>true,onEvent:event=>events.push(event)});
  assert.equal(controller.restore(old,'history'),true);
  let run=controller.run(input,options);controller.stop();assert.equal(worker.jobs[0].cancelled,true);
  worker.jobs[0].reject(new DOMException('Stopped','AbortError'));await run;
  assert.equal(controller.entry,old);assert.equal(controller.signature,'history');assert.equal(controller.running,false);
  assert.deepEqual(events.slice(-2).map(event=>event.type),['stopped','idle']);
  run=controller.run(input,options);worker.jobs[1].reject(Object.assign(new Error('failed'),{code:'engine_failed'}));await run;
  assert.equal(controller.entry,old);assert.deepEqual(events.slice(-2).map(event=>event.type),['failed','idle']);
  run=controller.run(input,options);worker.jobs[2].resolve(result);await run;assert.deepEqual(controller.entry.result,result);
});

test('历史写入失败仍保留新结果并解除忙碌',async()=>{
  const worker=transport(),events=[];
  const controller=createContestSimulationController({gate:createContestComputeGate(),profile:'synthetic-a',start:worker.start,remember:async()=>{throw new Error('storage_failed');},onEvent:event=>events.push(event)});
  const run=controller.run(input,options);worker.jobs[0].resolve(result);await run;
  assert.deepEqual(controller.entry.result,result);assert.equal(controller.signature,'input-a');assert.equal(controller.running,false);
  assert.deepEqual(events.map(event=>event.type),['started','completed','save-failed','idle']);
});

test('销毁取消任务并忽略迟到结果、进度，不写入历史或接受新任务',async()=>{
  const worker=transport(),events=[],writes=[];
  const controller=createContestSimulationController({gate:createContestComputeGate(),profile:'synthetic-a',start:worker.start,remember:async(...args)=>writes.push(args),onEvent:event=>events.push(event)});
  const run=controller.run(input,options);controller.dispose();assert.equal(worker.jobs[0].cancelled,true);
  worker.jobs[0].options.onProgress(100);worker.jobs[0].resolve(result);await run;await controller.run(input,options);
  assert.equal(controller.running,false);assert.equal(controller.entry,null);assert.equal(controller.restore({},'history'),false);
  assert.equal(worker.jobs.length,1);assert.deepEqual(writes,[]);assert.deepEqual(events.map(event=>event.type),['started']);
});

test('历史保存中销毁不向已退出的界面通知，启动异常可解除忙碌',async()=>{
  const worker=transport(),events=[],saved=deferred();
  const controller=createContestSimulationController({gate:createContestComputeGate(),profile:'synthetic-a',start:worker.start,remember:()=>saved.promise,onEvent:event=>events.push(event)});
  const run=controller.run(input,options);worker.jobs[0].resolve(result);await setImmediate();controller.dispose();saved.reject(new Error('storage_failed'));await run;
  assert.deepEqual(events.map(event=>event.type),['started','completed']);
  const failureEvents=[],failed=createContestSimulationController({gate:createContestComputeGate(),start:()=>{throw new Error('worker_failed');},onEvent:event=>failureEvents.push(event)});
  await failed.run(input,options);assert.equal(failed.running,false);assert.deepEqual(failureEvents.map(event=>event.type),['started','failed','idle']);
});

function preview(t){
  t.mock.timers.enable({apis:['setTimeout']});
  const worker=transport(),events=[];
  const controller=createContestMultiplierController({stage:input.stage,supportCards:[],start:worker.start,onEvent:event=>events.push(event)});
  return {...worker,events,controller,async finish(index=worker.jobs.length-1,values={vocal:1,dance:2,visual:3}){worker.jobs[index].resolve(values);await setImmediate();},startPending(){t.mock.timers.tick(160);}};
}
const params={vocal:100,dance:200,visual:300,stamina:50};

test('倍率防抖只提交最终输入，体力变化不重算，单属性完成只通知该属性',async t=>{
  const p=preview(t);p.controller.update(params);t.mock.timers.tick(159);assert.equal(p.jobs.length,0);
  p.controller.update({...params,vocal:101});p.startPending();assert.equal(p.jobs.length,1);assert.equal(p.jobs[0].request.params.vocal,101);await p.finish();
  p.controller.update({...params,vocal:101,stamina:60});p.startPending();assert.equal(p.jobs.length,1);assert.deepEqual(p.events.at(-1),{type:'pending',pending:[],cleared:[]});
  p.controller.update({...params,vocal:102});assert.deepEqual(p.events.at(-1).pending,['vocal']);p.startPending();await p.finish(1,{vocal:1.2,dance:99,visual:99});
  assert.deepEqual(p.events.at(-2),{type:'completed',values:{vocal:1.2}});
});

test('取消的未完成项继续计算，旧任务的完成与错误不能覆盖新状态',async t=>{
  const p=preview(t);p.controller.update(params);p.startPending();await p.finish();
  p.controller.update({...params,vocal:101});p.startPending();
  p.controller.update({...params,vocal:101,dance:201});assert.equal(p.jobs[1].cancelled,true);assert.deepEqual(p.events.at(-1).pending,['vocal','dance']);p.startPending();
  const count=p.events.length;await p.finish(1,{vocal:99});assert.equal(p.events.length,count);
  p.controller.update({...params,vocal:102,dance:201});p.startPending();const next=p.events.length;p.jobs[2].reject(new Error('stale'));await setImmediate();assert.equal(p.events.length,next);
  await p.finish(3,{vocal:1.02,dance:2.01});assert.deepEqual(p.events.at(-2),{type:'completed',values:{vocal:1.02,dance:2.01}});
});

test('属性改回缓存旧值仍恢复已清空的显示，清空和非有限结果可重新计算',async t=>{
  const p=preview(t);p.controller.update(params);p.startPending();await p.finish();
  p.controller.update({...params,vocal:101});p.controller.update(params);assert.deepEqual(p.events.at(-1).pending,['vocal']);p.startPending();await p.finish();
  p.controller.update({...params,dance:undefined});assert.deepEqual(p.events.at(-1),{type:'pending',pending:[],cleared:['dance']});
  p.controller.update(params);p.startPending();await p.finish(2,{dance:NaN});
  p.controller.update(params);assert.deepEqual(p.events.at(-1).pending,['dance']);p.startPending();await p.finish(3,{dance:2});
});

test('倍率失败支持相同输入重试，销毁后不再通知或调度',async t=>{
  const p=preview(t);p.controller.update(params);p.startPending();p.jobs[0].reject(new Error('preview_failed'));await setImmediate();
  assert.deepEqual(p.events.slice(-2).map(event=>event.type),['failed','idle']);
  p.controller.update(params);p.startPending();await p.finish();
  p.controller.update({...params,vocal:101});p.startPending();p.controller.dispose();assert.equal(p.jobs[2].cancelled,true);const count=p.events.length;
  await p.finish(2);p.controller.update(params);p.startPending();assert.equal(p.events.length,count);assert.equal(p.jobs.length,3);
});

test('防抖等待期间销毁不会启动 Worker',t=>{
  const p=preview(t);p.controller.update(params);p.controller.dispose();p.startPending();assert.equal(p.jobs.length,0);
});

test('正式模拟等待时冻结输入，可取消等待且保持跨控制器 FIFO',async()=>{
  const gate=createContestComputeGate(),owner=gate.acquire(),worker=transport(),events=[];
  const make=()=>createContestSimulationController({gate,start:worker.start,remember:async()=>true,onEvent:event=>events.push(event.type)});
  const first=make(),cancelled=make(),last=make(),snapshot=structuredClone(input);
  const a=first.run(snapshot,options),b=cancelled.run(input,options),c=last.run(input,options);
  assert.equal(first.running,true);assert.equal(first.queued,true);assert.equal(worker.jobs.length,0);
  snapshot.request.params.vocal=999;snapshot.stage.id='edited';snapshot.loadout.memories.push({edited:true});
  cancelled.stop();await b;assert.equal(cancelled.running,false);assert.equal(cancelled.queued,false);assert.equal(gate.pending,2);
  owner.release();await setImmediate();assert.equal(first.queued,false);assert.equal(worker.jobs.length,1);
  assert.equal(worker.jobs[0].request.params.vocal,100);assert.equal(last.queued,true);
  worker.jobs[0].resolve(result);await a;await setImmediate();assert.equal(worker.jobs.length,2);
  assert.equal(first.entry.stageKey,'contest:stage-a');assert.deepEqual(first.entry.loadout,{memories:[]});
  worker.jobs[1].resolve(result);await c;assert.equal(gate.busy,false);assert.equal(gate.pending,0);
  assert.equal(events.filter(type=>type==='queued').length,3);assert.equal(events.filter(type=>type==='started').length,2);
});

test('等待任务销毁不启动 Worker，前一个任务启动失败后释放给后续任务',async()=>{
  const gate=createContestComputeGate(),owner=gate.acquire(),worker=transport(),events=[];
  const disposed=createContestSimulationController({gate,start:worker.start,remember:async()=>true});
  const failed=createContestSimulationController({gate,start:()=>{throw new Error('startup_failed');},onEvent:event=>events.push(event.type)});
  const next=createContestSimulationController({gate,start:worker.start,remember:async()=>true});
  const old=disposed.run(input,options),bad=failed.run(input,options),good=next.run(input,options);
  disposed.dispose();await old;assert.equal(worker.jobs.length,0);assert.equal(gate.pending,2);
  owner.release();await bad;await setImmediate();assert.equal(worker.jobs.length,1);
  assert.deepEqual(events,['queued','started','failed','idle']);assert.equal(gate.busy,true);
  worker.jobs[0].resolve(result);await good;assert.equal(gate.busy,false);
});

test('排队通知同步失败也移除自身等待票据，不占住后续任务',async()=>{
  const gate=createContestComputeGate(),owner=gate.acquire(),events=[];
  const failed=createContestSimulationController({gate,onEvent:event=>{if(event.type==='queued')throw new Error('view_failed');events.push(event.type);}});
  await failed.run(input,options);assert.equal(failed.running,false);assert.equal(gate.pending,0);
  assert.equal(owner.granted,true);assert.deepEqual(events,['failed','idle']);owner.release();assert.equal(gate.busy,false);
});
