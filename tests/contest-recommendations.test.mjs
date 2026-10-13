import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {recommendationMemories,recommendationPairCount,recommendationPairs,recommendationStatistics,compareRecommendations,promoteRecommendations,recommendationPhases,RECOMMENDATION_FINAL_BUDGETS,recommendationRoughLimit,recommendationUncertainty,recommendationRefinements} from '../domain/contest-recommendations.mjs';
import {contestCardEffectScore} from '../domain/contest-card-effect-score.mjs';
import {sampleContestScores,sampleContestScoreBatch,runContestSimulation,createContestSimulationSession} from '../domain/contest-engine-runner.mjs';

const stage={planType:'ProducePlanType_Plan1',curve:[]};
const memory=(key,extra={})=>({key,characterId:'hski',planType:2,vocal:1000,dance:1200,visual:1400,stamina:40,examBattleProduceCards:[{id:'a',upgradeCount:1,customizes:[]}],examBattleProduceItemIds:['item'],...extra});
test('两层搜索覆盖全部有序主副组合，排除同槽并遵守偶像和舞台计划',()=>{
  const input=[memory('a'),memory('b'),memory('c'),memory('other',{characterId:'ttmr'}),memory('wrong',{planType:3}),memory('empty',{examBattleProduceCards:[]})];
  const eligible=recommendationMemories(input,stage,'hski'),pairs=[...recommendationPairs(eligible)];
  assert.equal(eligible.length,3);assert.equal(pairs.length,6);assert.ok(pairs.every(pair=>pair.main!==pair.sub));
  assert.deepEqual(new Set(pairs.map(pair=>pair.id)),new Set(['0:1','0:2','1:0','1:2','2:0','2:1']));
  assert.equal([...recommendationPairs([memory('same'),memory('same')])].length,0);
});
test('推荐分对称奖励上行并惩罚下行，保留完整方差统计且不修改样本',()=>{
  const scores=[120,80,100],before=[...scores],variable=recommendationStatistics(scores),stable=recommendationStatistics([98,100,102]);
  assert.deepEqual(scores,before);assert.deepEqual(variable,{runs:3,mean:100,median:100,variance:400,deviation:20,downside:Math.sqrt(400/3),upside:Math.sqrt(400/3),score:100});
  assert.equal(stable.score,100);assert.ok(compareRecommendations({stats:stable,main:0,sub:1},{stats:variable,main:1,sub:0})<0);
  assert.equal(recommendationStatistics([10,20]).median,15);assert.throws(()=>recommendationStatistics([NaN]));
});
test('高分尾部获得同系数奖励，上下行偏离均按全部样本衡量频率',()=>{
  const stable=recommendationStatistics([100,100,100,100,100]),upside=recommendationStatistics([100,100,100,100,200]),lower=recommendationStatistics([0,100,100,100,100]);
  assert.equal(stable.score,100);assert.equal(upside.mean,120);assert.equal(upside.median,100);assert.equal(upside.downside,0);assert.equal(upside.upside,Math.sqrt(2000));assert.equal(upside.score,110+.25*Math.sqrt(2000));assert.ok(upside.deviation>0);
  assert.equal(lower.upside,0);assert.equal(lower.downside,Math.sqrt(2000));assert.equal(lower.score,90-.25*Math.sqrt(2000));assert.equal(recommendationStatistics([200]).score,200);
});
test('最终复评从五百次直接追加到两千次，初筛给有潜力的高波动组合保留名额',()=>{
  assert.deepEqual(RECOMMENDATION_FINAL_BUDGETS,[500,2000]);
  assert.deepEqual(recommendationPhases(100).map(phase=>[phase.runs,phase.limit]),[[4,undefined],[16,40],[64,20],[500,10]]);
  assert.deepEqual(recommendationPhases(30).map(phase=>phase.runs),[64,500]);assert.deepEqual(recommendationPhases(12).map(phase=>phase.runs),[500]);
  const rows=Array.from({length:10},(_,index)=>({id:String(index),main:index,sub:0,stats:{score:100-index,mean:100-index,median:100-index,deviation:0,runs:16}}));
  rows.push({id:'potential',main:20,sub:0,stats:{score:85,mean:100,median:100,deviation:80,runs:16}});
  const selected=promoteRecommendations(rows,4);assert.equal(selected.length,4);assert.ok(selected.some(row=>row.id==='potential'));assert.ok(selected.some(row=>row.id==='0'));
});
test('初筛实际得分与完整模拟在相同种子下完全一致',async()=>{
  const source=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-engine.json',import.meta.url)));
  for(const request of source.requests){
    const sampled=await sampleContestScores(request,{runs:3,seed:42,cardEffects:true}),full=await runContestSimulation(request,{runs:3,seed:42});
    assert.deepEqual([...sampled.scores].sort((a,b)=>a-b),full.scores);
    assert.equal(sampled.cardEffectScores.length,3);assert.ok(sampled.cardEffectScores.every(score=>Number.isFinite(score)&&score>0));
  }
});

