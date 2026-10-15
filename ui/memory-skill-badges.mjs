import {el} from './dom.mjs';
import {t} from '../i18n.mjs';

function syncCustomizationBadge(target,count){
  const existing=target.querySelector(':scope > .selection-custom-count');
  if(!count){existing?.remove();return '';}
  const badge=existing??el('span','','selection-custom-count'),label=t('附魔次数：{0}',[count]);
  badge.textContent=String(count);badge.setAttribute('aria-label',label);badge.title=label;
  if(!existing)target.append(badge);
  return label;
}

// 同步直属角标与父控件的次数描述，保留控件名称、缩略图和说明浮层。
export function updateSkillCustomizationBadge(target,reference){
  const label=syncCustomizationBadge(target,(reference.customizes??[]).reduce((sum,entry)=>sum+entry.customizeCount,0));
  if(label)target.setAttribute('aria-description',label);else target.removeAttribute('aria-description');
  return label;
}

export function appendMemorySkillBadges(target,count,phase){
  const labels=[];
  const customizationLabel=syncCustomizationBadge(target,count);if(customizationLabel)labels.push(customizationLabel);
  if(phase===1){const badge=el('span',t('开局标识'),'memory-start-inherit');const label=t('开局继承');badge.setAttribute('role','img');badge.setAttribute('aria-label',label);target.append(badge);labels.push(label);}
  return labels;
}
