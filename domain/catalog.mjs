import {assetURL,uiIconURL} from '../resources.mjs';
import {createAchievementCatalog,achievementDetailScope} from './achievements.mjs';
import {endingBonusReference} from './ending-bonuses.mjs';
import {descriptionIconType} from './effect-icons.mjs';
import {createCardCustomizations} from './card-customizations.mjs';
import {mergeCollection,selectedValues} from './model.mjs';
import {t,locale} from '../i18n.mjs';
import {createProgression} from './progression.mjs';
import {plainText,descriptionText} from './semantic-text.mjs';
import {summarizeAbility,abilityGroupInfo,abilityChoiceGroups} from './ability-summary.mjs';
import {createSemantics} from './semantic-model.mjs';
export {plainText} from './semantic-text.mjs';
// 偶像印象色取自 https://gkms.idolism.org/colors（2026-09-30 核对）；根緒亜紗里使用用户指定色，未列出的角色不猜色。
const characterColors={amao:'#C45DC8',atbm:'#8874FF',fktn:'#FFD203',hmsz:'#6EA3FC',hrnm:'#FD7EC2',
  hski:'#FF4F64',hume:'#F74C2C',jsna:'#FFAC28',kcna:'#FE8A22',kllj:'#D2E3E4',shro:'#00BED8',ssmk:'#92DE5A',ttmr:'#27B4EB',nasr:'#92debb'};
let tables = null;
const supportCatalogCache=new Map();
let endingBonuses={};
let achievements=createAchievementCatalog();
export const achievementCharacterIds=()=>[...achievements.characterIds].sort(compareCharacterFilters);
export const achievementCount=()=>achievements.count;
export const achievementEntries=(snapshot,view)=>achievements.entries(snapshot,view);
export function achievementViewCounts(snapshot,view){
  if(!achievements.characterIds.includes(view.achievementCharacter))return {count:achievements.count,total:achievements.count};
  // 顶部汇总两个子页签，保留奖励和状态筛选，不受当前子页签或分页影响。
  const scopes=view.achievementCharacter==='nasr'?['Produce','Other'].map(achievementCategory=>({...view,achievementCategory})):['common','card'].map(achievementScope=>({...view,achievementScope}));
  const options={achievementSection:'achievement'},sum=rows=>scopes.reduce((total,scope)=>total+achievementDetailScope(rows,scope).reduce((count,row)=>count+row.stages.length,0),0);
  return {count:sum(achievements.entries(snapshot,{...view,...options,query:'',achievementCategory:''})),total:sum(achievements.entries(snapshot,options))};
}

