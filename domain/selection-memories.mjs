import {CAPTURE_FORMAT,CAPTURE_SCHEMA} from './snapshot-format.mjs';
import {mergeSelectionDetails} from './selection-details.mjs';
import {validPublicUserId} from './account.mjs';
import {hifStarRules} from './hif-star-rules.mjs';
import {InputError,digest,validCapturedAt,matchesAny,selectedValues} from './model.mjs';
import {characterInfo,cardInfo,itemArt,idolInfo,selectionChoiceMetadata,selectionFlowDefinitions,selectionSupportRewards} from './catalog.mjs';
import {effectSearchText} from './effect-language.mjs';

export const SELECTION_CAPACITY=1000;
export function missingSelectionRewards(memory,detail){
  const candidates=selectionSupportRewards(detail);
  if(candidates===null)return null;
  const owned={cards:new Set(memory.produceCards.map(row=>row.id)),items:new Set(memory.produceItems.map(row=>row.id))};
  const plan=({2:'Plan1',3:'Plan2',4:'Plan3'})[memory.planType];
  return candidates.filter(({kind,value,plan:required})=>(!required||required==='Common'||required===plan)&&!owned[kind].has(value.id));
}
export const selectionGrades=['','F','E','D','C','C+','B','B+','A','A+','S','S+','SS','SS+','SSS','SSS+','S4','S4+','S5','S5+'];
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.length<=4096;
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const boolean=x=>typeof x==='boolean';
const list=check=>x=>Array.isArray(x)&&x.length<=20000&&x.every(check);
function project(input,schema){
  if(!record(input))throw new InputError();
  const output={};
  for(const [key,check] of Object.entries(schema)){
    if(!check(input[key]))throw new InputError();
    output[key]=input[key];
  }
  return output;
}
const custom=x=>project(x,{id:text,customizeCount:integer});
function card(x){
  const clean=project(x,{id:text,upgradeCount:integer,customizes:list(record),fromMemory:boolean});
  return {...clean,customizes:clean.customizes.map(custom)};
}
const item=x=>project(x,{id:text,triggerCount:integer,reactionCount:integer});
const strings=['userSelectionMemoryId','memoryTagId','assetId','produceId','characterId','idolCardId','idolCardSkinId','researchId'];
const numbers=['grade','planType','idolCardLevelLimitRank','idolCardPotentialRank','vocal','dance','visual','vocalGrowthRatePermil','danceGrowthRatePermil','visualGrowthRatePermil','stamina','star','clearedTime','lastUsedTime'];
const schema={...Object.fromEntries(strings.map(k=>[k,text])),...Object.fromEntries(numbers.map(k=>[k,integer])),isProtected:boolean,isPrimaStella:boolean,produceCards:list(record),produceItems:list(record),produceCustomizeItems:list(record)};
export function parseSelectionSnapshot(input){
  const clean=project(input,{format:x=>x===CAPTURE_FORMAT,schema_version:x=>x===CAPTURE_SCHEMA,publicUserId:validPublicUserId,source:x=>x==='selection_memory_list',captured_at:validCapturedAt,count:integer,selectionMemories:list(record),eventExpiredSelectionMemoryIds:list(text)});
  const seen=new Set();
  clean.selectionMemories=clean.selectionMemories.map(row=>{
    const value=project(row,schema);
    if(!value.userSelectionMemoryId||seen.has(value.userSelectionMemoryId))throw new InputError();
    seen.add(value.userSelectionMemoryId);
    return {...value,produceCards:value.produceCards.map(card),produceItems:value.produceItems.map(item),produceCustomizeItems:value.produceCustomizeItems.map(item)};
  });
  if(clean.count!==clean.selectionMemories.length)throw new InputError();
  return clean;
}
export async function prepareSelectionSnapshot(input){
  const clean=parseSelectionSnapshot(input);
  // 不持久化账户照片路径、原始持有记录 ID 或高分记录 ID。
  const selectionMemories=await Promise.all(clean.selectionMemories.map(async({userSelectionMemoryId,...row},index)=>({...row,key:await digest('selection:'+userSelectionMemoryId),ordinal:index+1})));
  const eventExpiredSelectionMemoryIds=await Promise.all([...new Set(clean.eventExpiredSelectionMemoryIds)].map(id=>digest('selection:'+id)));
  return {...clean,selectionMemories,eventExpiredSelectionMemoryIds};
}
export function restoreSelectionSnapshot(input){
  if(!record(input)||!Array.isArray(input.selectionMemories)||input.selectionMemories.some(row=>!(/^[a-f0-9]{64}$/.test(row.key)))||!Array.isArray(input.eventExpiredSelectionMemoryIds)||input.eventExpiredSelectionMemoryIds.some(id=>!(/^[a-f0-9]{64}$/.test(id))))throw new InputError();
  const clean=parseSelectionSnapshot({...input,selectionMemories:input.selectionMemories.map(row=>({...row,userSelectionMemoryId:row.key}))});
  clean.selectionMemories=clean.selectionMemories.map(({userSelectionMemoryId,...row},i)=>({...row,key:userSelectionMemoryId,ordinal:i+1}));
  const details=input.details===undefined?[]:input.details;
  if(!Array.isArray(details))throw new InputError();
  return details.length?mergeSelectionDetails(clean,details):clean;
}
// 技能筛选以 ID 与强化次数组成稳定键，附魔不改变版本身份。
export const selectionSkillKey=card=>JSON.stringify([card.id,card.upgradeCount]);
export function withoutSecondExclusiveSkills(keys){
  return keys.filter(key=>{const [id,upgradeCount]=JSON.parse(key);return !selectionChoiceMetadata('card',{id,upgradeCount}).secondExclusive;});
}
export function withoutCommonSelectionItems(keys){
  return keys.filter(id=>selectionChoiceMetadata('item',{id}).source!=='common');
}
export function selectionChoiceOptions(snapshot){
  const cards=new Map(),items=new Map();
  for(const memory of snapshot?.selectionMemories??[]){
    for(const card of memory.produceCards){
      const info=cardInfo(card,memory.characterId),key=selectionSkillKey(card);
      if(info.rarity?.toUpperCase()==='N'||selectionChoiceMetadata('card',card).secondExclusive)continue;
      if(!cards.has(key))cards.set(key,{key,reference:{id:card.id,upgradeCount:card.upgradeCount,customizes:[]},characterId:memory.characterId,memoryCharacterIds:[],info,metadata:selectionChoiceMetadata('card',card)});
      if(!cards.get(key).memoryCharacterIds.includes(memory.characterId))cards.get(key).memoryCharacterIds.push(memory.characterId);
    }
    for(const item of memory.produceItems){
      const metadata=selectionChoiceMetadata('item',item);
      if(metadata.source!=='common'&&!items.has(item.id))items.set(item.id,{key:item.id,memoryCharacterIds:[],info:itemArt(item.id),metadata});
      if(items.has(item.id)&&!items.get(item.id).memoryCharacterIds.includes(memory.characterId))items.get(item.id).memoryCharacterIds.push(memory.characterId);
    }
  }
  return {cards:sortSelectionChoices([...cards.values()]),items:sortSelectionChoices([...items.values()])};
}
export function selectionChoicesForCharacters(values,characters){
  const selected=selectedValues(characters);
  return values.filter(value=>{
    if(!selected.length)return true;
    const related=value.metadata.source==='idol'&&value.metadata.ownerCharacterId?[value.metadata.ownerCharacterId]:value.memoryCharacterIds;
    return related.some(id=>selected.includes(id));
  });
}
export function sortSelectionChoices(values){
  const plans=['Plan1','Plan2','Plan3','Common'],rarities=['LEGEND','SSR','SR','R','N'];
  const rank=(values,value)=>{const index=values.indexOf(value);return index<0?values.length:index;};
  const flowRank=value=>Math.min(selectionFlowDefinitions.length,...value.metadata.flows.map(id=>rank(selectionFlowDefinitions.map(flow=>flow.id),id)));
  return [...values].sort((a,b)=>rank(plans,a.metadata.plan)-rank(plans,b.metadata.plan)||flowRank(a)-flowRank(b)||rank(rarities,a.metadata.rarity)-rank(rarities,b.metadata.rarity)||a.key.localeCompare(b.key,'ja'));
}
export function filterSelectionChoices(values,{plan='',flow='',rarity=''}={}){
  return values.filter(value=>(!plan||value.metadata.plan===plan)&&(!rarity||value.metadata.rarity===rarity)&&(!flow||(flow==='unclassified'?!value.metadata.flows.length:value.metadata.flows.includes(flow))));

}
function matchesSelectionGroup(selected,values,all){
  const choices=selectedValues(selected);
  return !choices.length||(all?choices.every(value=>values.includes(value)):choices.some(value=>values.includes(value)));
}
export function selectionItemTriggerStatus(item,description){
  // 仅识别整个培养期间的明确上限，不把单场课程／试验限制当作总次数。
  const limits=[...new Set([...description.normalize('NFKC').matchAll(/プロデュース中\s*(?:最大\s*)?(\d+)\s*回/g)].map(match=>Number(match[1])))];
  const limit=limits.length===1?limits[0]:null;
  return {triggered:item.triggerCount,remaining:limit===null?null:Math.max(0,limit-item.triggerCount)};
}
// 来源优先于回忆标记；组内按稀有度、附魔总次数、强化等级降序，完全相同则保留原顺序。
export function sortedSelectionCards(cards){
  const rarities=['LEGEND','SSR','SR','R','N'];
  return cards.map(card=>{
    const metadata=selectionChoiceMetadata('card',card),rank=rarities.indexOf(metadata.rarity);
    return {card,group:metadata.source==='idol'?0:metadata.source==='support'?2:card.fromMemory?1:3,rarity:rank<0?rarities.length:rank,customizes:card.customizes.reduce((sum,value)=>sum+value.customizeCount,0)};
  }).sort((a,b)=>a.group-b.group||a.rarity-b.rarity||b.customizes-a.customizes||b.card.upgradeCount-a.card.upgradeCount).map(value=>value.card);
}
// 附魔成品独立置前；普通道具组内按稀有度降序，培育组的 HIF 徽章优先。
export function sortedSelectionItems(memory){
  const rarities=['LEGEND','SSR','SR','R','N'];
  const ordinary=memory.produceItems.map(value=>{
    const metadata=selectionChoiceMetadata('item',value),rank=rarities.indexOf(metadata.rarity);
    const group=metadata.source==='idol'?1:metadata.use==='training'?2:3;
    return {value,kind:'items',group,rarity:rank<0?rarities.length:rank,priority:group===2&&value.id==='pitem_00-3-265-0'?0:1};
  }).sort((a,b)=>a.group-b.group||a.priority-b.priority||a.rarity-b.rarity);
  return [...memory.produceCustomizeItems.map(value=>({value,kind:'customs'})),...ordinary.map(({value,kind})=>({value,kind}))];
}
export function selectionEntries(snapshot,filters,tagsFor=()=>[]){
  const expired=new Set(snapshot?.eventExpiredSelectionMemoryIds??[]),query=(filters.query??'').trim().toLowerCase();
  // 同一快照使用统一标尺，筛选与翻页不改变色条比例；不代表培养上限。
  const attributeMaximum=Math.max(1,...(snapshot?.selectionMemories??[]).flatMap(memory=>[memory.vocal,memory.dance,memory.visual]));
  return (snapshot?.selectionMemories??[]).map(memory=>({memory,attributeMaximum,expired:expired.has(memory.key),info:idolInfo({idolCardId:memory.idolCardId,levelLimitRank:memory.idolCardLevelLimitRank,potentialRank:memory.idolCardPotentialRank})}))
    .filter(({memory:m,expired,info})=>matchesAny(filters.selectionCharacter,[m.characterId])&&
      (!filters.selectionPlan||String(m.planType)===filters.selectionPlan)&&(!filters.selectionGrade||String(m.grade)===filters.selectionGrade)&&
      (filters.selectionProtection!=='protected'||m.isProtected)&&(filters.selectionProtection!=='unprotected'||!m.isProtected)&&
      matchesSelectionGroup(filters.selectionSkill,m.produceCards.map(selectionSkillKey),filters.selectionSkillAll)&&matchesSelectionGroup(filters.selectionItem,m.produceItems.map(i=>i.id),filters.selectionItemAll)&&
      (!query||m.key===query||[...tagsFor(m),characterInfo(m.characterId).name,info.name,...m.produceCards.flatMap(c=>{const info=cardInfo(c,m.characterId);return [info.name,...info.lines.map(effectSearchText)];}),...m.produceItems.map(i=>itemArt(i.id).name)].join(' ').toLowerCase().includes(query)))
    .sort((a,b)=>filters.selectionSort==='character'?characterInfo(a.memory.characterId).name.localeCompare(characterInfo(b.memory.characterId).name,'ja')||a.memory.ordinal-b.memory.ordinal:
      filters.selectionSort&&filters.selectionSort!=='original'?(b.memory[filters.selectionSort]??0)-(a.memory[filters.selectionSort]??0)||a.memory.ordinal-b.memory.ordinal:a.memory.ordinal-b.memory.ordinal);
}

