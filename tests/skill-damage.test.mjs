import test from 'node:test';
import assert from 'node:assert/strict';
import {installMaster,supportSkillVisual} from '../domain/catalog.mjs';

function install(){
  const effect=(id,value,count=1,type='ExamLesson')=>({id,effectType:`ProduceExamEffectType_${type}`,effectValue1:value,effectCount:count});
  const card=(id,upgradeCount,effectId,trigger='',definition={},hideIcon=false)=>({id,upgradeCount,category:'ProduceCardCategory_ActiveSkill',rarity:'ProduceCardRarity_Sr',definition,
    playEffects:[{produceExamEffectId:effectId,produceExamTriggerId:trigger,hideIcon}]});
  installMaster({tables:{ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[effect('base',18),effect('upgraded',27),effect('multi',9,2),effect('dynamic',180,1,'ExamLessonDependBlock'),effect('block',15,0,'ExamBlock'),effect('block-upgraded',27,0,'ExamBlock'),effect('block-dynamic',150,0,'ExamBlockDependCardPlayAggressive')],ProduceCard:[
    card('block',0,'block'),card('block',1,'block-upgraded'),card('block-conditional',0,'block','trigger'),card('block-hidden',0,'block','',{},true),card('block-dynamic',0,'block-dynamic'),
    card('fixed',0,'base'),card('fixed',1,'upgraded'),card('multi',0,'multi'),card('conditional',0,'base','trigger'),card('dynamic',0,'dynamic'),
    card('usage',0,'base','',{playProduceExamTriggerId:'usage-trigger'}),card('hidden',0,'base','',{},true),card('unknown',0,'missing'),
  ]}});
}
test('固定伤害取强化版本，保留多次效果次数，使用条件不冒充效果条件',()=>{
  install();
  assert.deepEqual(supportSkillVisual({id:'fixed',upgradeCount:0}).damage,{value:18,count:1});
  assert.deepEqual(supportSkillVisual({id:'fixed',upgradeCount:1}).damage,{value:27,count:1});
  assert.deepEqual(supportSkillVisual({id:'multi',upgradeCount:0}).damage,{value:9,count:2});
  assert.deepEqual(supportSkillVisual({id:'usage',upgradeCount:0}).damage,{value:18,count:1});
});
test('条件、动态、隐藏及未解析效果不显示固定伤害，已附魔不冒充基础值',()=>{
  install();
  for(const id of ['conditional','dynamic','hidden','unknown'])assert.equal(supportSkillVisual({id,upgradeCount:0}).damage,undefined);
  assert.equal(supportSkillVisual({id:'fixed',upgradeCount:0,customizes:[{customizeCount:1}]}).damage,undefined);
});

test('元气右上数值区分强化，条件与动态效果及未合并附魔不显示定值',()=>{
  install();
  assert.deepEqual(supportSkillVisual({id:'block',upgradeCount:0}).block,{value:15,count:0});
  assert.deepEqual(supportSkillVisual({id:'block',upgradeCount:1}).block,{value:27,count:0});
  for(const id of ['block-conditional','block-hidden','block-dynamic','unknown'])assert.equal(supportSkillVisual({id,upgradeCount:0}).block,undefined);
  assert.equal(supportSkillVisual({id:'block',upgradeCount:0,customizes:[{customizeCount:1}]}).block,undefined);
});

