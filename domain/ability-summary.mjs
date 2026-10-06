import {plainText} from './semantic-text.mjs';

const kinds = {
  VocalAddition: ['初期 Vo', 'flat'], DanceAddition: ['初期 Da', 'flat'], VisualAddition: ['初期 Vi', 'flat'],
  VocalGrowthRateAddition: ['Vo 加成', 'percent'], DanceGrowthRateAddition: ['Da 加成', 'percent'], VisualGrowthRateAddition: ['Vi 加成', 'percent'],
  ProducePointAdditionDisableTrigger: ['初期 P', 'flat'], StaminaRecoverFix: ['体力回复', 'flat'],
};
const initialTriggers = new Set(['p_trigger-produce_start', 'p_trigger-produce_start-initial', 'p_trigger-produce_start-no_description']);
const numericText = value => /^[+−-]?\d+(?:\.\d+)?(?:%|ターン)?$/.test(value);

export function iconForEffect(effect, catalog) {
  const resource = effect?.definition?.produceResourceType ?? 'ProduceResourceType_Unknown';
  let matches = (catalog.effects ?? []).filter(row => row.type === effect?.produceEffectType && row.resourceType === resource);
  // 换卡图标在公开表中按通用资源类型登记，技能卡资源是作用目标。
  if(!matches.length&&effect?.produceEffectType==='ProduceEffectType_ProduceCardChange'){
    matches=(catalog.effects??[]).filter(row=>row.type===effect.produceEffectType&&row.resourceType==='ProduceResourceType_Unknown');
  }
  if (matches.length !== 1) return {};
  return {icon: matches[0].iconAssetId + '.webp', background: matches[0].backgroundAssetId + '.webp'};
}
export function summarizeAbility(description, catalog = {}) {
  const fullText = [description.heading, ...description.lines].join('\n');
  const base = {label: '能力', value: '详情', context: '展开查看', fullText, description, fallback: true};
  const {skill, slots = [], mapping} = description.technical ?? {};
  if (slots.length !== 1 || !slots[0].effect || !skill) return base;
  const slot = slots[0], effect = slot.effect;
  const kind = effect.produceEffectType.replace('ProduceEffectType_', '');
  const images = iconForEffect(effect, catalog);
  const restricted = mapping?.definition?.produceGroupIds?.length || mapping?.definition?.isUniqueActivation;
  const initial = initialTriggers.has(slot.triggerId) && slot.trigger?.phaseType === 'ProducePhaseType_ProduceStart' && !restricted;
  const probability = slot.activationRatePermil > 0 && slot.activationRatePermil <= 1000 ? `${slot.activationRatePermil / 10}%` : '';
  const context = probability ? `${probability} · 条件` : initial ? '' : '有条件';
  const valueRange = effect.effectValueMin !== effect.effectValueMax;
  if (kinds[kind] && !valueRange) {
    const [label, unit] = kinds[kind];
    // 数值采用完整源节点；百分比只接受已经带单位的文本，不猜测缩放倍率。
    const values = (skill.descriptions ?? []).filter(part => part.produceDescriptionType === 'ProduceDescriptionType_DiffText')
      .map(part => plainText(part.text ?? '').trim()).filter(numericText);
    if (values.length !== 1 || (unit === 'percent') !== values[0].endsWith('%')) return {...base, ...images, label};
    const value = /^[+−-]/.test(values[0]) ? values[0] : '+' + values[0];
    return {...base, ...images, label, value, context, fallback: false};
  }
  if (kind === 'ExamStatusEnchant') {
    const parts = skill.descriptions ?? [];
    const effects = parts.filter(p => ['ProduceDescriptionType_ProduceExamEffectType', 'ProduceDescriptionType_ProduceCardGrowEffectType'].includes(p.produceDescriptionType));
    if (effects.length !== 1) return {...base, ...images, label: '考试效果', context: probability ? `${probability} · 详情` : '复杂效果'};
    const node = effects[0], label = plainText(node.text ?? '').trim();
    const at = parts.indexOf(node);
    const tail = parts.slice(at + 1).filter(p => p.originProduceExamEffectId && p.originProduceExamEffectId === node.originProduceExamEffectId);
    const value = plainText(tail.map(p => p.text ?? '').join('')).replace(/\s/g, '');
    const examType = node.examEffectType?.replace('ProduceExamEffectType_', '') ??
      (node.produceCardGrowEffectType === 'ProduceCardGrowEffectType_LessonAdd' ? 'ExamLesson' : null);
    const examImage = catalog.examIcons?.[examType];
    const specificImage = examImage ? {icon: examImage, background: undefined, exam: true} : images;
    // 附加考试效果外层通常是零，必须从同一效果的说明片段读取数值。
    if (label && (numericText(value) || value === 'に変更')) {
      return {...base, ...specificImage, label, value: value === 'に変更' ? '切换' : value, context: context || '有条件', fallback: false};
    }
    return {...base, ...specificImage, label: label || '考试效果', context: probability ? `${probability} · 详情` : '有条件'};
  }
  return {...base, ...images};
}

