import {catalogState,pair} from './catalog-state.mjs';
import {characterInfo} from './catalog-collections.mjs';
import {cardInfo,itemRewardInfo,supportSkillVisual} from './catalog-skills.mjs';
import {plainText,descriptionText} from './semantic-text.mjs';
import {t,locale} from '../i18n.mjs';

const supportCatalogCache=new Map();
let cacheGeneration=-1;
export function supportInfo(held) {
  if(cacheGeneration!==catalogState.generation){cacheGeneration=catalogState.generation;supportCatalogCache.clear();}
  const key=JSON.stringify([locale(),held.supportCardId]);
  if(!supportCatalogCache.has(key))supportCatalogCache.set(key,describeSupport(held));
  return supportCatalogCache.get(key);
}
// 仅使用本次阵容的记录等级和明确归属的专属奖励，不借用当前库存等级。
export function selectionSupportRewards(detail){
  if(!detail)return null;
  const rewards=new Map();
  for(const slot of detail.supportCards){
    const support=catalogState.tables?.supports.get(slot.supportCardId);
    for(const event of support?.events??[]){
      if(event.unlockLevel>slot.level)continue;
      for(const effectId of event.effectIds){
        for(const reward of catalogState.tables.effects.get(effectId)?.definition?.produceRewards??[]){
          const kind=reward.resourceType==='ProduceResourceType_ProduceCard'?'cards':reward.resourceType==='ProduceResourceType_ProduceItem'?'items':null;
          if(!kind)continue;
          const value=kind==='cards'?{id:reward.resourceId,upgradeCount:reward.resourceLevel??0,customizes:[]}:{id:reward.resourceId};
          const row=kind==='cards'?catalogState.tables.cards.get(pair(value.id,value.upgradeCount)):catalogState.tables.items.get(value.id);
          if(row?.definition?.originSupportCardId!==slot.supportCardId)continue;
          rewards.set(JSON.stringify([kind,value.id]),{kind,value,plan:row.definition.planType?.replace('ProducePlanType_','')});
        }
      }
    }
  }
  return [...rewards.values()];
}
function describeSupport(held) {
  const card = catalogState.tables?.supports.get(held.supportCardId);
  if (!card) return {name:t('未解析支援卡'), rarity:t('未知'), type:t('未知'), characters:t('目录未收录')};
  let events;
  const types = {Vocal:'Vocal', Dance:'Dance', Visual:'Visual', Assist:t('辅助')};
  return {name:plainText(card.name), rarity:card.rarity.replace('SupportCardRarity_', '').toUpperCase(),
    type:types[card.type.replace('SupportCardType_', '')] ?? t('未知'),
    characterIds:card.characterIds,characters:card.characterIds.map(id=>characterInfo(id).name).join(' · '),
    image:`img_general_${card.assetId}_full.webp`,plan:card.planType?.replace('ProducePlanType_',''),
    supportChance:card.produceCardUpgradePermil/10,
    supportAttribute:card.produceCardUpgradeLessonParameterType?.replace('ProduceParameterType_',''),
    get events(){return events??=(card.events??[]).map(event=>({...event,text:descriptionText(event.descriptions,undefined,true).text,
      rewards:event.effectIds.flatMap(id=>catalogState.tables.effects.get(id)?.definition?.produceRewards??[]).flatMap(reward=>{
        if(reward.resourceType==='ProduceResourceType_ProduceCard'){
          const reference={id:reward.resourceId,upgradeCount:reward.resourceLevel??0,customizes:[]};
          const versions=[0,1].filter(upgradeCount=>catalogState.tables.cards.has(pair(reference.id,upgradeCount))).map(upgradeCount=>{
            const variant={...reference,upgradeCount};
            return {reference:variant,...cardInfo(variant,card.characterIds[0]),description:catalogState.semantics.card(variant),visual:supportSkillVisual(variant)};
          });
          return [{kind:'card',...cardInfo(reference,card.characterIds[0]),description:catalogState.semantics.card(reference),versions}];
        }
        if(reward.resourceType==='ProduceResourceType_ProduceItem'){
          return [itemRewardInfo(reward.resourceId)];
        }
        return [];
      })}));}};
}

export function supportEffectKinds(effect){return (effect.beforeEffects??[]).map(id=>catalogState.tables?.effects.get(id)?.produceEffectType?.replace('ProduceEffectType_','')).filter(Boolean);}
export function supportEffectPhases(effect){return (effect.beforeTriggers??[]).map(id=>catalogState.tables?.triggers.get(id)?.phaseType?.replace('ProducePhaseType_','')).filter(Boolean).map(phase=>phase==='EndLessonBeforePresent'?'EndLesson':phase);}
