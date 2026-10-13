import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {installMaster,contestOwnedSupportRewards} from '../domain/catalog.mjs';
import {optimizationChoiceCatalog,buildContestOptimizationInput,supportedOptimizationInput,optimizationExclusiveCustomizationLimit,validateOptimizationExclusiveReference} from '../application/contest-optimization-input.mjs';
import {createOptimizationProblem,optimizationRandom,optimizationPopulation,optimizationCardKey} from '../domain/contest-optimization.mjs';
import {selectionGrades} from '../domain/selection-memories.mjs';
const {communityRules}=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/reference-data.json',import.meta.url)));
const context={stage:{planType:'ProducePlanType_Plan1'},idolCards:[{idolCardId:'owned-idol',levelLimitRank:0,potentialRank:0}],supportCards:[{supportCardId:'owned-support',level:30}],producerLevel:60,conversionRules:{excludedCardIds:['before']}};
const constraints={roles:[0,1].map(()=>({exclusiveId:'exclusive',grade:15,params:{vocal:1000,dance:1200,visual:900,stamina:40},maxCustomizeCount:2,maxCustomizedCards:1})),items:['fixed-item','support-item']};
function install(extraItems=[],{customizations=false,maximum=2,rules=communityRules}={}){
  const card=(id,source={})=>[0,1].map(upgradeCount=>({id,upgradeCount,name:id,rarity:'ProduceCardRarity_Ssr',category:'ProduceCardCategory_ActiveSkill',images:{},descriptions:[],playEffects:[],definition:{planType:'ProducePlanType_Plan1',unlockProducerLevel:5,...(customizations?{produceCardCustomizeIds:['boost','alternate'],maxCustomizeCount:maximum}:{}),...source}}));
  const input={communityRules:rules,tables:{ProduceCard:[...card('exclusive',{originIdolCardId:'owned-idol'}),...card('other-exclusive',{originIdolCardId:'unowned-idol'}),...card('common',{noDeckDuplication:true}),...card('before'),...card('after'),...card('common-two'),...card('common-three'),...card('common-four'),...card('support-skill',{originSupportCardId:'owned-support'}),...card('unowned-skill',{originSupportCardId:'unowned-support'})],ProduceItem:[...extraItems.map(id=>({id,definition:{originSupportCardId:'owned-support',planType:'ProducePlanType_Common',isExamEffect:true}})),{id:'fixed-item',definition:{originIdolCardId:'owned-idol',planType:'ProducePlanType_Plan1',isExamEffect:true}},{id:'support-item',definition:{originSupportCardId:'owned-support',planType:'ProducePlanType_Common',isExamEffect:true}}],ProduceEffect:[{id:'support-rewards',definition:{produceRewards:[...extraItems.map(id=>({resourceType:'ProduceResourceType_ProduceItem',resourceId:id})),{resourceType:'ProduceResourceType_ProduceCard',resourceId:'support-skill'},{resourceType:'ProduceResourceType_ProduceItem',resourceId:'support-item'}]}}],ProduceExamEffect:[],ProduceSkill:[],MemoryAbility:[]},idols:{cards:[{id:'owned-idol',characterId:'hski'},{id:'unowned-idol',characterId:'ttmr'}]},supports:{cards:[{id:'owned-support',events:[{unlockLevel:30,effectIds:['support-rewards']}]}]}};
  if(customizations){
    input.semantics={tables:{ProduceCardCustomize:[{id:'boost',customizeCount:1,produceCardGrowEffectIds:[]},{id:'boost',customizeCount:2,produceCardGrowEffectIds:[]},{id:'alternate',customizeCount:1,produceCardGrowEffectIds:[]}]}};
    input.tables.ProduceEffect.push({id:'customization-unlock',produceEffectType:'ProduceEffectType_IdolCardProduceCardCustomizeEnable'});
    input.tables.ProduceSkill.push({id:'unlock-skill',level:1,produceEffectId1:'customization-unlock',descriptions:[]});
    input.progression={tables:{IdolCard:[{id:'owned-idol',produceCardId:'exclusive',maxIdolCardLevelLimitRank:'IdolCardLevelLimitRank__7',idolCardLevelLimitProduceSkillId:'owned-idol-skills'}],IdolCardLevelLimitProduceSkill:[{id:'owned-idol-skills',rank:'IdolCardLevelLimitRank__7',produceSkillId:'unlock-skill',produceSkillLevel:1,order:1}]}};
  }
  installMaster(input);
}
test('搜索候选受持有、支援事件等级和转换开关约束，不能借用未持有技能',()=>{
  install();const ids=optimizationChoiceCatalog(context).cards.map(card=>card.id);assert.deepEqual(ids,['exclusive','common','after','common-two','common-three','common-four','support-skill']);
  const rewards=contestOwnedSupportRewards([{supportCardId:'owned-support',level:29}]);assert.equal(rewards.cards.size,0);assert.equal(rewards.items.size,0);
  const lower=optimizationChoiceCatalog({...context,supportCards:[{supportCardId:'owned-support',level:29}]});assert.ok(!lower.cards.some(card=>card.id==='support-skill'));assert.ok(!lower.items.some(item=>item.id==='support-item'));
});
test('正式输入投影固定主副专属、六槽、评级容量和主回忆 P 道具',()=>{
  install();const input=buildContestOptimizationInput(context,constraints),supported=new Set(input.probes.map(probe=>probe.key)),problem=createOptimizationProblem(supportedOptimizationInput(input,supported));assert.equal(problem.possible,true);
  for(let seed=1;seed<=20;seed++){
    const genome=problem.random(optimizationRandom(seed));assert.equal(problem.valid(genome),true);const memories=problem.materialize(genome);
    for(const memory of memories){assert.equal(memory.examBattleProduceCards.length,6);assert.equal(memory.examBattleProduceCards[0].id,'exclusive');assert.ok(memory.examBattleProduceCards.every(card=>!['before','unowned-skill'].includes(card.id)));assert.ok(memory.examBattleProduceCards.slice(2).every(card=>card.id!=='support-skill'));}
    assert.deepEqual(memories[0].examBattleProduceItemIds,['fixed-item','support-item']);assert.deepEqual(memories[1].examBattleProduceItemIds,[]);
  }
});
test('P 等级未知、缺少属性、重复道具与无支援信息不能启动搜索',()=>{
  install();assert.throws(()=>buildContestOptimizationInput({...context,producerLevel:null},constraints),error=>error.code==='optimization_unknown_level');
  assert.throws(()=>buildContestOptimizationInput({...context,supportCards:undefined},constraints),error=>error.code==='missing_support_bonus');
  assert.throws(()=>buildContestOptimizationInput(context,{...constraints,items:['fixed-item','fixed-item']}),error=>error.code==='optimization_invalid_items');
  const missing=structuredClone(constraints);delete missing.roles[0].params.stamina;assert.throws(()=>buildContestOptimizationInput(context,missing),error=>error.code==='optimization_missing_parameters');
});
test('预校验排除整项不支持的卡，不把它的附魔或槽位索引留在种群中',()=>{
  install();const input=buildContestOptimizationInput(context,constraints),supported=new Set(input.probes.filter(probe=>probe.entry.reference?.id!=='common').map(probe=>probe.key)),filtered=supportedOptimizationInput(input,supported);
  assert.ok(filtered.variants.every(variant=>variant.reference.id!=='common'));assert.ok(filtered.roles.every(role=>role.allowed.every(indices=>indices.every(index=>filtered.variants[index]))));
});

