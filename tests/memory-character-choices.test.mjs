import test from 'node:test';
import assert from 'node:assert/strict';
import {createView,resetFilters} from '../application/view-state.mjs';
import {filterMemories,memoryExamChoices} from '../domain/memories.mjs';
const card=(id,upgradeCount=0)=>({id,upgradeCount,customizes:[]});
const rows=[{key:'a',characterId:'hski',examBattleProduceCards:[card('one'),card('two')],examBattleProduceItemIds:['x','y']},{key:'b',characterId:'ttmr',examBattleProduceCards:[card('one',1)],examBattleProduceItemIds:['x']},{key:'c',characterId:'kllj'}];
const filter=options=>filterMemories({memories:rows},createView(options),new Map()).map(row=>row.key);
test('普通角色多选取并集，旧单选可恢复，清空恢复全部',()=>{
  assert.deepEqual(createView({character:'hski'}).character,['hski']);
  assert.deepEqual(filter({character:['hski','ttmr']}),['a','b']);
  const view=createView({character:['hski'],memoryExamSkill:[JSON.stringify(['one',0])],memoryExamItem:['x'],memoryExamItemAll:false});resetFilters(view,'memories');
  assert.deepEqual(view.character,[]);assert.deepEqual(view.memoryExamSkill,[]);assert.deepEqual(view.memoryExamItem,[]);assert.equal(view.memoryExamItemAll,true);
});
test('考试技能按强化版本匹配，卡与道具跨组同时满足，未知字段不当作命中',()=>{
  assert.deepEqual(filter({memoryExamSkill:[JSON.stringify(['one',1])]}),['b']);
  assert.deepEqual(filter({memoryExamItem:['x','y']}),['a']);
  assert.deepEqual(filter({memoryExamItem:['x','y'],memoryExamItemAll:false}),['a','b']);
  assert.deepEqual(filter({memoryExamSkill:[JSON.stringify(['one',0]),JSON.stringify(['one',1])],memoryExamSkillAll:false}),['a','b']);
  assert.deepEqual(filter({memoryExamSkill:[JSON.stringify(['one',1])],memoryExamItem:['y']}),[]);
  const choices=memoryExamChoices(rows);assert.equal(choices.cards.length,3);assert.deepEqual(new Set(choices.items.map(row=>row.key)),new Set(['x','y']));
});
test('评级筛选及旧常用条件归一化，退役字段不重新限制列表',()=>{
  const saved=createView({memoryGrade:'18',memoryUse:'training',configuration:'grouped',protection:'unprotected'});
  assert.equal(saved.memoryGrade,'18');assert.equal(saved.protection,'all');assert.equal('memoryUse' in saved,false);assert.equal('configuration' in saved,false);
  assert.deepEqual(filterMemories({memories:rows.map((row,index)=>({...row,grade:[16,18,14][index]}))},saved,new Map()).map(row=>row.key),['b']);
});
test('继承技能卡固定任一匹配，培养能力同组任一匹配，旧单选恢复为数组',()=>{
  const memories=[{key:'a',produceCard:card('one'),abilities:[{id:'x'},{id:'y'}]},{key:'b',produceCard:card('two'),abilities:[{id:'x'}]},{key:'c',produceCard:card('three'),abilities:[]}];
  const run=options=>filterMemories({memories},createView(options),new Map()).map(row=>row.key);
  assert.deepEqual(createView({skill:'one',ability:'x'}).skill,['one']);assert.deepEqual(createView({ability:'x'}).ability,['x']);
  assert.deepEqual(run({skill:['one','two']}),['a','b']);assert.deepEqual(run({skill:['one','two'],skillAll:true}),['a','b']);assert.equal('skillAll' in createView({skillAll:true}),false);
  assert.deepEqual(run({ability:['x','y']}),['a','b']);assert.deepEqual(run({ability:['x','y'],abilityAll:false}),['a','b']);
  assert.deepEqual(run({skill:['two'],ability:['y']}),[]);
  const view=createView({stat:'vocal',minimum:'999',maximum:'1000'});assert.equal('stat' in view,false);assert.equal('minimum' in view,false);assert.equal('maximum' in view,false);assert.deepEqual(run(view),['a','b','c']);
});
test('考试道具候选排除通用与仅培养支援道具，保留比赛支援和角色专属',async()=>{
  const {installMaster}=await import('../domain/catalog.mjs');
  const items=[{id:'common',definition:{}},{id:'training',definition:{originSupportCardId:'support',isExamEffect:false}},{id:'battle',definition:{originSupportCardId:'support',isExamEffect:true}},{id:'idol',definition:{originIdolCardId:'idol',isExamEffect:true}}];
  installMaster({tables:{ProduceCard:[],ProduceItem:items,MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]}});
  const choices=memoryExamChoices([{examBattleProduceItemIds:items.map(row=>row.id)}]);
  assert.deepEqual(new Set(choices.items.map(row=>row.key)),new Set(['battle','idol']));
});
test('同技能同等级同限制的能力别名合并，匹配覆盖不同ID且旧筛选仍有效',async()=>{
  const {installMaster,abilityChoiceKey}=await import('../domain/catalog.mjs');
  installMaster({tables:{ProduceCard:[],ProduceItem:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[],MemoryAbility:[{id:'alias-z',skillId:'skill',level:1,definition:{}},{id:'alias-a',skillId:'skill',level:1,definition:{}},{id:'restricted',skillId:'skill',level:1,definition:{isUniqueActivation:true}},{id:'different',skillId:'other-skill',level:1,definition:{}}]}});
  assert.equal(abilityChoiceKey('alias-z'),abilityChoiceKey('alias-a'));assert.notEqual(abilityChoiceKey('restricted'),abilityChoiceKey('alias-a'));
  const memories=[{key:'a',abilities:[{id:'alias-a',level:1}]},{key:'z',abilities:[{id:'alias-z',level:1}]},{key:'r',abilities:[{id:'restricted',level:1}]}];
  assert.deepEqual(filterMemories({memories},createView({ability:['alias-z']}),new Map()).map(row=>row.key),['a','z']);
});
test('培养能力组内OR、组间AND，无选择不限制，旧全组开关不改变新规则',async()=>{
  const {installMaster}=await import('../domain/catalog.mjs');
  const definitions=[['vo20','VocalAddition',20],['vo30','VocalAddition',30],['da20','DanceAddition',20],['p30','ProducePointAdditionDisableTrigger',30]];
  installMaster({tables:{ProduceCard:[],ProduceItem:[],ProduceExamEffect:[],MemoryAbility:definitions.map(([id])=>({id,skillId:'skill-'+id,level:1,definition:{}})),ProduceSkill:definitions.map(([id])=>({id:'skill-'+id,level:1,produceEffectId1:id,produceTriggerId1:'p_trigger-produce_start',descriptions:[]})),ProduceEffect:definitions.map(([id,type,amount])=>({id,produceEffectType:'ProduceEffectType_'+type,effectValueMin:amount,effectValueMax:amount}))}});
  const memories=[['a',['vo20','da20']],['b',['vo30','da20']],['c',['vo20']],['d',['da20']],['e',['vo30','p30']]].map(([key,ids])=>({key,abilities:ids.map(id=>({id,level:1}))}));
  const run=ability=>filterMemories({memories},createView({ability,abilityAll:false}),new Map()).map(row=>row.key);
  assert.deepEqual(run(['vo20','vo30','da20']),['a','b']);assert.deepEqual(run(['vo20','vo30','p30']),['e']);assert.deepEqual(run(['vo20','vo30','da20','p30']),[]);assert.equal(run([]).length,5);assert.equal('abilityAll' in createView({abilityAll:true}),false);
});
test('考试P道具按计划、稀有度、强化优先排序，不受流派与输入顺序影响',async()=>{
  const {sortExamItemChoices}=await import('../domain/memories.mjs');
  const row=(key,plan,rarity,upgraded)=>({key,metadata:{plan,rarity,flows:[]},info:{upgraded}});
  const values=[row('logic','Plan2','SSR',true),row('senseSR','Plan1','SR',true),row('senseBase','Plan1','SSR',false),row('senseUpgraded','Plan1','SSR',true),row('anomaly','Plan3','SSR',true),row('common','Common','SSR',true)];
  const before=JSON.stringify(values);
  assert.deepEqual(sortExamItemChoices(values).map(value=>value.key),['senseUpgraded','senseBase','senseSR','logic','anomaly','common']);
  assert.equal(JSON.stringify(values),before);
});
test('考试技能卡按来源采用角色/计划/流派/稀有度/强化排序，支援不按流派分隔',async()=>{
  const {sortExamCardChoices}=await import('../domain/memories.mjs');
  const row=(key,source,character,plan,flow,rarity,upgradeCount=0)=>({key,metadata:{source,ownerCharacterId:character,plan,flows:[flow],rarity},reference:{upgradeCount}});
  const values=[row('idolOther','idol','ttmr','Plan1','parameter','SSR'),row('idolLaterPlan','idol','hski','Plan2','review','SSR'),row('idolBase','idol','hski','Plan1','lesson','SSR'),row('idolUp','idol','hski','Plan1','lesson','SSR',2),row('idolEarlierFlow','idol','hski','Plan1','parameter','R'),row('supportEarlierFlow','support','','Plan1','parameter','SR',2),row('supportBase','support','','Plan1','lesson','SSR'),row('supportUp','support','','Plan1','lesson','SSR',2),row('commonBase','common','','Plan1','lesson','SSR'),row('commonUp','common','','Plan1','lesson','SSR',1),row('commonEarlierFlow','common','','Plan1','parameter','R')];
  const before=JSON.stringify(values);
  assert.deepEqual(sortExamCardChoices(values).map(row=>row.key),['idolEarlierFlow','idolUp','idolBase','idolLaterPlan','idolOther','supportUp','supportBase','supportEarlierFlow','commonEarlierFlow','commonUp','commonBase']);
  assert.equal(JSON.stringify(values),before);
});
test('继承技能卡按流派分组，组内稀有度及强化降序，多流派不重复出现',async()=>{
  const {groupedInheritanceCardChoices}=await import('../domain/memories.mjs');
  const row=(key,flows,rarity,upgradeCount)=>({key,metadata:{flows,rarity},reference:{upgradeCount}});
  const values=[row('unknown',[],'SSR',1),row('lesson',['lesson'],'SSR',1),row('base',['parameter'],'SSR',0),row('up',['parameter'],'SSR',2),row('lower',['parameter'],'SR',3),row('mixed',['lesson','parameter'],'SSR',1)];
  const before=JSON.stringify(values),groups=groupedInheritanceCardChoices(values);
  assert.deepEqual(groups.map(group=>group.id),['parameter','parameter+lesson','lesson','unclassified']);
  assert.deepEqual(groups[0].values.map(value=>value.key),['up','base','lower']);
  assert.equal(groups.flatMap(group=>group.values).length,values.length);assert.equal(JSON.stringify(values),before);
});
test('无明确流派的继承技能卡归入对应计划通用，紧随该计划流派排列',async()=>{
  const {groupedInheritanceCardChoices}=await import('../domain/memories.mjs');
  const row=(key,plan,flows=[])=>({key,metadata:{plan,flows,rarity:'SSR'},reference:{upgradeCount:0}});
  const groups=groupedInheritanceCardChoices([row('common','Common'),row('logicCommon','Plan2'),row('senseCommon','Plan1'),row('anomalyCommon','Plan3'),row('lesson','Plan1',['lesson']),row('review','Plan2',['review']),row('fullPower','Plan3',['fullPower'])]);
  assert.deepEqual(groups.map(group=>group.id),['lesson','common-Plan1','review','common-Plan2','fullPower','common-Plan3','common-Common']);
});
test('回忆文本检索只纳入继承技能卡名称，考试卡组继续通过独立筛选匹配',async()=>{
  const {installMaster}=await import('../domain/catalog.mjs');
  installMaster({tables:{ProduceCard:[{id:'inherit',upgradeCount:0,name:'继承专用词',descriptions:[]},{id:'exam',upgradeCount:0,name:'考试专用词',descriptions:[]}],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},characters:{hski:'花海咲季'}});
  const memories=[{key:'a',ordinal:1,characterId:'hski',produceCard:card('inherit'),abilities:[],examBattleProduceCards:[card('exam')],examBattleProduceItemIds:[]}];
  const run=options=>filterMemories({memories},createView(options),new Map(),()=>['自定义标记']);
  assert.equal(run({query:'继承专用词'}).length,1);assert.equal(run({query:'考试专用词'}).length,0);assert.equal(run({query:'花海咲季'}).length,1);assert.equal(run({query:'自定义标记'}).length,1);
  assert.equal(run({memoryExamSkill:[JSON.stringify(['exam',0])]}).length,1);
});
