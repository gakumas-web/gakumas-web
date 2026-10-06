import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCardCustomizations,customizationPreview,recordedCustomizationState} from '../domain/card-customizations.mjs';
import {createProgression} from '../domain/progression.mjs';
const text=value=>({produceDescriptionType:'ProduceDescriptionType_PlainText',text:value});
test('卡片使用条件变化读取独立描述，不借用效果触发说明或宣称旧内容完整',()=>{
  const {base,catalog}=fixture();
  catalog.ProduceCardGrowEffect[0]={id:'add',effectType:'ProduceCardGrowEffectType_PlayTriggerChange',playProduceExamTriggerId:'new-trigger'};
  catalog.ProduceExamTrigger=[{id:'new-trigger',playProduceDescriptions:[text('手札が2枚以上の場合、使用可')],playEffectProduceDescriptions:[text('別の効果条件')]}];
  const read=()=>createCardCustomizations(base,catalog).available({id:'card',upgradeCount:1}).options[0].levels[0].effects[0];
  assert.equal(read().text,'手札が2枚以上の場合、使用可');assert.equal(read().complete,true);
  assert.equal(read().descriptionParts[0].originProduceExamTriggerId,'new-trigger');
  delete catalog.ProduceExamTrigger[0].playProduceDescriptions;
  assert.equal(read().complete,false);assert.equal(read().text,'');
  catalog.ProduceExamTrigger=[];assert.equal(read().complete,false);
});
function fixture(){
  const base={ProduceCard:[{id:'card',name:'カード',upgradeCount:0,definition:{produceCardCustomizeIds:[],maxCustomizeCount:0}},
    {id:'card',name:'カード+',upgradeCount:1,definition:{produceCardCustomizeIds:['first'],maxCustomizeCount:1}},
    {id:'card',name:'カード++',upgradeCount:2,definition:{produceCardCustomizeIds:['second'],maxCustomizeCount:1}}],
    ProduceExamEffect:[{id:'added',effectTurn:3,descriptions:[{produceDescriptionType:'ProduceDescriptionType_Exam',examDescriptionType:'ExamDescriptionType_ExamTurn',originProduceExamEffectId:'added',text:''},text('の間、集中+2')]}]};
  const catalog={ProduceCardCustomize:[{id:'first',customizeCount:1,producePoint:120,description:'',produceCardGrowEffectIds:['add']},{id:'second',customizeCount:2,producePoint:150,description:'',produceCardGrowEffectIds:['percent']},{id:'second',customizeCount:1,producePoint:100,description:'',produceCardGrowEffectIds:['percent']}],
    ProduceCardGrowEffect:[{id:'add',effectType:'ProduceCardGrowEffectType_EffectAdd',playProduceExamEffectId:'added'},{id:'percent',effectType:'ProduceCardGrowEffectType_LessonDependBlockAdd',value:600}],
    ProduceDescriptionProduceCardGrowEffect:[{type:'ProduceCardGrowEffectType_EffectAdd',name:'効果追加'},{type:'ProduceCardGrowEffectType_LessonDependBlockAdd',name:'元気分パラメータ倍率増加',produceCardCustomizeDescription:'元気分パラメータ+'}]};
  return {base,catalog};
}
test('按技能卡ID与强化版本联接选项，保留等级、费用及次数上限',()=>{
  const {base,catalog}=fixture(),get=createCardCustomizations(base,catalog).available;
  assert.equal(get({id:'card',upgradeCount:0}).options.length,0);
  const first=get({id:'card',upgradeCount:1});assert.equal(first.maximum,1);assert.equal(first.options[0].id,'first');assert.equal(first.options[0].levels[0].producePoint,120);
  assert.deepEqual(get({id:'card',upgradeCount:2}).options[0].levels.map(row=>[row.level,row.producePoint]),[[1,100],[2,150]]);
  assert.equal(get({id:'card',upgradeCount:3}),null);
});
test('动态回合只取相同效果记录，千分比只对明确类型换算',()=>{
  const {base,catalog}=fixture(),get=createCardCustomizations(base,catalog).available;
  assert.equal(get({id:'card',upgradeCount:1}).options[0].levels[0].effects[0].text,'3ターンの間、集中+2');
  assert.equal(get({id:'card',upgradeCount:2}).options[0].levels[0].effects[0].text,'元気分パラメータ+60%');
  assert.equal(get({id:'card',upgradeCount:2}).options[0].levels[0].effects[0].descriptionParts[0].examEffectType,'ProduceExamEffectType_ExamLesson');
  base.ProduceExamEffect[0].descriptions[0].originProduceExamEffectId='different';
  assert.equal(createCardCustomizations(base,catalog).available({id:'card',upgradeCount:1}).complete,false);
});
test('替换效果同时保留旧新原文，移除条件仅定位声明的触发节点',()=>{
  const {base,catalog}=fixture();base.ProduceCard[1].descriptions=[{...text('やる気が3以上の場合、'),originProduceExamTriggerId:'target'},text('別の条件は保留')];
  base.ProduceExamEffect.push({id:'old',descriptions:[text('元気+1')]});
  catalog.ProduceCardGrowEffect[0]={id:'add',effectType:'ProduceCardGrowEffectType_EffectChange',playProduceExamEffectId:'added',targetPlayProduceExamEffectIds:['old']};
  const changed=createCardCustomizations(base,catalog).available({id:'card',upgradeCount:1}).options[0].levels[0].effects[0];assert.deepEqual(changed.replaces,['元気+1']);
  catalog.ProduceCardGrowEffect[0]={id:'add',effectType:'ProduceCardGrowEffectType_PlayEffectTriggerChange',targetPlayEffectProduceExamTriggerIds:['target'],playEffectProduceExamTriggerId:''};
  const removed=createCardCustomizations(base,catalog).available({id:'card',upgradeCount:1}).options[0].levels[0].effects[0];assert.equal(removed.text,'やる気が3以上の場合、');assert.equal(removed.removesCondition,true);
});
test('成长变更读取关联状态说明，缺失依赖显式不完整',()=>{
  const {base,catalog}=fixture();catalog.ProduceCardGrowEffect[0]={id:'add',effectType:'ProduceCardGrowEffectType_CardStatusEnchantChange',produceCardStatusEnchantId:'enchant'};
  catalog.ProduceCardStatusEnchant=[{id:'enchant',produceDescriptions:[text('成長：パラメータ+15')]}];
  assert.equal(createCardCustomizations(base,catalog).available({id:'card',upgradeCount:1}).options[0].levels[0].effects[0].text,'成長：パラメータ+15');
  catalog.ProduceCardStatusEnchant=[];assert.equal(createCardCustomizations(base,catalog).available({id:'card',upgradeCount:1}).complete,false);
});
test('解锁按实际技能效果类型与卡片上限判断，6到7的预览不改实际持有状态',()=>{
  const data=JSON.parse(readFileSync(new URL('./fixtures/public-data/progression.json',import.meta.url))).tables;
  const unlock=data.IdolCardLevelLimitProduceSkill.find(row=>row.rank==='IdolCardLevelLimitRank__7');
  const model=createProgression(data,{ProduceSkill:[{id:unlock.produceSkillId,level:unlock.produceSkillLevel,produceEffectId1:'enable'}],ProduceEffect:[{id:'enable',produceEffectType:'ProduceEffectType_IdolCardProduceCardCustomizeEnable'}]},
    {card:({id})=>({heading:id,lines:[]}),item:id=>({heading:id,lines:[]})});
  const held={idolCardId:'i_card-hski-3-000',levelLimitRank:6,potentialRank:0},result=model.idol(held,7);
  assert.equal(result.customization.rank,7);assert.equal(result.customization.unlocked,false);assert.equal(result.customization.targetUnlocked,true);assert.equal(held.levelLimitRank,6);
  const change=result.changes.find(row=>row.customizationUnlock);assert.equal(change.before,'未解锁');assert.equal(change.after,'解锁角色专属技能卡附魔');assert.equal(change.changed,true);
  assert.equal(model.idol({...held,levelLimitRank:7}).customization.unlocked,true);
  assert.equal(model.idol({idolCardId:'i_card-amao-1-000',levelLimitRank:0,potentialRank:0}).customization,null);
});

