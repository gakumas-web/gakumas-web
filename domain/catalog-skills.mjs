import {catalogState,pair} from './catalog-state.mjs';
import {descriptionIconType} from './effect-icons.mjs';
import {plainText,descriptionText} from './semantic-text.mjs';
import {summarizeAbility,abilityGroupInfo,abilityChoiceGroups} from './ability-summary.mjs';
import {selectedValues} from './model.mjs';
import {t,locale} from '../i18n.mjs';

const abilitySummaryCache=new Map(),choiceMetadataCache=new Map(),abilityFilterGroupCache=new Map();
let cacheGeneration=-1,abilitySummaryLanguage;
function syncCaches(){
  if(cacheGeneration===catalogState.generation)return;
  cacheGeneration=catalogState.generation;abilitySummaryCache.clear();choiceMetadataCache.clear();abilityFilterGroupCache.clear();
}
export const cardCustomizations=reference=>catalogState.customizeCards.available(reference);

export function cardInfo(card, characterId) {
  if (card === undefined) return {name: t('未记录'), lines: []};
  if (card === null) return {name: t('无继承卡'), lines: []};
  const row = catalogState.tables?.cards.get(pair(card.id, card.upgradeCount));
  const description = catalogState.semantics.card(card);
  const lines = description.lines;
  const categories = {ProduceCardCategory_ActiveSkill: 'Active', ProduceCardCategory_MentalSkill: 'Mental', ProduceCardCategory_Trouble: 'Trouble'};
  const image = row?.isCharacterAsset ? row.images?.[characterId] : row?.images?.common;
  return {name: plainText(row?.name) || t('未解析技能卡'), lines, image,
    rarity: row?.rarity?.replace('ProduceCardRarity_', '') ?? '',
    category: categories[row?.category] ?? '', upgrade: card.upgradeCount,
    customizes: card.customizes.reduce((sum, c) => sum + c.customizeCount, 0)};
}

