import {el} from './dom.mjs';
import {t} from '../i18n.mjs';

export function appendMemorySkillBadges(target,count,phase){
  const labels=[];
  if(count){const badge=el('span',String(count),'selection-custom-count');const label=t('附魔次数：{0}',[count]);badge.setAttribute('aria-label',label);target.append(badge);labels.push(label);}
  if(phase===1){const badge=el('span',t('开局标识'),'memory-start-inherit');const label=t('开局继承');badge.setAttribute('role','img');badge.setAttribute('aria-label',label);target.append(badge);labels.push(label);}
  return labels;
}