export const endingBonusInfo=(characterId,capturedCharacter)=>endingBonusReference(endingBonuses,characterId,capturedCharacter);
let customizeCards=createCardCustomizations();
export const cardCustomizations=reference=>customizeCards.available(reference);
let progression = createProgression();
export function progressionInfo(kind, held, target, potential) { return progression[kind](held,target,potential); }
let abilityIcons = {};
let semantics = createSemantics({});
const pair = (id, level) => JSON.stringify([id, level]);
function index(rows, secondary) {
  const map = new Map();
  for (const row of rows) {
    const key = secondary ? pair(row.id, row[secondary]) : row.id;
    if (map.has(key)) map.set(key, null);
    else map.set(key, row);
  }
  return map;
}
// 补充时间仅供排序；不改写公开目录的 viewStartTime。
// 初期夏装按同期报道核对批次，日期精度为天：
// https://ascii.jp/elem/000/004/207/4207337/
const summerReleaseDays=new Map([
  ...['amao-3-001','ssmk-3-001','hski-3-003','ttmr-3-003','fktn-3-003','kllj-3-002'].map(id=>['i_card-skin-'+id,'2024-07-01']),
  ...['hrnm-3-001','hume-3-001','kcna-3-003','shro-3-003'].map(id=>['i_card-skin-'+id,'2024-07-12']),
]);
export function skinSortTimes(skins){
  const result=new Map();
  const valid=value=>Number.isFinite(Number(value))&&Number(value)>0;
  for(const skin of skins){
    if(valid(skin.viewStartTime)){result.set(skin.id,{time:Number(skin.viewStartTime),source:'catalog'});continue;}
    const day=summerReleaseDays.get(skin.id);
    if(day&&skin.theme==='夏 · キミとセミブルー'){
      result.set(skin.id,{time:Date.parse(day+'T00:00:00+09:00'),source:'reported-batch',precision:'day',url:'https://ascii.jp/elem/000/004/207/4207337/'});continue;
    }
    // 仅对已核对的同批次条目推定，禁止从跨年份合并主题自动借用日期。
    if(skin.id==='i_card-skin-jsna-3-016'&&skin.theme==='ENDLESS DANCE'){
      const peers=skins.filter(row=>row.id!==skin.id&&row.theme===skin.theme&&valid(row.viewStartTime));
      const times=new Set(peers.map(row=>Number(row.viewStartTime)));
      if(peers.length&&times.size===1)result.set(skin.id,{time:Number(peers[0].viewStartTime),source:'same-batch',referenceIds:peers.map(row=>row.id)});
    }
  }
  return result;
}
let skinReleaseTimes=new Map();
let secondExclusiveCardIds=new Set();
let primaryExclusiveCards=new Map();
let abilityChoiceAliases=new Map(),abilityChoiceDefinitions=new Map(),abilityFilterGroupCache=new Map();
let customizeItemParents=new Map();
let customizeItemImages={};
export function installMaster(input) {
  supportCatalogCache.clear();
  endingBonuses=input.endingBonuses??{};
  achievements=createAchievementCatalog(input.achievements??{},endingBonuses,input.characters??{});
  const t = input.tables;
  const abilityGroups=new Map();abilityChoiceAliases=new Map();abilityChoiceDefinitions=new Map();abilityFilterGroupCache=new Map();
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
  customizeItemParents=new Map();
  customizeItemImages=input.customizeItemImages??{};
  for(const link of input.semantics?.tables?.ProduceCustomizeItemRelationship??[]){
    const parents=customizeItemParents.get(link.childProduceCustomizeItemId)??[];
    parents.push(link.parentProduceCustomizeItemId);customizeItemParents.set(link.childProduceCustomizeItemId,parents);
  }
  skinReleaseTimes=skinSortTimes(input.idols?.skins??[]);
  primaryExclusiveCards=new Map((input.idolCardRelations??input.progression?.tables?.IdolCard??[]).map(card=>[card.id,card.produceCardId]));
  secondExclusiveCardIds=new Set((input.idolCardRelations??input.progression?.tables?.IdolCard??[]).map(card=>card.secondProduceCardId).filter(Boolean));
  customizeCards=createCardCustomizations(t,input.semantics?.tables??{});
  abilityIcons = input.abilityIcons ?? {};
  semantics = createSemantics(t,input.semantics?.tables ?? {});
  progression = createProgression(input.progression?.tables,t,semantics);
  tables = {memoryTags:index(input.memoryTags??[]),cardCustomizes:index(input.semantics?.tables?.ProduceCardCustomize??[],'customizeCount'),cardGrows:index(input.semantics?.tables?.ProduceCardGrowEffect??[]),customizeItems:index(input.semantics?.tables?.ProduceCustomizeItem??[]),cards: index(t.ProduceCard, 'upgradeCount'), items: index(t.ProduceItem),
    abilities: index(t.MemoryAbility, 'level'), skills: index(t.ProduceSkill, 'level'),
    effects: index(t.ProduceEffect), exam: index(t.ProduceExamEffect), characters: new Map(Object.entries(input.characters ?? {})),
    triggers:index(input.semantics?.tables?.ProduceTrigger??[]), supports: index(input.supports?.cards ?? []), idols: index(input.idols?.cards ?? []), skins: index(input.idols?.skins ?? [])};
}
// 筛选按用户指定角色顺序；新增角色接在现有可培养角色之后，根緒亜紗里始终最后。
const characterFilterOrder=new Map(['hski','ttmr','fktn','hume','hmsz','jsna','kllj','ssmk','kcna','shro','hrnm','amao','atbm'].map((id,index)=>[id,index]));
export function compareCharacterFilters(a,b){
  const position=id=>id==='nasr'?Number.MAX_SAFE_INTEGER:characterFilterOrder.get(id)??characterFilterOrder.size;
  return position(a)-position(b)||(tables?.characters.get(a)??a).localeCompare(tables?.characters.get(b)??b,'ja')||a.localeCompare(b);
}
export function characterInfo(id) {
  const name = tables?.characters.get(id);
  return name ? {name, color:characterColors[id], face: `img_sd_${id}_face-00.webp`, portrait: id==='nasr'?undefined:`img_chr_${id}_00-full.webp`,signature:id==='nasr'?undefined:`img_general_sign_${id}_00.webp`} : {name: t('未解析角色')};
}
export function cardInfo(card, characterId) {
  if (card === undefined) return {name: t('未记录'), lines: []};
  if (card === null) return {name: t('无继承卡'), lines: []};
  const row = tables?.cards.get(pair(card.id, card.upgradeCount));
  const description = semantics.card(card);
  const lines = description.lines;
  const categories = {ProduceCardCategory_ActiveSkill: 'Active', ProduceCardCategory_MentalSkill: 'Mental', ProduceCardCategory_Trouble: 'Trouble'};
  const image = row?.isCharacterAsset ? row.images?.[characterId] : row?.images?.common;
  return {name: plainText(row?.name) || t('未解析技能卡'), lines, image,
    rarity: row?.rarity?.replace('ProduceCardRarity_', '') ?? '',
    category: categories[row?.category] ?? '', upgrade: card.upgradeCount,
    customizes: card.customizes.reduce((sum, c) => sum + c.customizeCount, 0)};
}
export function abilityInfo(ability) {
  const description = semantics.ability(ability);
  return [description.heading,...description.lines].join('\n');
}
export function semanticGroup(memory, field) { return semantics.group(memory,field); }
// 专属项优先使用所属偶像卡主流派；其它项按结构化效果归类，可多归属，不从名称猜测。
export const selectionFlowDefinitions=[
  {id:'parameter',label:'好调',prefixes:['ExamParameterBuff']},
  {id:'lesson',label:'集中',prefixes:['ExamLessonBuff']},
  {id:'aggressive',label:'干劲',prefixes:['ExamCardPlayAggressive','ExamAggressive']},
  {id:'review',label:'好印象',prefixes:['ExamReview']},
  {id:'concentration',label:'强气／温存',prefixes:['ExamConcentration']},
  {id:'fullPower',label:'全力',prefixes:['ExamFullPower']},
];
export function selectionChoiceMetadata(kind,reference){
  const row=kind==='card'?tables?.cards.get(pair(reference.id,reference.upgradeCount)):tables?.items.get(reference.id);
  const definition=row?.definition??{},types=(row?.descriptions??[]).map(part=>part.examEffectType?.replace('ProduceExamEffectType_','')).filter(Boolean);
  const owner=tables?.idols.get(definition.originIdolCardId||definition.originPrimaStellaIdolCardId);
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
  return {ownerCharacterId:owner?.characterId,use:definition.isExamEffect===true?'battle':definition.isExamEffect===false?'training':'unknown',secondExclusive:kind==='card'&&secondExclusiveCardIds.has(reference.id),source:!row?'unknown':definition.originIdolCardId||definition.originPrimaStellaIdolCardId?'idol':definition.originSupportCardId?'support':'common',plan,rarity:(definition.rarity??row?.rarity??'').replace(/^Produce(?:Card|Item)Rarity_/,'').toUpperCase(),
    flows:ownerFlows.length?ownerFlows:selectionFlowDefinitions.filter(flow=>involved.has(flow.id)).map(flow=>flow.id)};
}
// 组合 ID 精确匹配完整成品说明，不拆分 ID 或叠加部件效果。
export function customizeItemInfo(id){
  const row=tables?.customizeItems.get(id);
  if(!row)return {resolved:false,id,name:t('未解析附魔道具'),images:[],parents:[]};
  return {resolved:true,id,name:plainText(row.name),use:row.effectType==='ProduceItemEffectType_ProduceEffect'?'training':row.effectType==='ProduceItemEffectType_ProduceExamEffect'?'battle':'unknown',image:customizeItemImages[id],descriptionParts:row.produceDescriptions,
    text:descriptionText(row.produceDescriptions,undefined,true).text,
    effectIds:row.produceEffectIds??[],examEffectIds:row.produceExamEffectIds??[],
    triggerLimit:row.produceEffectTriggerCount,examLimit:row.examEffectCount,
    images:[1,2,3,4,5].map(layer=>row[`assetId${layer}`]).filter(Boolean).map(asset=>asset+'.webp'),
    parents:(customizeItemParents.get(id)??[]).map(parent=>({id:parent,name:plainText(tables.customizeItems.get(parent)?.name)||parent}))};
}
export function itemArt(id) {
  const row = tables?.items.get(id);
  return {name: plainText(row?.name) || t('未解析 P 道具'), image: row?.image, upgraded: row?.isUpgraded === true,
    background:row?.definition?.rarity?.replace('ProduceItemRarity_','').toLowerCase()};
}
export function idolInfo(held) {
  const card = tables?.idols.get(held.idolCardId);
  if (!card) return {name: t('未解析偶像卡'), character: t('角色未解析'), cardResolved: false, skinResolved: false, variant: 'unresolved', label: t('公开目录未收录')};
  const info = {name: plainText(card.name), character: characterInfo(card.characterId).name,
    characterResolved: tables.characters.has(card.characterId),
    characterId: card.characterId, plan: card.planType?.replace('ProducePlanType_',''), rarity: card.rarity.replace(/^IdolCardRarity_/, '').toUpperCase(),
    examEffectType:card.examEffectType, rarityEnum: card.rarity, cardResolved: true, skinResolved: true};
  const skin = held.idolCardSkinId ? tables.skins.get(held.idolCardSkinId) : null;
  if (held.idolCardSkinId && (!skin || skin.idolCardId !== card.id)) {
    return {...info, skinResolved: false, variant: 'unresolved', label: t('所选卡面未解析或所属偶像卡不匹配')};
  }
  const alternate = skin && skin.assetId !== card.assetId;
  const upgraded = !alternate && held.levelLimitRank >= 3;
  const variant = alternate ? 'alternate' : upgraded ? 'upgraded' : 'base';
  return {...info, variant, image: `img_general_${alternate ? skin.assetId : card.assetId}_${upgraded ? 1 : 0}-full.webp`,
    label: alternate ? t('所选替换卡面') : upgraded ? t('强化后卡面') : t('默认卡面')};
}
export function idolArtVariants(held) {
  const card=tables?.idols.get(held.idolCardId);
  if(!card)return [];
  const result=progressionInfo('idol',held);
  const variants=[{id:'base',image:`img_general_${card.assetId}_0-full.webp`,label:t('突破前卡面')}];
  if(result?.illustrationRank!==undefined)variants.push({id:'upgraded',image:`img_general_${card.assetId}_1-full.webp`,
    label:t('突破后卡面'),unlockRank:result.illustrationRank});
  const selected=idolInfo(held);
  if(selected.variant==='alternate')variants.push({id:'alternate',image:selected.image,label:t('所选替换卡面')});
  return variants;
}
// 数值缺失和未持有条目始终置后；同值保持当前目录／快照顺序。
export function sortCollectionEntries(entries,mode,kind,{ownedFirst=false}={}){
  const rarity={R:1,SR:2,SSR:3},plans={Plan1:0,Plan2:1,Plan3:2,Common:3};
  const number=(a,b,ascending=false)=>{
    const av=Number.isFinite(a),bv=Number.isFinite(b);
    return av!==bv?(av?-1:1):av?(ascending?a-b:b-a):0;
  };
  const actual=(entry,key)=>isReference(entry.held)?undefined:entry.held[key];
  const characters=entry=>(entry.info.characterIds??[entry.info.characterId]).filter(Boolean).sort(compareCharacterFilters);
  const compareCharacters=(a,b)=>{
    const aa=characters(a),bb=characters(b);
    if(!aa.length||!bb.length)return aa.length?-1:bb.length?1:0;
    for(let i=0;i<Math.min(aa.length,bb.length);i++){const order=compareCharacterFilters(aa[i],bb[i]);if(order)return order;}
    return aa.length-bb.length;
  };
  const gap=new Map();
  if(mode==='levelGap')for(const entry of entries){
    if(isReference(entry.held))continue;
    const model=progressionInfo('support',entry.held),limit=model?.levelLimits.find(row=>row.rank===entry.held.levelLimitRank)?.level;
    if(Number.isFinite(limit)&&Number.isFinite(entry.held.level))gap.set(entry,Math.max(0,limit-entry.held.level));
  }
  return [...entries].sort((a,b)=>{
    const ownership=ownedFirst?Number(b.held.ownership==='owned')-Number(a.held.ownership==='owned'):0;
    if(ownership)return ownership;
    let order=0;
    switch(mode){
      case 'rarity':order=number(rarity[a.info.rarity],rarity[b.info.rarity]);break;
      case 'level':case 'levelAsc':order=number(actual(a,kind==='idolCards'?'levelLimitRank':'level'),actual(b,kind==='idolCards'?'levelLimitRank':'level'),mode==='levelAsc');break;
      case 'potential':case 'potentialAsc':order=number(actual(a,'potentialRank'),actual(b,'potentialRank'),mode==='potentialAsc');break;
      case 'rank':case 'rankAsc':order=number(actual(a,'levelLimitRank'),actual(b,'levelLimitRank'),mode==='rankAsc');break;
      case 'levelGap':order=number(gap.get(a),gap.get(b));break;
      case 'character':order=compareCharacters(a,b);break;
      case 'name':order=(a.info.theme||a.info.name).localeCompare(b.info.theme||b.info.name,'ja');break;
      case 'plan':order=number(plans[a.info.plan],plans[b.info.plan],true)||number(rarity[a.info.rarity],rarity[b.info.rarity])||compareCharacters(a,b);break;
      case 'type':{
        const types={Vocal:0,Dance:1,Visual:2,[t('辅助')]:3};
        order=number(types[a.info.type],types[b.info.type],true)||number(rarity[a.info.rarity],rarity[b.info.rarity])||number(actual(a,'level'),actual(b,'level'));break;
      }
      case 'theme':order=number(a.info.themeStartTime,b.info.themeStartTime,true)||(a.info.theme||'').localeCompare(b.info.theme||'','ja')||compareCharacters(a,b);break;
      case 'release':case 'releaseAsc':order=number(a.info.sortReleaseTime??a.info.viewStartTime,b.info.sortReleaseTime??b.info.viewStartTime,mode==='releaseAsc');break;
    }
    return order||(a.ordinal??0)-(b.ordinal??0);
  });
}
export function sortIdolEntries(entries,mode,options={}){return sortCollectionEntries(entries,mode,'idolCards',options);}

