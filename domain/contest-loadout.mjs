import {commonCardUnlocked} from './producer-level.mjs';
// 自定义仅创建比赛编组副本，不修改导入的回忆和持有记录。
export function createContestMemoryDraft(memory,primaryCardId){
  const cards=(memory.examBattleProduceCards??[]).map(card=>({...card,customizes:(card.customizes??[]).map(entry=>({...entry}))}));
  const primary=cards.findIndex(card=>card.id===primaryCardId);
  if(primary>0)cards.unshift(...cards.splice(primary,1));
  return {...memory,examBattleProduceCards:cards,...(memory.examBattleProduceItemIds===undefined?{}:{examBattleProduceItemIds:[...memory.examBattleProduceItemIds]})};
}
export function contestSlotChoices(catalog,{memoryIndex,slotIndex,planType,characterId,kind='card',includeIdolItems=true}){
  const plan=({2:'Plan1',3:'Plan2',4:'Plan3'})[planType];
  return catalog.filter(choice=>{
    const metadata=choice.metadata;
    if(kind==='card'&&metadata.rarity==='LEGEND')return false;
    if(!plan||!['Common',plan].includes(metadata.plan))return false;
    // 剧本通用道具不能用于比赛；通用计划的支援卡道具仍可使用。
    if(kind==='item')return memoryIndex===0&&metadata.use==='battle'&&(metadata.source==='support'||includeIdolItems&&metadata.source==='idol'&&metadata.ownerCharacterId===characterId);
    if(slotIndex===0)return metadata.source==='idol'&&metadata.ownerCharacterId===characterId;
    return metadata.source==='common'||slotIndex===1&&metadata.source==='support';
  });
}
export function contestCustomizationValid(data,customizes){
  if(!customizes.length)return true;
  if(!data||customizes.reduce((sum,entry)=>sum+entry.customizeCount,0)>data.maximum)return false;
  return new Set(customizes.map(entry=>entry.id)).size===customizes.length&&customizes.every(entry=>Number.isInteger(entry.customizeCount)&&entry.customizeCount>0&&data.options.some(option=>option.id===entry.id&&option.levels.some(level=>level.level===entry.customizeCount)));
}

// 自带道具不占额外道具容量；空槽只在尚未达到三件时开放。
export function contestExtraItemCount(items,fixedIds){
  return items.filter(id=>!fixedIds.has(id)).length;
}
export function contestCardChanged(original,current){
  if(!original||!current)return original!==current;
  const signature=card=>JSON.stringify([card.id,card.upgradeCount,[...(card.customizes??[])].map(value=>[value.id,value.customizeCount]).sort(([a],[b])=>a.localeCompare(b))]);
  return signature(original)!==signature(current);
}

// 当前槽位保留原技能；其它专属来源依据账号持有卡片判断，缺失持有记录不视作已持有。
export function contestChoiceOwned(choice,{idolCardIds,supportCardIds,producerLevel},currentId){
  if(choice.id===currentId)return true;
  if(choice.metadata.source==='common')return commonCardUnlocked(choice,producerLevel)===true;
  if(choice.metadata.source==='idol')return idolCardIds.has(choice.idolCardId);
  if(choice.metadata.source==='support')return supportCardIds.has(choice.supportCardId);
  return false;
}
