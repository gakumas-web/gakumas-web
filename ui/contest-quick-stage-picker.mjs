import {el} from './dom.mjs';
import {t} from '../i18n.mjs';
import {contestStageSummary} from './contest-stage-picker.mjs';
import {closeRewardPopover} from './card-rewards.mjs';

let pickerId=0;
export function createContestQuickStagePicker(stages,onSelect){
  const element=el('div','','season-quick-stage-control'),label=el('span',t('同计划其他舞台')),button=el('button','','season-quick-stage season-picker-trigger'),arrow=el('span','▾','season-picker-arrow');
  button.type='button';button.setAttribute('aria-label',t('同计划其他舞台'));button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');arrow.setAttribute('aria-hidden','true');button.append(el('span','---'),arrow);
  const popup=el('div','','season-picker-popup season-quick-stage-popup'),list=el('div','','season-picker-list');popup.popover='auto';list.id=`season-quick-stage-list-${++pickerId}`;list.setAttribute('role','listbox');list.setAttribute('aria-label',t('同计划其他舞台'));button.setAttribute('aria-controls',list.id);popup.append(list);element.append(label,button,popup);
  for(const stage of stages){const option=el('button','','season-picker-option season-quick-stage-option');option.type='button';option.dataset.stageId=stage.id;option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.tabIndex=-1;option.append(contestStageSummary(stage));option.onclick=()=>{hide();onSelect(stage.id);document.querySelector('.season-quick-stage')?.focus({preventScroll:true});};list.append(option);}
  function hide(){if(popup.matches(':popover-open'))popup.hidePopover();}
  function show(focusOption=false){
    if(button.disabled)return;closeRewardPopover();popup.showPopover();
    const bounds=button.getBoundingClientRect(),width=Math.min(420,innerWidth-24),below=innerHeight-bounds.bottom-18,above=bounds.top-18,under=below>=240||below>=above;
    popup.style.width=`${width}px`;popup.style.maxHeight=`${Math.max(120,Math.min(560,under?below:above))}px`;popup.style.left=`${Math.max(12,Math.min(bounds.left,innerWidth-width-12))}px`;popup.style.top=`${under?bounds.bottom+6:Math.max(12,bounds.top-popup.getBoundingClientRect().height-6)}px`;list.scrollTop=0;
    if(focusOption)list.firstElementChild?.focus();
  }
  button.onclick=()=>popup.matches(':popover-open')?hide():show();
  button.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();show(true);}};
  popup.onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide();button.focus({preventScroll:true});return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();const options=[...list.children],index=options.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowUp'?-1:1)+options.length)%options.length;options[next]?.focus();
  };
  popup.addEventListener('toggle',()=>button.setAttribute('aria-expanded',String(popup.matches(':popover-open'))));
  const onScroll=event=>{if(popup.matches(':popover-open')&&!popup.contains(event.target))hide();};document.addEventListener('scroll',onScroll,true);window.addEventListener('resize',hide);
  return {element,hide,setDisabled(value){button.disabled=value||!stages.length;if(button.disabled)hide();},dispose(){hide();document.removeEventListener('scroll',onScroll,true);window.removeEventListener('resize',hide);}};
}
