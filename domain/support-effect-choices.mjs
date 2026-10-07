import {createChoiceAvailability} from './choice-availability.mjs';
import {collectionRecords,supportInfo,progressionInfo,supportEffectKinds,supportEffectPhases} from './catalog.mjs';
import {descriptionText} from './semantic-text.mjs';
import {selectedValues} from './model.mjs';
import {t} from '../i18n.mjs';

export const supportEffectAttributes=[['vocal','Vo'],['dance','Da'],['visual','Vi'],['points','P 点'],['stamina','体力'],['other','其他']];
export const supportEffectGroups=[['Always','常驻效果'],['ProduceStart','培育开始时'],['SupportEventReward','获得事件奖励时'],['EndLessonNormal','普通课程结束时'],['EndLessonSp','SP 课程结束时'],['EndLesson','课程结束时'],['StartRefresh','休息时'],['StartShop','咨询时'],['EndStepEventActivity','外出结束时'],['GetProduceCard','获得技能卡时'],['UpgradeProduceCard','强化技能卡时'],['DeleteProduceCard','删除技能卡时'],['StartPresent','选择活动补给／慰问品时'],['EndStepEventSchool','授课／营业结束时'],['EndAudition','试验／试镜结束时'],['StartCustomize','特别指导开始时'],['GetProduceDrink','获得 P 饮料时'],['GetProduceItem','获得 P 道具时'],['BuyShopItemProduceCard','咨询中交换技能卡后'],['BuyShopItemProduceDrink','咨询中交换 P 饮料后'],['ChangeProduceCard','变更技能卡时'],['CustomizeProduceCard','自定义技能卡时'],['Other','其他时机']];
export function supportEffectChoice(effect){
  const kinds=[...new Set(supportEffectKinds(effect))].sort(),phases=[...new Set(supportEffectPhases(effect))].sort();
  const attributes=['Vocal','Dance','Visual'].filter(attribute=>kinds.some(kind=>kind.includes(attribute)||kind==='LessonSpChangeRatePermilAddition')).map(value=>value.toLowerCase());
  if(kinds.some(kind=>kind.includes('ProducePoint')))attributes.push('points');
  if(kinds.some(kind=>kind.includes('Stamina')))attributes.push('stamina');
  if(!attributes.length)attributes.push('other');
  let group=!phases.length?'Always':phases.length===1&&supportEffectGroups.some(([id])=>id===phases[0])?phases[0]:'Other';
  // 只去掉结构化数值片段，保留条件中的次数、门槛和技能卡名称。
  const parts=effect.descriptionParts??[];
  let descriptionParts=parts.map(part=>({...part}));
  for(const [index,part] of parts.entries()){
    if(part.produceDescriptionType!=='ProduceDescriptionType_DiffText'||!/^[+−-]?\d+(?:\.\d+)?[%％]?$/.test(part.text??''))continue;
    descriptionParts[index].text='';
    if(index>0)descriptionParts[index-1].text=(descriptionParts[index-1].text??'').replace(/[+−-]$/,'');
    if(index+1<parts.length)descriptionParts[index+1].text=(descriptionParts[index+1].text??'').replace(/^[%％]/,'');
  }
  descriptionParts=descriptionParts.filter(part=>part.text!=='');
  const text=parts.length?descriptionText(descriptionParts,undefined,true).text.trim():effect.before;
  group=choiceGroup(group,text);
  const key=JSON.stringify([group,text,kinds,phases]);
  return {key,group,attributes,text,descriptionParts,effectIds:effect.beforeEffects??[],cardReferences:effect.beforeReferences??[]};
}
// 当前公开触发投影只保留时机枚举；普通/SP 课程限定取完整源说明。
const eventRewardTexts=new Set([
  'このサポートカードのイベントによる獲得Pポイントを増加',
  'このサポートカードのイベントによる体力回復量を増加',
  'このサポートカードのイベントによるパラメータ上昇を増加',
]);
function choiceGroup(group,text){
  if(eventRewardTexts.has(text))return 'SupportEventReward';
  if(group!=='EndLesson')return group;
  return text.includes('通常レッスン終了時')?'EndLessonNormal':text.includes('SPレッスン終了時')?'EndLessonSp':group;
}
export function normalizeSupportEffectKey(key){
  try{const value=JSON.parse(key);const group=choiceGroup(value[0],value[1]);if(group!==value[0]){value[0]=group;return JSON.stringify(value);}}catch{}
  return key;
}
export function supportEffectClauses(values){
  const groups=new Map();
  for(const key of selectedValues(values).map(normalizeSupportEffectKey)){
    let group;try{group=JSON.parse(key)[0];}catch{group=key;}
    if(!groups.has(group))groups.set(group,[]);groups.get(group).push(key);
  }
  return [...groups.values()];
}
export function matchesSupportChoices(effects,values){
  if(!selectedValues(values).length)return true;
  const available=new Set(effects.map(effect=>supportEffectChoice(effect).key));
  return supportEffectClauses(values).every(clause=>clause.some(key=>available.has(key)));
}
export function supportEffectChoices(snapshot,filters={}){
  const values=new Map();
  // 候选范围只依赖计划、通用计划开关和支援卡属性，不依赖角色与持有状态。
  for(const held of collectionRecords(snapshot,'supportCards','all')){
    const info=supportInfo(held);
    if(filters.supportPlan&&info.plan!==filters.supportPlan&&!(filters.supportPlanCommon!==false&&info.plan==='Common'))continue;
    if(filters.supportType&&info.type!==filters.supportType&&!(filters.supportType==='Assist'&&info.type===t('辅助')))continue;
    for(const effect of progressionInfo('supportMaximum',held)?.changes??[]){
      const value=supportEffectChoice(effect);
      // 通用支援发生率不提供区分价值，仅从筛选候选移除。
      if(/^このサポートカードの(?:スキルカード|レッスン)サポート発生率/.test(value.text))continue;
      if(!values.has(value.key))values.set(value.key,value);
    }
  }
  const order=value=>supportEffectAttributes.findIndex(([attribute])=>value.attributes.includes(attribute));
  return [...values.values()].sort((a,b)=>order(a)-order(b));
}

// 打开选择器时建立一次倒排索引；勾选时只做集合运算，不重复解析满级效果。
export function createSupportEffectAvailability(effectRows){
  const evaluate=createChoiceAvailability(effectRows.map(effects=>effects.map(effect=>supportEffectChoice(effect).key)),{mode:'grouped',clauses:supportEffectClauses});
  return draft=>evaluate(draft.map(normalizeSupportEffectKey));
}