test('实际回忆按附魔ID与次数取对应等级，不借用可选项或相邻等级',()=>{
  const {base,catalog}=fixture(),model=createCardCustomizations(base,catalog);
  const current=model.applied({id:'card',upgradeCount:2},{id:'second',customizeCount:2});
  assert.equal(current.level,2);assert.equal(current.producePoint,150);
  assert.equal(current.effects[0].text,'元気分パラメータ+60%');
  assert.equal(model.applied({id:'card',upgradeCount:2},{id:'second',customizeCount:3}),null);
});

test('效果条件替换使用对应触发器的效果条件原文，不借用卡片使用条件',()=>{
  const {base,catalog}=fixture();
  base.ProduceCard[1].descriptions=[{...text('好調が12ターン以上の場合、'),originProduceExamTriggerId:'before'}];
  catalog.ProduceCardGrowEffect[0]={id:'add',effectType:'ProduceCardGrowEffectType_PlayEffectTriggerChange',targetPlayEffectProduceExamTriggerIds:['before'],playEffectProduceExamTriggerId:'after'};
  catalog.ProduceExamTrigger=[{id:'after',playEffectProduceDescriptions:[text('好調が8ターン以上の場合、')],playProduceDescriptions:[text('使用可')]}];
  const effect=createCardCustomizations(base,catalog).available({id:'card',upgradeCount:1}).options[0].levels[0].effects[0];
  assert.deepEqual(effect.replaces,['好調が12ターン以上の場合、']);
  assert.equal(effect.text,'好調が8ターン以上の場合、');assert.equal(effect.complete,true);
  assert.ok(effect.descriptionParts.every(part=>part.originProduceExamTriggerId==='after'));
  assert.equal(effect.replacesParts[0][0].originProduceExamTriggerId,'before');
});

