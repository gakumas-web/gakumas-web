import {createMemoryPowerRules} from './memory-power.mjs';
import {installCommunityRules} from './community-rules.mjs';
import {createContestCatalog} from './contest-simulation.mjs';
import {createAchievementCatalog} from './achievements.mjs';
import {createCardCustomizations} from './card-customizations.mjs';
import {createProgression} from './progression.mjs';
import {createSemantics} from './semantic-model.mjs';

// 内部查询只读当前目录；安装新资料后整体替换，查询缓存依据代次失效。
export let catalogState={
  generation:0,tables:null,characterColors:{},skinReleaseMetadata:{},skinReleaseTimes:new Map(),themeCardReleaseTimes:new Map(),
  contests:createContestCatalog(),achievements:createAchievementCatalog(),
  customizeCards:createCardCustomizations(),progression:createProgression(),memoryPowerRules:null,
  producerLevels:undefined,cardConversions:[],abilityIcons:{},semantics:createSemantics({}),
  secondExclusiveCardIds:new Set(),primaryExclusiveCards:new Map(),
  abilityChoiceAliases:new Map(),abilityChoiceDefinitions:new Map(),customizeItemParents:new Map(),customizeItemImages:{},
};
export const catalogGeneration=()=>catalogState.generation;

export const pair = (id, level) => JSON.stringify([id, level]);
function index(rows, secondary) {
  const map = new Map();
  for (const row of rows) {
    const key = secondary ? pair(row.id, row[secondary]) : row.id;
    if (map.has(key)) map.set(key, null);
    else map.set(key, row);
  }
  return map;
}
// 自身日期和已核实补充优先；关联曲目时间仅用于排序参考，不改写原始发行日期。
export function skinSortTimes(skins,supplements=catalogState.skinReleaseMetadata,cards=[]){
  const result=new Map(),originals=new Map(cards.map(card=>[card.originalIdolCardSkinId,card]));
  const known=value=>Number.isFinite(Number(value))&&Number(value)>0;
  for(const skin of skins){
    const card=originals.get(skin.id);
    if(known(skin.viewStartTime))result.set(skin.id,{time:Number(skin.viewStartTime),source:'catalog'});
    else if(known(card?.viewStartTime))result.set(skin.id,{time:Number(card.viewStartTime),source:'idol-card',idolCardId:card.id});
    else if(known(supplements[skin.id]?.time))result.set(skin.id,supplements[skin.id]);
    else if(skin.musicId&&known(skin.musicViewStartTime))result.set(skin.id,{time:Number(skin.musicViewStartTime),source:'linked-music',musicId:skin.musicId});
  }
  return result;
}
export function installMaster(input) {
  const generation=catalogState.generation+1;
  const characterColors=input.catalogMetadata?.characterColors??{},skinReleaseMetadata=input.catalogMetadata?.skinReleaseTimes??{};
  installCommunityRules(input.communityRules);
  const contests=createContestCatalog(input.contests?.tables,input.contests?.stagePresets);
  const endingBonuses=input.endingBonuses??{};
  const achievements=createAchievementCatalog(input.achievements??{},endingBonuses,input.characters??{});
  const t = input.tables;
  const abilityGroups=new Map(),abilityChoiceAliases=new Map(),abilityChoiceDefinitions=new Map();
  for(const ability of t.MemoryAbility??[]){
    const definition=ability.definition??{};
    const key=JSON.stringify([ability.skillId||ability.id,ability.level,[...(definition.produceGroupIds??[])].sort(),Boolean(definition.isUniqueActivation)]);
    const group=abilityGroups.get(key)??[];group.push(ability);abilityGroups.set(key,group);
  }
  for(const group of abilityGroups.values()){
    const canonical=group.map(ability=>ability.id).sort()[0];
    abilityChoiceDefinitions.set(canonical,{id:canonical,level:group[0].level});
    for(const ability of group)abilityChoiceAliases.set(ability.id,canonical);
  }
  const customizeItemParents=new Map();
  const customizeItemImages=input.customizeItemImages??{};
  for(const link of input.semantics?.tables?.ProduceCustomizeItemRelationship??[]){
    const parents=customizeItemParents.get(link.childProduceCustomizeItemId)??[];
    parents.push(link.parentProduceCustomizeItemId);customizeItemParents.set(link.childProduceCustomizeItemId,parents);
  }
  const skinReleaseTimes=skinSortTimes(input.idols?.skins??[],skinReleaseMetadata,input.idols?.cards??[]);
  // 排序保底从完整目录中的主题偶像卡取最早已知日期，不受当前角色或持有筛选影响。
  const skinsById=new Map((input.idols?.skins??[]).map(skin=>[skin.id,skin])),themeCardReleaseTimes=new Map();
  for(const card of input.idols?.cards??[]){
    const skin=skinsById.get(card.originalIdolCardSkinId),time=skinReleaseTimes.get(skin?.id)?.time;
    if(!skin?.theme||!Number.isFinite(time)||time<=0)continue;
    themeCardReleaseTimes.set(skin.theme,Math.min(themeCardReleaseTimes.get(skin.theme)??Infinity,time));
  }
  const primaryExclusiveCards=new Map((input.idolCardRelations??input.progression?.tables?.IdolCard??[]).map(card=>[card.id,card.produceCardId]));
  const secondExclusiveCardIds=new Set((input.idolCardRelations??input.progression?.tables?.IdolCard??[]).map(card=>card.secondProduceCardId).filter(Boolean));
  const customizeCards=createCardCustomizations(t,input.semantics?.tables??{});
  const abilityIcons = input.abilityIcons ?? {};
  const semantics = createSemantics(t,input.semantics?.tables ?? {});
  const progression = createProgression(input.progression?.tables,t,semantics);
  const memoryPowerRules=createMemoryPowerRules(input.progression?.tables);
  const producerLevels=input.progression?.tables?.ProducerLevel;
  const cardConversions=input.progression?.tables?.ProduceCardConversion??[];
  const tables = {cardTriggers:index(input.semantics?.tables?.ProduceExamTrigger??[]),memoryTags:index(input.memoryTags??[]),cardCustomizes:index(input.semantics?.tables?.ProduceCardCustomize??[],'customizeCount'),cardGrows:index(input.semantics?.tables?.ProduceCardGrowEffect??[]),customizeItems:index(input.semantics?.tables?.ProduceCustomizeItem??[]),cards: index(t.ProduceCard, 'upgradeCount'), items: index(t.ProduceItem),
    effects: index(t.ProduceEffect), exam: index(t.ProduceExamEffect), characters: new Map(Object.entries(input.characters ?? {})),
    triggers:index(input.semantics?.tables?.ProduceTrigger??[]), supports: index(input.supports?.cards ?? []), idols: index(input.idols?.cards ?? []), skins: index(input.idols?.skins ?? [])};
  catalogState={
    generation,tables,characterColors,skinReleaseMetadata,skinReleaseTimes,themeCardReleaseTimes,contests,achievements,
    customizeCards,progression,memoryPowerRules,producerLevels,cardConversions,abilityIcons,semantics,
    secondExclusiveCardIds,primaryExclusiveCards,abilityChoiceAliases,abilityChoiceDefinitions,customizeItemParents,customizeItemImages,
  };
}