// 规则独立配置；停用或配置无效时保留当前值，不提供推算结果。
export function selectionStarPotential(memory,rules=hifStarRules){
  const positive=value=>Number.isFinite(value)&&value>0;
  const nonnegative=value=>Number.isFinite(value)&&value>=0;
  const rounds={floor:Math.floor,round:Math.round,ceil:Math.ceil,none:value=>value};
  const itemRule=rules?.item,battle=rules?.battle,round=rounds[rules?.rounding];
  if(!rules?.enabled||!positive(rules.finalCap)||!positive(rules.bonusMultiplier)||!round||
    !itemRule?.id||!Number.isInteger(itemRule.limit)||itemRule.limit<0||!nonnegative(itemRule.baseReward)||
    !['triggerCount','reactionCount'].includes(itemRule.countField)||
    ![null,undefined,'triggerCount','reactionCount'].includes(itemRule.matchingCountField)||
    !Array.isArray(battle?.spLessons)||!Array.isArray(battle?.rounds)||
    ![...battle.spLessons,...battle.rounds].every(nonnegative))return null;
  const items=memory.produceItems.filter(item=>item.id===itemRule.id);
  const item=items[0],current=memory.star,count=item?.[itemRule.countField];
  if(items.length!==1||!Number.isInteger(current)||current<0||current>rules.finalCap||
    !Number.isInteger(count)||count<0||count>itemRule.limit||
    (itemRule.matchingCountField&&count!==item[itemRule.matchingCountField]))return null;
  const reward=value=>round(value*rules.bonusMultiplier);
  const charges=itemRule.limit-count,itemGain=charges*reward(itemRule.baseReward);
  const spGain=battle.spLessons.reduce((sum,value)=>sum+reward(value),0),roundGains=battle.rounds.map(reward);
  const battleGain=spGain+roundGains.reduce((sum,value)=>sum+value,0);
  const final=Math.min(rules.finalCap,current+itemGain+battleGain);
  return {current,charges,itemGain,spGain,roundGains,battleGain,remaining:final-current,final};
}
