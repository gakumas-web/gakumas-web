import {assetURL,uiIconURL,imageLoading} from '../resources.mjs';
import {el} from './dom.mjs';
import {watchImage} from './image-loading.mjs';
import {t} from '../i18n.mjs';
import {cardInfo, itemArt, characterInfo, supportSkillVisual} from '../domain/catalog.mjs';

function node(tag, text, className = '') {
  const element = document.createElement(tag); element.textContent = text; element.className = className;
  return element;
}
export function illustration(filename, label, variant = '', {characterId,fullResolution=false} = {}) {
  const frame = node('span', '', `illustration ${variant}`);
  frame.title = label;
  const fallback = node('span', filename ? t('插图载入中') : t('未解析插图'), 'art-fallback');
  const face=characterId?characterInfo(characterId).face:null;
  if(face&&face!==filename){
    fallback.classList.add('character-image-fallback');fallback.setAttribute('role','img');fallback.setAttribute('aria-label',label);
    const text=node('span',fallback.textContent),icon=document.createElement('img');
    icon.className='character-fallback-icon';icon.alt='';icon.width=32;icon.height=32;icon.hidden=true;
    watchImage(icon,()=>{if(icon.src.endsWith('/ui-icons/unavailable.svg')){icon.hidden=true;return;}text.hidden=true;},()=>{text.hidden=false;});
    icon.src=assetURL(face);fallback.replaceChildren(icon,text);
  }
  if (filename) {
    const image = document.createElement('img'); image.alt = label;
    image.hidden=true;image.width = variant === 'portrait' ? 112 : 128; image.height = variant === 'portrait' ? 160 : 128; image.loading = imageLoading(); image.decoding = 'async';
    watchImage(image,()=>{if(image.src.endsWith('/ui-icons/unavailable.svg')){image.hidden=true;fallback.hidden=false;return;}fallback.hidden=true;},willRetry=>{fallback.hidden=false;const text=fallback.querySelector('span')??fallback;text.textContent=t(willRetry?'插图暂不可用，稍后自动重试':'插图暂不可用');});
    image.src = assetURL(filename,!fullResolution&&!variant.includes('full')); frame.append(image);
  }
  frame.append(fallback);return frame;
}
export function characterAccent(element,id){
  const color=characterInfo(id).color;
  if(color){element.style.setProperty('--character-color',color);element.classList.add('character-accent');}
  return element;
}
export function characterArt(id, portrait = false, {fullResolution=false} = {}) {
  const c = characterInfo(id);
  return characterAccent(illustration(portrait ? c.portrait : c.face, t("{0} · 角色插图（非回忆照片）",[c.name]), portrait ? 'portrait' : 'face',{characterId:id,fullResolution}),id);
}
export function skillArt(card, characterId, compact = false, showRarity = false) {
  const info = cardInfo(card, characterId);
  const frame = node('div', '', compact ? 'skill-tile compact' : 'skill-tile');
  if(showRarity){
    const rarity=info.rarity?.toUpperCase()||'UNKNOWN';frame.dataset.rarity=rarity;
    const badge=node('span',rarity==='UNKNOWN'?t('未知'):rarity,'skill-rarity');
    badge.setAttribute('aria-label',`${t('稀有度')} ${badge.textContent}`);frame.append(badge);
  }
  frame.append(skillThumbnailFor(card,characterId,{compact}));
  const badges = node('span', '', 'art-badges');
  if (info.upgrade !== undefined) badges.append(node('span', `+${info.upgrade}`));
  if (info.customizes) badges.append(node('span', t("自定义 {0}",[info.customizes])));
  frame.append(badges);
  if (!compact) {
    frame.append(node('span', info.name, 'art-name'), node('span', [info.rarity?.toUpperCase(), info.category].filter(Boolean).join(' · '), 'small muted'));
  }
  frame.title = t("{0} · {1} · 强化 +{2} · 自定义 {3}",[info.name,info.category || t('类别未解析'),info.upgrade ?? t('未记录'),info.customizes ?? t('未记录')]);
  return frame;
}
export function deckArt(memory, compact = false) {
  const groups=node('div','','deck-groups');
  const group=(label,values,kind)=>{
    const section=node('div','',`deck-group ${kind}`);
    section.append(node('span',`${label} · ${values===undefined?t('未记录'):values.length}`,'deck-group-label'));
    const strip=node('div','',compact?'deck-strip compact':'deck-strip');
    section.append(strip);groups.append(section);return strip;
  };
  const cards=group(t('技能卡'),memory.examBattleProduceCards,'deck-card-group');
  for(const card of memory.examBattleProduceCards??[])cards.append(skillArt(card,memory.characterId,compact,true));
  const items=group(t('P 道具'),memory.examBattleProduceItemIds,'deck-item-group');
  for(const id of memory.examBattleProduceItemIds??[]){
    const info=itemArt(id),tile=node('div','','item-tile');
    tile.append(itemThumbnail(info));
    if(!compact)tile.append(node('span',info.name,'art-name'));
    if(info.upgraded)tile.append(node('span',t('强化'),'badge'));
    items.append(tile);
  }
  return groups;
}
export function filterSymbol(value){
  const icons={Plan1:'plan1',Plan2:'plan2',Plan3:'plan3',
    Vocal:'vocal',Dance:'dance',Visual:'visual',Assist:'assist',vocal:'vocal',dance:'dance',visual:'visual',
    ProduceExamEffectType_ExamParameterBuff:'examparameterbuff',ProduceExamEffectType_ExamReview:'examreview',
    ProduceExamEffectType_ExamLessonBuff:'examlessonbuff',ProduceExamEffectType_ExamConcentration:'examconcentration',
    ProduceExamEffectType_ExamFullPower:'examfullpower',ProduceExamEffectType_ExamCardPlayAggressive:'examcardplayaggressive'};
  const name=icons[value];if(!name)return null;
  const frame=node('span','','filter-symbol'+(name.startsWith('exam')?' exam-symbol':''));frame.setAttribute('aria-hidden','true');
  const image=document.createElement('img');image.alt='';image.src=uiIconURL(`${name}.webp`);image.width=24;image.height=24;
  watchImage(image);frame.append(image);return frame;
}