export function supportSkillVisual(reference){
  const row=tables?.cards.get(pair(reference.id,reference.upgradeCount));
  if(!row)return {costs:[],icons:[]};
  const definition=row.definition??{},costs=[];
  const values=new Map([['stamina',definition.stamina??0],['direct',definition.forceStamina??0]]);
  const present=new Set([...values].filter(([,value])=>value>0).map(([key])=>key));
  const statusType=definition.costType?.replace('ExamCostType_','');
  if(definition.costValue>0){values.set(statusType,definition.costValue);present.add(statusType);}
  const targets={Cost:'stamina',CostPenetrate:'direct',CostAggressive:'ExamCardPlayAggressive',CostFullPowerPoint:'ExamFullPowerPoint',CostLessonBuff:'ExamLessonBuff',CostParameterBuff:'ExamParameterBuff',CostParameterBuffMultiplePerTurn:'ExamParameterBuffMultiplePerTurn',CostReview:'ExamReview'};
  let costsKnown=true;
  // 选定附魔等级的增减已经是累计值，不再乘以附魔次数；仅合并使用消耗。
  for(const custom of reference.customizes??[]){
    if(!custom.customizeCount)continue;
    const selected=tables.cardCustomizes.get(pair(custom.id,custom.customizeCount));
    if(!selected){costsKnown=false;continue;}
    for(const id of selected.produceCardGrowEffectIds??[]){
      const grow=tables.cardGrows.get(id);
      if(!grow){costsKnown=false;continue;}
      const type=grow.effectType.replace('ProduceCardGrowEffectType_','');
      if(!type.startsWith('Cost'))continue;
      const match=type.match(/^(.*)(Add|Reduce)$/),target=match&&targets[match[1]];
      if(!target){costsKnown=false;continue;}
      values.set(target,(values.get(target)??0)+(match[2]==='Reduce'?-grow.value:grow.value));present.add(target);
    }
  }
  const addCost=(label,value,icon,kind='stamina')=>costs.push({label,value:Math.max(0,value),icon,kind});
  if(present.has('stamina'))addCost(t('体力'),values.get('stamina'),uiIconURL('skill-stamina.webp'));
  if(present.has('direct'))addCost(t('直接消耗体力（无法用元气抵消）'),values.get('direct'),uiIconURL('skill-stamina-direct.webp'),'direct');
  for(const type of present){
    if(type==='stamina'||type==='direct')continue;
    const icon=abilityIcons.examIcons?.[type];
    const label={ExamParameterBuff:t('好调'),ExamParameterBuffMultiplePerTurn:t('绝好调'),ExamCardPlayAggressive:t('干劲'),ExamLessonBuff:t('集中'),ExamReview:t('好印象'),ExamFullPowerPoint:t('全力值')}[type]??t('消耗');
    addCost(label,values.get(type),icon?assetURL(icon):null,'status');
  }
  if(!costs.length)addCost(t('体力'),0,uiIconURL('skill-stamina.webp'));
  // 使用条件不等于效果触发条件；只显示使用后直接生效的定值参数提升与元气。
  const fixedEffects=(row.playEffects??[]).filter(play=>!play.produceExamTriggerId&&!play.hideIcon)
    .map(play=>tables.exam.get(play.produceExamEffectId));
  const fixedValue=type=>{
    const effects=fixedEffects.filter(effect=>effect?.effectType===type&&effect.effectValue1>0);
    const fixed=effects.length===1&&!reference.customizes?.some(custom=>custom.customizeCount>0)?effects[0]:null;
    return fixed?{value:fixed.effectValue1,count:fixed.effectCount}:undefined;
  };
  const damage=fixedValue('ProduceExamEffectType_ExamLesson'),block=fixedValue('ProduceExamEffectType_ExamBlock');
  const visible=new Set((row.playEffects??[]).filter(effect=>!effect.hideIcon).map(effect=>effect.produceExamEffectId));
  const icons=new Map();
  for(const part of row.descriptions??[]){
    const icon=abilityIcons.examIcons?.[descriptionIconType(part)];
    if(icon&&visible.has(part.originProduceExamEffectId)&&!icons.has(icon))icons.set(icon,{image:icon,label:plainText(part.text)});
  }
  const kind={ProduceCardCategory_ActiveSkill:'a',ProduceCardCategory_MentalSkill:'m',ProduceCardCategory_Trouble:'t'}[row.category];
  const rarity=row.rarity==='ProduceCardRarity_Legend'?'lr':row.rarity?.replace('ProduceCardRarity_','').toLowerCase();
  const frame=kind==='t'?'skill-frame-t':kind&&rarity?`skill-frame-${kind}-${rarity}`:undefined;
  return {costs,costsKnown,damage,block,icons:[...icons.values()],frame};
}

