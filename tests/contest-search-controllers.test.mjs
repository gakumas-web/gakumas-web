import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {installMaster} from '../domain/catalog.mjs';
import {createContestRecommendationController} from '../application/contest-recommendation-controller.mjs';
import {createContestOptimizationController} from '../application/contest-optimization-controller.mjs';

const {communityRules}=JSON.parse(readFileSync(new URL('./fixtures/public-data/reference-data.json',import.meta.url)));
const cards=['exclusive','common-a','common-b','common-c','common-d','common-e'].map(id=>({id,upgradeCount:0,name:id,rarity:'ProduceCardRarity_Ssr',category:'ProduceCardCategory_ActiveSkill',images:{},descriptions:[],playEffects:[],definition:{planType:'ProducePlanType_Plan1',unlockProducerLevel:5,...(id==='exclusive'?{originIdolCardId:'owned-idol'}:{})}}));
installMaster({communityRules,tables:{ProduceCard:cards,ProduceItem:[],ProduceEffect:[],ProduceExamEffect:[],ProduceSkill:[],MemoryAbility:[]},idols:{cards:[{id:'owned-idol',characterId:'hski'}]}});
const params={vocal:1000,dance:1200,visual:900,stamina:40};
const memories=['a','b'].map(key=>({key,characterId:'hski',idolCardId:'owned-idol',planType:2,...params,examBattleProduceCards:[{id:'common-a',upgradeCount:0,customizes:[]},{id:'exclusive',upgradeCount:0,customizes:[]}],produceCard:{id:'exclusive',upgradeCount:0,customizes:[]},examBattleProduceItemIds:[]}));
const context={stage:{id:'stage-a',planType:'ProducePlanType_Plan1'},memories,supportCards:[],manual:{},idolCards:[{idolCardId:'owned-idol',levelLimitRank:0,potentialRank:0}],producerLevel:60,conversionRules:{excludedCardIds:[]}};
const form={params:Object.fromEntries(Object.entries(params).map(([key,value])=>[key,String(value)])),roles:[0,1].map(()=>({exclusiveId:'exclusive',grade:'15'})),items:[],seed:'123'};
const options={signature:'form-a',multiCore:true,budget:{population:8}};
function workerBoundary(){
  const jobs=[];
  return {jobs,start(input,options){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});const job={input,options,promise,resolve,reject,cancelled:false,cancel(){this.cancelled=true;}};jobs.push(job);return job;}};
}
const abort=()=>new DOMException('Stopped','AbortError');
function recommendation(){const worker=workerBoundary(),events=[],controller=createContestRecommendationController({start:worker.start,onEvent:event=>events.push(event)});controller.setContext(context);return {...worker,events,controller};}
function optimization(t,initialState){t.mock.timers.enable({apis:['setTimeout']});const worker=workerBoundary(),events=[],controller=createContestOptimizationController({initialState,start:worker.start,onEvent:event=>events.push(event)});controller.setContext(context);return {...worker,events,controller,async prepare(){t.mock.timers.tick(0);await setImmediate();}};}

test('回忆搜索使用正式筛选与编组副本，结果可捕获恢复且同上下文不取消',async()=>{
  const p=recommendation(),run=p.controller.run('hski',{multiCore:true});
  assert.equal(p.controller.running,true);assert.equal(p.controller.setContext({...context}),false);
  assert.equal(p.jobs[0].cancelled,false);assert.equal(p.jobs[0].input.memories.length,2);
  assert.notEqual(p.jobs[0].input.memories[0].examBattleProduceCards,memories[0].examBattleProduceCards);
  p.jobs[0].options.onProgress({phase:'final',completed:1});assert.equal(p.events.at(-1).type,'progress');
  p.jobs[0].resolve({rows:[],seed:123});await run;
  const result=p.controller.resultFor('hski');assert.equal(result.originals[0],memories[0]);assert.equal(result.stage,context.stage);assert.equal(result.report.seed,123);
  const restored=createContestRecommendationController({initialState:{results:p.controller.captureResults()}});restored.setContext(context);assert.equal(restored.resultFor('hski'),result);
  restored.setContext({...context,manual:{vocal:2}});assert.equal(restored.resultFor('hski'),null);
  assert.deepEqual(p.events.map(event=>event.type),['started','progress','completed','idle']);
});

test('回忆搜索停止与失败保留已完成结果，重复启动被阻止',async()=>{
  const p=recommendation();let run=p.controller.run('hski');p.jobs[0].resolve({rows:[]});await run;const previous=p.controller.resultFor('hski');
  run=p.controller.run('hski');await p.controller.run('hski');assert.equal(p.jobs.length,2);p.controller.stop();assert.equal(p.jobs[1].cancelled,true);p.jobs[1].reject(abort());await run;
  assert.equal(p.controller.resultFor('hski'),previous);assert.equal(p.controller.running,false);assert.equal(p.events.at(-2).type,'stopped');
  run=p.controller.run('hski');p.jobs[2].reject(new Error('worker_failed'));await run;assert.equal(p.controller.resultFor('hski'),previous);assert.equal(p.events.at(-2).type,'failed');
});

