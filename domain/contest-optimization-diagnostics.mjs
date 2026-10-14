// 跨运行身份只包含公开编组配置；不使用候选索引、账号键或回忆记录身份。
export function optimizationConfigurationKey(memories){
  return JSON.stringify(memories.map(memory=>({
    ...Object.fromEntries(['characterId','idolCardId','planType','grade','vocal','dance','visual','stamina'].map(key=>[key,memory[key]??null])),
    cards:memory.examBattleProduceCards.map(card=>[card.id,card.upgradeCount,[...(card.customizes??[])].map(value=>[value.id,value.customizeCount]).sort(([a],[b])=>a.localeCompare(b))]),
    items:memory.examBattleProduceItemIds??[],
  })));
}
export const optimizationMemoryStructureKey=memories=>JSON.stringify(memories.map(memory=>memory.examBattleProduceCards.map(card=>card.id).sort()));

// 分差使用同一阶段、同一样本数的最终复评，不自行规定“可用”阈值。
export function optimizationFinalDiagnostics(rows){
  const best=rows[0]?.stats.score,structures=new Map();
  const finalists=rows.map((row,index)=>{
    const score=row.stats.score,gap=score-best,value={key:row.key,configurationKey:optimizationConfigurationKey(row.memories),structureKey:optimizationMemoryStructureKey(row.memories),rank:index+1,score,runs:row.result.runs,gap,relativeGap:best===0?null:gap/Math.abs(best)};
    if(!structures.has(value.structureKey))structures.set(value.structureKey,value);
    return value;
  });
  return {stage:'final',champion:finalists[0]??null,finalists,structures:[...structures.values()]};
}