export function cardRewardInfo(reference,characterId,{previewVersions=false}={}){
  const upgrades=previewVersions?[...new Set([reference.upgradeCount,0,Math.max(1,reference.upgradeCount)])].filter(upgrade=>tables?.cards.has(pair(reference.id,upgrade))):[reference.upgradeCount];
  return {kind:'card',reference,...cardInfo(reference,characterId),description:semantics.card(reference),
    versions:upgrades.map(upgradeCount=>{const variant={...reference,upgradeCount};return {reference:variant,...cardInfo(variant,characterId),description:semantics.card(variant),visual:supportSkillVisual(variant)};})};
}
export function itemRewardInfo(id){
  const exam=tables?.items.get(id)?.definition?.isExamEffect;
  return {kind:'item',use:exam===true?'battle':exam===false?'training':'unknown',...itemArt(id),description:semantics.item(id)};
}

export function supportInfo(held) {
  const key=JSON.stringify([locale(),held.supportCardId]);
  if(!supportCatalogCache.has(key))supportCatalogCache.set(key,describeSupport(held));
  return supportCatalogCache.get(key);
}
// 仅使用本次阵容的记录等级和明确归属的专属奖励，不借用当前库存等级。
export function selectionSupportRewards(detail){
  if(!detail)return null;
  const rewards=new Map();
  for(const slot of detail.supportCards){
    const support=tables?.supports.get(slot.supportCardId);
    for(const event of support?.events??[]){
      if(event.unlockLevel>slot.level)continue;
      for(const effectId of event.effectIds){
        for(const reward of tables.effects.get(effectId)?.definition?.produceRewards??[]){
          const kind=reward.resourceType==='ProduceResourceType_ProduceCard'?'cards':reward.resourceType==='ProduceResourceType_ProduceItem'?'items':null;
          if(!kind)continue;
          const value=kind==='cards'?{id:reward.resourceId,upgradeCount:reward.resourceLevel??0,customizes:[]}:{id:reward.resourceId};
          const row=kind==='cards'?tables.cards.get(pair(value.id,value.upgradeCount)):tables.items.get(value.id);
          if(row?.definition?.originSupportCardId!==slot.supportCardId)continue;
          rewards.set(JSON.stringify([kind,value.id]),{kind,value,plan:row.definition.planType?.replace('ProducePlanType_','')});
        }
      }
    }
  }
  return [...rewards.values()];
}
function describeSupport(held) {
  const card = tables?.supports.get(held.supportCardId);
  if (!card) return {name:t('未解析支援卡'), rarity:t('未知'), type:t('未知'), characters:t('目录未收录')};
  const types = {Vocal:'Vocal', Dance:'Dance', Visual:'Visual', Assist:t('辅助')};
  return {name:plainText(card.name), rarity:card.rarity.replace('SupportCardRarity_', '').toUpperCase(),
    type:types[card.type.replace('SupportCardType_', '')] ?? t('未知'),
    characterIds:card.characterIds,characters:card.characterIds.map(id=>characterInfo(id).name).join(' · '),
    image:`img_general_${card.assetId}_full.webp`,plan:card.planType?.replace('ProducePlanType_',''),
    supportChance:card.produceCardUpgradePermil/10,
    supportAttribute:card.produceCardUpgradeLessonParameterType?.replace('ProduceParameterType_',''),
    events:(card.events??[]).map(event=>({...event,text:descriptionText(event.descriptions,undefined,true).text,
      rewards:event.effectIds.flatMap(id=>tables.effects.get(id)?.definition?.produceRewards??[]).flatMap(reward=>{
        if(reward.resourceType==='ProduceResourceType_ProduceCard'){
          const reference={id:reward.resourceId,upgradeCount:reward.resourceLevel??0,customizes:[]};
          const versions=[0,1].filter(upgradeCount=>tables.cards.has(pair(reference.id,upgradeCount))).map(upgradeCount=>{
            const variant={...reference,upgradeCount};
            return {reference:variant,...cardInfo(variant,card.characterIds[0]),description:semantics.card(variant),visual:supportSkillVisual(variant)};
          });
          return [{kind:'card',...cardInfo(reference,card.characterIds[0]),description:semantics.card(reference),versions}];
        }
        if(reward.resourceType==='ProduceResourceType_ProduceItem'){
          return [itemRewardInfo(reward.resourceId)];
        }
        return [];
      })}))};
}

