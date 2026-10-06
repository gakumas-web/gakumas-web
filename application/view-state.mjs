import {validProfile} from '../domain/account.mjs';
import {selectedValues} from '../domain/model.mjs';

export const defaults=()=>({customTag:'',achievementSection:'ending',achievementScope:'common',achievementCharacter:'',achievementFocus:'hski',achievementCategory:'',achievementState:'',achievementReward:'',achievementSort:'original',achievementIncompleteFirst:true,selectionCharacter:[],selectionPlan:'',selectionGrade:'',selectionProtection:'all',selectionLoadoutCollapsed:true,selectionSkill:[],selectionItem:[],selectionSkillAll:true,selectionItemAll:true,selectionSort:'original',skinCharacter:[],skinTheme:'',memoryGrade:'',memoryExamSkill:[],memoryExamItem:[],memoryExamSkillAll:true,memoryExamItemAll:true,ownership:'owned',idolCharacter:[],idolRarity:'',idolImmersive:false,idolPlan:'',idolEffect:[],supportRarity:'',supportImmersive:false,supportType:'',supportPlan:'',supportPlanCommon:true,supportReward:'',supportEffect:[],supportEffectAttribute:[],supportCharacter:[],supportCharacterAll:true,supportTrigger:'',query:'',plan:'',skill:[],ability:[],character:[],protection:'all',sort:'ordinal',catalogSort:'original',ownedFirst:false,purpose:'all',page:0});

