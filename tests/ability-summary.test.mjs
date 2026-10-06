import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeAbility,iconForEffect} from '../domain/ability-summary.mjs';
const part=(text,extra={})=>({produceDescriptionType:'ProduceDescriptionType_DiffText',text,...extra});
function description(kind='DanceGrowthRateAddition',value='2.8%') {
  return {heading:'能力 Lv.1',lines:['原文与条件'],technical:{mapping:{definition:{}},skill:{descriptions:[part(value)]},slots:[{
    effect:{produceEffectType:'ProduceEffectType_'+kind,effectValueMin:28,effectValueMax:28},
    triggerId:'p_trigger-produce_start-no_description',trigger:{phaseType:'ProducePhaseType_ProduceStart'},activationRatePermil:0,
  }]}};
}
test('百分比取同等级说明值，不再次缩放或忽略单位',()=>{
  assert.equal(summarizeAbility(description()).value,'+2.8%');
  assert.equal(summarizeAbility(description('DanceGrowthRateAddition','28')).value,'详情');
});
test('概率与条件独立保留，不伪装为无条件回复',()=>{
  const d=description('StaminaRecoverFix','4');d.technical.slots[0].triggerId='conditional';d.technical.slots[0].activationRatePermil=450;
  const summary=summarizeAbility(d);assert.equal(summary.value,'+4');assert.equal(summary.context,'45% · 条件');
});
test('多效果、范围、未解析均显式保留详情入口',()=>{
  const d=description();d.technical.slots.push(d.technical.slots[0]);assert.equal(summarizeAbility(d).fallback,true);
  const range=description();range.technical.slots[0].effect.effectValueMax=40;assert.equal(summarizeAbility(range).fallback,true);
  assert.equal(summarizeAbility({heading:'未知',lines:['未解析']}).value,'详情');
});
test('考试效果读取同一来源片段，绝不把外层零值显示成加零',()=>{
  const d=description('ExamStatusEnchant');d.technical.slots[0].effect.effectValueMin=0;d.technical.slots[0].effect.effectValueMax=0;
  d.technical.skill.descriptions=[{produceDescriptionType:'ProduceDescriptionType_ProduceExamEffectType',examEffectType:'ProduceExamEffectType_ExamReview',text:'好印象',originProduceExamEffectId:'same'},
    part('<nobr>+',{originProduceExamEffectId:'same'}),part('3',{originProduceExamEffectId:'same'}),part('</nobr>',{originProduceExamEffectId:'same'})];
  const summary=summarizeAbility(d,{examIcons:{ExamReview:'img_review.webp'}});
  assert.equal(summary.label,'好印象');assert.equal(summary.value,'+3');assert.equal(summary.icon,'img_review.webp');
});
test('图标映射尊重资源类型，重复映射不猜图',()=>{
  const effect={produceEffectType:'type',definition:{produceResourceType:'resource'}};
  const row={type:'type',resourceType:'resource',iconAssetId:'img_icon',backgroundAssetId:'img_bg'};
  assert.equal(iconForEffect(effect,{effects:[row]}).icon,'img_icon.webp');
  assert.deepEqual(iconForEffect(effect,{effects:[row,row]}),{});
});

test('换卡效果使用公开表的通用换卡图标，歧义映射仍不猜测',()=>{
  const effect={produceEffectType:'ProduceEffectType_ProduceCardChange',definition:{produceResourceType:'ProduceResourceType_ProduceCard'}};
  const row={type:effect.produceEffectType,resourceType:'ProduceResourceType_Unknown',iconAssetId:'change',backgroundAssetId:'positive'};
  assert.deepEqual(iconForEffect(effect,{effects:[row]}),{icon:'change.webp',background:'positive.webp'});
  assert.deepEqual(iconForEffect(effect,{effects:[row,row]}),{});
});


