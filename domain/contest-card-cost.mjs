import {contestCostRules} from './community-rules.mjs';

// 数值、来源费用与评级别名来自内容；此处只解释规则并计算，不补造缺失费用。
export function contestCostRanges(rules=contestCostRules){return rules?.ranges??[];}
export function contestCostAliases(rules=contestCostRules){return Object.keys(rules?.rankAliases??{});}
export function contestCardCost(record,rules=contestCostRules){
  if(!record?.definition||!rules)return null;
  const definition=record.definition,key=record.upgradeCount>0?'upgraded':'base';
  if(definition.originIdolCardId||definition.originPrimaStellaIdolCardId)return rules.exclusiveCost;
  if(definition.originSupportCardId)return rules.supportCard[key];
  const rarity=(record.rarity??definition.rarity??'').replace('ProduceCardRarity_','').toUpperCase(),cost=rules.rarities[rarity];
  if(!cost)return null;
  if(cost.initial){
    if(!Number.isFinite(definition.unlockProducerLevel))return null;
    if(definition.unlockProducerLevel<=rules.initialProducerLevelMax)return cost.initial[key];
  }
  return cost[key];
}
export function contestDeckCost(entries,rules=contestCostRules){
  const cards=entries.map(entry=>({reference:entry.reference,name:entry.record?.name??entry.reference.id,cost:contestCardCost(entry.record,rules)}));
  return {cards,total:rules&&cards.every(card=>card.cost!==null)?cards.reduce((sum,card)=>sum+card.cost,0):null};
}
export function contestCapacityStatus(total,rank,rules=contestCostRules){
  const range=rules?.ranges.find(value=>value.rank===(rules.rankAliases[rank]??rank))??null;
  return {range,underflow:total!==null&&Boolean(range)&&total<range.min,overflow:total!==null&&Boolean(range)&&total>range.max};
}
