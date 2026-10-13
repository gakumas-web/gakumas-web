import {el} from './dom.mjs';
import {t} from '../i18n.mjs';
import {contestPlanName} from './contest-stage-picker.mjs';
import {filterSymbol} from './illustrations.mjs';
import {closeRewardPopover} from './card-rewards.mjs';

const attributes=['vocal','dance','visual'],short=['Vo','Da','Vi'];
const groupName=group=>group.kind==='contest'?t('赛季 {0}',[group.seasonNumber]):[group.name,group.round?t('第 {0} 轮',[group.round]):''].filter(Boolean).join(' · ');
export function createContestSeasonPicker(groups,onSelect){
  const element=el('div','','season-group-controls'),label=el('span',t('选择舞台'),'season-picker-label'),button=el('button','','season-picker-trigger'),value=el('span'),arrow=el('span','▾','season-picker-arrow');
  label.id='season-picker-label';value.id='season-picker-value';button.id='season-select';button.setAttribute('aria-labelledby',`${label.id} ${value.id}`);button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');arrow.setAttribute('aria-hidden','true');button.append(value,arrow);
  const popup=el('div','','season-picker-popup'),list=el('div','','season-picker-list');popup.id='season-picker-popup';popup.popover='auto';list.id='season-picker-list';list.setAttribute('role','listbox');list.setAttribute('aria-label',t('选择舞台'));button.setAttribute('aria-controls',list.id);popup.append(list);
  const activity=el('input'),activityLabel=el('label','','season-activity-toggle');activity.type='checkbox';activity.id='season-activity-mode';activityLabel.append(activity,el('span',t('活动舞台模拟')));element.append(label,button,activityLabel,popup);
  let selectedId=groups.find(group=>group.kind==='contest')?.id??groups[0].id,kind='contest';const lastSelected=new Map();
  activity.onchange=()=>{hide();kind=activity.checked?'event':'contest';const group=groups.find(group=>group.id===lastSelected.get(kind))??groups.find(group=>group.kind===kind);if(group)onSelect(group);};

  function hide(){if(popup.matches(':popover-open'))popup.hidePopover();}
  function position(){
    const bounds=button.getBoundingClientRect(),width=Math.min(540,innerWidth-24),below=innerHeight-bounds.bottom-18,above=bounds.top-18,under=below>=240||below>=above;
    popup.style.width=`${width}px`;popup.style.maxHeight=`${Math.max(120,Math.min(620,under?below:above))}px`;popup.style.left=`${Math.max(12,Math.min(bounds.left,innerWidth-width-12))}px`;
    popup.style.top=`${under?bounds.bottom+6:Math.max(12,bounds.top-popup.getBoundingClientRect().height-6)}px`;
  }
  function draw(){
    list.replaceChildren();
    for(const group of groups.filter(group=>group.kind===kind)){
      const option=el('button','','season-picker-option'),heading=el('span','','season-picker-option-heading'),plans=el('span','','season-picker-plans');option.dataset.seasonId=group.id;option.dataset.kind=group.kind;option.dataset.stageCount=String(group.stages.length);plans.style.setProperty('--stage-count',String(group.stages.length));option.setAttribute('role','option');option.setAttribute('aria-selected',String(group.id===selectedId));heading.append(el('strong',groupName(group)),plans);
      for(const stage of group.stages){const plan=el('span','','season-picker-plan'),symbol=filterSymbol(stage.planType.replace('ProducePlanType_',''));plan.title=contestPlanName(stage.planType);plan.setAttribute('aria-label',plan.title);if(symbol)plan.append(symbol);plan.append(el('span',plan.title));plans.append(plan);}
      option.append(heading);
      for(const stage of group.stages){
        const row=el('span','','season-picker-stage'),allocation=el('span','','season-picker-allocation');row.append(el('span',t('{0} 回合',[stage.turn]),'season-picker-turns'),allocation);
        if(stage.criteria){const bar=el('span','','contest-criteria-bar'),labels=el('span','','contest-criteria-labels');bar.setAttribute('aria-hidden','true');attributes.forEach((key,index)=>{const value=stage.criteria[key],part=el('span'),text=el('span',`${short[index]} ${Number((value*100).toFixed(1))}%`);part.style.flexGrow=String(value);part.dataset.attribute=key;text.dataset.attribute=key;bar.append(part);labels.append(text);});allocation.append(bar,labels);}
        else allocation.append(el('span',t('属性分配未收录'),'small muted'));
        option.append(row);
      }
      option.onclick=()=>{hide();onSelect(group);button.focus({preventScroll:true});};list.append(option);
    }
    if(!list.childElementCount)list.append(el('p',t('没有匹配的舞台。'),'empty-result'));
  }
  function show(focusOption=false){
    closeRewardPopover();draw();popup.showPopover();position();list.scrollTop=0;
    if(focusOption)(list.querySelector('[aria-selected=true]')??list.querySelector('button'))?.focus();
  }
  button.onclick=()=>popup.matches(':popover-open')?hide():show();button.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();show(true);}};
  popup.onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide();button.focus({preventScroll:true});return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const options=[...list.querySelectorAll('[role=option]')];if(!options.length)return;event.preventDefault();const index=options.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowUp'?-1:1)+options.length)%options.length;options[next].focus();
  };
  popup.addEventListener('toggle',()=>button.setAttribute('aria-expanded',String(popup.matches(':popover-open'))));
  const onScroll=event=>{if(popup.matches(':popover-open')&&!popup.contains(event.target))hide();};document.addEventListener('scroll',onScroll,true);window.addEventListener('resize',hide);
  return {element,hide,update(group){selectedId=group.id;kind=group.kind;activity.checked=kind==='event';lastSelected.set(kind,group.id);value.textContent=groupName(group);button.dataset.value=group.id;},dispose(){hide();document.removeEventListener('scroll',onScroll,true);window.removeEventListener('resize',hide);}};
}