test('新旧效果均保留结构化说明及图标枚举',()=>{
  const {base,catalog}=fixture();
  const parts=[{produceDescriptionType:'ProduceDescriptionType_ProduceExamEffectType',examEffectType:'ProduceExamEffectType_ExamLessonBuff',text:'集中'},text('+2')];
  base.ProduceExamEffect[0].descriptions=parts;
  base.ProduceExamEffect.push({id:'old',descriptions:[{...parts[0],text:'集中'},text('+1')]});
  catalog.ProduceCardGrowEffect[0]={id:'add',effectType:'ProduceCardGrowEffectType_EffectChange',playProduceExamEffectId:'added',targetPlayProduceExamEffectIds:['old']};
  const result=createCardCustomizations(base,catalog).available({id:'card',upgradeCount:1}).options[0].levels[0].effects[0];
  assert.equal(result.descriptionParts[0].examEffectType,'ProduceExamEffectType_ExamLessonBuff');
  assert.equal(result.replacesParts[0][0].examEffectType,'ProduceExamEffectType_ExamLessonBuff');
  assert.deepEqual([result.replaces[0],result.text],['集中+1','集中+2']);
});

test('培养预览费用逐次累计，效果取目标次数记录而非累加历次效果',()=>{
  const data={maximum:2,options:[{id:'a',levels:[{level:1,producePoint:40,effects:[{text:'元気+4'}]},{level:2,producePoint:70,effects:[{text:'元気+13'}]}]},
    {id:'b',levels:[{level:1,producePoint:100,effects:[]}]}]};
  assert.equal(customizationPreview(data).producePoint,0);
  const maximum=customizationPreview(data,{a:2});
  assert.equal(maximum.count,2);assert.equal(maximum.producePoint,110);assert.equal(maximum.selected[0].level.effects[0].text,'元気+13');
  assert.deepEqual([customizationPreview(data,{a:1,b:1}).count,customizationPreview(data,{a:1,b:1}).producePoint],[2,140]);
  assert.equal(customizationPreview(data,{a:1}).producePoint,40);
});

test('状态、次数和减少型附魔均保留明确的效果图标类型',()=>{
  const mappings={ParameterBuffTurnAdd:'ExamParameterBuff',ParameterBuffTurnReduce:'ExamParameterBuff',LessonCountAdd:'ExamLesson',BlockReduce:'ExamBlock',
    ParameterBuffMultiplePerTurnAdd:'ExamParameterBuffMultiplePerTurn',StaminaConsumptionDownTurnAdd:'ExamStaminaConsumptionDown',CostLessonBuffReduce:'ExamLessonBuff',CardDrawAdd:'ExamCardCreateId'};
  for(const [type,icon] of Object.entries(mappings)){
    const {base,catalog}=fixture();catalog.ProduceCardGrowEffect[0]={id:'add',effectType:'ProduceCardGrowEffectType_'+type,value:1};
    const effect=createCardCustomizations(base,catalog).available({id:'card',upgradeCount:1}).options[0].levels[0].effects[0];
    assert.equal(effect.descriptionParts[0].examEffectType,'ProduceExamEffectType_'+icon,type);
  }
});

test('记录附魔占用总次数，满额不展示选项，只提供当前等级的下一步',()=>{
  const data={maximum:3,options:[{id:'a',levels:[{level:1},{level:2}]},{id:'b',levels:[{level:1}]}]};
  const partial=recordedCustomizationState(data,{customizes:[{id:'a',customizeCount:1},{id:'historical',customizeCount:1}]});
  assert.equal(partial.used,2);assert.equal(partial.remaining,1);assert.equal(partial.outsideCount,1);
  assert.deepEqual(partial.options.map(option=>option.id),['a','b']);
  const full=recordedCustomizationState(data,{customizes:[{id:'a',customizeCount:2},{id:'b',customizeCount:1}]});
  assert.equal(full.remaining,0);assert.deepEqual(full.options,[]);
  const cappedOption=recordedCustomizationState(data,{customizes:[{id:'a',customizeCount:2}]});
  assert.deepEqual(cappedOption.options.map(option=>option.id),['b']);
});