export function abilitySummaries(memory) {
  return semanticGroup(memory, 'abilities').entries.map(entry => summarizeAbility(entry, abilityIcons));
}
export function abilityChoiceKey(id){return abilityChoiceAliases.get(id)??id;}
export function abilityChoicesReady(){return abilityChoiceAliases.size>0;}
export function abilityFilterClauses(selected){
  const groups=new Map(abilityChoiceGroups.map(([id])=>[id,[]]));
  for(const key of new Set(selectedValues(selected).map(abilityChoiceKey))){
    if(!abilityFilterGroupCache.has(key)){
      const reference=abilityChoiceDefinitions.get(key);
      abilityFilterGroupCache.set(key,reference?abilityGroupInfo(semantics.ability(reference)).id:'other');
    }
    groups.get(abilityFilterGroupCache.get(key)).push(key);
  }
  return [...groups.values()].filter(values=>values.length);
}

export function supportEffectKinds(effect){return (effect.beforeEffects??[]).map(id=>tables?.effects.get(id)?.produceEffectType?.replace('ProduceEffectType_','')).filter(Boolean);}
export function supportEffectPhases(effect){return (effect.beforeTriggers??[]).map(id=>tables?.triggers.get(id)?.phaseType?.replace('ProducePhaseType_','')).filter(Boolean).map(phase=>phase==='EndLessonBeforePresent'?'EndLesson':phase);}

