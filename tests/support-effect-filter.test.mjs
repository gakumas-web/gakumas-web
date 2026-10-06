import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesSupportEffect} from '../domain/model.mjs';

test('成长率、属性提升与 SP 出现率分别组合目标属性',()=>{
  assert.equal(matchesSupportEffect('VocalGrowthRateAddition',['GrowthRate'],['Vocal']),true);
  assert.equal(matchesSupportEffect('VocalGrowthRateAddition',['GrowthRate'],['Dance']),false);
  assert.equal(matchesSupportEffect('DanceAddition',['AttributeAddition'],['Dance','Visual']),true);
  assert.equal(matchesSupportEffect('LessonVisualSpChangeRatePermilAddition',['SpChangeRate'],['Dance','Visual']),true);
  assert.equal(matchesSupportEffect('StaminaRecoverFix',['StaminaRecover'],['Vocal']),false);
});
test('类型和属性必须来自同一个效果，不能跨技能拼凑命中',()=>{
  const kinds=['VocalGrowthRateAddition','LessonDanceSpChangeRatePermilAddition'];
  assert.equal(kinds.some(kind=>matchesSupportEffect(kind,['SpChangeRate'],['Vocal'])),false);
  assert.equal(kinds.some(kind=>matchesSupportEffect(kind,['GrowthRate','SpChangeRate'],['Vocal'])),true);
});
test('全属性 SP 枚举匹配任意目标，不限属性保留无属性效果',()=>{
  for(const attr of ['Vocal','Dance','Visual'])assert.equal(matchesSupportEffect('LessonSpChangeRatePermilAddition',['SpChangeRate'],[attr]),true);
  assert.equal(matchesSupportEffect('StaminaRecoverFix',['StaminaRecover'],[]),true);
});
test('满级效果检索覆盖未持有和低等级卡，当前效果模型仍按实际等级',async()=>{
  const {installMaster,progressionInfo}=await import('../domain/catalog.mjs');
  const {supportEntries}=await import('../domain/catalog-selectors.mjs');
  installMaster({tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceEffect:[],ProduceExamEffect:[],ProduceSkill:[{id:'late',level:1,descriptions:[{produceDescriptionType:'ProduceDescriptionType_PlainText',text:'高等级专用效果'}],produceTriggerId1:'rest',produceEffectId1:'recover'}]},
    supports:{cards:[{id:'card',name:'测试卡',rarity:'SupportCardRarity_SSR',type:'SupportCardType_Assist',characterIds:[]}]},
    semantics:{tables:{ProduceTrigger:[{id:'rest',phaseType:'ProducePhaseType_StartRefresh'}]}},
    progression:{tables:{SupportCard:[{id:'card',supportCardLevelLimitId:'limits'}],SupportCardLevelLimit:[{id:'limits',rank:'Rank_Unknown',levelLimit:40},{id:'limits',rank:'Rank__4',levelLimit:60}],SupportCardProduceSkillLevelAssist:[{supportCardId:'card',supportCardLevel:50,produceSkillId:'late',produceSkillLevel:1,order:1}]}}});
  const filters={supportTrigger:'StartRefresh'};
  const empty={supportCards:[]};
  const unowned=supportEntries(empty,'','original',filters);
  assert.equal(unowned.length,1);assert.equal(unowned[0].held.ownership,'unowned');assert.equal(unowned[0].held.level,1);
  assert.equal(progressionInfo('support',unowned[0].held).changes.length,0);assert.equal(unowned[0].searchEffects.length,1);
  assert.equal(supportEntries(empty,'高等级专用效果','original',{}).length,1);
  assert.equal(supportEntries(empty,'','original',{...filters,ownership:'owned'}).length,0);
  const held={supportCards:[{supportCardId:'card',level:10,levelLimitRank:0}]};
  const owned=supportEntries(held,'','original',{...filters,ownership:'owned'});
  assert.equal(owned.length,1);assert.equal(owned[0].held.level,10);assert.equal(progressionInfo('support',owned[0].held).changes.length,0);
});