export const FILTER_BINDINGS=[['custom-tag-filter','customTag'],['selection-character','selectionCharacter'],['selection-plan','selectionPlan'],['selection-grade','selectionGrade'],['selection-loadout-collapsed','selectionLoadoutCollapsed'],['selection-skill','selectionSkill'],['selection-item','selectionItem'],['selection-skill-all','selectionSkillAll'],['selection-item-all','selectionItemAll'],['selection-sort','selectionSort'],['skin-character','skinCharacter'],['skin-theme','skinTheme'],['memory-grade','memoryGrade'],['memory-skill','memoryExamSkill'],['memory-item','memoryExamItem'],['memory-skill-all','memoryExamSkillAll'],['memory-item-all','memoryExamItemAll'],['ownership','ownership'],['search','query'],['character','character'],['sort','sort'],['idol-sort','catalogSort'],['catalog-owned-first','ownedFirst'],['purpose','purpose'],['plan','plan'],['skill','skill'],['ability','ability'],['idol-character','idolCharacter'],['idol-rarity','idolRarity'],['idol-immersive','idolImmersive'],['idol-plan','idolPlan'],['idol-effect','idolEffect'],["support-character", "supportCharacter"],["support-character-all", "supportCharacterAll"],["support-rarity", "supportRarity"],["support-immersive", "supportImmersive"],["support-type", "supportType"],["support-plan", "supportPlan"],["support-plan-common", "supportPlanCommon"],["support-reward", "supportReward"],["support-effect", "supportEffect"],["support-effect-attribute", "supportEffectAttribute"],["support-trigger", "supportTrigger"]];
export const CHOICE_GROUPS=[
    ['selection-character-chips','selection-character','selectionCharacter',true,'selectionMemories'],
    ['selection-plan-chips','selection-plan','selectionPlan',false,'selectionMemories'],
    ['selection-grade-chips','selection-grade','selectionGrade',false,'selectionMemories'],
    ['memory-character-chips','character','character',true,'memories'],
    ['idol-plan-chips','idol-plan','idolPlan',false,'idolCards'],
    ['support-plan-chips','support-plan','supportPlan',false,'supportCards'],
    ['support-type-chips','support-type','supportType',false,'supportCards'],
    ['memory-plan-chips','plan','plan',false,'memories'],
    ['memory-grade-chips','memory-grade','memoryGrade',false,'memories'],
    ['skin-character-chips','skin-character','skinCharacter',true,'idolCardSkins'],
    ['idol-character-chips','idol-character','idolCharacter',true,'idolCards'],
    ['idol-effect-chips','idol-effect','idolEffect',false,'idolCards'],
    ['support-character-chips','support-character','supportCharacter',true,'supportCards'],
    ['support-effect-chips','support-effect','supportEffect',false,'supportCards'],
    ['support-effect-attribute-chips','support-effect-attribute','supportEffectAttribute',false,'supportCards']];

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function normalizeView(v){
  for(const [key,value] of Object.entries(defaults()))if(typeof value==='string'&&typeof v[key]!=='string'||typeof value==='boolean'&&typeof v[key]!=='boolean')v[key]=value;
  if(!Number.isSafeInteger(v.page)||v.page<0)v.page=0;
  if(!['all','owned','unowned','favorites'].includes(v.ownership))v.ownership='owned';
  if(!['ordinal','shotTime','power','vocal','dance','visual','stamina'].includes(v.sort))v.sort='ordinal';
  if(!['original','clearedTime','lastUsedTime','grade','vocal','dance','visual','character'].includes(v.selectionSort))v.selectionSort='original';
  if(!['original','rarity','level','levelAsc','potential','potentialAsc','plan','character','rank','rankAsc','levelGap','type','theme','release','releaseAsc'].includes(v.catalogSort))v.catalogSort='original';
  for(const key of ['achievementCharacter','achievementFocus'])if(typeof v[key]!=='string')v[key]='';
  v.achievementScope=v.achievementScope==='card'?'card':'common';
  v.achievementSection=v.achievementSection==='achievement'?'achievement':'ending';
  if(!['','Idol','Produce','Other'].includes(v.achievementCategory))v.achievementCategory='';
  if(!['','achieved','unachieved'].includes(v.achievementState))v.achievementState='';
  v.achievementIncompleteFirst=v.achievementIncompleteFirst!==false;
  if(!['','experience','support','jewel','other'].includes(v.achievementReward))v.achievementReward='';
  if(!['original','near'].includes(v.achievementSort))v.achievementSort='original';
  for(const key of ['selectionSkill','memoryExamSkill'])v[key]=selectedValues(v[key]).filter(value=>{
    try{const key=JSON.parse(value);return Array.isArray(key)&&key.length===2&&typeof key[0]==='string'&&Number.isInteger(key[1])&&key[1]>=0;}catch{return false;}
  });
  v.selectionItem=selectedValues(v.selectionItem);
  v.memoryExamItem=selectedValues(v.memoryExamItem);
  v.skill=selectedValues(v.skill);v.ability=selectedValues(v.ability);
  v.memoryExamSkillAll=v.memoryExamSkillAll!==false;v.memoryExamItemAll=v.memoryExamItemAll!==false;
  v.protection=v.protection==='protected'?'protected':'all';
  v.selectionProtection=v.selectionProtection==='protected'?'protected':'all';
  v.selectionLoadoutCollapsed=v.selectionLoadoutCollapsed!==false;
  v.selectionSkillAll=v.selectionSkillAll!==false;
  v.selectionItemAll=v.selectionItemAll!==false;
  v.ownedFirst=v.ownedFirst===true;
  v.supportImmersive=v.supportImmersive===true;
  v.idolImmersive=v.idolImmersive===true;
  v.supportCharacterAll=v.supportCharacterAll!==false;
  v.supportPlanCommon=v.supportPlanCommon!==false;
  v.purpose=['inheritance','with-deck'].includes(v.purpose)?v.purpose:'all';
  for(const key of ['character','selectionCharacter','skinCharacter','idolCharacter','idolEffect','supportCharacter','supportEffect','supportEffectAttribute'])v[key]=selectedValues(v[key]);
  return v;
}

// 当前字段白名单同时用于档案恢复和已保存视图，不重新引入退役字段。
export function createView(saved={}){
  if(!object(saved))saved={};
  return normalizeView(Object.fromEntries(Object.entries(defaults()).map(([key,value])=>[key,saved[key]??value])));
}
export function createViews(saved={}){
  if(!object(saved))saved={};
  return Object.fromEntries(['memories','selectionMemories','idolCards','supportCards','idolCardSkins','achievements'].map(tab=>{
    const view=createView(saved[tab]);
    if(tab==='supportCards'){if(view.ownership!=='favorites')view.ownership='all';view.page=0;}
    return [tab,view];
  }));
}