export function collectionRecords(snapshot,field,mode='owned') {
  const catalog=field==='idolCards'?tables?.idols:field==='idolCardSkins'?tables?.skins:tables?.supports;
  const rows=mergeCollection(snapshot?.[field],catalog?[...catalog.values()]:[],field,mode);
  return field==='idolCardSkins'?rows.filter(row=>{
    const skin=catalog?.get(row.idolCardSkinId);
    return !skin||Boolean(skin.theme||skin.name);
  }):rows;
}
export function ownershipLabel(row){return t(row.ownership==='unowned'?'未持有':row.ownership==='unknown'?'持有情况未采集':'已拥有');}
export function isReference(row){return row.ownership==='unowned'||row.ownership==='unknown';}

export function skinInfo(held){
  const skin=tables?.skins.get(held.idolCardSkinId),card=tables?.idols.get(skin?.idolCardId);
  return {name:plainText(skin?.name)||(skin?.theme?plainText(card?.name):t('基础装扮')),theme:skin?.theme||skin?.name||'',themeAliases:skin?.themeAliases??[],themeStartTime:skin?.themeStartTime,viewStartTime:skin?.viewStartTime&&Number(skin.viewStartTime)>0?Number(skin.viewStartTime):undefined,
    characterId:card?.characterId,character:characterInfo(card?.characterId).name,
    cardName:plainText(card?.name)||t('未解析偶像卡'),idolCardId:skin?.idolCardId,
    image:skin?`img_general_${skin.assetId}_0-full.webp`:undefined,
    sortReleaseTime:skinReleaseTimes.get(skin?.id)?.time,releaseTimeSource:skinReleaseTimes.get(skin?.id),
    hasIdolArt:Boolean(skin&&card&&skin.assetId===card.assetId),
    resolved:Boolean(skin)};
}

