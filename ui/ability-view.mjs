import {t} from '../i18n.mjs';
import {sortedAbilitySummaries} from '../domain/ability-summary.mjs';
import {semanticContent} from './semantic-view.mjs';
import {supportHint} from './card-rewards.mjs';

const node = (tag, text = '', className = '') => {
  const result = document.createElement(tag); result.textContent = text; result.className = className; return result;
};
function abilityEffect(item){
  const content=semanticContent({entries:[item.description]},{leadingEffectIcons:true});
  content.querySelectorAll('h4').forEach(heading=>heading.remove());
  const lessons={vocal:'Vo',dance:'Da',visual:'Vi'};
  const types=[...new Set((item.description.technical?.slots??[]).map(slot=>lessons[slot.triggerId?.match(/^p_trigger-(?:start_lesson|end_lesson|end_lesson_before_present)-lesson_(vocal|dance|visual)(?:_normal|_sp|_hard)?(?:-|$)/)?.[1]]).filter(Boolean))];
  const leading=content.querySelector('.effect-leading-icons');
  const parts=item.description.technical?.skill?.descriptions??[];
  const triggerCard=parts.find((part,index)=>part.produceDescriptionType==='ProduceDescriptionType_ProduceCard'&&/^使用後/.test(parts[index+1]?.text??''));
  if(triggerCard&&leading){
    const reference=[...content.querySelectorAll('.effect-card-reference')].find(reference=>reference.lastChild?.textContent===triggerCard.text);
    const thumbnail=reference?.querySelector('.support-skill-thumbnail');
    if(thumbnail){
      thumbnail.classList.add('ability-trigger-card');
      leading.querySelector('.effect-inline-icon')?.replaceWith(thumbnail);
    }
  }
  if(types.length===1&&leading){
    const lesson=node('span','','ability-lesson-icon');lesson.dataset.lesson=types[0];
    const icon=leading.querySelector('.effect-inline-icon');if(icon)lesson.append(icon);
    lesson.append(node('b',types[0],'ability-lesson-label'));leading.prepend(lesson);
  }
  if(leading){
    // 把具体效果图标前置，避免条件长句截断后只剩通用能力图标。
    const seen=new Set([...leading.querySelectorAll('.foreground')].map(image=>image.getAttribute('src')));
    for(const effect of content.querySelectorAll('.effect-term>.effect-inline-icon')){
      const src=effect.querySelector('.foreground')?.getAttribute('src');
      if(src&&!seen.has(src)){leading.append(effect);seen.add(src);}
    }
    const sleepy=parts.find(part=>part.produceDescriptionType==='ProduceDescriptionType_ProduceCard'&&part.targetId==='p_card-00-acc-0_002');
    if(sleepy&&parts.some(part=>part.targetId==='Label_ProduceCardPositionType_Lost'&&part.originProduceExamEffectId===sleepy.originProduceExamEffectId)){
      const reference=[...content.querySelectorAll('.effect-card-reference')].find(reference=>reference.lastChild?.textContent===sleepy.text);
      const thumbnail=reference?.querySelector('.support-skill-thumbnail');
      if(thumbnail){const icon=node('span','','ability-remove-card-icon');icon.title=t('移除眠气');icon.append(thumbnail.cloneNode(true),node('b','−','ability-remove-card-mark'));leading.append(icon);}
    }
  }
  const effectType=item.description.technical?.slots?.[0]?.effect?.produceEffectType;
  if(leading&&!item.fallback&&!item.context&&/^ProduceEffectType_(?:(?:Vocal|Dance|Visual)(?:Addition|GrowthRateAddition)|ProducePointAdditionDisableTrigger)$/.test(effectType??'')){
    const icon=leading.querySelector('.effect-inline-icon');
    if(icon){icon.classList.add('ability-value-icon');const amount=node('b',item.value,'ability-icon-value');amount.setAttribute('aria-hidden','true');icon.append(amount);}
  }
  return content;
}
export function abilityIconPreview(item){
  const content=abilityEffect(item),preview=node('span','','ability-icon-preview');
  preview.setAttribute('aria-label',content.textContent);
  const leading=content.querySelector('.effect-leading-icons');
  if(leading)preview.append(...leading.childNodes);
  else preview.append(node('span','?','ability-icon-fallback'));
  const extras=[...preview.children].slice(1);
  if(extras.length){const strip=node('span','','ability-extra-icons');strip.append(...extras);preview.append(strip);}
  return preview;
}
export function abilityChips(items) {
  const group = node('div', '', 'ability-chips'); group.setAttribute('aria-label', t('{0} 项能力，点击查看完整条件',[items.length]));
  if (!items.length) { group.append(node('span', t('能力记录为空'), 'small muted')); return group; }
  for (const [index,item] of sortedAbilitySummaries(items).entries()) {
    const button=node('button','','ability-chip');button.dataset.abilityIndex=String(index);
    const preview=abilityIconPreview(item);button.setAttribute('aria-label',preview.getAttribute('aria-label'));
    button.append(preview);
    const wrapper=supportHint(button,()=>{
      const body=node('div','','support-reward-body ability-effect-popover');body.append(abilityEffect(item));return body;
    });
    wrapper.classList.add('ability-hint');group.append(wrapper);
  }
  return group;
}
