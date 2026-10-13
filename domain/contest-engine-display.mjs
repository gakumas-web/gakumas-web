// 已核对的运行时生成卡，仅补充显示引用，不扩大可编入卡组的引擎映射。
export function generatedSkillReference(engineId){
  return Number(engineId)===23?{id:'p_card-00-acc-0_002',upgradeCount:0,customizes:[]}:null;
}
export function simulationCardReference(card){
  return card.reference??generatedSkillReference(card.id);
}