export function semanticGroup(memory, field) { return catalogState.semantics.group(memory,field); }
// 专属项优先使用所属偶像卡主流派；其它项按结构化效果归类，可多归属，不从名称猜测。
export const selectionFlowDefinitions=[
  {id:'parameter',label:'好调',prefixes:['ExamParameterBuff']},
  {id:'lesson',label:'集中',prefixes:['ExamLessonBuff']},
  {id:'aggressive',label:'干劲',prefixes:['ExamCardPlayAggressive','ExamAggressive']},
  {id:'review',label:'好印象',prefixes:['ExamReview']},
  {id:'concentration',label:'强气',prefixes:['ExamConcentration']},
  {id:'fullPower',label:'全力',prefixes:['ExamFullPower']},
];
export function selectionChoiceMetadata(kind,reference){
  syncCaches();
  const key=JSON.stringify([kind,reference.id,kind==='card'?reference.upgradeCount:null]);
  if(!choiceMetadataCache.has(key))choiceMetadataCache.set(key,describeChoiceMetadata(kind,reference));
  return choiceMetadataCache.get(key);
}
function describeChoiceMetadata(kind,reference){
  const row=kind==='card'?catalogState.tables?.cards.get(pair(reference.id,reference.upgradeCount)):catalogState.tables?.items.get(reference.id);
  const definition=row?.definition??{},types=(row?.descriptions??[]).map(part=>part.examEffectType?.replace('ProduceExamEffectType_','')).filter(Boolean);
  const owner=catalogState.tables?.idols.get(definition.originIdolCardId||definition.originPrimaStellaIdolCardId);
  const ownerType=owner?.examEffectType?.replace('ProduceExamEffectType_','');
  const ownerFlows=selectionFlowDefinitions.filter(flow=>ownerType&&flow.prefixes.some(prefix=>ownerType.startsWith(prefix))).map(flow=>flow.id);
  const plan=definition.planType?.replace('ProducePlanType_','')??'';
  const involved=new Set(selectionFlowDefinitions.filter(flow=>types.some(type=>flow.prefixes.some(prefix=>type.startsWith(prefix)))).map(flow=>flow.id));
  const groups=new Set((definition.effectGroupIds??[]).map(id=>id.replace(/^effect_group-visible-/,'').replace(/-000$/,'')));
  // 计划限定效果分类的补充含义；通用计划的泛用元气不自动归为干劲。
  const rules=[
    ['Plan1','parameter',['exam_parameter_buff','exam_parameter_buff_multiple_per_turn','exam_parameter_buff_multiple_per_turn_reduce','exam_parameter_buff_reduce']],
    ['Plan1','lesson',['exam_lesson_buff','exam_lesson_buff_reduce']],
    ['Plan2','aggressive',['exam_card_play_aggressive','exam_aggressive_reduce','exam_block','exam_block_restriction','exam_lesson_depend_block']],
    ['Plan2','review',['exam_review','exam_review_reduce','exam_lesson_depend_exam_review']],
    ['Plan3','concentration',['exam_concentration','exam_preservation']],
    ['Plan3','fullPower',['exam_full_power','exam_full_power_point_reduce']],
  ];
  for(const [requiredPlan,flow,effects] of rules)if(plan===requiredPlan&&effects.some(effect=>groups.has(effect)))involved.add(flow);
  if(plan==='Plan2'&&types.some(type=>type==='ExamBlock'||type==='ExamBlockFix'))involved.add('aggressive');
  if(plan==='Plan3'&&types.some(type=>type==='ExamPreservation'||type==='ExamOverPreservation'))involved.add('concentration');
  return {ownerCharacterId:owner?.characterId,use:definition.isExamEffect===true?'battle':definition.isExamEffect===false?'training':'unknown',secondExclusive:kind==='card'&&catalogState.secondExclusiveCardIds.has(reference.id),source:!row?'unknown':definition.originIdolCardId||definition.originPrimaStellaIdolCardId?'idol':definition.originSupportCardId?'support':'common',plan,rarity:(definition.rarity??row?.rarity??'').replace(/^Produce(?:Card|Item)Rarity_/,'').toUpperCase(),
    flows:ownerFlows.length?ownerFlows:selectionFlowDefinitions.filter(flow=>involved.has(flow.id)).map(flow=>flow.id)};
}
// 组合 ID 精确匹配完整成品说明，不拆分 ID 或叠加部件效果。
export function customizeItemInfo(id){
  const row=catalogState.tables?.customizeItems.get(id);
  if(!row)return {resolved:false,id,name:t('未解析附魔道具'),images:[],parents:[]};
  return {resolved:true,id,name:plainText(row.name),use:row.effectType==='ProduceItemEffectType_ProduceEffect'?'training':row.effectType==='ProduceItemEffectType_ProduceExamEffect'?'battle':'unknown',image:catalogState.customizeItemImages[id],descriptionParts:row.produceDescriptions,
    text:descriptionText(row.produceDescriptions,undefined,true).text,
    effectIds:row.produceEffectIds??[],examEffectIds:row.produceExamEffectIds??[],
    triggerLimit:row.produceEffectTriggerCount,examLimit:row.examEffectCount,
    images:[1,2,3,4,5].map(layer=>row[`assetId${layer}`]).filter(Boolean).map(asset=>asset+'.webp'),
    parents:(catalogState.customizeItemParents.get(id)??[]).map(parent=>({id:parent,name:plainText(catalogState.tables.customizeItems.get(parent)?.name)||parent}))};
}
export function itemArt(id) {
  const row = catalogState.tables?.items.get(id);
  return {name: plainText(row?.name) || t('未解析 P 道具'), image: row?.image, upgraded: row?.isUpgraded === true,
    background:row?.definition?.rarity?.replace('ProduceItemRarity_','').toLowerCase()};
}
export function supportSkillVisual(reference){
  const row=catalogState.tables?.cards.get(pair(reference.id,reference.upgradeCount));
  if(!row)return {costs:[],icons:[]};
  const definition=row.definition??{},costs=[];
  const values=new Map([['stamina',definition.stamina??0],['direct',definition.forceStamina??0]]);
  const present=new Set([...values].filter(([,value])=>value>0).map(([key])=>key));
  const statusType=definition.costType?.replace('ExamCostType_','');
  if(definition.costValue>0){values.set(statusType,definition.costValue);present.add(statusType);}
  const targets={Cost:'stamina',CostPenetrate:'direct',CostAggressive:'ExamCardPlayAggressive',CostFullPowerPoint:'ExamFullPowerPoint',CostLessonBuff:'ExamLessonBuff',CostParameterBuff:'ExamParameterBuff',CostParameterBuffMultiplePerTurn:'ExamParameterBuffMultiplePerTurn',CostReview:'ExamReview'};
  let costsKnown=true,growsKnown=true;const appliedGrows=[];
  // 选定附魔等级的增减已经是累计值，不再乘以附魔次数；仅合并使用消耗。
  for(const custom of reference.customizes??[]){
    if(!custom.customizeCount)continue;
    const selected=catalogState.tables.cardCustomizes.get(pair(custom.id,custom.customizeCount));
    if(!selected){costsKnown=false;growsKnown=false;continue;}
    for(const id of selected.produceCardGrowEffectIds??[]){
      const grow=catalogState.tables.cardGrows.get(id);
      if(!grow){costsKnown=false;growsKnown=false;continue;}
      appliedGrows.push(grow);
      const type=grow.effectType.replace('ProduceCardGrowEffectType_','');
      if(!type.startsWith('Cost'))continue;
      const match=type.match(/^(.*)(Add|Reduce)$/),target=match&&targets[match[1]];
      if(!target){costsKnown=false;continue;}
      values.set(target,(values.get(target)??0)+(match[2]==='Reduce'?-grow.value:grow.value));present.add(target);
    }
  }
  // 只返回资源名；状态消耗取游戏图片，其余消耗取界面图标，由 UI 解析地址。
  const addCost=(label,value,icon,kind='stamina')=>costs.push({label,value:Math.max(0,value),icon,kind});
  if(present.has('stamina'))addCost(t('体力'),values.get('stamina'),'skill-stamina.webp');
  if(present.has('direct'))addCost(t('体力'),values.get('direct'),'skill-stamina-direct.webp','direct');
  for(const type of present){
    if(type==='stamina'||type==='direct')continue;
    const icon=catalogState.abilityIcons.examIcons?.[type];
    const label={ExamParameterBuff:t('好调'),ExamParameterBuffMultiplePerTurn:t('绝好调'),ExamCardPlayAggressive:t('干劲'),ExamLessonBuff:t('集中'),ExamReview:t('好印象'),ExamFullPowerPoint:t('全力值')}[type]??t('消耗');
    addCost(label,values.get(type),icon??null,'status');
  }
  if(!costs.length)addCost(t('体力'),0,'skill-stamina.webp');
  // 先合并直接效果与效果条件；新增无关效果不应隐藏原有固定数值。
  let plays=(row.playEffects??[]).map(play=>({...play,originalId:play.produceExamEffectId}));
  for(const grow of appliedGrows){
    const kind=grow.effectType.replace('ProduceCardGrowEffectType_','');
    if(kind==='EffectAdd'){
      if(!catalogState.tables.exam.has(grow.playProduceExamEffectId)){growsKnown=false;continue;}
      plays.push({produceExamEffectId:grow.playProduceExamEffectId,originalId:grow.playProduceExamEffectId,produceExamTriggerId:grow.playEffectProduceExamTriggerId??'',hideIcon:false});
    }else if(kind==='EffectChange'){
      const targets=new Set(grow.targetPlayProduceExamEffectIds??[]);
      if(!targets.size||!catalogState.tables.exam.has(grow.playProduceExamEffectId)){growsKnown=false;continue;}
      plays=plays.map(play=>targets.has(play.produceExamEffectId)||targets.has(play.originalId)?{...play,produceExamEffectId:grow.playProduceExamEffectId}:play);
    }else if(kind==='PlayEffectTriggerChange'){
      const targets=new Set(grow.targetPlayEffectProduceExamTriggerIds??[]);
      if(!targets.size){growsKnown=false;continue;}
      plays=plays.map(play=>targets.has(play.produceExamTriggerId)?{...play,produceExamTriggerId:grow.playEffectProduceExamTriggerId??''}:play);
    }
    // PlayTriggerChange 改的是使用条件；CardStatusEnchantChange 改的是后续触发，不抹掉初始直接效果。
  }
  const fixedValue=type=>{
    if(!growsKnown)return undefined;
    const parts=[];
    for(const play of plays){
      const fixed=catalogState.tables.exam.get(play.produceExamEffectId);
      if(play.produceExamTriggerId||play.hideIcon||fixed?.effectType!==type||!(fixed.effectValue1>0))continue;
      let value=fixed.effectValue1,count=fixed.effectCount??0;
      for(const grow of appliedGrows){
        if(grow.targetPlayProduceExamEffectIds?.length&&!grow.targetPlayProduceExamEffectIds.some(id=>id===fixed.id||id===play.originalId))continue;
        const kind=grow.effectType.replace('ProduceCardGrowEffectType_',''),prefix=type==='ProduceExamEffectType_ExamLesson'?'Lesson':'Block';
        if(kind===prefix+'Add')value+=grow.value;
        if(kind===prefix+'Reduce')value-=grow.value;
        if(prefix==='Lesson'&&kind==='LessonCountAdd')count+=grow.value;
        if(prefix==='Lesson'&&kind==='LessonCountReduce')count-=grow.value;
      }
      parts.push({value:Math.max(0,value),count:Math.max(0,count)});
    }
    // 多段固定效果分别展示，避免合成单次伤害后误解集中、干劲等逐次加成。
    return parts.length===1?parts[0]:parts.length?{parts}:undefined;
  };
  const damage=fixedValue('ProduceExamEffectType_ExamLesson'),block=fixedValue('ProduceExamEffectType_ExamBlock');
  const visible=new Set(plays.filter(effect=>!effect.hideIcon).map(effect=>effect.produceExamEffectId)),icons=new Map();
  const descriptions=[...(row.descriptions??[]),...plays.flatMap(play=>catalogState.tables.exam.get(play.produceExamEffectId)?.descriptions??[])];
  for(const part of descriptions){
    const icon=catalogState.abilityIcons.examIcons?.[descriptionIconType(part)];
    if(icon&&visible.has(part.originProduceExamEffectId)&&!icons.has(icon))icons.set(icon,{image:icon,label:plainText(part.text)});
  }
  const kind={ProduceCardCategory_ActiveSkill:'a',ProduceCardCategory_MentalSkill:'m',ProduceCardCategory_Trouble:'t'}[row.category];
  const rarity=row.rarity==='ProduceCardRarity_Legend'?'lr':row.rarity?.replace('ProduceCardRarity_','').toLowerCase();
  const frame=kind==='t'?'skill-frame-t':kind&&rarity?`skill-frame-${kind}-${rarity}`:undefined;
  return {costs,costsKnown,damage,block,icons:[...icons.values()],frame};
}