test('牌效初筛削弱属性倍率优势，保留舞台权重且不改写对局日志',()=>{
  const logs=score=>[{logType:'startTurn',data:{type:'vocal'}},{logType:'diff',data:{field:'score',prev:0,next:score}}];
  const weak=logs(100),strong=logs(30),before=structuredClone(weak);
  assert.equal(contestCardEffectScore(weak,'score',{vocal:10},{vocal:.2}),2);
  assert.equal(contestCardEffectScore(strong,'score',{vocal:2},{vocal:.2}),3);
  assert.equal(contestCardEffectScore(logs(60),'score',{vocal:4},{vocal:.2}),3);
  assert.equal(contestCardEffectScore(strong,'score',{vocal:2},{vocal:.4}),6);
  assert.equal(contestCardEffectScore(logs(0),'score',{vocal:0},{vocal:.2}),0);assert.deepEqual(weak,before);
});

test('主位不按道具硬筛选，专属、空列表和未知道具均进入有序组合',()=>{
  const memories=[memory('main',{examBattleProduceItemIds:['exclusive','support']}),memory('exclusive',{examBattleProduceItemIds:['exclusive']}),memory('empty',{examBattleProduceItemIds:[]}),memory('unknown',{examBattleProduceItemIds:['unknown-item']}),memory('unrecorded',{examBattleProduceItemIds:undefined})];
  const pairs=[...recommendationPairs(memories)];
  assert.equal(recommendationPairCount(memories),20);assert.equal(pairs.length,20);
  for(let main=0;main<memories.length;main++)assert.deepEqual(pairs.filter(pair=>pair.main===main).map(pair=>pair.sub),[0,1,2,3,4].filter(sub=>sub!==main));
});

test('累计模拟与一次执行完全一致，交错任务不重复随机样本，历史统计使用同一批对局',async()=>{
  const source=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-engine.json',import.meta.url)));
  for(const request of source.requests){
    const whole=await createContestSimulationSession(request,{seed:71}),split=await createContestSimulationSession(request,{seed:71});
    const expected=await whole.advance(8),prefix=await split.advance(3);
    await sampleContestScores(request,{runs:2,seed:999});
    const progress=[],actual=await split.advance(8,count=>progress.push(count));
    assert.deepEqual(actual.scores,expected.scores);assert.deepEqual(prefix.scores,actual.scores.slice(0,3));assert.equal(progress.at(-1),5);
    const singles=[];
    for(const seed of [3096120732,798478386,598082986,1231240274,2925194839,2135920505,2850003754,216305201])singles.push(await runContestSimulation(request,{runs:1,seed}));
    assert.deepEqual(actual.scores,singles.map(r=>r.scores[0]));
    const a=await whole.finish(),b=await split.finish();assert.deepEqual(a,b);
    assert.equal(b.statistics.total.totalScore,singles.reduce((sum,r)=>sum+r.statistics.total.totalScore,0));
    for(const [i,turn] of b.turnAverages.entries())assert.equal(turn.score,singles.reduce((sum,r)=>sum+(r.representative.turns[i]?.score??r.maximum),0)/8);assert.equal(b.statistics.runs,8);assert.deepEqual(b.scores,[...actual.scores].sort((a,b)=>a-b));
    assert.equal(b.minimumRun.score,b.minimum);assert.equal(b.maximumRun.score,b.maximum);assert.ok(b.scores.includes(b.representative.score));
    assert.deepEqual((await split.advance(8)).scores,actual.scores);await assert.rejects(split.advance(7),{code:'invalid_options'});
  }
});
test('综合分重采样可复现并随分数同比缩放，不修改样本',()=>{
  const scores=Array.from({length:500},(_,i)=>80+(i%41)),before=[...scores],a=recommendationUncertainty(scores),b=recommendationUncertainty(scores.map(v=>v*3));
  assert.deepEqual(scores,before);assert.deepEqual(a,recommendationUncertainty(scores));assert.ok(a.error>0);assert.ok(Math.abs(b.error/a.error-3)<1e-10);
  assert.deepEqual(recommendationUncertainty(Array(500).fill(100)),{lower:100,upper:100,error:0});
});
test('补跑只覆盖目标名次竞争，保留竞争双方并尊重两千次上限',()=>{
  const row=(id,score,error=0,runs=500)=>({id,main:Number(id),sub:99,stats:{score,mean:score,median:score,deviation:1,runs},uncertainty:{lower:score-error,upper:score+error}});
  assert.deepEqual(recommendationRefinements([row('0',100),row('1',80),row('2',60)],2),[]);
  assert.deepEqual(new Set(recommendationRefinements([row('0',100,3),row('1',98,3),row('2',60)],2).map(r=>r.id)),new Set(['0','1']));
  assert.deepEqual(new Set(recommendationRefinements([row('0',100),row('1',80,3),row('2',78,3)],2).map(r=>r.id)),new Set(['1','2']));
  assert.deepEqual(recommendationRefinements([row('0',100,3,2000),row('1',98,3,2000)],2),[]);
});