// 卡面流派使用彩色效果图层，筛选仍使用独立的单色符号。
export function idolStyleSymbol(value){
  const names={ExamParameterBuff:'parameterbuff',ExamReview:'review',ExamLessonBuff:'lessonbuff',
    ExamCardPlayAggressive:'cardplayaggressive',ExamConcentration:'concentration',ExamFullPower:'fullpower'};
  const name=names[value?.replace('ProduceExamEffectType_','')];if(!name)return null;
  const background=['concentration','fullpower'].includes(name)?name:'blue';
  const frame=node('span','','idol-style-symbol');frame.setAttribute('aria-hidden','true');
  for(const [file,layer] of [[`idol-style-bg-${background}`,'background'],[`idol-style-${name}`,'foreground']]){
    const image=document.createElement('img');image.src=uiIconURL(`${file}.webp`);image.alt='';image.className=layer;watchImage(image);frame.append(image);
  }
  return frame;
}

function skillImage(src,className,label=''){
  const image=el('img','',className);image.src=src;image.alt=label;return image;
}
function skillCosts(visual){
  const costs=el('span','','support-skill-costs');
  for(const cost of visual.costs){
    const chip=el('span','','support-skill-cost');chip.title=`${cost.label} ${cost.value}`;chip.dataset.costKind=cost.kind;
    chip.setAttribute('aria-label',chip.title);
    if(cost.kind==='status')chip.append(skillImage(uiIconURL('skill-cost-status-bg.webp'),'cost-background'));
    if(cost.icon)chip.append(skillImage(cost.icon,'cost-symbol')); 
    chip.append(el('b',cost.value?`−${cost.value}`:'0'));costs.append(chip);
  }
  return costs;
}
export function skillThumbnail(version,{compact=false}={}){
  const tile=el('span','','support-skill-thumbnail');tile.classList.toggle('thumbnail-compact',compact);tile.setAttribute('aria-hidden','true');
  tile.append(illustration(version.image,version.name,'reward-art'));
  if(version.visual.frame)tile.append(skillImage(uiIconURL(`${version.visual.frame}.webp`),'support-skill-frame'));
  const icons=el('span','','support-skill-symbols');
  for(const icon of compact?[]:version.visual.icons.slice(0,3))icons.append(skillImage(assetURL(icon.image),'',icon.label));
  const applied=version.reference.customizes?.some(entry=>entry.customizeCount>0);
  const costs=skillCosts(compact||version.visual.costsKnown===false?{costs:[]}:version.visual);
  if(version.reference.upgradeCount)tile.append(skillImage(uiIconURL('skill-enhanced.webp'),'support-skill-enhanced'));
  tile.append(icons,costs);
  if(!compact&&!applied&&version.visual.damage){
    const {value,count}=version.visual.damage;
    tile.append(el('b',`${value}${count>1?`×${count}`:''}`,'support-skill-damage'));
  }
  if(!compact&&!applied&&version.visual.block){
    const {value,count}=version.visual.block;
    const amount=el('span','','support-skill-block'),number=el('b',`${value}${count>1?`×${count}`:''}`);amount.title=`${t('元气')} ${number.textContent}`;amount.append(skillImage(uiIconURL('skill-block.webp'),''),number);tile.append(amount);
  }
  return tile;
}
export function itemThumbnail(reward){
  const tile=el('span','','support-item-thumbnail');
  if(reward.background)tile.append(skillImage(uiIconURL(`item-bg-${reward.background}.webp`),'support-item-background'));
  tile.append(illustration(reward.image,reward.name,'reward-art'));
  if(reward.upgraded)tile.append(skillImage(uiIconURL('skill-enhanced.webp'),'support-item-enhanced'));
  return tile;
}

export function skillThumbnailFor(reference,characterId,options){
  const info=cardInfo(reference,characterId);
  return skillThumbnail({reference:reference??{},...info,visual:reference?supportSkillVisual(reference):{costs:[],icons:[]}},options);
}