test('消耗按已选附魔等级合并，不重复乘次数，保留零值与红绿心区别',()=>{
  installMaster({tables:{ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[],ProduceCard:[
    {id:'costs',upgradeCount:1,definition:{stamina:3,forceStamina:1,costType:'ExamCostType_ExamFullPowerPoint',costValue:2}},
  ]},semantics:{tables:{ProduceCardCustomize:[
    {id:'reduce',customizeCount:2,produceCardGrowEffectIds:['stamina','status']},
    {id:'effect',customizeCount:1,produceCardGrowEffectIds:['unrelated']},
  ],ProduceCardGrowEffect:[
    {id:'stamina',effectType:'ProduceCardGrowEffectType_CostReduce',value:2},
    {id:'status',effectType:'ProduceCardGrowEffectType_CostFullPowerPointReduce',value:3},
    {id:'unrelated',effectType:'ProduceCardGrowEffectType_EffectAdd'},
  ]}}});
  const reference={id:'costs',upgradeCount:1,customizes:[{id:'reduce',customizeCount:2}]};
  const visual=supportSkillVisual(reference);
  assert.equal(visual.costsKnown,true);
  assert.deepEqual(visual.costs.map(({kind,value})=>({kind,value})),[{kind:'stamina',value:1},{kind:'direct',value:1},{kind:'status',value:0}]);
  assert.equal(visual.costs[0].icon,'skill-stamina.webp');
  assert.equal(visual.costs[1].icon,'skill-stamina-direct.webp');
  assert.equal(visual.costs[1].label,'体力');
  assert.deepEqual(supportSkillVisual({...reference,customizes:[{id:'effect',customizeCount:1}]}).costs.map(c=>c.value),[3,1,2]);
  assert.equal(supportSkillVisual({...reference,customizes:[{id:'unknown',customizeCount:1}]}).costsKnown,false);
});

test('固定伤害、次数与元气按当前附魔等级计算，消耗附魔不隐藏伤害',()=>{
  installMaster({tables:{ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[
    {id:'hit',effectType:'ProduceExamEffectType_ExamLesson',effectValue1:18,effectCount:1},
    {id:'shield',effectType:'ProduceExamEffectType_ExamBlock',effectValue1:10,effectCount:0},
  ],ProduceCard:[{id:'enchanted',upgradeCount:1,definition:{},playEffects:[{produceExamEffectId:'hit'},{produceExamEffectId:'shield'}]}]},semantics:{tables:{
    ProduceCardCustomize:[{id:'custom',customizeCount:2,produceCardGrowEffectIds:['damage','count','block']},{id:'cost',customizeCount:1,produceCardGrowEffectIds:['cost']},{id:'replace',customizeCount:1,produceCardGrowEffectIds:['replace']}],
    ProduceCardGrowEffect:[{id:'damage',effectType:'ProduceCardGrowEffectType_LessonAdd',value:12},{id:'count',effectType:'ProduceCardGrowEffectType_LessonCountAdd',value:1},{id:'block',effectType:'ProduceCardGrowEffectType_BlockReduce',value:3},{id:'cost',effectType:'ProduceCardGrowEffectType_CostReduce',value:1},{id:'replace',effectType:'ProduceCardGrowEffectType_EffectChange'}],
  }}});
  const visual=id=>supportSkillVisual({id:'enchanted',upgradeCount:1,customizes:[{id,customizeCount:id==='custom'?2:1}]});
  assert.deepEqual(visual('custom').damage,{value:30,count:2});assert.deepEqual(visual('custom').block,{value:7,count:0});
  assert.deepEqual(visual('cost').damage,{value:18,count:1});assert.equal(visual('replace').damage,undefined);
});

