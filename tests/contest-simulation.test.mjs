import test from 'node:test';
import assert from 'node:assert/strict';
import {createContestCatalog,contestAttributeMultiplier,contestMemoryEntries,contestMemoryTotals,contestMemoryCards,contestSupportBonus} from '../domain/contest-simulation.mjs';
const curve=[{id:'score',parameter:0,vocalPermil:1000,dancePermil:2000,visualPermil:3000},{id:'score',parameter:100,vocalPermil:3000,dancePermil:6000,visualPermil:9000}];
test('比赛评分曲线保留各属性端点，按区间插值，缺失与越界不外推',()=>{
  assert.equal(contestAttributeMultiplier(curve,'vocal',50),2);
  assert.equal(contestAttributeMultiplier(curve,'dance',50),4);
  assert.equal(contestAttributeMultiplier(curve,'visual',100),9);
  assert.equal(contestAttributeMultiplier(curve,'vocal',0),1);
  for(const value of [undefined,null,NaN,-1,101])assert.equal(contestAttributeMultiplier(curve,'vocal',value),null);
  assert.equal(contestAttributeMultiplier([],'vocal',1),null);
});
test('舞台自己的评分配置优先，空引用使用赛季配置，公共卡组保留重复卡',()=>{
  const input={PvpRateConfig:[{id:'season-9',produceExamBattleScoreConfigId:'score',pvpRateCommonProduceCardId:'deck',stages:[{produceExamBattleScoreConfigId:''},{produceExamBattleScoreConfigId:'stage-score'}]},{id:'season-10',stages:[]}],ProduceExamBattleScoreConfig:[...curve,...curve.map(r=>({...r,id:'stage-score',vocalPermil:r.vocalPermil*2}))],PvpRateCommonProduceCard:[{id:'deck',planType:'ProducePlanType_Plan1',produceCards:[{id:'a'},{id:'a'}]}]};
  const before=JSON.stringify(input),catalog=createContestCatalog(input);
  assert.deepEqual(catalog.seasons.map(x=>x.id),['season-10','season-9']);
  assert.equal(contestAttributeMultiplier(catalog.stage('season-9',0).curve,'vocal',50),2);
  assert.equal(contestAttributeMultiplier(catalog.stage('season-9',1).curve,'vocal',50),4);
  assert.equal(catalog.stage('season-9',0).decks[0].produceCards.length,2);
  assert.equal(JSON.stringify(input),before);
});
test('候选限舞台计划与已记录考试卡组，排序使用所选属性倍率，不影响输入',()=>{
  const rows=[{key:'a',ordinal:1,planType:2,vocal:20,examBattleProduceCards:[{}]},{key:'b',ordinal:2,planType:2,vocal:60,examBattleProduceCards:[{}]},{key:'c',planType:3,vocal:90,examBattleProduceCards:[{}]},{key:'d',planType:2,vocal:100,examBattleProduceCards:[]}];
  const stage={planType:'ProducePlanType_Plan1',curve};
  assert.deepEqual(contestMemoryEntries(rows,stage,'vocal').map(x=>x.memory.key),['b','a']);
  assert.deepEqual(contestMemoryEntries(rows,{...stage,planType:'ProducePlanType_Common'}).map(x=>x.memory.key),['a','b','c']);
  assert.equal(rows[0].key,'a');
});

