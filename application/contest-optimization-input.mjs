import {contestCustomizationCatalog,contestSimulationReference,contestOwnedSupportRewards,cardCustomizations,progressionInfo,idolInfo} from '../domain/catalog.mjs';
import {contestChoiceOwned,contestCustomizationValid} from '../domain/contest-loadout.mjs';
import {contestCardCost,contestCapacityStatus} from '../domain/contest-card-cost.mjs';
import {contestExtraItemLimit} from '../domain/contest-item-rules.mjs';
import {selectionGrades} from '../domain/selection-memories.mjs';
import {contestCustomizationLimits} from '../domain/contest-customization-rules.mjs';
import {optimizationCardKey,optimizationCustomizations,OPTIMIZATION_SLOTS} from '../domain/contest-optimization.mjs';

export const optimizationPlanType=plan=>({Plan1:2,Plan2:3,Plan3:4})[plan];
export function sortOptimizationExclusives(choices,idolCards){
  const rarity={SSR:3,SR:2,R:1},info=new Map(idolCards.map(held=>[held.idolCardId,idolInfo(held)]));
  return [...choices].sort((a,b)=>{
    const left=info.get(a.idolCardId),right=info.get(b.idolCardId),rank=(rarity[right?.rarity]??0)-(rarity[left?.rarity]??0);
    if(rank)return rank;
    const at=left?.sortReleaseTime,bt=right?.sortReleaseTime,knownA=Number.isFinite(at),knownB=Number.isFinite(bt);
    if(knownA!==knownB)return knownA?-1:1;
    return (knownA?bt-at:0)||a.idolCardId.localeCompare(b.idolCardId)||Number(a.metadata.secondExclusive)-Number(b.metadata.secondExclusive)||a.id.localeCompare(b.id);
  });
}
export function optimizationChoiceCatalog(context){
  const catalog=contestCustomizationCatalog(),ownership={idolCardIds:new Set(context.idolCards.map(card=>card.idolCardId)),supportCardIds:new Set((context.supportCards??[]).map(card=>card.supportCardId)),producerLevel:context.producerLevel};
  const supportRewards=contestOwnedSupportRewards(context.supportCards),excluded=new Set(context.conversionRules?.excludedCardIds??[]),stagePlan=context.stage.planType.replace('ProducePlanType_','');
  const matchesPlan=choice=>stagePlan==='Common'||choice.metadata.plan===stagePlan||choice.metadata.plan==='Common';
  const cards=catalog.cards.filter(choice=>matchesPlan(choice)&&!excluded.has(choice.id)&&contestChoiceOwned(choice,ownership,'')&&(choice.metadata.source!=='support'||supportRewards.cards.has(choice.id)));
  const items=catalog.items.filter(choice=>{
    if(!matchesPlan(choice)||choice.metadata.use!=='battle')return false;
    const definition=contestSimulationReference('item',choice.id).record?.definition;
    return choice.metadata.source==='idol'?ownership.idolCardIds.has(definition?.originIdolCardId||definition?.originPrimaStellaIdolCardId):choice.metadata.source==='support'&&supportRewards.items.has(choice.id);
  }).map(choice=>({...choice,definition:contestSimulationReference('item',choice.id).record.definition}));
  return {cards,exclusive:cards.filter(choice=>choice.metadata.source==='idol'),items};
}
function fail(code){throw Object.assign(new Error(code),{code});}
function roleCustomization(context,role,choice){
  const held=context.idolCards.find(card=>card.idolCardId===choice.idolCardId),exclusiveUnlocked=progressionInfo('idol',held)?.customization?.unlocked===true;
  const customization=contestCustomizationLimits(selectionGrades[role.grade],{exclusiveUnlocked});
  if(!customization)return null;
  const maxCustomizeCount=Math.min(role.maxCustomizeCount??Infinity,customization.maxCustomizeCount),maxCustomizedCards=Math.min(role.maxCustomizedCards??OPTIMIZATION_SLOTS,customization.maxCustomizedCards);
  if(maxCustomizeCount!==Infinity&&(!Number.isSafeInteger(maxCustomizeCount)||maxCustomizeCount<0)||!Number.isSafeInteger(maxCustomizedCards)||maxCustomizedCards<0||maxCustomizedCards>OPTIMIZATION_SLOTS)fail('optimization_invalid_customization_limit');
  return {customization,maxCustomizeCount,maxCustomizedCards};
}
function exclusiveCustomizationLimit({customization,maxCustomizeCount,maxCustomizedCards}){
  return maxCustomizedCards>0&&customization.cards.idol>0?Math.min(maxCustomizeCount,customization.perCard.idol):0;
}
// 仅返回持有解锁与评级预算允许的次数；目录单卡上限由调用方另取最小值。
export function optimizationExclusiveCustomizationLimit(context,role){
  const choice=optimizationChoiceCatalog(context).exclusive.find(value=>value.id===role.exclusiveId);
  if(!choice)return null;
  const limits=roleCustomization(context,role,choice);return limits?exclusiveCustomizationLimit(limits):null;
}
function exclusiveReference(role,choice,limits){
  if(role.exclusiveReference===undefined)return undefined;
  const reference=role.exclusiveReference,invalid=()=>fail('optimization_invalid_exclusive_customization');
  if(!reference||reference.id!==role.exclusiveId||!Number.isSafeInteger(reference.upgradeCount)||!choice.versions.some(version=>version.upgradeCount===reference.upgradeCount)||!Array.isArray(reference.customizes)||reference.customizes.some(value=>!value||typeof value.id!=='string'||!Number.isSafeInteger(value.customizeCount)||value.customizeCount<=0))invalid();
  const normalized={id:reference.id,upgradeCount:reference.upgradeCount,customizes:reference.customizes.map(value=>({id:value.id,customizeCount:value.customizeCount}))};
  const count=normalized.customizes.reduce((sum,value)=>sum+value.customizeCount,0);
  if(!contestCustomizationValid(cardCustomizations(normalized),normalized.customizes)||count>exclusiveCustomizationLimit(limits))invalid();
  return normalized;
}
// 独立于 P 等级和整张搜索表单，便于选择弹窗与提交入口复用相同校验。
export function validateOptimizationExclusiveReference(context,role){
  if(role.exclusiveReference===undefined)return undefined;
  const choice=optimizationChoiceCatalog(context).exclusive.find(value=>value.id===role.exclusiveId);
  if(!choice)fail('optimization_invalid_exclusive_customization');
  const limits=roleCustomization(context,role,choice);
  if(!limits)fail('optimization_unknown_customization_rules');
  return exclusiveReference(role,choice,limits);
}
export function buildContestOptimizationInput(context,constraints){
  if(!Number.isSafeInteger(context.producerLevel)||context.producerLevel<1)fail('optimization_unknown_level');
  if(context.supportCards===undefined)fail('missing_support_bonus');
  const catalog=optimizationChoiceCatalog(context),exclusive=constraints.roles.map(role=>catalog.exclusive.find(choice=>choice.id===role.exclusiveId));
  if(exclusive.some((choice,index)=>!choice&&constraints.roles[index].exclusiveReference!==undefined))fail('optimization_invalid_exclusive_customization');
  if(exclusive.some(choice=>!choice)||exclusive[0].metadata.ownerCharacterId!==exclusive[1].metadata.ownerCharacterId||exclusive[0].metadata.plan!==exclusive[1].metadata.plan)fail('optimization_exclusive_mismatch');
  const plan=exclusive[0].metadata.plan,planType=optimizationPlanType(plan),characterId=exclusive[0].metadata.ownerCharacterId;
  if(!planType)fail('invalid_loadout');
  const extraLimit=contestExtraItemLimit(constraints.roles[0].grade);
  if(extraLimit===null)fail('optimization_unknown_item_rules');
  const itemIds=constraints.items.filter(Boolean);
  if(new Set(itemIds).size!==itemIds.length)fail('optimization_invalid_items');
  const items=itemIds.map(id=>catalog.items.find(choice=>choice.id===id&&['Common',plan].includes(choice.metadata.plan)));
  if(items.some(item=>!item)||items.filter(item=>item.metadata.source==='support').length>extraLimit||items.filter(item=>item.metadata.source==='idol').length>1||items.some(item=>item.metadata.source==='idol'&&(item.definition.originIdolCardId||item.definition.originPrimaStellaIdolCardId)!==exclusive[0].idolCardId))fail('optimization_invalid_items');
  const parameterKeys=['vocal','dance','visual','stamina'],totals=constraints.params;
  if(totals&&!parameterKeys.every(key=>Number.isSafeInteger(totals[key])&&totals[key]>=(key==='stamina'?1:0)))fail('optimization_missing_parameters');
  const variants=[],variantIndices=new Map(),probes=new Map(),missingCosts=new Set();
  const roles=constraints.roles.map((role,roleIndex)=>{
    const capacity=contestCapacityStatus(0,selectionGrades[role.grade]).range;
    if(!capacity)fail('optimization_unknown_capacity');
    // 合计输入归入假设主回忆，副回忆属性为零；保存和载入仍沿用正式合计规则。
    const params=totals?Object.fromEntries(parameterKeys.map(key=>[key,roleIndex===0?totals[key]:0])):role.params;
    if(!totals&&!parameterKeys.every(key=>Number.isSafeInteger(params?.[key])&&params[key]>=(key==='stamina'?1:0)))fail('optimization_missing_parameters');
    const limits=roleCustomization(context,role,exclusive[roleIndex]);
    if(!limits)fail('optimization_unknown_customization_rules');
    const {customization,maxCustomizeCount,maxCustomizedCards}=limits,fixedReference=exclusiveReference(role,exclusive[roleIndex],limits);
    const available=catalog.cards.filter(choice=>['Common',plan].includes(choice.metadata.plan)&&(choice.id===role.exclusiveId||['common','support'].includes(choice.metadata.source)));
    const indicesByCard=new Map();
    for(const choice of available){
      const indices=[];
      for(const version of choice.versions){
        if(fixedReference&&choice.id===role.exclusiveId&&version.upgradeCount!==fixedReference.upgradeCount)continue;
        const base={id:choice.id,upgradeCount:version.upgradeCount,customizes:[]},record=contestSimulationReference('card',base),cost=contestCardCost(record.record);
        if(cost===null){missingCosts.add(choice.name);continue;}
        const data=cardCustomizations(base),limit=maxCustomizedCards>0&&customization.cards[choice.metadata.source]>0?Math.min(maxCustomizeCount,customization.perCard[choice.metadata.source]):0;
        // 明确指定专属时只投影这一种引用，旧调用继续自动枚举强化和附魔。
        for(const customizes of fixedReference&&choice.id===role.exclusiveId?[fixedReference.customizes]:optimizationCustomizations(data,limit)){
          const reference={...base,customizes},key=optimizationCardKey(reference);
          if(!variantIndices.has(key)){
            const dependencies=[base,...customizes.map(value=>({...base,customizes:[value]}))].map(probe=>{
              const key=optimizationCardKey(probe);if(!probes.has(key))probes.set(key,{key,entry:contestSimulationReference('card',probe)});return key;
            });
            variantIndices.set(key,variants.length);variants.push({reference,key,cost,source:choice.metadata.source,rarity:choice.metadata.rarity,unlockProducerLevel:choice.unlockProducerLevel,probes:dependencies});
          }
          indices.push(variantIndices.get(key));
        }
      }
      indicesByCard.set(choice.id,indices);
    }
    const common=available.filter(choice=>choice.metadata.source==='common').flatMap(choice=>indicesByCard.get(choice.id)),support=available.filter(choice=>choice.metadata.source==='support').flatMap(choice=>indicesByCard.get(choice.id));
    return {capacity:{min:capacity.min,max:capacity.max},maxCustomizeCount,maxCustomizedCards,customizedCardsBySource:customization.cards,allowed:[indicesByCard.get(role.exclusiveId),[...common,...support],...Array.from({length:OPTIMIZATION_SLOTS-2},()=>common)],
      template:{characterId,idolCardId:exclusive[roleIndex].idolCardId,planType,grade:role.grade,...params,produceCard:structuredClone(fixedReference??{id:role.exclusiveId,upgradeCount:0,customizes:[]}),examBattleProduceItemIds:roleIndex===0?itemIds:[]}};
  });
  const fixedProbes=[];
  for(const item of items){const key=`item:${item.id}`;probes.set(key,{key,kind:'item',entry:contestSimulationReference('item',item.id)});fixedProbes.push(key);}
  for(const role of constraints.roles)if(role.exclusiveReference){const reference=role.exclusiveReference,base={...reference,customizes:[]};for(const probe of [base,...reference.customizes.map(value=>({...base,customizes:[value]}))])fixedProbes.push(optimizationCardKey(probe));}
  const excluded=new Set(context.conversionRules?.excludedCardIds??[]);
  for(const deck of context.stage.decks??[])if(deck.planType===`ProducePlanType_${plan}`)for(const card of deck.produceCards)if(!excluded.has(card.id)){const key=optimizationCardKey(card);probes.set(key,{key,entry:contestSimulationReference('card',card)});fixedProbes.push(key);}
  return {variants,roles,fixedProbes,probes:[...probes.values()],missingCosts:[...missingCosts],plan};
}
export function supportedOptimizationInput(input,supported){
  const variants=[],indices=new Map();
  for(const [index,variant] of input.variants.entries())if(variant.probes.every(key=>supported.has(key))){indices.set(index,variants.length);variants.push(variant);}
  return {variants,roles:input.roles.map(role=>({...role,allowed:role.allowed.map(values=>values.filter(index=>indices.has(index)).map(index=>indices.get(index)))}))};
}