test('新增无关效果与使用条件不隐藏原值，多段固定效果逐段保留',()=>{
  installMaster({tables:{ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[
    {id:'hit',effectType:'ProduceExamEffectType_ExamLesson',effectValue1:18,effectCount:2},
    {id:'shield',effectType:'ProduceExamEffectType_ExamBlock',effectValue1:10,effectCount:0},
    {id:'extra-hit',effectType:'ProduceExamEffectType_ExamLesson',effectValue1:6,effectCount:1},
    {id:'extra-shield',effectType:'ProduceExamEffectType_ExamBlock',effectValue1:4,effectCount:0},
    {id:'buff',effectType:'ProduceExamEffectType_ExamLessonBuff',effectValue1:2},
    {id:'dynamic',effectType:'ProduceExamEffectType_ExamLessonDependBlock',effectValue1:100},
  ],ProduceCard:[{id:'card',upgradeCount:1,definition:{},playEffects:[{produceExamEffectId:'hit'},{produceExamEffectId:'shield'}]}]},semantics:{tables:{
    ProduceCardCustomize:['buff','hit','shield','conditional','usage','status','replace'].map(id=>({id,customizeCount:1,produceCardGrowEffectIds:[id]})),
    ProduceCardGrowEffect:[
      {id:'buff',effectType:'ProduceCardGrowEffectType_EffectAdd',playProduceExamEffectId:'buff'},
      {id:'hit',effectType:'ProduceCardGrowEffectType_EffectAdd',playProduceExamEffectId:'extra-hit'},
      {id:'shield',effectType:'ProduceCardGrowEffectType_EffectAdd',playProduceExamEffectId:'extra-shield'},
      {id:'conditional',effectType:'ProduceCardGrowEffectType_EffectAdd',playProduceExamEffectId:'extra-hit',playEffectProduceExamTriggerId:'condition'},
      {id:'usage',effectType:'ProduceCardGrowEffectType_PlayTriggerChange',playProduceExamTriggerId:'condition'},
      {id:'status',effectType:'ProduceCardGrowEffectType_CardStatusEnchantChange',produceCardStatusEnchantId:'status'},
      {id:'replace',effectType:'ProduceCardGrowEffectType_EffectChange',targetPlayProduceExamEffectIds:['hit'],playProduceExamEffectId:'dynamic'},
    ],
  }}});
  const visual=id=>supportSkillVisual({id:'card',upgradeCount:1,customizes:[{id,customizeCount:1}]});
  for(const id of ['buff','conditional','usage','status']){assert.deepEqual(visual(id).damage,{value:18,count:2});assert.deepEqual(visual(id).block,{value:10,count:0});}
  assert.deepEqual(visual('hit').damage,{parts:[{value:18,count:2},{value:6,count:1}]});
  assert.deepEqual(visual('shield').block,{parts:[{value:10,count:0},{value:4,count:0}]});
  assert.equal(visual('replace').damage,undefined);assert.deepEqual(visual('replace').block,{value:10,count:0});
});

test('效果条件替换只影响目标，解除条件后显示固定数值，仍有条件则不显示',()=>{
  installMaster({tables:{ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[
    {id:'hit',effectType:'ProduceExamEffectType_ExamLesson',effectValue1:12,effectCount:1},
    {id:'shield',effectType:'ProduceExamEffectType_ExamBlock',effectValue1:8,effectCount:0},
  ],ProduceCard:[{id:'conditional',upgradeCount:1,definition:{},playEffects:[{produceExamEffectId:'hit',produceExamTriggerId:'hit-condition'},{produceExamEffectId:'shield',produceExamTriggerId:'other-condition'}]}]},semantics:{tables:{
    ProduceCardCustomize:['remove','change'].map(id=>({id,customizeCount:1,produceCardGrowEffectIds:[id]})),
    ProduceCardGrowEffect:[
      {id:'remove',effectType:'ProduceCardGrowEffectType_PlayEffectTriggerChange',targetPlayEffectProduceExamTriggerIds:['hit-condition'],playEffectProduceExamTriggerId:''},
      {id:'change',effectType:'ProduceCardGrowEffectType_PlayEffectTriggerChange',targetPlayEffectProduceExamTriggerIds:['hit-condition'],playEffectProduceExamTriggerId:'new-condition'},
    ],
  }}});
  const visual=id=>supportSkillVisual({id:'conditional',upgradeCount:1,customizes:[{id,customizeCount:1}]});
  assert.deepEqual(visual('remove').damage,{value:12,count:1});assert.equal(visual('remove').block,undefined);
  assert.equal(visual('change').damage,undefined);
});