test('统一舞台列表补充活动与链接比赛，不把活动输入当成普通回忆属性',()=>{
  const preset={id:1,name:'测试活动',type:'event',plan:'logic',turnCounts:{vocal:2,dance:4,visual:6},criteria:{vocal:.2,dance:.35,visual:.45},firstTurns:{vocal:0,dance:0,visual:1}};
  const catalog=createContestCatalog({},[preset]),stage=catalog.choices[0];
  assert.equal(stage.kind,'event');assert.equal(stage.turn,12);assert.equal(stage.manualMultipliers,true);
  const rows=[{key:'a',planType:3,vocal:1800,examBattleProduceCards:[{}]}];
  assert.equal(contestMemoryEntries(rows,stage)[0].multipliers.vocal,null);
  assert.equal(contestMemoryEntries(rows,stage,'ordinal',{vocal:1500})[0].multipliers.vocal,15);
});
test('自定义比例缩放基准曲线，独立设置计划与回合，不修改原规则',async()=>{
  const {customizeContestStage}=await import('../domain/contest-simulation.mjs');
  const base={id:'base',curve,criteria:{vocal:.2,dance:.3,visual:.5},produceItemIds:['original'],planType:'ProducePlanType_Plan1'};
  const settings={criteria:{vocal:.4,dance:.3,visual:.3},turnCounts:{vocal:4,dance:3,visual:3},firstTurns:{vocal:1,dance:0,visual:0},planType:'ProducePlanType_Common'};
  const custom=customizeContestStage(base,settings);
  assert.equal(custom.custom,true);assert.equal(custom.turn,10);assert.equal(custom.planType,'ProducePlanType_Common');
  assert.equal(contestAttributeMultiplier(custom.curve,'vocal',50),4);assert.equal(contestAttributeMultiplier(base.curve,'vocal',50),2);
  assert.deepEqual(custom.produceItemIds,['original']);
  assert.throws(()=>customizeContestStage(base,{...settings,criteria:{vocal:.5,dance:.5,visual:.5}}),/invalid_custom_stage/);
  assert.throws(()=>customizeContestStage(base,{...settings,turnCounts:{vocal:0,dance:0,visual:0}}),/invalid_custom_stage/);
});

test('副回忆数值按五分之一向下取整，再换算舞台倍率；不自动提升副槽位',()=>{
  const a={vocal:20,dance:30,visual:40,stamina:30,power:1000},b={vocal:30,dance:40,visual:50,stamina:20,power:2000},stage={curve};
  const totals=contestMemoryTotals([a,b],stage);
  assert.deepEqual([totals.vocal,totals.dance,totals.visual,totals.stamina,totals.power],[26,38,50,34,1400]);
  assert.equal(totals.multipliers.vocal,1.52);
  assert.notEqual(totals.multipliers.vocal,contestAttributeMultiplier(curve,'vocal',20)+contestAttributeMultiplier(curve,'vocal',30));
  assert.equal(contestMemoryTotals([a],stage).vocal,20);
  assert.equal(contestMemoryTotals([null,b],stage).vocal,undefined);
  assert.equal(contestMemoryTotals([a,{...b,stamina:29,vocal:34}],stage).stamina,35);
  assert.equal(contestMemoryTotals([a,{...b,stamina:29,vocal:34}],stage).vocal,26);
  assert.equal(contestMemoryTotals([a,{...b,vocal:undefined}],stage).vocal,undefined);
  assert.equal(contestMemoryTotals([a,{...b,vocal:undefined}],stage).multipliers.vocal,null);
  assert.equal(contestMemoryTotals([a,{...b,vocal:500}],stage).multipliers.vocal,null);
  assert.equal(contestMemoryTotals([a,b],{manualMultipliers:true},{vocal:1500}).multipliers.vocal,15);
});

test('禁止重复的技能附魔覆盖无附魔，双方附魔保留主卡，无附魔时强化覆盖未强化',()=>{
  const card=(id,upgradeCount=0,customizes=[])=>({id,upgradeCount,customizes});
  const enchant=[{id:'custom',customizeCount:1}],main={examBattleProduceCards:[card('a',1),card('b',0,enchant),card('c'),card('d',1),card('e',0,enchant)]};
  const sub={examBattleProduceCards:[card('a',0,enchant),card('b',1,enchant),card('c',1),card('d'),card('e'),card('unique')]};
  const entries=contestMemoryCards([main,sub],()=>true),kept=entries.filter(entry=>entry.retained);
  assert.deepEqual(kept.map(entry=>[entry.card.id,entry.memoryIndex]),[['b',0],['d',0],['e',0],['a',1],['c',1],['unique',1]]);
  assert.equal(entries.filter(entry=>!entry.retained).length,5);
  assert.equal(contestMemoryCards([null,sub],()=>true).filter(entry=>entry.retained).length,6);
});