test('能力按属性、P 点、回复、其他、HIF 排序，同属性稳定且不改变输入',async()=>{
  const {sortedAbilitySummaries}=await import('../domain/ability-summary.mjs');
  const item=(id,type,hif=false)=>({id,description:{technical:{skill:{definition:{produceType:hif?'ProduceType_HatsuboshiIdolFestival':''}},slots:[{triggerId:'p_trigger-produce_start',effect:{produceEffectType:'ProduceEffectType_'+type}}]}}});
  const items=[item('hif','VocalAddition',true),item('other','ExamStatusEnchant'),item('heal','StaminaRecoverFix'),item('p','ProducePointAdditionDisableTrigger'),item('vi','VisualAddition'),item('da','DanceGrowthRateAddition'),item('voGrowth','VocalGrowthRateAddition'),item('voInitial','VocalAddition')];
  const before=items.slice();
  assert.deepEqual(sortedAbilitySummaries(items).map(item=>item.id),['voGrowth','voInitial','da','vi','p','heal','other','hif']);
  assert.deepEqual(items,before);
});

test('能力选择按Vo/Da/Vi分组，各组先初始再成长并降序，其他按悬停原文排序',async()=>{
  const {groupedAbilityChoices}=await import('../domain/ability-summary.mjs');
  const choice=(key,type,amount,text=key,trigger='p_trigger-produce_start')=>({key,text,summary:{description:{technical:{slots:[{triggerId:trigger,effect:{produceEffectType:'ProduceEffectType_'+type,effectValueMin:amount,effectValueMax:amount}}]}}}});
  const hif=choice('hif','ExamStatusEnchant',0);hif.summary.description.technical.skill={definition:{produceType:'ProduceType_HatsuboshiIdolFestival'},descriptions:[{produceDescriptionType:'ProduceDescriptionType_ProduceCard',text:'技能卡'},{text:'使用後、'}]};
  const values=[choice('vi','VisualAddition',99),choice('voLow','VocalAddition',10),choice('voHigh','VocalAddition',30),choice('da','DanceAddition',50),choice('daGrowth','DanceGrowthRateAddition',20),choice('voGrowthLow','VocalGrowthRateAddition',14),choice('voGrowthHigh','VocalGrowthRateAddition',28),choice('pLow','ProducePointAdditionDisableTrigger',20),choice('pHigh','ProducePointAdditionDisableTrigger',40),hif,choice('z','StaminaRecoverFix',4,'わ'),choice('a','ExamStatusEnchant',0,'あ'),choice('conditional','VocalAddition',100,'か','p_trigger-end_lesson')];
  const before=JSON.stringify(values),groups=groupedAbilityChoices(values,'ja');
  assert.deepEqual(groups.map(group=>group.id),['vocal','dance','visual','points','hif','other']);
  assert.deepEqual(groups.map(group=>group.values.map(value=>value.key)),[['voHigh','voLow','voGrowthHigh','voGrowthLow'],['da','daGrowth'],['vi'],['pHigh','pLow'],['hif'],['a','conditional','z']]);
  assert.equal(JSON.stringify(values),before);
  assert.deepEqual(groupedAbilityChoices([]),[]);
});
test('HIF按触发卡计划、培养能力效果类型、稀有度排序',async()=>{
  const {groupedAbilityChoices}=await import('../domain/ability-summary.mjs');
  const value=(key,plan,effects,rarity)=>({key,text:key,hifSort:{plan,effects,rarity},summary:{description:{technical:{skill:{definition:{produceType:'ProduceType_HatsuboshiIdolFestival'},descriptions:[{produceDescriptionType:'ProduceDescriptionType_ProduceCard'},{text:'使用後、'}]}}}}});
  const values=[value('sleepLow','Plan1','CardRemoveSleepiness','R'),value('sleepHigh','Plan1','CardRemoveSleepiness','SSR'),value('logic','Plan2','A','SSR'),value('senseOtherEffect','Plan1','B','SSR'),value('senseLowRarity','Plan1','A','R'),value('senseHighRarity','Plan1','A','SSR'),value('common','Common','A','SSR')];
  assert.deepEqual(groupedAbilityChoices(values)[0].values.map(row=>row.key),['senseHighRarity','senseLowRarity','senseOtherEffect','sleepHigh','sleepLow','logic','common']);
});