export function skinThemeNames(skins){
  const themes=new Map(skins.filter(info=>info.theme).map(info=>[info.theme,info]));
  return [...themes.values()].sort((a,b)=>(a.themeStartTime??Infinity)-(b.themeStartTime??Infinity)||a.theme.localeCompare(b.theme,'ja')).map(info=>info.theme);
}

export function planLabel(value){
  const names={2:'Sense',3:'Logic',4:'Anomaly',Plan1:'Sense',Plan2:'Logic',Plan3:'Anomaly'};
  return t(names[value]??'计划 {0}',[value]);
}

export function memoryTagName(id){return tables?.memoryTags.get(id)?.defaultName??'';}

export function memoryExclusiveSkill(memory){
  const id=primaryExclusiveCards.get(memory.idolCardId);
  if(!id)return null;
  const reference=memory.examBattleProduceCards?.find(card=>card.id===id)??memory.examBattleProduceCards?.find(card=>{const metadata=selectionChoiceMetadata('card',card);return metadata.source==='idol'&&metadata.ownerCharacterId===memory.characterId;})??{id,upgradeCount:0,customizes:[]};
  if(!tables?.cards.get(pair(reference.id,reference.upgradeCount)))return null;
  const info=cardInfo(reference,memory.characterId);
  return info.image?{reference,...info}:null;
}
export function selectionPrimarySkill(memory){
  const id=primaryExclusiveCards.get(memory.idolCardId);
  if(!id)return null;
  const reference=memory.produceCards?.find(card=>card.id===id)??{id,upgradeCount:0,customizes:[]};
  if(!tables?.cards.get(pair(id,reference.upgradeCount)))return null;
  return {reference,...cardInfo(reference,memory.characterId)};
}

export function recordedProduceSkillInfo(reference){
  const row=tables?.skills.get(pair(reference.id,reference.level));
  if(!row)return {text:t('效果说明未收录'),descriptionParts:[],effectIds:[]};
  return {text:descriptionText(row.descriptions).text,descriptionParts:row.descriptions,effectIds:[1,2,3].map(index=>row[`produceEffectId${index}`]).filter(Boolean)};
}