test('支援奖励逐卡按等级档位累加，区分未采集与空持有，忽略重复卡库存数',()=>{
  const bonus=level=>contestSupportBonus([{level,stockQuantity:9}]);
  for(const [level,value] of [[1,0],[9,0],[10,.01],[19,.01],[20,.02],[29,.02],[30,.04],[39,.04],[40,.06],[49,.06],[50,.08],[59,.08],[60,.1]])assert.equal(bonus(level),value);
  assert.equal(contestSupportBonus([{level:35},{level:45},{level:55},{level:60}]),.28);
  assert.equal(contestSupportBonus([]),0);assert.equal(contestSupportBonus(undefined),null);
});

test('竞技场按赛季提供三个舞台，活动保持独立分组',async()=>{
  const {contestSeasonGroups}=await import('../domain/contest-simulation.mjs');
  const choices=[...[53,52].flatMap(number=>[1,2,3].map(stageNumber=>({id:`${number}-${stageNumber}`,kind:'contest',season:{id:`season-${number}`},seasonNumber:number,stageNumber}))),{id:'event',kind:'event',preset:{name:'event'}},{id:'link',kind:'linkContest',preset:{name:'link'}}];
  const groups=contestSeasonGroups(choices);assert.equal(groups.length,3);assert.deepEqual(groups.slice(0,2).map(group=>group.stages.length),[3,3]);assert.equal(groups[0].seasonNumber,53);assert.equal(groups[2].kind,'event');
});

test('同一活动按轮次聚合，保留完整五舞台并按字母排序',async()=>{
  const {contestSeasonGroups}=await import('../domain/contest-simulation.mjs');
  const choices=[1,2,3].flatMap(round=>['A','B','C','D','E'].map(stage=>({id:`${round}-${stage}`,kind:'event',preset:{name:'活动',round,stage}})));
  const groups=contestSeasonGroups(choices);assert.equal(groups.length,3);assert.ok(groups.every(group=>group.stages.length===5));assert.equal(groups[0].round,1);assert.deepEqual(groups[0].stages.map(stage=>stage.preset.stage),['A','B','C','D','E']);
});

test('同一活动编号下的不同舞台名称合并，其他活动保持独立',async()=>{
  const {contestSeasonGroups}=await import('../domain/contest-simulation.mjs');
  const choices=['C','B','A'].map((stage,index)=>({id:String(index),kind:'event',preset:{season:4,round:1,stage,name:`文化祭 ${stage} STAGE`}}));
  choices.push({id:'other',kind:'event',preset:{season:3,round:1,stage:'A',name:'文化祭'}});
  const groups=contestSeasonGroups(choices);assert.equal(groups.length,2);assert.equal(groups[0].name,'文化祭');assert.equal(groups[0].id,'event:4:1');assert.deepEqual(groups[0].stages.map(stage=>stage.preset.stage),['A','B','C']);
});

test('允许重复的技能保留所有副本，不因强化或附魔差异互相覆盖',()=>{
  const card=(upgradeCount,customizes=[])=>({id:'repeatable',upgradeCount,customizes});
  const main={examBattleProduceCards:[card(0),card(1)]},sub={examBattleProduceCards:[card(0,[{id:'custom',customizeCount:1}]),{id:'restricted',upgradeCount:0,customizes:[]}]};
  main.examBattleProduceCards.push({id:'restricted',upgradeCount:0,customizes:[]});
  const entries=contestMemoryCards([main,sub],reference=>reference.id==='restricted');
  assert.equal(entries.filter(entry=>entry.card.id==='repeatable'&&entry.retained).length,3);
  assert.deepEqual(entries.filter(entry=>entry.card.id==='restricted'&&entry.retained).map(entry=>entry.memoryIndex),[0]);
});
