import {$} from './dom.mjs';
import {t} from '../i18n.mjs';

export function updatePickerResultCount(count){
  const button=$('selection-picker-confirm');
  button.textContent=t('确认（{0}）',[count]);
  button.setAttribute('aria-label',t('确认，筛选后剩余 {0} 条',[count]));
}

export function createPickerAvailabilityUpdater(evaluate,getDraft,inputs){
  return ()=>{
    const draft=getDraft(),result=evaluate(draft),selected=new Set(draft);updatePickerResultCount(result.count);
    for(const [key,input] of inputs){
      input.checked=selected.has(key);input.disabled=!input.checked&&!result.available.has(key);
      input.title=input.disabled?t('与其他分组或当前筛选条件不匹配'):'';
    }
  };
}