test('合计属性通过正式请求和保存载入保持一致，不重复叠加副回忆',async()=>{
  install();const params={vocal:1701,dance:1403,visual:901,stamina:43},input=buildContestOptimizationInput(context,{...constraints,params,roles:constraints.roles.map(({params,...role})=>role)});
  const problem=createOptimizationProblem(input),memories=problem.materialize(problem.random(optimizationRandom(12)));
  const {createContestSimulationRequest}=await import('../domain/contest-engine-request.mjs');
  const {captureSimulationLoadout}=await import('../application/contest-simulation-history.mjs');
  const stage={...context.stage,decks:[],manualMultipliers:true};
  assert.deepEqual(createContestSimulationRequest(memories,stage,context.supportCards).params,params);
  assert.deepEqual(createContestSimulationRequest(captureSimulationLoadout(memories).memories,stage,context.supportCards).params,params);
  assert.throws(()=>buildContestOptimizationInput(context,{...constraints,params:{...params,stamina:0}}),error=>error.code==='optimization_missing_parameters');
});

test('额外 P 道具按主回忆评级限制两种或三种，角色专属不占名额',()=>{
  install(['support-two','support-three']);
  const low={...constraints,roles:constraints.roles.map(role=>({...role,grade:13})),items:['fixed-item','support-item','support-two']};
  assert.equal(buildContestOptimizationInput(context,low).roles[0].template.examBattleProduceItemIds.length,3);
  const exceeded={...low,items:[...low.items,'support-three']};
  assert.throws(()=>buildContestOptimizationInput(context,exceeded),error=>error.code==='optimization_invalid_items');
  const high={...exceeded,roles:[{...low.roles[0],grade:14},low.roles[1]]};
  assert.equal(buildContestOptimizationInput(context,high).roles[0].template.examBattleProduceItemIds.length,4);
});