export function cardRewardInfo(reference,characterId,{previewVersions=false}={}){
  const upgrades=previewVersions?[...new Set([reference.upgradeCount,0,Math.max(1,reference.upgradeCount)])].filter(upgrade=>catalogState.tables?.cards.has(pair(reference.id,upgrade))):[reference.upgradeCount];
  return {kind:'card',reference,...cardInfo(reference,characterId),description:catalogState.semantics.card(reference),
    versions:upgrades.map(upgradeCount=>{const variant={...reference,upgradeCount};return {reference:variant,...cardInfo(variant,characterId),description:catalogState.semantics.card(variant),visual:supportSkillVisual(variant)};})};
}
export function itemRewardInfo(id){
  const exam=catalogState.tables?.items.get(id)?.definition?.isExamEffect;
  return {kind:'item',use:exam===true?'battle':exam===false?'training':'unknown',...itemArt(id),description:catalogState.semantics.item(id)};
}

function cachedAbilitySummary(reference){
  syncCaches();
  const language=locale();
  if(abilitySummaryLanguage!==language){abilitySummaryLanguage=language;abilitySummaryCache.clear();}
  const key=pair(reference.id,reference.level);
  if(!abilitySummaryCache.has(key))abilitySummaryCache.set(key,summarizeAbility(catalogState.semantics.ability(reference),catalogState.abilityIcons));
  return abilitySummaryCache.get(key);
}
export function abilitySummaries(memory) {
  if(memory.abilities===undefined)return semanticGroup(memory,'abilities').entries.map(entry=>summarizeAbility(entry,catalogState.abilityIcons));
  return memory.abilities.map(cachedAbilitySummary);
}
export function abilityChoiceKey(id){return catalogState.abilityChoiceAliases.get(id)??id;}
export function abilityChoicesReady(){return catalogState.abilityChoiceAliases.size>0;}
export function abilityFilterClauses(selected){
  syncCaches();
  const groups=new Map(abilityChoiceGroups.map(([id])=>[id,[]]));
  for(const key of new Set(selectedValues(selected).map(abilityChoiceKey))){
    if(!abilityFilterGroupCache.has(key)){
      const reference=catalogState.abilityChoiceDefinitions.get(key);
      abilityFilterGroupCache.set(key,reference?abilityGroupInfo(cachedAbilitySummary(reference).description).id:'other');
    }
    groups.get(abilityFilterGroupCache.get(key)).push(key);
  }
  return [...groups.values()].filter(values=>values.length);
}

export function memoryTagName(id){return catalogState.tables?.memoryTags.get(id)?.defaultName??'';}

export function memoryExclusiveSkill(memory){
  const id=catalogState.primaryExclusiveCards.get(memory.idolCardId);
  if(!id)return null;
  const reference=memory.examBattleProduceCards?.find(card=>card.id===id)??memory.examBattleProduceCards?.find(card=>{const metadata=selectionChoiceMetadata('card',card);return metadata.source==='idol'&&metadata.ownerCharacterId===memory.characterId;})??{id,upgradeCount:0,customizes:[]};
  if(!catalogState.tables?.cards.get(pair(reference.id,reference.upgradeCount)))return null;
  const info=cardInfo(reference,memory.characterId);
  return info.image?{reference,...info}:null;
}
export function selectionPrimarySkill(memory){
  const id=catalogState.primaryExclusiveCards.get(memory.idolCardId);
  if(!id)return null;
  const reference=memory.produceCards?.find(card=>card.id===id)??{id,upgradeCount:0,customizes:[]};
  if(!catalogState.tables?.cards.get(pair(id,reference.upgradeCount)))return null;
  return {reference,...cardInfo(reference,memory.characterId)};
}
