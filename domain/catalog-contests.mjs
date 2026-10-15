import {catalogState,pair} from './catalog-state.mjs';
import {calculateMemoryPower} from './memory-power.mjs';
import {selectionChoiceMetadata} from './catalog-skills.mjs';
import {plainText} from './semantic-text.mjs';

export const contestCatalog=()=>catalogState.contests;
export const contestCardConversions=()=>catalogState.cardConversions;
export const memoryPower=memory=>calculateMemoryPower(memory,catalogState.memoryPowerRules,contestSimulationReference);

// 比赛编组候选来自公开目录，包含未持有项；不暴露内部主数据 Map。
export function contestCustomizationCatalog(){
  const cards=new Map();
  for(const row of catalogState.tables?.cards.values()??[]){
    if(!row||row.upgradeCount>1||row.definition?.libraryHidden||row.category==='ProduceCardCategory_Trouble'||row.rarity==='ProduceCardRarity_Legend')continue;
    const reference={id:row.id,upgradeCount:row.upgradeCount,customizes:[]};
    if(!cards.has(row.id))cards.set(row.id,{id:row.id,name:plainText(row.name),unlockProducerLevel:row.definition?.unlockProducerLevel,idolCardId:row.definition?.originIdolCardId||row.definition?.originPrimaStellaIdolCardId||'',supportCardId:row.definition?.originSupportCardId||'',metadata:selectionChoiceMetadata('card',reference),previewCharacterId:row.originCharacterId||Object.keys(row.images??{}).find(id=>id!=='common'),versions:[]});
    if(row.upgradeCount===0)cards.get(row.id).unlockProducerLevel=row.definition?.unlockProducerLevel;
    cards.get(row.id).versions.push(reference);
  }
  const conversionById=new Map(catalogState.cardConversions.flatMap(row=>[[row.beforeProduceCardId,row],[row.afterProduceCardId,row]]));
  for(const card of cards.values()){
    card.versions.sort((a,b)=>a.upgradeCount-b.upgradeCount);
    card.conversion=conversionById.get(card.id);
    card.isConversion=catalogState.tables.cards.get(pair(card.id,0))?.definition?.isConversion===true;
    if(card.isConversion)card.unlockProducerLevel=card.conversion?.unlockProducerLevel;
  }
  const items=[];
  for(const row of catalogState.tables?.items.values()??[]){
    if(!row||row.definition?.libraryHidden||row.definition?.isExamEffect!==true)continue;
    items.push({id:row.id,name:plainText(row.name),metadata:selectionChoiceMetadata('item',{id:row.id})});
  }
  return {cards:[...cards.values()],items};
}

export function contestFixedItemIds(memory){
  return new Set((memory.examBattleProduceItemIds??[]).filter(id=>{
    const definition=catalogState.tables?.items.get(id)?.definition;
    return Boolean(definition)&&(definition.originIdolCardId||definition.originPrimaStellaIdolCardId)===memory.idolCardId;
  }));
}

// 搜索候选只使用当前支援等级已解锁的事件奖励，不把持有卡片等同于全部奖励已开放。
export function contestOwnedSupportRewards(supportCards=[]){
  const cards=new Set(),items=new Set();
  for(const held of supportCards){
    for(const event of catalogState.tables?.supports.get(held.supportCardId)?.events??[]){
      if(!Number.isFinite(held.level)||!Number.isFinite(event.unlockLevel)||held.level<event.unlockLevel)continue;
      for(const id of event.effectIds??[])for(const reward of catalogState.tables.effects.get(id)?.definition?.produceRewards??[]){
        if(reward.resourceType==='ProduceResourceType_ProduceCard')cards.add(reward.resourceId);
        if(reward.resourceType==='ProduceResourceType_ProduceItem')items.add(reward.resourceId);
      }
    }
  }
  return {cards,items};
}

export const contestCardNoDeckDuplication=reference=>catalogState.tables?.cards.get(pair(reference.id,reference.upgradeCount))?.definition.noDeckDuplication===true;

// 模拟只接收所选卡片及其公开定义，不传递账号标识或整份库存。
export function contestSimulationReference(kind,reference){
  if(kind==='item')return {id:reference,record:catalogState.tables?.items.get(reference)??null};
  return {reference:{id:reference.id,upgradeCount:reference.upgradeCount,customizes:(reference.customizes??[]).map(value=>({...value}))},record:catalogState.tables?.cards.get(pair(reference.id,reference.upgradeCount))??null,customizations:(reference.customizes??[]).map(value=>{
    const record=catalogState.tables?.cardCustomizes.get(pair(value.id,value.customizeCount));
    const grows=(record?.produceCardGrowEffectIds??[]).map(id=>catalogState.tables?.cardGrows.get(id)??null);
    const triggerIds=[...new Set(grows.filter(grow=>['ProduceCardGrowEffectType_PlayTriggerChange','ProduceCardGrowEffectType_PlayEffectTriggerChange'].includes(grow?.effectType)).flatMap(grow=>[grow.playProduceExamTriggerId,grow.playEffectProduceExamTriggerId,...(grow.targetPlayEffectProduceExamTriggerIds??[])])).values()].filter(Boolean).sort();
    return {record:record??null,grows,effects:grows.filter(grow=>grow?.playProduceExamEffectId).map(grow=>catalogState.tables?.exam.get(grow.playProduceExamEffectId)??null),...(triggerIds.length?{triggers:triggerIds.map(id=>catalogState.tables?.cardTriggers.get(id)??null)}:{})};
  })};
}
