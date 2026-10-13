// 解锁决定可用范围，启用设置只在解锁后选择版本；不修改已有回忆记录。
export function conversionUnlocked(conversion,level){
  return Number.isSafeInteger(level)&&level>=1&&Number.isSafeInteger(conversion?.unlockProducerLevel)&&conversion.unlockProducerLevel>=1&&level>=conversion.unlockProducerLevel;
}
export function activeConversionCard(conversion,level,preferences={}){
  return conversionUnlocked(conversion,level)&&preferences[conversion.beforeProduceCardId]!=='before'?conversion.afterProduceCardId:conversion.beforeProduceCardId;
}
// 自选候选只受解锁等级限制；非当前版本仍可放入编组，由模拟阶段排除。
export function conversionChoiceAvailable(choice,level){
  if(!choice.conversion)return !choice.isConversion;
  return choice.id===choice.conversion.beforeProduceCardId||conversionUnlocked(choice.conversion,level);
}
export function conversionChoiceEnabled(choice,level,preferences={}){
  if(!choice.conversion)return !choice.isConversion;
  return choice.id===activeConversionCard(choice.conversion,level,preferences);
}
// 比赛只保留开关选定的版本；排除另一版，不替换回忆中的卡片或附魔。
export function cardConversionRules(conversions,level,preferences={}){
  return {excludedCardIds:conversions.map(pair=>activeConversionCard(pair,level,preferences)===pair.afterProduceCardId?pair.beforeProduceCardId:pair.afterProduceCardId)};
}
