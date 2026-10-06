import {CAPTURE_FORMAT,CAPTURE_SCHEMA} from './snapshot-format.mjs';
import {digest,InputError,compareCapturedAt,validCapturedAt} from './model.mjs';
import {validPublicUserId} from './account.mjs';
export const SELECTION_DETAIL_SCHEMA=CAPTURE_SCHEMA;
const text=value=>typeof value==='string'&&value.length<=4096;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const boolean=value=>typeof value==='boolean';
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
function fields(value,schema){
  if(!record(value))throw new InputError();
  return Object.fromEntries(Object.entries(schema).map(([key,check])=>{if(!check(value[key]))throw new InputError();return [key,value[key]];}));
}
function rows(values,convert,max=1000){if(!Array.isArray(values)||values.length>max)throw new InputError();return values.map(convert);}
const ability=value=>fields(value,{id:text,level:integer});
const skill=value=>fields(value,{id:text,level:integer,triggerCount:integer});
function card(value){
  if(value===null)return null;
  const base=fields(value,{id:text,upgradeCount:integer});
  return {...base,customizes:rows(value.customizes,item=>fields(item,{id:text,customizeCount:integer}))};
}
function memory(value){
  if(value===null)return null;
  const base=fields(value,{characterId:text,idolCardId:text,grade:integer,power:integer,planType:integer,vocal:integer,dance:integer,visual:integer,stamina:integer,produceCardPhaseType:integer});
  return {...base,produceCard:card(value.produceCard),abilities:rows(value.abilities,ability)};
}
function normalize(input,prepared){
  const base=fields(input,{format:value=>value===CAPTURE_FORMAT,schema_version:value=>value===SELECTION_DETAIL_SCHEMA,source:value=>value==='selection_memory_get',captured_at:validCapturedAt,publicUserId:validPublicUserId,[prepared?'key':'userSelectionMemoryId']:prepared?hash:value=>text(value)&&value.length>0});
  const memories=rows(input.memories,slot=>({...fields(slot,{number:integer,isRental:boolean,[prepared?'memoryKey':'userMemoryId']:prepared?value=>value===null||hash(value):text}),memory:memory(slot.memory),memoryAbilities:rows(slot.memoryAbilities,skill)}),20);
  const supportCards=rows(input.supportCards,slot=>({...fields(slot,{number:integer,supportCardId:text,level:integer,levelLimitRank:integer,isRental:boolean}),produceSkills:rows(slot.produceSkills,skill),eventDetailIds:rows(slot.eventDetailIds,value=>{if(!text(value))throw new InputError();return value;})}),20);
  for(const slots of [memories,supportCards])if(new Set(slots.map(slot=>slot.number)).size!==slots.length)throw new InputError();
  return {...base,memories,supportCards};
}
export async function prepareSelectionDetail(input){
  const {userSelectionMemoryId,memories,...base}=normalize(input,false);
  return {...base,key:await digest('selection:'+userSelectionMemoryId),memories:await Promise.all(memories.map(async({userMemoryId,...slot})=>({...slot,memoryKey:userMemoryId?await digest(userMemoryId):null})))};
}
export const restoreSelectionDetail=input=>normalize(input,true);
export function mergeSelectionDetails(snapshot,details){
  if(!snapshot?.publicUserId)throw new InputError();
  const keys=new Set(snapshot.selectionMemories.map(row=>row.key)),all=new Map((snapshot.details??[]).map(detail=>[detail.key,detail]));
  for(const input of details){
    const detail=restoreSelectionDetail(input);
    if(detail.publicUserId!==snapshot.publicUserId||!keys.has(detail.key))throw new InputError();
    if(!all.has(detail.key)||compareCapturedAt(detail.captured_at,all.get(detail.key).captured_at)>=0)all.set(detail.key,detail);
  }
  return {...snapshot,details:[...all.values()]};
}