const unlockedContext=()=>({...context,idolCards:[{...context.idolCards[0],levelLimitRank:7}]});
const exclusive=(id='boost',upgradeCount=1)=>({id:'exclusive',upgradeCount,customizes:id?[{id,customizeCount:1}]:[]});
test('专属配置校验独立于 P 等级，返回隔离副本，次数 helper 不包含目录单卡上限',()=>{
  install([],{customizations:true});const current={...unlockedContext(),producerLevel:null,supportCards:undefined},reference=exclusive(),role={...constraints.roles[0],exclusiveReference:reference};
  assert.equal(optimizationExclusiveCustomizationLimit(current,role),1);
  const validated=validateOptimizationExclusiveReference(current,role);assert.deepEqual(validated,reference);assert.notStrictEqual(validated.customizes,reference.customizes);assert.notStrictEqual(validated.customizes[0],reference.customizes[0]);
  assert.equal(validateOptimizationExclusiveReference(current,constraints.roles[0]),undefined);
  assert.equal(optimizationExclusiveCustomizationLimit(current,{...role,grade:999}),null);
  assert.throws(()=>validateOptimizationExclusiveReference(current,{...role,grade:999}),error=>error.code==='optimization_unknown_customization_rules');
  install([],{customizations:true,maximum:0});assert.equal(optimizationExclusiveCustomizationLimit(current,role),1);
  assert.throws(()=>validateOptimizationExclusiveReference(current,role),error=>error.code==='optimization_invalid_exclusive_customization');
  const unknown=structuredClone(communityRules);delete unknown.contestCustomizations;install([],{customizations:true,rules:unknown});
  assert.equal(optimizationExclusiveCustomizationLimit(current,role),null);
  assert.throws(()=>validateOptimizationExclusiveReference(current,role),error=>error.code==='optimization_unknown_customization_rules');
});
test('精确主副专属引用约束随机与变异，正式请求与保存载入保留强化及附魔',async()=>{
  install([],{customizations:true});const current=unlockedContext(),references=[exclusive(),exclusive('alternate')];
  const fixed={...constraints,roles:constraints.roles.map((role,index)=>({...role,maxCustomizeCount:1,maxCustomizedCards:1,exclusiveReference:references[index]}))},before=structuredClone(fixed);
  const input=buildContestOptimizationInput(current,fixed),problem=createOptimizationProblem(supportedOptimizationInput(input,new Set(input.probes.map(probe=>probe.key))));
  assert.equal(problem.possible,true);
  input.roles.forEach((role,index)=>{assert.equal(role.allowed[0].length,1);assert.deepEqual(input.variants[role.allowed[0][0]].reference,references[index]);assert.deepEqual(role.template.produceCard,references[index]);});
  const assertFixed=genome=>{
    assert.ok(problem.valid(genome));const memories=problem.materialize(genome);
    memories.forEach((memory,index)=>{assert.deepEqual(memory.examBattleProduceCards[0],references[index]);assert.deepEqual(memory.produceCard,references[index]);assert.ok(memory.examBattleProduceCards.slice(1).every(card=>card.customizes.length===0));});
    return memories;
  };
  for(let seed=1;seed<=20;seed++){const random=optimizationRandom(seed),genome=problem.random(random);assertFixed(genome);assertFixed(problem.mutate(genome,random));}
  let population=optimizationPopulation(problem,{size:16,random:optimizationRandom(73)});
  for(let generation=0;generation<3;generation++){assert.ok(population.length);population.forEach(assertFixed);population=optimizationPopulation(problem,{size:16,random:optimizationRandom(73+generation),ranked:population.map(genome=>({genome}))});}
  const neighbors=problem.neighbors(population[0],optimizationRandom(32),16);assert.ok(neighbors.length);neighbors.forEach(assertFixed);
  const memories=assertFixed(population[0]);
  const {createContestSimulationRequest}=await import('../domain/contest-engine-request.mjs');
  const {captureSimulationLoadout,createSimulationRecord}=await import('../application/contest-simulation-history.mjs');
  const stage={...current.stage,decks:[],manualMultipliers:true},saved=createSimulationRecord(createContestSimulationRequest(memories,stage,current.supportCards),stage,{},{loadout:captureSimulationLoadout(memories)});
  assert.deepEqual(saved.request.cards.filter(card=>card.reference.id==='exclusive').map(card=>card.reference),references);
  assert.deepEqual(saved.loadout.memories.map(memory=>memory.produceCard),references);assert.deepEqual(saved.loadout.memories.map(memory=>memory.examBattleProduceCards[0]),references);
  assert.deepEqual(fixed,before);
  memories[0].produceCard.customizes[0].customizeCount=99;memories[0].examBattleProduceCards[0].customizes[0].customizeCount=99;
  assert.deepEqual(memories[1].produceCard,references[1]);assert.deepEqual(memories[1].examBattleProduceCards[0],references[1]);assert.deepEqual(problem.materialize(population[0])[0].produceCard,references[0]);
});
test('明确零附魔锁住指定强化版本，未提供引用的旧调用继续自动枚举',()=>{
  install([],{customizations:true});const current=unlockedContext(),reference=exclusive('',0),fixed={...constraints,roles:constraints.roles.map(role=>({...role,exclusiveReference:reference}))};
  const input=buildContestOptimizationInput(current,fixed);
  assert.ok(input.roles.every(role=>role.allowed[0].length===1&&optimizationCardKey(input.variants[role.allowed[0][0]].reference)===optimizationCardKey(reference)));
  const automatic=buildContestOptimizationInput(current,constraints);
  assert.ok(automatic.roles.every(role=>role.allowed[0].length>1));
  assert.ok(automatic.roles[0].allowed[0].some(index=>automatic.variants[index].reference.upgradeCount===1&&automatic.variants[index].reference.customizes.length));
  assert.deepEqual(automatic.roles[0].template.produceCard,exclusive('',0));
});
test('专属配置不匹配、非法版本、未知附魔、非法次数和重复附魔均以专用错误码拒绝',()=>{
  install([],{customizations:true});const current=unlockedContext();
  const invalid=[null,{...exclusive(),id:'common'},{...exclusive(),upgradeCount:2},{...exclusive(),upgradeCount:-1},{...exclusive(),upgradeCount:'1'},
    {...exclusive(),customizes:undefined},exclusive('unknown'),{...exclusive(),customizes:[{id:'boost',customizeCount:0}]},{...exclusive(),customizes:[{id:'boost',customizeCount:-1}]},
    {...exclusive(),customizes:[{id:'boost',customizeCount:1.5}]},{...exclusive(),customizes:[{id:'boost',customizeCount:3}]},{...exclusive(),customizes:[{id:'boost',customizeCount:1},{id:'boost',customizeCount:1}]}];
  for(const reference of invalid){
    const role={...constraints.roles[0],exclusiveReference:reference};
    assert.throws(()=>validateOptimizationExclusiveReference(current,role),error=>error.code==='optimization_invalid_exclusive_customization');
    assert.throws(()=>buildContestOptimizationInput(current,{...constraints,roles:[role,constraints.roles[1]]}),error=>error.code==='optimization_invalid_exclusive_customization');
  }
});
test('专属解锁、评级名额、单卡次数与整份回忆预算不能静默截断',()=>{
  install([],{customizations:true});const current=unlockedContext(),role={...constraints.roles[0],exclusiveReference:exclusive()};
  const locked={...current,idolCards:[{...current.idolCards[0],levelLimitRank:6}]};
  assert.equal(optimizationExclusiveCustomizationLimit(locked,role),0);
  assert.throws(()=>validateOptimizationExclusiveReference(locked,role),error=>error.code==='optimization_invalid_exclusive_customization');
  assert.throws(()=>buildContestOptimizationInput(locked,{...constraints,roles:[role,constraints.roles[1]]}),error=>error.code==='optimization_invalid_exclusive_customization');
  const noSlots={...role,grade:selectionGrades.indexOf('A+')};assert.equal(optimizationExclusiveCustomizationLimit(current,noSlots),0);
  for(const limited of [noSlots,{...role,maxCustomizeCount:0},{...role,maxCustomizedCards:0},{...role,exclusiveReference:{...exclusive(),customizes:[{id:'boost',customizeCount:2}]}}]){
    assert.throws(()=>validateOptimizationExclusiveReference(current,limited),error=>error.code==='optimization_invalid_exclusive_customization');
  }
  const unowned={...current,idolCards:[]};assert.equal(optimizationExclusiveCustomizationLimit(unowned,role),null);
  assert.throws(()=>validateOptimizationExclusiveReference(unowned,role),error=>error.code==='optimization_invalid_exclusive_customization');
  assert.throws(()=>buildContestOptimizationInput(unowned,{...constraints,roles:[role,role]}),error=>error.code==='optimization_invalid_exclusive_customization');
});
test('固定附魔未通过引擎预校验时固定槽无解，不回退为其它附魔或零附魔',()=>{
  install([],{customizations:true});const current=unlockedContext(),fixed={...constraints,roles:constraints.roles.map(role=>({...role,exclusiveReference:exclusive()}))};
  const input=buildContestOptimizationInput(current,fixed),supported=new Set(input.probes.filter(probe=>probe.entry.reference?.id!=='exclusive'||!probe.entry.reference.customizes.length).map(probe=>probe.key));
  const filtered=supportedOptimizationInput(input,supported);assert.ok(filtered.roles.every(role=>role.allowed[0].length===0));assert.equal(createOptimizationProblem(filtered).possible,false);
});


