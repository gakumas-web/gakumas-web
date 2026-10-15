import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareContestSimulation,runContestSimulation} from '../domain/contest-engine-runner.mjs';
import {contestEngineMap} from '../domain/contest-engine-map.mjs';
import {IdolConfig,StageConfig,IdolStageConfig,StageEngine,StagePlayer,STRATEGIES,resetRand,Stages,S} from '../domain/upstream-contest-engine.mjs';
import {createContestSimulationRequest} from '../domain/contest-engine-request.mjs';
import {installMaster} from '../domain/catalog.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-engine.json',import.meta.url)));

test('复用公开定义校验不能掩盖内容变化，重复准备仍创建独立战斗配置',async()=>{
  const request=structuredClone(fixture.customized),first=await prepareContestSimulation(request);
  first.idol.params.stamina=1;
  const second=await prepareContestSimulation(request);assert.equal(second.idol.params.stamina,request.params.stamina);
  request.cards[0].record.name+='changed';
  await assert.rejects(prepareContestSimulation(request),error=>error.code==='unsupported_entities');
});

test('三个计划实际跑完舞台，固定种子复现且分数与直接调用上游引擎一致',async()=>{
  for(const request of fixture.requests){
    const before=structuredClone(request),progress=[];
    const result=await runContestSimulation(request,{runs:3,seed:42,onProgress:value=>progress.push(value)});
    assert.equal(result.minimumRun.score,result.minimum);assert.equal(result.maximumRun.score,result.maximum);
    assert.equal(Math.round(result.turnAverages.at(-1).score),result.mean);
    assert.ok(result.representative.turns.some(turn=>turn.changes.length));
    for(const turn of result.representative.turns){assert.deepEqual(turn.cardDetails.map(card=>card.name),turn.cards);assert.ok(turn.changes.every(change=>Number.isFinite(change.previous)&&Number.isFinite(change.next)));}
    assert.equal(result.runs,3);assert.equal(progress.at(-1),3);assert.equal(result.representative.turns.length,request.stage.turn);
    assert.equal(result.representative.turns.at(-1).score,result.representative.score);assert.ok(result.minimum>0&&result.minimum<=result.mean&&result.mean<=result.maximum);
    const input={params:['vocal','dance','visual','stamina'].map(key=>request.params[key]),supportBonus:request.supportBonus,pItemIds:request.items.map(entry=>contestEngineMap.items[entry.id][0]),skillCardIdGroups:[request.cards.map(entry=>contestEngineMap.cards[JSON.stringify([entry.reference.id,entry.reference.upgradeCount])][0])]};
    const config=new IdolStageConfig(new IdolConfig(input),new StageConfig(structuredClone(Stages.getById(request.stage.preset.id))));
    const adapted=await prepareContestSimulation(request);assert.deepEqual(adapted.defaultCardIds,config.defaultCardIds);assert.deepEqual(adapted.typeMultipliers,config.typeMultipliers);
    resetRand(42);const engine=new StageEngine(config),strategy=new STRATEGIES.HeuristicStrategy(engine);engine.strategy=strategy;const scores=[];
    for(let index=0;index<3;index++)scores.push((await new StagePlayer(engine,strategy).play()).score);
    assert.deepEqual(result.scores,scores.sort((a,b)=>a-b));assert.deepEqual(await runContestSimulation(request,{runs:3,seed:42}),result);assert.deepEqual(request,before);
  }
});
test('已核对的附魔传入引擎；缺失映射或公开定义变化时不静默丢弃效果',async()=>{
  const config=await prepareContestSimulation(fixture.customized);assert.ok(config.idol.cards.some(card=>Object.values(card.customizations??{}).includes(1)));
  const result=await runContestSimulation(fixture.customized,{runs:2,seed:7});assert.ok(result.mean>0);
  const unknown=structuredClone(fixture.customized);unknown.cards[0].reference.customizes=[{id:'synthetic-unsupported-customization',customizeCount:1}];unknown.cards[0].customizations=[{record:null,grows:[],effects:[]}];
  await assert.rejects(prepareContestSimulation(unknown),error=>error.code==='unsupported_entities'&&error.details.some(entry=>entry.kind==='customization'));
  const changed=structuredClone(fixture.requests[0]);changed.cards[0].record.name='synthetic-changed-card';await assert.rejects(prepareContestSimulation(changed),error=>error.code==='unsupported_entities');
});
test('活动使用手动倍率且不重复叠加支援奖励，缺失倍率不能生成分数',async()=>{
  const config=await prepareContestSimulation(fixture.event);assert.deepEqual(config.typeMultipliers,{vocal:8,dance:10,visual:12});
  const missing=structuredClone(fixture.event);delete missing.manualMultipliers.visual;await assert.rejects(prepareContestSimulation(missing),error=>error.code==='missing_manual_multipliers');
});
test('舞台身份、基础抽牌规则、支援资料和公共卡组必须完整匹配',async()=>{
  for(const [change,code] of [
    [request=>request.stage.preset.criteria.vocal+=.01,'unsupported_stage'],
    [request=>request.stage.setting.turnStartDistribute=4,'unsupported_stage_rules'],
    [request=>request.supportBonus=null,'missing_support_bonus'],
    [request=>request.defaultCards=[],'missing_default_deck'],
  ]){const request=structuredClone(fixture.requests[0]);change(request);await assert.rejects(prepareContestSimulation(request),error=>error.code===code);}
});
test('请求保留允许重复的卡片，实际引擎牌库张数一致且不传递账号身份',async()=>{
  const source=fixture.requests[0],entries=[...source.cards,...source.defaultCards],records=[...new Map(entries.map(entry=>[JSON.stringify([entry.reference.id,entry.reference.upgradeCount]),entry.record])).values()];
  installMaster({tables:{ProduceCard:records,ProduceItem:source.items.map(entry=>entry.record),ProduceExamEffect:[],MemoryAbility:[],ProduceEffect:[],ProduceSkill:[]}});
  const main={key:'synthetic-private-memory',userMemoryId:'synthetic-private-record',publicUserId:'synthetic-private-account',planType:2,vocal:1000,dance:1200,visual:1500,stamina:50,examBattleProduceCards:source.cards.map(entry=>entry.reference),examBattleProduceItemIds:source.items.map(entry=>entry.id)};
  const sub={...main,vocal:1001,dance:1201,visual:1501,stamina:51,examBattleProduceItemIds:['synthetic-sub-only-item']};
  const stage={...source.stage,preset:source.stage.preset,decks:[{planType:'ProducePlanType_Plan1',produceCards:source.defaultCards.map(entry=>entry.reference)}],curve:[]};
  const request=createContestSimulationRequest([main,sub],stage,[{level:60}]);assert.deepEqual(request.params,{vocal:1200,dance:1440,visual:1800,stamina:60});assert.equal(request.cards.length,source.cards.reduce((count,entry)=>count+(entry.record.definition.noDeckDuplication?1:2),0));assert.equal(request.supportBonus,.001);
  const config=await prepareContestSimulation(request),engine=new StageEngine(config),state=engine.getInitialState();
  for(const entry of source.cards){
    const expected=entry.record.definition.noDeckDuplication?1:2,id=contestEngineMap.cards[JSON.stringify([entry.reference.id,entry.reference.upgradeCount])][0];
    assert.equal(request.cards.filter(card=>card.reference.id===entry.reference.id).length,expected);
    assert.equal(config.idol.cards.filter(card=>card.id===id).length,expected);
    assert.equal(state[S.cardMap].filter(card=>card.id===id).length,expected);
  }
  const result=await runContestSimulation(request,{runs:3,seed:42});assert.ok(result.mean>0);
  const raw=JSON.stringify(request);for(const text of ['synthetic-private','synthetic-sub-only-item','publicUserId','userMemoryId'])assert.equal(raw.includes(text),false);
});