// 已选标签与清空操作共用字段范围；持有范围、稀有度和排序独立保留。
const FILTER_FIELDS={
  achievements:['achievementCategory','achievementState','achievementReward'],
  memories:['character','memoryGrade','customTag','plan','skill','ability','memoryExamSkill','memoryExamItem','memoryExamSkillAll','memoryExamItemAll'],
  selectionMemories:['customTag','selectionCharacter','selectionPlan','selectionGrade','selectionSkill','selectionItem','selectionSkillAll','selectionItemAll'],
  idolCards:['idolCharacter','idolPlan','idolEffect'],
  supportCards:['supportCharacter','supportCharacterAll','supportType','supportPlan','supportPlanCommon','supportReward','supportEffect','supportEffectAttribute','supportTrigger'],
  idolCardSkins:['skinCharacter','skinTheme'],
};
export function activeFilterKeys(tab,view){
  return FILTER_FIELDS[tab].filter(key=>!['selectionSkillAll','selectionItemAll','memoryExamSkillAll','memoryExamItemAll'].includes(key)&&selectedValues(view[key]).length&&!['all','auto'].includes(view[key]));
}
export function resetFilters(view,tab,{keys=FILTER_FIELDS[tab]}={}){
  const initial=defaults();
  for(const key of keys)view[key]=initial[key];
  view.page=0;
}

export function nextChoice(current,value){
  if(!Array.isArray(current))return value;
  return !value?[]:current.includes(value)?current.filter(item=>item!==value):[...current,value];
}

export const PROFILE_PREFERENCE_KEY='gakumas-web:active-profile';
export const normalizeProfile=value=>validProfile(value)?value:null;

// 卡面偏好只保存图片版本，培养阶段仍为会话内预览。
export function restoreIdolArt(saved={}){
  return Object.fromEntries(Object.entries(object(saved)?saved:{}).filter(([,value])=>value==='base'||value==='upgraded'));
}

// 每类目录只提供有明确数据依据的排序；箭头表示数值／时间方向。
export const CATALOG_SORTS={
  idolCards:[['original','快照顺序'],['rarity','稀有度 ↓'],['level','特训等级 ↓'],['levelAsc','特训等级 ↑'],['potential','开花等级 ↓'],['potentialAsc','开花等级 ↑'],['plan','计划 → 稀有度 → 角色'],['character','角色顺序']],
  supportCards:[['original','快照顺序'],['rarity','稀有度 ↓'],['level','等级 ↓'],['levelAsc','等级 ↑'],['rank','突破数 ↓'],['rankAsc','突破数 ↑'],['levelGap','距当前突破上限的等级差 ↓'],['type','属性 → 稀有度 → 等级']],
  idolCardSkins:[['original','快照顺序'],['theme','主题顺序 → 角色'],['release','实装时间：新到旧'],['releaseAsc','实装时间：旧到新'],['character','角色顺序']],
};

// 本地偏好是独立输入边界；损坏时只恢复显示默认值，不影响账号数据。
export function parsePreferences(raw){
  let saved={},recovered=false;
  try{saved=typeof raw==='string'?JSON.parse(raw):raw??{};if(!object(saved)){saved={};recovered=true;}}catch{recovered=true;}
  const views=createViews(saved.views),tab=Object.hasOwn(views,saved.tab)?saved.tab:'memories';
  if(saved.tab!==undefined&&tab!==saved.tab)recovered=true;
  if(saved.views!==undefined){
    if(!object(saved.views))recovered=true;
    else for(const [name,value] of Object.entries(saved.views)){
      if(!Object.hasOwn(views,name)||!object(value)){recovered=true;continue;}
      const normalized=createView(value);
      for(const key of Object.keys(defaults()))if(Object.hasOwn(value,key)&&JSON.stringify(value[key])!==JSON.stringify(normalized[key]))recovered=true;
    }
  }
  return {views,tab,idolArt:restoreIdolArt(saved.idolArt),recovered};
}

// 常用筛选与库存独立恢复；不保留无法识别的条目结构。
export function parseSavedViews(raw){
  try{
    const saved=raw==null?[]:JSON.parse(raw);
    if(!Array.isArray(saved)||saved.length>1000||saved.some(item=>!object(item)||typeof item.name!=='string'||!item.name.trim()||item.name.length>60||!object(item.view)))return {values:[],recovered:true};
    return {values:saved.map(item=>({name:item.name,view:createView(item.view)})),recovered:false};
  }catch{return {values:[],recovered:true};}
}

export function readSavedViews(profile,storage){
  try{return parseSavedViews((storage??globalThis.localStorage).getItem(`gakumas-web:saved-views:${profile}`));}
  catch{return {values:[],recovered:true};}
}
