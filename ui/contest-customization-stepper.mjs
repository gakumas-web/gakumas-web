import {el} from './dom.mjs';
import {t} from '../i18n.mjs';
import {customizationColorKind} from './contest-customization-colors.mjs';

// 只负责附魔控件的显示与增减事件，上限和可用等级由调用方决定。
export function createContestCustomizationStepper({option,onStep}){
  const names=[...new Set(option.levels.flatMap(level=>level.effects.map(effect=>effect.name)).filter(Boolean))],label=names.join('／')||t('附魔');
  const element=el('div','','contest-customizer-stepper'),minus=el('button','−'),output=el('output'),plus=el('button','+');
  element.dataset.customizeId=option.id;element.dataset.colorKind=customizationColorKind(option);element.setAttribute('role','group');element.setAttribute('aria-label',label);
  minus.dataset.step='-1';plus.dataset.step='1';minus.setAttribute('aria-label',`${t('减少附魔次数')} · ${label}`);plus.setAttribute('aria-label',`${t('增加附魔次数')} · ${label}`);output.setAttribute('aria-live','polite');
  element.append(el('span',label,'contest-customizer-name'),minus,output,plus);minus.onclick=()=>onStep(-1);plus.onclick=()=>onStep(1);
  return {element,update({count,canDecrease,canIncrease}){output.value=String(count);minus.disabled=!canDecrease;plus.disabled=!canIncrease;element.classList.toggle('has-customization',count>0);}};
}