test('固定道具与舞台公共牌纳入搜索前的必需校验，不在评分阶段才发现缺失',()=>{
  install();const current={...context,stage:{...context.stage,decks:[{planType:'ProducePlanType_Plan1',produceCards:[{id:'common',upgradeCount:0,customizes:[]}]}]}},input=buildContestOptimizationInput(current,constraints);
  assert.ok(input.fixedProbes.includes('item:fixed-item'));assert.ok(input.fixedProbes.includes('item:support-item'));
  assert.ok(input.fixedProbes.includes(optimizationCardKey({id:'common',upgradeCount:0,customizes:[]})));
  assert.equal(input.probes.find(probe=>probe.key==='item:fixed-item').kind,'item');
});

test('公开标记不同的卡片仍在每张生成回忆内统一禁重',()=>{
  install();const input=buildContestOptimizationInput(context,constraints),filtered=supportedOptimizationInput(input,new Set(input.probes.map(probe=>probe.key))),problem=createOptimizationProblem(filtered);
  assert.ok(problem.possible);
  for(let seed=1;seed<=10;seed++)for(const memory of problem.materialize(problem.random(optimizationRandom(seed))))assert.equal(new Set(memory.examBattleProduceCards.map(card=>card.id)).size,6);
});

test('候选将公开稀有度及解锁等级传入搜索，支持过滤后仍保留',()=>{
  install();const input=buildContestOptimizationInput(context,constraints),filtered=supportedOptimizationInput(input,new Set(input.probes.map(probe=>probe.key)));
  assert.ok(filtered.variants.length);for(const variant of filtered.variants){assert.equal(variant.rarity,'SSR');assert.equal(variant.unlockProducerLevel,5);}
});
