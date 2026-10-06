import {favoriteRecords} from './personal-library.mjs';
import {t,localizeSource} from '../i18n.mjs';
import {matchesAny,selectedValues,matchesSupportEffect} from './model.mjs';
import {idolInfo,skinInfo,supportInfo,collectionRecords,sortIdolEntries,sortCollectionEntries,progressionInfo,supportEffectKinds,supportEffectPhases} from './catalog.mjs';
import {effectSearchText} from './effect-language.mjs';
export function supportEntries(snapshot, query, sort,filters={}) {
  const characters=selectedValues(filters.supportCharacter);
  const matchEffects=selectedValues(filters.supportEffect).length||selectedValues(filters.supportEffectAttribute).length;
  // 先排除角色、稀有度等不匹配项，再计算满级效果；空搜索不生成检索正文。
  const entries=favoriteRecords(snapshot,'supportCards',filters,collectionRecords)
    .map((held,ordinal)=>({held,ordinal,info:supportInfo(held)}))
    .filter(({info})=>{
      const associated=info.characterIds??[];
      const characterMatch=filters.supportCharacterAll!==false?characters.every(id=>associated.includes(id)):matchesAny(characters,associated);
      if(!characterMatch)return false;
      if(filters.supportRarity&&info.rarity!==filters.supportRarity)return false;
      if(filters.supportType&&info.type!==filters.supportType&&!(filters.supportType==='Assist'&&info.type===t('辅助')))return false;
      // 选择具体计划后，由开关决定是否同时纳入通用支援卡。
      if(filters.supportPlan&&info.plan!==filters.supportPlan&&!(filters.supportPlanCommon!==false&&info.plan==='Common'))return false;
      return !filters.supportReward||info.events?.some(event=>event.rewards.some(reward=>reward.kind===filters.supportReward||`item-${reward.use}`===filters.supportReward));
    })
    .map(entry=>{
      let effects;
      return {...entry,get searchEffects(){return effects??=(progressionInfo('supportMaximum',entry.held)?.changes??[]);}};
    });
  const filtered=entries.filter(entry=>{
    const {info}=entry;
    if(!matchEffects&&!filters.supportTrigger&&!query)return true;
    const searchEffects=entry.searchEffects;
    if(matchEffects&&!searchEffects.some(effect=>supportEffectKinds(effect).some(kind=>matchesSupportEffect(kind,filters.supportEffect,filters.supportEffectAttribute))))return false;
    if(filters.supportTrigger&&!searchEffects.some(effect=>supportEffectPhases(effect).includes(filters.supportTrigger)))return false;
    return !query||[entry.held.supportCardId,info.name,info.rarity,info.type,info.characters,...(info.events??[]).flatMap(event=>[event.text,...event.rewards.map(reward=>reward.name)]),...searchEffects.flatMap(effect=>[effect.before,effectSearchText(effect.before)])].join(' ').toLowerCase().includes(query);
  });
  return sortCollectionEntries(filtered,sort,'supportCards',filters);
}
export function idolEntries(snapshot, query, sort = 'original', filters = {}) {
  const entries=favoriteRecords(snapshot,'idolCards',filters,collectionRecords)
    .map((held,ordinal)=>({held,info:idolInfo({...held,idolCardSkinId:''}),ordinal}))
    .filter(({info})=>matchesAny(filters.idolCharacter,[info.characterId])&&(!filters.idolRarity||info.rarity===filters.idolRarity)&&(!filters.idolPlan||info.plan===filters.idolPlan)&&matchesAny(filters.idolEffect,[info.examEffectType]))
    .map(entry=>{
      let current;
      return {...entry,get current(){if(current===undefined)current=progressionInfo('idol',entry.held);return current;}};
    })
    .filter(entry=>!query||[entry.info.name,entry.info.character,entry.info.rarity,entry.held.idolCardId,...(entry.current?.changes??[]).flatMap(row=>[row.label,localizeSource(row.label),row.before,effectSearchText(row.before)])].join(' ').toLowerCase().includes(query));
  return sortIdolEntries(entries,sort,filters);
}
export function skinEntries(snapshot,query,filters){
  const entries=favoriteRecords(snapshot,'idolCardSkins',filters,collectionRecords).map((held,ordinal)=>({held,info:skinInfo(held),ordinal}))
    .filter(({info})=>matchesAny(filters.skinCharacter,info.characterId?[info.characterId]:[])&&
      (!filters.skinTheme||info.theme===filters.skinTheme)&&
      (!query||[info.name,info.theme,...info.themeAliases,info.character,info.cardName].join(' ').toLowerCase().includes(query)))
;
  return sortCollectionEntries(entries,filters.catalogSort,'idolCardSkins',filters);
}