test('共用附魔逐卡核对，至高のエンタメ+与已验证的ハイタッチ+均使用元气九点',async()=>{
  const data=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-customization-compatibility.json',import.meta.url))),request=structuredClone(fixture.customized);
  request.cards[2]=data.card;
  const config=await prepareContestSimulation(request);assert.ok(config.idol.cards.some(card=>card.customizations?.[28]===1));
  const result=await runContestSimulation(request,{runs:3,seed:42});assert.ok(result.mean>0);
  request.cards[2]=data.conflictingCard;
  const updated=await prepareContestSimulation(request);assert.ok(updated.idol.cards.some(card=>card.id===35&&card.customizations?.[28]===1));
  assert.ok((await runContestSimulation(request,{runs:1,seed:42})).mean>0);
});

test('月明かりに包まれて名称差异映射支持未强化、强化及两种附魔，并完成真实模拟',async()=>{
  const data=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-card-name-matching.json',import.meta.url)));
  for(const [upgrade,customId] of [[0,null],[1,null],[1,data.customizations[0].id],[1,data.customizations[1].id]]){
    const request=structuredClone(fixture.customized),record=data.cards.find(row=>row.upgradeCount===upgrade),custom=data.customizations.find(row=>row.id===customId);
    const grows=custom?custom.produceCardGrowEffectIds.map(id=>data.grows.find(row=>row.id===id)):[];
    request.cards[2]={reference:{id:record.id,upgradeCount:upgrade,customizes:custom?[{id:custom.id,customizeCount:1}]:[]},record,customizations:custom?[{record:custom,grows,effects:grows.filter(row=>row.playProduceExamEffectId).map(row=>data.effects.find(effect=>effect.id===row.playProduceExamEffectId))}]:[]};
    assert.equal(contestEngineMap.cards[JSON.stringify([record.id,upgrade])][0],upgrade?587:586);
    const config=await prepareContestSimulation(request);assert.ok(config.idol.cards.some(card=>card.id===(upgrade?587:586)));
    const result=await runContestSimulation(request,{runs:3,seed:42});assert.equal(result.runs,3);assert.ok(result.mean>0);
  }
});

