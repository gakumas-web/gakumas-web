import {el} from './dom.mjs';
import {createListboxPopover} from './listbox-popover.mjs';
import {t} from '../i18n.mjs';
import {contestStageSummary} from './contest-stage-summary.mjs';
import {closeRewardPopover} from './card-rewards.mjs';

let pickerId=0;
export function createContestQuickStagePicker(stages,onSelect){
  const element=el('div','','season-quick-stage-control'),label=el('span',t('同计划其他舞台')),button=el('button','','season-quick-stage season-picker-trigger'),arrow=el('span','▾','season-picker-arrow');
  button.type='button';button.setAttribute('aria-label',t('同计划其他舞台'));arrow.setAttribute('aria-hidden','true');button.append(el('span','---'),arrow);
  const popup=el('div','','season-picker-popup season-quick-stage-popup'),list=el('div','','season-picker-list');list.id=`season-quick-stage-list-${++pickerId}`;list.setAttribute('aria-label',t('同计划其他舞台'));popup.append(list);element.append(label,button,popup);
  const {hide,restoreFocus,dispose}=createListboxPopover({button,popup,list,width:420,maxHeight:560,beforeShow:closeRewardPopover,returnFocus:()=>document.querySelector('.season-quick-stage')});
  for(const stage of stages){const option=el('button','','season-picker-option season-quick-stage-option');option.type='button';option.dataset.stageId=stage.id;option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.tabIndex=-1;option.append(contestStageSummary(stage));option.onclick=()=>{hide();onSelect(stage.id);restoreFocus();};list.append(option);}
  return {element,hide,setDisabled(value){button.disabled=value||!stages.length;if(button.disabled)hide();},dispose};
}