test('回忆上下文替换后旧任务不能写入缓存或干扰新任务，销毁抑制全部迟到事件',async()=>{
  const p=recommendation(),old=p.controller.run('hski');
  p.controller.setContext({...context,stage:{...context.stage,id:'stage-b'}});assert.equal(p.jobs[0].cancelled,true);assert.equal(p.events.at(-1).type,'invalidated');
  const next=p.controller.run('hski'),count=p.events.length;p.jobs[0].options.onProgress({phase:'final'});p.jobs[0].resolve({old:true});await old;
  assert.equal(p.events.length,count);assert.equal(p.controller.running,true);assert.equal(p.controller.resultFor('hski'),null);
  p.controller.dispose();assert.equal(p.jobs[1].cancelled,true);p.jobs[1].reject(abort());await next;await p.controller.run('hski');assert.equal(p.events.length,count);assert.equal(p.jobs.length,2);
});

test('回忆搜索启动异常释放忙碌状态',async()=>{
  const events=[],p=createContestRecommendationController({start:()=>{throw new Error('worker_failed');},onEvent:event=>events.push(event)});p.setContext(context);await p.run('hski');
  assert.equal(p.running,false);assert.deepEqual(events.map(event=>event.type),['started','failed','idle']);
});

test('推荐搜索通过正式约束投影，保留种子、预算、结果签名和原舞台上下文',async t=>{
  const p=optimization(t),run=p.controller.run(form,options);await p.prepare();assert.equal(p.jobs.length,1);
  const job=p.jobs[0];assert.equal(job.options.seed,123);assert.equal(job.options.budget,options.budget);assert.equal(job.options.multiCore,true);
  assert.equal(job.input.input.roles[0].template.vocal,params.vocal);assert.equal(job.input.input.roles[1].template.vocal,0);assert.ok(job.input.input.probes.length>0);
  job.options.onProgress({phase:'search',completed:1});job.resolve({rows:[],seed:123});await run;
  assert.equal(p.controller.report.seed,123);assert.equal(p.controller.reportSignature,'form-a');assert.equal(p.controller.reportContext.stage,context.stage);assert.notEqual(p.controller.reportContext.manual,context.manual);
  const restored=createContestOptimizationController({initialState:p.controller.captureState()});restored.setContext(context);assert.equal(restored.report,p.controller.report);
  restored.setContext({...context,producerLevel:61});assert.equal(restored.report,null);
  assert.deepEqual(p.events.map(event=>event.type),['preparing','started','progress','completed','idle']);
});

test('推荐准备阶段可停止，输入投影失败不启动 Worker 且可恢复',async t=>{
  const p=optimization(t);let run=p.controller.run(form,options);p.controller.stop();await p.prepare();await run;
  assert.equal(p.jobs.length,0);assert.equal(p.controller.running,false);assert.deepEqual(p.events.map(event=>event.type),['preparing','stopped','idle']);
  run=p.controller.run({...form,params:{...form.params,stamina:''}},options);await p.prepare();await run;
  assert.equal(p.jobs.length,0);assert.equal(p.events.at(-2).error.code,'optimization_missing_parameters');assert.equal(p.controller.running,false);
  run=p.controller.run(form,options);await p.prepare();p.jobs[0].resolve({rows:[]});await run;assert.ok(p.controller.report);
});

test('推荐搜索取消和失败保留上次结果与签名',async t=>{
  const p=optimization(t);let run=p.controller.run(form,options);await p.prepare();p.jobs[0].resolve({rows:[],seed:123});await run;const report=p.controller.report;
  for(const error of [abort(),new Error('worker_failed')]){
    run=p.controller.run(form,{...options,signature:'form-b'});await p.prepare();await p.controller.run(form,options);const job=p.jobs.at(-1);p.controller.stop();assert.equal(job.cancelled,true);job.reject(error);await run;
    assert.equal(p.controller.report,report);assert.equal(p.controller.reportSignature,'form-a');assert.equal(p.controller.running,false);
  }
  assert.equal(p.jobs.length,3);
});

test('推荐上下文变更和销毁丢弃旧响应，准备期间变更不启动旧 Worker',async t=>{
  const p=optimization(t);let old=p.controller.run(form,options);p.controller.setContext({...context,producerLevel:61});await p.prepare();await old;assert.equal(p.jobs.length,0);
  old=p.controller.run(form,options);await p.prepare();p.controller.setContext({...context,producerLevel:62});assert.equal(p.jobs[0].cancelled,true);
  const next=p.controller.run(form,options);await p.prepare();const count=p.events.length;p.jobs[0].options.onProgress({phase:'search'});p.jobs[0].resolve({old:true});await old;
  assert.equal(p.events.length,count);assert.equal(p.controller.running,true);assert.equal(p.controller.report,null);
  p.controller.dispose();p.jobs[1].resolve({old:true});await next;await p.controller.run(form,options);assert.equal(p.events.length,count);assert.equal(p.jobs.length,2);
});
