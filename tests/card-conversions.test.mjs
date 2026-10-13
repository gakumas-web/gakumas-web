import {contestMemoryCards} from '../domain/contest-simulation.mjs';
import {createContestSimulationRequest} from '../domain/contest-engine-request.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {activeConversionCard,conversionChoiceEnabled,conversionChoiceAvailable,cardConversionRules} from '../domain/card-conversions.mjs';
import {loadCardConversions,saveCardConversions,cardConversionKey} from '../application/card-conversion-preferences.mjs';
import {contestChoiceOwned} from '../domain/contest-loadout.mjs';
import {installMaster,contestCustomizationCatalog} from '../domain/catalog.mjs';

const conversion={beforeProduceCardId:'before',afterProduceCardId:'after',unlockProducerLevel:58};
const before={id:'before',conversion},after={id:'after',conversion,isConversion:true};
test('转换版默认启用，但 P 等级是独立前置门槛',()=>{
  for(const level of [null,undefined,57]){
    assert.equal(activeConversionCard(conversion,level),'before');
    assert.equal(conversionChoiceEnabled(after,level,{before:'after'}),false);
  }
  assert.equal(activeConversionCard(conversion,58),'after');
  assert.equal(conversionChoiceEnabled(before,58),false);
  assert.equal(conversionChoiceEnabled(after,58),true);
  assert.equal(activeConversionCard(conversion,80,{before:'before'}),'before');
  assert.equal(conversionChoiceEnabled(after,80,{before:'before'}),false);
});
test('旧内容缺少配对时不能把转换卡的零等级当作已解锁',()=>{
  assert.equal(conversionChoiceEnabled({id:'after',isConversion:true},80),false);
  assert.equal(conversionChoiceEnabled({id:'ordinary'},null),true);
});
test('启用偏好按账号保存，刷新可恢复，不跨账号继承',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  saveCardConversions('synthetic-a',{before:'before'},storage);
  assert.deepEqual(loadCardConversions('synthetic-a',storage),{before:'before'});
  assert.deepEqual(loadCardConversions('synthetic-b',storage),{});
  values.set(cardConversionKey('synthetic-a'),'{invalid');
  assert.deepEqual(loadCardConversions('synthetic-a',storage),{});
});
test('正式目录将转换等级提供给持有筛选而不是原始零等级',()=>{
  const row=id=>({id,upgradeCount:0,name:id,definition:{isConversion:id==='after',unlockProducerLevel:id==='after'?0:6},descriptions:[],images:{},playEffects:[]});
  installMaster({tables:{ProduceCard:[row('before'),row('after')],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},progression:{tables:{ProduceCardConversion:[conversion]}}});
  const choice=contestCustomizationCatalog().cards.find(row=>row.id==='after');
  assert.equal(choice.unlockProducerLevel,58);
  choice.metadata.source='common';
  assert.equal(contestChoiceOwned(choice,{producerLevel:57},'other'),false);
  assert.equal(contestChoiceOwned(choice,{producerLevel:58},'other'),true);
});

test('转换限制先于重复判断，单独出现的非当前版本也排除，回忆与附魔不变',()=>{
  const card=(id,upgradeCount=0,customizes=[])=>({id,upgradeCount,customizes});
  const memories=[{examBattleProduceCards:[card('before',1,[{id:'old-customize',customizeCount:2}]),card('after'),card('ordinary')]},{examBattleProduceCards:[card('after',1),card('ordinary')]}];
  const original=structuredClone(memories),afterRules=cardConversionRules([conversion],58),beforeRules=cardConversionRules([conversion],58,{before:'before'});
  const entries=contestMemoryCards(memories,c=>c.id!=='ordinary',afterRules);
  assert.equal(entries[0].exclusion,'conversion');assert.equal(entries[0].retained,false);
  assert.deepEqual(entries.filter(e=>e.retained).map(e=>[e.card.id,e.memoryIndex]),[['ordinary',0],['after',1],['ordinary',1]]);
  const old=contestMemoryCards(memories,()=>true,beforeRules);
  assert.deepEqual(old.filter(e=>e.retained).map(e=>e.card.id),['before','ordinary']);
  assert.equal(old.filter(e=>e.exclusion==='conversion').length,2);
  assert.equal(contestMemoryCards([{examBattleProduceCards:[card('before')]}],()=>true,afterRules).filter(e=>e.retained).length,0);
  assert.deepEqual(cardConversionRules([conversion],57),beforeRules);
  assert.deepEqual(memories,original);
});
test('正式模拟请求剔除限制卡，不把原版自动改成转换版，不拒绝整份回忆',()=>{
  const main={planType:4,vocal:100,dance:200,visual:300,stamina:30,examBattleProduceCards:[{id:'before',upgradeCount:0,customizes:[]}],examBattleProduceItemIds:[]};
  const stage={decks:[],curve:[],kind:'contest',turn:12};
  const request=createContestSimulationRequest([main],stage,[],{},cardConversionRules([conversion],58));
  assert.deepEqual(request.cards,[]);assert.equal(request.params.stamina,30);
  const restored=createContestSimulationRequest([main],stage,[],{},cardConversionRules([conversion],58,{before:'before'}));
  assert.deepEqual(restored.cards.map(card=>card.reference.id),['before']);
  assert.equal(main.examBattleProduceCards[0].id,'before');
});

test('自选同时保留已解锁的转换前后版本，当前开关只影响参赛',()=>{
  for(const level of [undefined,57,58,80])assert.equal(conversionChoiceAvailable(before,level),true);
  for(const level of [undefined,57])assert.equal(conversionChoiceAvailable(after,level),false);
  assert.equal(conversionChoiceAvailable(after,58),true);
  assert.equal(conversionChoiceAvailable(before,58),true);
  assert.equal(conversionChoiceEnabled(before,58),false);
  assert.equal(conversionChoiceAvailable({id:'after',isConversion:true},80),false);
});
