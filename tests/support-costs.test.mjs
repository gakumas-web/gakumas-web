import {imageConfig} from '../image-config.mjs';
import {assetURL} from '../resources.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {installMaster,supportSkillVisual} from '../domain/catalog.mjs';

function install(){
  const card=(id,upgradeCount,definition)=>({id,upgradeCount,category:'ProduceCardCategory_ActiveSkill',rarity:'ProduceCardRarity_Ssr',definition});
  installMaster({tables:{ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[],ProduceCard:[
    {...card('legend-a',0,{}),rarity:'ProduceCardRarity_Legend'},
    {...card('legend-m',0,{}),rarity:'ProduceCardRarity_Legend',category:'ProduceCardCategory_MentalSkill'},
    {...card('n-a',0,{}),rarity:'ProduceCardRarity_N'},
    {...card('n-m',0,{}),rarity:'ProduceCardRarity_N',category:'ProduceCardCategory_MentalSkill'},
    {...card('trouble',0,{}),rarity:'ProduceCardRarity_N',category:'ProduceCardCategory_Trouble'},
    {...card('grow',0,{}),playEffects:[{produceExamEffectId:'grow-effect',hideIcon:false}],descriptions:[{produceCardGrowEffectType:'ProduceCardGrowEffectType_LessonAdd',originProduceExamEffectId:'grow-effect',text:'成長'}]},
    card('normal',1,{stamina:3,forceStamina:0}),card('direct',0,{stamina:0,forceStamina:3}),card('direct',1,{stamina:0,forceStamina:2}),
    card('motivation',1,{stamina:0,costType:'ExamCostType_ExamCardPlayAggressive',costValue:2}),
    card('condition',1,{stamina:0,costType:'ExamCostType_ExamParameterBuff',costValue:1}),
  ]},abilityIcons:{examIcons:{ExamLesson:'lesson.webp',ExamCardPlayAggressive:'img_motivation.webp',ExamParameterBuff:'img_condition.webp'}}});
}
test('普通体力与直接体力使用不同图标，强化版本保持对应消耗',()=>{
  const previous={...imageConfig};
  Object.assign(imageConfig,{icons:['skill-stamina.webp','skill-stamina-direct.webp'],iconURLs:{'skill-stamina.webp':'blob:https://example.invalid/stamina','skill-stamina-direct.webp':'blob:https://example.invalid/direct'}});
  try{
  install();const normal=supportSkillVisual({id:'normal',upgradeCount:1}).costs[0];
  const direct=supportSkillVisual({id:'direct',upgradeCount:1}).costs[0];
  assert.equal(normal.kind,'stamina');assert.equal(direct.kind,'direct');assert.notEqual(normal.icon,direct.icon);
  assert.match(direct.label,/无法用元气抵消/);assert.equal(direct.value,2);
  assert.equal(supportSkillVisual({id:'direct',upgradeCount:0}).costs[0].value,3);
  }finally{Object.assign(imageConfig,previous);}
});
test('状态消耗使用状态底板类型和对应图标，やる気标为干劲',()=>{
  install();const motivation=supportSkillVisual({id:'motivation',upgradeCount:1}).costs;
  assert.equal(motivation.length,1);assert.equal(motivation[0].kind,'status');assert.equal(motivation[0].label,'干劲');assert.equal(motivation[0].icon,assetURL('img_motivation.webp'));
  const condition=supportSkillVisual({id:'condition',upgradeCount:1}).costs[0];
  assert.equal(condition.kind,'status');assert.equal(condition.label,'好调');assert.equal(condition.icon,assetURL('img_condition.webp'));
});

test('Legend 使用 LR 素材名，主动与精神卡分别取对应边框',()=>{
  install();
  assert.equal(supportSkillVisual({id:'legend-a',upgradeCount:0}).frame,'skill-frame-a-lr');
  assert.equal(supportSkillVisual({id:'legend-m',upgradeCount:0}).frame,'skill-frame-m-lr');
});

test('N 稀有度与 Trouble 分别取明确边框，增长图标与正文共用映射',()=>{
  install();
  for(const [id,frame] of [['n-a','skill-frame-a-n'],['n-m','skill-frame-m-n'],['trouble','skill-frame-t']])
    assert.equal(supportSkillVisual({id,upgradeCount:0}).frame,frame);
  assert.deepEqual(supportSkillVisual({id:'grow',upgradeCount:0}).icons,[{image:'lesson.webp',label:'成長'}]);
});