test('モチベ+的山札选择保留附魔映射到现有引擎并完成真实对局',async()=>{
  const data=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-hold-customization.json',import.meta.url)));
  const request=structuredClone(fixture.requests.find(request=>request.plan==='anomaly'));request.cards.push(data.card);
  const config=await prepareContestSimulation(request);assert.ok(config.idol.cards.some(card=>card.id===553&&card.customizations?.[43]===1));
  const result=await runContestSimulation(request,{runs:3,seed:42});assert.equal(result.runs,3);assert.ok(result.mean>0);
});

test('预览审计修复的附魔保持原配置并完成对应计划的真实模拟',async()=>{
  const data=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-preview-customizations.json',import.meta.url)));
  for(const entry of data.entries){
    const request=structuredClone(fixture.requests.find(row=>row.plan===entry.plan));request.cards.push(entry.card);
    const config=await prepareContestSimulation(request),id=contestEngineMap.cards[JSON.stringify([entry.card.reference.id,entry.card.reference.upgradeCount])][0];
    assert.ok(config.idol.cards.some(card=>card.id===id&&entry.engineCustomizations.every((custom,i)=>card.customizations?.[custom]===entry.card.reference.customizes[i].customizeCount)),entry.card.record.name);
    const result=await runContestSimulation(request,{runs:2,seed:42});assert.equal(result.runs,2);assert.ok(result.mean>0);
  }
});

test('持续附魔替换原触发而不叠加，保留次数、直接效果条件和独立计数',async()=>{
  const data=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-status-customizations.json',import.meta.url)));
  for(const entry of data.entries){
    const request=structuredClone(fixture.requests.find(row=>row.plan==='logic'));request.cards.push(entry);
    const config=await prepareContestSimulation(request),engine=new StageEngine(config),state=engine.getInitialState(),id=contestEngineMap.cards[JSON.stringify([entry.reference.id,1])][0],index=state[S.cardMap].findIndex(card=>card.id===id),lines=engine.cardManager.getLines(state,index,'actions'),triggers=lines.filter(line=>line.phase);
    if(id===517){assert.equal(triggers.length,1);assert.equal(triggers[0].phase,'startOfTurn');assert.equal(triggers[0].limit,4);assert.equal(triggers[0].actions[0].rhs.right.value,[.7,.8,.95][entry.reference.customizes[0].customizeCount-1]);}
    if(id===305){assert.equal(triggers.length,1);assert.equal(triggers[0].phase,'cardUsed');assert.deepEqual(triggers[0].actions.map(action=>action.lhs),['score','goodImpressionTurns']);assert.equal(triggers[0].actions[0].rhs.right.value,.5);assert.equal(triggers[0].actions[1].rhs.value,1);}
    if(id===778){assert.equal(triggers.length,1);assert.equal(triggers[0].ttl,4);assert.equal(triggers[0].conditions[0].name,'isDirectEffect');assert.equal(triggers[0].actions[0].rhs.right.value,1.3);}
    if(id===273){assert.equal(lines.length,2);assert.equal(triggers.length,2);assert.ok(triggers.every(line=>line.phase==='activeCardUsed'));assert.equal(triggers[1].limit,2);assert.equal(triggers[0].actions[0].lhs,'effectCounter');assert.equal(triggers[1].conditions[0].left.right.value,3);assert.equal(triggers[1].actions[0].rhs.left.left.value,12);}
    const result=await runContestSimulation(request,{runs:3,seed:42});assert.equal(result.runs,3);assert.ok(result.mean>0);
  }
});