test('默认只复核前三竞争，忽略低顺位边界与重叠链，并在累计后重新判断',()=>{
  const row=(id,score,error=0,runs=500)=>({id,main:Number(id),sub:99,stats:{score,mean:score,median:score,deviation:1,runs},uncertainty:{lower:score-error,upper:score+error}});
  const ids=rows=>recommendationRefinements(rows).map(r=>r.id);
  const clear=[row('0',300),row('1',250),row('2',200)];
  assert.deepEqual(ids([...clear,...Array.from({length:17},(_,i)=>row(String(i+3),100-i,3))]),[]);
  assert.deepEqual(ids([row('0',300),row('1',250,3),row('2',248,3),row('3',100)]),['1','2']);
  assert.deepEqual(ids([...clear,row('3',198,3),row('4',194,3)]),['2','3']);
  assert.deepEqual(ids([...clear,row('3',100,101)]),['2','3']);
  assert.deepEqual(ids([row('0',300),row('1',250),row('2',200,0,2000),row('3',198,3)]),['3']);
  assert.deepEqual(ids([...clear,row('3',190,1,500)]),[]);
  assert.deepEqual(ids([row('0',300),row('1',250),row('2',200),row('3',251,3,500)]),['3','1']);
});

test('粗筛保留量按有效配置数计算，并正确处理20和40的阶段边界',()=>{
  assert.deepEqual([0,12,40,42,120,121,700].map(recommendationRoughLimit),[0,12,40,40,40,41,234]);
  assert.deepEqual(recommendationPhases(20).map(p=>p.runs),[500]);
  assert.deepEqual(recommendationPhases(21).map(p=>p.runs),[64,500]);
  assert.deepEqual(recommendationPhases(40).map(p=>p.runs),[64,500]);
  assert.deepEqual(recommendationPhases(41).map(p=>p.runs),[4,16,64,500]);
  assert.equal(recommendationPhases(1000).find(p=>p.name==='review').limit,20);
});
test('4加12加48与一次64局的真实得分和牌效完全一致，交错调用不改变续跑',async()=>{
  const source=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-engine.json',import.meta.url)));
  for(const request of source.requests){
    const all=await sampleContestScoreBatch(request,{runs:64,seed:77,cardEffects:true});
    const first=await sampleContestScoreBatch(request,{runs:4,seed:77,cardEffects:true});
    await sampleContestScores(request,{runs:2,seed:999});
    const second=await sampleContestScoreBatch(request,{runs:12,offset:4,seed:77,cardEffects:true}),progress=[];
    const third=await sampleContestScoreBatch(request,{runs:48,offset:16,seed:77,cardEffects:true,onProgress:n=>progress.push(n)});
    assert.deepEqual([...first.scores,...second.scores,...third.scores],all.scores);
    assert.deepEqual([...first.cardEffectScores,...second.cardEffectScores,...third.cardEffectScores],all.cardEffectScores);
    assert.equal(progress.at(-1),48);
    const session=await createContestSimulationSession(request,{seed:77,details:false});assert.deepEqual((await session.advance(64)).scores,all.scores);
    await assert.rejects(sampleContestScoreBatch(request,{runs:12,offset:-1}),{code:'invalid_options'});
  }
});
