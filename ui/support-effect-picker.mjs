import {createPickerAvailabilityUpdater} from './selection-picker-status.mjs';
import {$,el,openDialog} from './dom.mjs';
import {effectReading} from './effect-view.mjs';
import {supportEffectChoices,supportEffectGroups,supportEffectAttributes,supportEffectClauses,normalizeSupportEffectKey} from '../domain/support-effect-choices.mjs';
import {t,locale} from '../i18n.mjs';
import {nextChoice} from '../application/view-state.mjs';
let cache;
export function resetSupportEffectChoices(){cache=null;}
export function syncSupportEffectChoices(snapshot,view){
  const scope=JSON.stringify([view.supportPlan,view.supportPlanCommon,view.supportType,locale()]);
  if(!cache||cache.snapshot!==snapshot||cache.scope!==scope){
    $('support-skill-scope-status').hidden=true;
    cache={snapshot,scope,values:supportEffectChoices(snapshot,view)};
    $('support-skills').replaceChildren(...cache.values.map(value=>new Option(value.text,value.key)));
  }
  const available=new Set(cache.values.map(value=>value.key)),before=view.supportSkills.length;
  view.supportSkills=[...new Set(view.supportSkills.map(normalizeSupportEffectKey))].filter(key=>available.has(key));
  if(before!==view.supportSkills.length){$('support-skill-scope-status').hidden=false;$('support-skill-scope-status').textContent=t('已移除不在当前计划或属性范围内的支援效果。');}
  return cache.values;
}
const reading=value=>effectReading(value.text,{descriptionParts:value.descriptionParts,leadingEffectIcons:true,effectIds:value.effectIds,cardReferences:value.cardReferences});
function openPicker(view,values,onChange,createAvailability){
  const dialog=$('selection-picker'),list=$('selection-picker-list');let draft=[...view.supportSkills];const attributes=new Set(),evaluate=createAvailability(),inputs=new Map();
  dialog.classList.remove('ability-picker');dialog.classList.add('support-effect-picker');dialog.querySelector('.selection-picker-filters').hidden=true;
  $('selection-picker-title').textContent=t('选择支援效果');$('selection-picker-hint').textContent=t('同组任一满足，不同组同时满足')+'。'+t('灰色选项与其他分组或当前筛选条件不匹配；已选项仍可取消。');
  list.replaceChildren();
  const attributeBar=el('div','','support-effect-attribute-buttons');attributeBar.setAttribute('role','group');attributeBar.setAttribute('aria-label',t('效果奖励'));attributeBar.append(el('span',t('效果奖励'),'support-effect-attribute-label'));
  for(const [id,label] of [['',t('全部')],...supportEffectAttributes]){
    const button=el('button',t(label),'effect-choice');button.dataset.effectAttribute=id;
    button.onclick=()=>{if(!id)attributes.clear();else if(attributes.has(id))attributes.delete(id);else attributes.add(id);draw();list.scrollTop=0;};attributeBar.append(button);
  }
  const groups=el('div','','support-effect-picker-groups');const filterBar=$('support-effect-picker-filters');filterBar.replaceChildren(attributeBar);filterBar.hidden=false;list.append(groups);
  const updateAvailability=createPickerAvailabilityUpdater(evaluate,()=>draft,inputs);
  function draw(){
    inputs.clear();
    for(const button of attributeBar.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.effectAttribute?attributes.has(button.dataset.effectAttribute):!attributes.size));
    groups.replaceChildren();
    for(const [id,label] of supportEffectGroups){
      const matches=values.filter(value=>value.group===id&&(!attributes.size||value.attributes.some(attribute=>attributes.has(attribute))));if(!matches.length)continue;
      const section=el('section','','ability-picker-group'),heading=el('h3',`${t(label)} · ${matches.length}`),options=el('div','','support-effect-options');section.dataset.effectGroup=id;section.append(heading,options);
      for(const value of matches){
        const label=el('label','','support-effect-choice'),input=el('input');input.type='checkbox';input.value=value.key;input.checked=draft.includes(value.key);input.setAttribute('aria-label',value.text);
        inputs.set(value.key,input);input.onchange=()=>{draft=nextChoice(draft,value.key);updateAvailability();};label.append(input,reading(value));options.append(label);
      }
      groups.append(section);
    }
    if(!groups.childElementCount)groups.append(el('p',t('没有匹配选项'),'selection-picker-empty'));
    updateAvailability();
  }
  draw();
  $('selection-picker-clear').onclick=()=>{draft=[];updateAvailability();};$('selection-picker-cancel').onclick=()=>dialog.close();
  $('selection-picker-confirm').onclick=()=>{dialog.close();onChange('supportSkills',draft);};
  openDialog(dialog);list.scrollTop=0;attributeBar.querySelector('button').focus({preventScroll:true});
}
export function renderSupportEffectChoices(view,values,onChange,createAvailability){
  const opener=$('support-skills-open'),list=$('support-skills-list'),byKey=new Map(values.map(value=>[value.key,value]));
  opener.onclick=()=>openPicker(view,values,onChange,createAvailability);list.replaceChildren();list.hidden=!view.supportSkills.length;
  for(const [index,clause] of supportEffectClauses(view.supportSkills).entries()){
    if(index)list.append(el('span','AND','filter-logic-operator'));
    const group=el('span','','support-effect-selected-group');
    for(const [position,key] of clause.entries()){
      if(position)group.append(el('span','OR','filter-logic-operator'));
      const value=byKey.get(key);if(!value)continue;
      const button=el('button','','support-effect-selected');button.dataset.value=key;button.setAttribute('aria-label',t('移除筛选：{0}',[value.text]));button.append(reading(value),el('span','×'));
      button.onclick=()=>{onChange('supportSkills',nextChoice(view.supportSkills,key));opener.focus({preventScroll:true});};group.append(button);
    }
    list.append(group);
  }
}
