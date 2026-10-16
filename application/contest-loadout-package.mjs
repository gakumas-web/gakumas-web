import {contestCatalog,contestCustomizationCatalog,contestSimulationReference,cardCustomizations,idolInfo,contestOwnedSupportRewards,progressionInfo} from '../domain/catalog.mjs';
import {contestChoiceOwned,contestCustomizationValid,contestSlotChoices} from '../domain/contest-loadout.mjs';
import {contestPlanMatches} from '../domain/contest-simulation.mjs';
import {contestDeckCost,contestCapacityStatus} from '../domain/contest-card-cost.mjs';
import {contestCustomizationLimits} from '../domain/contest-customization-rules.mjs';
import {contestExtraItemLimit} from '../domain/contest-item-rules.mjs';
import {selectionGrades} from '../domain/selection-memories.mjs';
import {createSavedLoadout} from './contest-saved-loadouts.mjs';

export const LOADOUT_PACKAGE_FORMAT='gakumas-contest-loadouts',LOADOUT_PACKAGE_VERSION=1;
export const LOADOUT_PACKAGE_FILE_LIMIT=2*1024*1024,LOADOUT_PACKAGE_ENTRY_LIMIT=100;
export class LoadoutPackageError extends Error{constructor(code='loadout_package_invalid'){super(code);this.code=code;}}
const fail=()=>{throw new LoadoutPackageError();};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=256)=>typeof value==='string'&&value.length>0&&value.length<=max;
const label=(value,max=512)=>typeof value==='string'&&value.length<=max;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
function keys(value,allowed,required=allowed){if(!record(value)||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>value[key]===undefined))fail();}
function project(value,allowed){return Object.fromEntries(allowed.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));}
const cardFields=['id','upgradeCount','customizes'];
function card(value){
  keys(value,cardFields);if(!text(value.id)||!integer(value.upgradeCount)||!Array.isArray(value.customizes)||value.customizes.length>16)fail();
  for(const custom of value.customizes){keys(custom,['id','customizeCount']);if(!text(custom.id)||!integer(custom.customizeCount)||custom.customizeCount<1)fail();}
  if(new Set(value.customizes.map(row=>row.id)).size!==value.customizes.length)fail();
  return structuredClone(value);
}
const memoryFields=['characterId','idolCardId','planType','vocal','dance','visual','stamina','power','powerSource','grade','produceCard','examBattleProduceCards','examBattleProduceItemIds'];
function memory(value){
  keys(value,memoryFields,memoryFields.filter(key=>!['power','powerSource'].includes(key)));
  if(!text(value.characterId)||!text(value.idolCardId)||![2,3,4].includes(value.planType)||!['vocal','dance','visual','stamina','grade'].every(key=>integer(value[key]))||value.grade>=selectionGrades.length||value.power!==undefined&&!integer(value.power)||value.powerSource!==undefined&&value.powerSource!=='calculated')fail();
  if(!Array.isArray(value.examBattleProduceCards)||value.examBattleProduceCards.length<1||value.examBattleProduceCards.length>6||!Array.isArray(value.examBattleProduceItemIds)||value.examBattleProduceItemIds.length>4||!value.examBattleProduceItemIds.every(id=>text(id))||new Set(value.examBattleProduceItemIds).size!==value.examBattleProduceItemIds.length)fail();
  return {...structuredClone(value),produceCard:card(value.produceCard),examBattleProduceCards:value.examBattleProduceCards.map(card)};
}
const stageFields=['id','kind','seasonNumber','stageNumber','name','planType','preset'],presetFields=['id','name','round','stage'];
function stage(value){
  keys(value,stageFields,['id','kind','planType']);
  if(!text(value.id)||!['contest','event','linkContest'].includes(value.kind)||!['ProducePlanType_Common','ProducePlanType_Plan1','ProducePlanType_Plan2','ProducePlanType_Plan3'].includes(value.planType))fail();
  for(const key of ['seasonNumber','stageNumber'])if(value[key]!==undefined&&!integer(value[key]))fail();
  if(value.kind==='contest'&&(!integer(value.seasonNumber)||!integer(value.stageNumber)))fail();
  if(value.name!==undefined&&!label(value.name))fail();
  if(value.preset!==undefined){keys(value.preset,presetFields,['id']);if(!integer(value.preset.id))fail();for(const key of ['round','stage'])if(value.preset[key]!==undefined&&!integer(value.preset[key])&&!label(value.preset[key],64))fail();if(value.preset.name!==undefined&&!label(value.preset.name))fail();}
  if(value.kind!=='contest'&&!value.preset)fail();
  return structuredClone(value);
}
function entry(value){
  keys(value,['name','stage','loadout']);if(!text(value.name,60)||!value.name.trim())fail();
  keys(value.loadout,['memories','manual','originals'],['memories','manual']);
  const pair=values=>{if(!Array.isArray(values)||values.length!==2)fail();return values.map(memory);};
  const memories=pair(value.loadout.memories);keys(value.loadout.manual,['vocal','dance','visual'],[]);
  for(const number of Object.values(value.loadout.manual))if(!Number.isFinite(number)||number<0||number>Number.MAX_SAFE_INTEGER)fail();
  return {name:value.name.trim(),stage:stage(value.stage),loadout:{memories,manual:structuredClone(value.loadout.manual),...(value.loadout.originals!==undefined?{originals:pair(value.loadout.originals)}:{})}};
}
export function parseLoadoutPackage(input){
  keys(input,['format','version','exportMetadata','entries']);
  if(input.format!==LOADOUT_PACKAGE_FORMAT||input.version!==LOADOUT_PACKAGE_VERSION)fail();
  keys(input.exportMetadata,['exportedAt','contentVersion']);
  if(!text(input.exportMetadata.exportedAt,64)||!Number.isFinite(Date.parse(input.exportMetadata.exportedAt))||input.exportMetadata.contentVersion!==null&&!text(input.exportMetadata.contentVersion,256)||!Array.isArray(input.entries)||!input.entries.length||input.entries.length>LOADOUT_PACKAGE_ENTRY_LIMIT)fail();
  return {format:LOADOUT_PACKAGE_FORMAT,version:LOADOUT_PACKAGE_VERSION,exportMetadata:structuredClone(input.exportMetadata),entries:input.entries.map(entry)};
}
// 导出重新投影全部嵌套字段，避免存储记录中的账号身份或模拟日志进入文件。
export function createLoadoutPackage(entries,{contentVersion=null,exportedAt=new Date().toISOString()}={}){
  const cleanMemory=value=>({...project(value,memoryFields),produceCard:project(value.produceCard,cardFields),examBattleProduceCards:value.examBattleProduceCards.map(value=>project(value,cardFields))});
  const cleanCardCustoms=value=>({...value,customizes:value.customizes.map(custom=>project(custom,['id','customizeCount']))});
  const cleanPair=values=>values.map(value=>{const clean=cleanMemory(value);return {...clean,produceCard:cleanCardCustoms(clean.produceCard),examBattleProduceCards:clean.examBattleProduceCards.map(cleanCardCustoms)};});
  return parseLoadoutPackage({format:LOADOUT_PACKAGE_FORMAT,version:LOADOUT_PACKAGE_VERSION,exportMetadata:{exportedAt,contentVersion},entries:entries.map(value=>({name:value.name,stage:{...project(value.stage,stageFields),...(value.stage.preset?{preset:project(value.stage.preset,presetFields)}:{})},loadout:{memories:cleanPair(value.loadout.memories),manual:project(value.loadout.manual??{},['vocal','dance','visual']),...(value.loadout.originals?{originals:cleanPair(value.loadout.originals)}:{})}}))});
}
export async function readLoadoutPackage(file){
  if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>LOADOUT_PACKAGE_FILE_LIMIT)throw new LoadoutPackageError('loadout_package_too_large');
  let input;try{input=JSON.parse(await file.text());}catch{throw new LoadoutPackageError();}
  return parseLoadoutPackage(input);
}
// 可载入要求当前目录与账号条件都可核验；未知项目保留为需检查，不承诺原分数。
export function inspectLoadoutPackage(input,context={}){
  const parsed=parseLoadoutPackage(input),catalog=contestCustomizationCatalog(),owned={idolCardIds:new Set((context.idolCards??[]).map(value=>value.idolCardId)),supportCardIds:new Set((context.supportCards??[]).map(value=>value.supportCardId)),producerLevel:context.producerLevel},rewards=contestOwnedSupportRewards(context.supportCards);
  return parsed.entries.map(value=>{
    const reasons=new Set();
    const inspectIdentity=memory=>{
      const info=idolInfo({idolCardId:memory.idolCardId}),held=(context.idolCards??[]).find(value=>value.idolCardId===memory.idolCardId),plan=({2:'Plan1',3:'Plan2',4:'Plan3'})[memory.planType];
      if(!info.cardResolved||info.characterId!==memory.characterId||info.plan!==plan)reasons.add('catalog');
      if(!held||context.supportCards===undefined)reasons.add('ownership');
      return held;
    };
    for(const [index,original] of (value.loadout.originals??[]).entries()){
      inspectIdentity(original);
      if(['characterId','idolCardId','planType'].some(key=>original[key]!==value.loadout.memories[index][key]))reasons.add('catalog');
      if(original.examBattleProduceItemIds.some(id=>!contestSimulationReference('item',id).record))reasons.add('catalog');
    }
    for(const memory of [...value.loadout.memories,...(value.loadout.originals??[])])for(const reference of [memory.produceCard,...memory.examBattleProduceCards]){
      if(!contestSimulationReference('card',reference).record||!contestCustomizationValid(cardCustomizations(reference),reference.customizes))reasons.add('catalog');
    }
    const currentStage=contestCatalog().choices.find(stage=>stage.id===value.stage.id||stage.kind===value.stage.kind&&value.stage.preset?.id!==undefined&&stage.preset?.id===value.stage.preset.id);
    if(!currentStage||currentStage.kind!==value.stage.kind||currentStage.planType!==value.stage.planType)reasons.add('stage');
    for(const [index,memory] of value.loadout.memories.entries()){
      const held=inspectIdentity(memory);
      if(!currentStage||!contestPlanMatches(currentStage,memory.planType)||memory.characterId!==value.loadout.memories[0].characterId||memory.planType!==value.loadout.memories[0].planType)reasons.add('stage');
      const limits=contestCustomizationLimits(selectionGrades[memory.grade],{exclusiveUnlocked:held?progressionInfo('idol',held)?.customization?.unlocked===true:false}),counts={idol:0,support:0,common:0};
      if(!limits)reasons.add('rules');
      for(const [slotIndex,reference] of memory.examBattleProduceCards.entries()){
        const record=contestSimulationReference('card',reference).record,choice=catalog.cards.find(value=>value.id===reference.id);
        if(!record||!choice){reasons.add('catalog');continue;}
        if(!contestSlotChoices(catalog.cards,{memoryIndex:index,slotIndex,planType:memory.planType,characterId:memory.characterId}).some(value=>value.id===reference.id))reasons.add('rules');
        if(!contestChoiceOwned(choice,owned,'')||choice.metadata.source==='support'&&!rewards.cards.has(choice.id))reasons.add('ownership');
        if(reference.customizes.length){counts[choice.metadata.source]++;if(!limits||reference.customizes.reduce((sum,value)=>sum+value.customizeCount,0)>limits.perCard[choice.metadata.source])reasons.add('rules');}
      }
      if(limits&&Object.entries(counts).some(([source,count])=>count>limits.cards[source]))reasons.add('rules');
      const cost=contestDeckCost(memory.examBattleProduceCards.map(reference=>contestSimulationReference('card',reference))),capacity=contestCapacityStatus(cost.total,selectionGrades[memory.grade]);
      if(cost.total===null||!capacity.range||capacity.overflow||capacity.underflow)reasons.add('rules');
      let extras=0;
      for(const id of memory.examBattleProduceItemIds){
        const record=contestSimulationReference('item',id).record,choice=catalog.items.find(value=>value.id===id);
        if(!record||!choice){reasons.add('catalog');continue;}
        if(index===1)continue;
        if(!contestSlotChoices(catalog.items,{memoryIndex:index,slotIndex:0,planType:memory.planType,characterId:memory.characterId,kind:'item'}).some(value=>value.id===id))reasons.add('rules');
        if(choice.metadata.source==='support'){extras++;if(!rewards.items.has(id))reasons.add('ownership');}
        else if((record.definition.originIdolCardId||record.definition.originPrimaStellaIdolCardId)!==memory.idolCardId)reasons.add('rules');
      }
      const limit=contestExtraItemLimit(memory.grade);if(limit===null||extras>limit)reasons.add('rules');
    }
    if(currentStage?.manualMultipliers&&!['vocal','dance','visual'].every(key=>value.loadout.manual[key]!==undefined))reasons.add('rules');
    return {entry:value,status:reasons.size?'check':'loadable',reasons:[...reasons]};
  });
}
export function materializeLoadoutImport(preview){return preview.map(value=>createSavedLoadout(value.entry,value.entry.name));}
