import {contestCustomizationRules} from './community-rules.mjs';

// 只解释内容分包中的评级与来源规则，不将容量评级别名用于附魔。
export function contestCustomizationLimits(rank,{exclusiveUnlocked=false}={},rules=contestCustomizationRules){
  const row=rules?.ranks?.[rank];if(!row)return null;
  const cards={...row.cards,idol:exclusiveUnlocked?row.cards.idol:0};
  return {cards,perCard:rules.perCard,guaranteedCounts:row.guaranteedCounts,provisional:row.provisional,source:rules.source,
    maxCustomizedCards:Object.values(cards).reduce((sum,value)=>sum+value,0),
    maxCustomizeCount:Object.entries(cards).reduce((sum,[source,count])=>sum+count*rules.perCard[source],0)};
}
