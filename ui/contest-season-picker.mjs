import {contestStageCapability} from '../domain/contest-stage-capability.mjs';
import {appendContestCriteria} from './contest-criteria.mjs';
import {el} from './dom.mjs';
import {filterTitle} from './filter-field.mjs';
import {createListboxPopover} from './listbox-popover.mjs';
import {t} from '../i18n.mjs';
import {contestPlanName} from './contest-stage-summary.mjs';
import {filterSymbol} from './illustrations.mjs';
import {closeRewardPopover} from './card-rewards.mjs';
import {contestGroupDateRange,contestGroupUpcoming,contestGroupPeriod} from '../domain/contest-period.mjs';

const groupName=(group,{selected=false}={})=>group.kind==='contest'?t(selected&&contestGroupUpcoming(group)?'赛季 {0}（筹备中）':'赛季 {0}',[group.seasonNumber]):[group.name,group.round?t('第 {0} 轮',[group.round]):''].filter(Boolean).join(' · ');
export function createContestSeasonPicker(groups,onSelect){
  const element=el('div','','season-group-controls'),label=filterTitle(t('选择舞台')),button=el('button','','season-picker-trigger'),value=el('span'),arrow=el('span','▾','season-picker-arrow');
  label.classList.add('season-picker-label');label.id='season-picker-label';value.id='season-picker-value';button.id='season-select';button.setAttribute('aria-labelledby',`${label.id} ${value.id}`);arrow.setAttribute('aria-hidden','true');button.append(value,arrow);
  const popup=el('div','','season-picker-popup'),list=el('div','','season-picker-list');popup.id='season-picker-popup';list.id='season-picker-list';list.setAttribute('aria-label',t('选择舞台'));popup.append(list);
  const activity=el('input'),activityLabel=el('label','','season-activity-toggle');activity.type='checkbox';activity.id='season-activity-mode';activityLabel.append(activity,el('span',t('活动舞台模拟')));element.append(label,button,activityLabel,popup);
  let selectedId=groups.find(group=>group.kind==='contest')?.id??groups[0].id,kind='contest';const lastSelected=new Map();
  const {hide,restoreFocus,dispose}=createListboxPopover({button,popup,list,width:480,maxHeight:620,beforeShow:()=>{closeRewardPopover();draw();}});
  activity.onchange=()=>{hide();kind=activity.checked?'event':'contest';const group=groups.find(group=>group.id===lastSelected.get(kind))??groups.find(group=>group.kind===kind);if(group)onSelect(group);};

  function draw(){
    list.replaceChildren();
    for(const group of groups.filter(group=>group.kind===kind)){
      const option=el('button','','season-picker-option'),heading=el('span','','season-picker-option-heading'),identity=el('span','','season-picker-option-identity'),period=el('span','','season-picker-option-period'),plans=el('span','','season-picker-plans');option.dataset.seasonId=group.id;option.dataset.kind=group.kind;option.dataset.stageCount=String(group.stages.length);plans.style.setProperty('--stage-count',String(group.stages.length));option.setAttribute('role','option');option.setAttribute('aria-selected',String(group.id===selectedId));identity.append(el('strong',groupName(group)));
      if(group.kind==='contest'){
        const dates=el('span',contestGroupDateRange(group)||t('赛期未收录'),'season-picker-dates'),{startTime,endTime}=contestGroupPeriod(group);
        if(startTime!==null&&endTime!==null&&endTime>Date.now()){
          const format=time=>new Date(time+9*60*60*1000).toISOString().slice(0,16).replace('T',' ');
          dates.title=`${format(startTime)} - ${format(endTime)} (JST)`;dates.setAttribute('aria-label',dates.title);
        }
        period.append(dates);
      }
      if(contestGroupUpcoming(group))period.append(el('small',t('预告'),'badge'));
      if(period.childElementCount)identity.append(period);
      heading.append(identity,plans);
      for(const stage of group.stages){const plan=el('span','','season-picker-plan'),symbol=filterSymbol(stage.planType.replace('ProducePlanType_',''));plan.title=contestPlanName(stage.planType);plan.setAttribute('aria-label',plan.title);if(symbol)plan.append(symbol);plan.append(el('span',plan.title));plans.append(plan);}
      option.append(heading);
      for(const stage of group.stages){
        const row=el('span','','season-picker-stage'),allocation=el('span','','season-picker-allocation');row.append(el('span',t('{0} 回合',[stage.turn]),'season-picker-turns'),allocation);
        if(contestStageCapability(stage).state==='pending')allocation.append(el('small',t('模拟资料待补充')+' · ','muted'));
        if(stage.criteria)appendContestCriteria(allocation,stage.criteria);
        else allocation.append(el('span',t('属性分配未收录'),'small muted'));
        option.append(row);
      }
      option.onclick=()=>{hide();onSelect(group);restoreFocus();};list.append(option);
    }
    if(!list.childElementCount)list.append(el('p',t('没有匹配的舞台。'),'empty-result'));
  }
  return {element,hide,update(group){selectedId=group.id;kind=group.kind;activity.checked=kind==='event';lastSelected.set(kind,group.id);value.textContent=groupName(group,{selected:true});button.dataset.value=group.id;},dispose};
}