// 仅重排显示副本；HIF 限定优先归入末组，同组同属性保留采集顺序。
export function sortedAbilitySummaries(items){
  const key=item=>{
    const {skill,slots=[]}=item.description.technical??{};
    if(skill?.definition?.produceType==='ProduceType_HatsuboshiIdolFestival'||skill?.descriptions?.some(part=>part.targetId==='Label_ProduceType_HatsuboshiIdolFestival'))return [4,0];
    if(slots.length!==1)return [3,0];
    const slot=slots[0],type=slot.effect?.produceEffectType??'';
    const attribute=type.match(/^ProduceEffectType_(Vocal|Dance|Visual)(Addition|GrowthRateAddition)$/);
    if(attribute&&(attribute[2]==='GrowthRateAddition'||initialTriggers.has(slot.triggerId)))return [0,['Vocal','Dance','Visual'].indexOf(attribute[1])];
    if(/^ProduceEffectType_ProducePointAddition/.test(type))return [1,0];
    if(type==='ProduceEffectType_StaminaRecoverFix')return [2,0];
    return [3,0];
  };
  return items.map(item=>({item,key:key(item)})).sort((a,b)=>a.key[0]-b.key[0]||a.key[1]-b.key[1]).map(entry=>entry.item);
}

export const abilityChoiceGroups=[['vocal','Vo'],['dance','Da'],['visual','Vi'],['points','P 点'],['hif','HIF 技能卡'],['other','其他']];
// 选择窗口与筛选匹配共用分组，数值取结构化效果，不从条件文字猜测。
export function abilityGroupInfo(description){
  const {skill,slots=[]}=description.technical??{},parts=skill?.descriptions??[];
  const hif=skill?.definition?.produceType==='ProduceType_HatsuboshiIdolFestival'||parts.some(part=>part.targetId==='Label_ProduceType_HatsuboshiIdolFestival');
  const triggerCard=parts.some((part,index)=>part.produceDescriptionType==='ProduceDescriptionType_ProduceCard'&&/^使用後/.test(parts[index+1]?.text??''));
  const slot=slots.length===1?slots[0]:null,effect=slot?.effect,type=effect?.produceEffectType??'';
  const attribute=type.match(/^ProduceEffectType_(Vocal|Dance|Visual)(Addition|GrowthRateAddition)$/);
  const amount=effect?.effectValueMin,numeric=Number.isFinite(amount)&&amount===effect.effectValueMax;
  const group=hif&&triggerCard?4:numeric&&attribute&&(attribute[2]==='GrowthRateAddition'||initialTriggers.has(slot.triggerId))?['Vocal','Dance','Visual'].indexOf(attribute[1]):numeric&&/^ProduceEffectType_ProducePointAddition/.test(type)?3:5;
  return {id:abilityChoiceGroups[group][0],kind:attribute?.[2]==='GrowthRateAddition'?1:0,amount};
}
export function groupedAbilityChoices(values,language='ja'){
  const groups=abilityChoiceGroups.map(([id,label])=>({id,label,values:[]}));
  for(const value of values){const info=abilityGroupInfo(value.summary.description);groups.find(group=>group.id===info.id).values.push({value,...info});}
  const rank=(values,value)=>{const index=values.indexOf(value);return index<0?values.length:index;};
  const hifCompare=(a,b)=>{const x=a.hifSort??{},y=b.hifSort??{};return rank(['Plan1','Plan2','Plan3','Common'],x.plan)-rank(['Plan1','Plan2','Plan3','Common'],y.plan)||Number((x.effects??'').split('|').includes('CardRemoveSleepiness'))-Number((y.effects??'').split('|').includes('CardRemoveSleepiness'))||(x.effects||a.text).localeCompare(y.effects||b.text,language)||rank(['LEGEND','SSR','SR','R','N'],x.rarity)-rank(['LEGEND','SSR','SR','R','N'],y.rarity)||a.text.localeCompare(b.text,language);};
  return groups.filter(group=>group.values.length).map(group=>({...group,values:group.values.sort((a,b)=>
    ['vocal','dance','visual'].includes(group.id)?a.kind-b.kind||b.amount-a.amount:group.id==='points'?b.amount-a.amount:group.id==='hif'?hifCompare(a.value,b.value):a.value.text.localeCompare(b.value.text,language)
  ).map(entry=>entry.value)}));
}