test('逐回合与统计缩略图保留本次输入的实际附魔引用',async()=>{
  const result=await runContestSimulation(fixture.customized,{runs:3,seed:42});
  const expected=fixture.customized.cards.filter(card=>card.reference.customizes.length).map(card=>card.reference);
  assert.ok(expected.length);
  const played=[result.representative,result.minimumRun,result.maximumRun].flatMap(run=>run.turns.flatMap(turn=>turn.cardDetails)).filter(card=>card.reference?.customizes.length);
  assert.ok(played.length);assert.ok(played.every(card=>expected.some(reference=>JSON.stringify(reference)===JSON.stringify(card.reference))));
  const customized=result.statistics.total.rows.filter(row=>row.customizationCount>0);
  assert.ok(customized.length);assert.ok(customized.every(row=>row.reference?.customizes.reduce((sum,custom)=>sum+custom.customizeCount,0)===row.customizationCount));
});

test('生成的眠気保留卡面引用，逐回合手牌选择和分组状态变化来自真实日志',async()=>{
  const request=structuredClone(fixture.customized);request.cards[request.cards.length-1]=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-sleepiness-card.json',import.meta.url)));
  const result=await runContestSimulation(request,{runs:10,seed:42}),sleep=result.statistics.total.rows.find(row=>row.name==='眠気');
  assert.ok(sleep?.draw>0);assert.equal(sleep.reference.id,'p_card-00-acc-0_002');
  const {simulationCardReference}=await import('../domain/contest-engine-display.mjs');assert.deepEqual(simulationCardReference({...sleep,reference:null}),sleep.reference);assert.equal(simulationCardReference({name:'眠気'}),null);
  for(const run of [result.minimumRun,result.representative,result.maximumRun]){
    for(const turn of run.turns){
      const flatten=events=>events.flatMap(event=>[event,...flatten(event.events??[])]),events=flatten(turn.events),changes=events.filter(event=>event.type==='change').map(({type,...change})=>change);
      assert.deepEqual(changes,turn.changes);assert.deepEqual(events.filter(event=>event.type==='hand').flatMap(event=>event.cards.filter(card=>card.selected).map(card=>card.name)),turn.cards);
      for(const event of events.filter(event=>event.type==='hand'))assert.ok(event.cards.every(card=>card.reference&&(!card.selected||Number.isFinite(card.estimate))));
    }
  }
});

test('Agitato 咲季普通和强化专属卡及道具通过正式校验并完成比赛',async()=>{
  const additions=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/agitato-saki.json',import.meta.url)));
  for(const upgrade of [0,1]){
    const request=structuredClone(fixture.requests.find(row=>row.plan==='logic'));
    request.cards[0]=additions.cards[upgrade];request.items=[additions.items[upgrade]];
    const prepared=await prepareContestSimulation(request);
    assert.ok(prepared.idol.cards.some(card=>card.id===887+upgrade));
    const result=await runContestSimulation(request,{runs:3,seed:42});
    assert.equal(result.runs,3);assert.ok(result.scores.every(Number.isFinite));
    assert.ok(result.representative.turns.some(turn=>turn.cards.some(name=>name.includes('スイートトラップ'))));
  }
});
