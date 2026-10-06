import {el} from './dom.mjs';
import {t} from '../i18n.mjs';
import {cardCustomizations} from '../domain/catalog.mjs';
import {effectReading} from './effect-view.mjs';
import {customizationPreview,recordedCustomizationState} from '../domain/card-customizations.mjs';

export function customizationPanel(unlock,{expanded=false,recorded=false}={}){
  const panel=el(expanded?'section':'details','','card-customizations');
  const summary=el(expanded?'h3':'summary','','customization-heading'),countSummary=el('span','','customization-summary customization-count'),totals=[];
  countSummary.setAttribute('aria-live','polite');countSummary.hidden=true;summary.append(el('span',t('技能附魔预览'),'customization-title'),countSummary);
  if(!expanded)panel.open=false;
  panel.classList.toggle('customizations-expanded',expanded);
  panel.append(summary);
  panel.classList.add('customizations-compact');
  for(const reference of unlock.cards){
    const data=cardCustomizations(reference),section=el('section','','customization-card');
    if(recorded&&!data)continue;
    if(!data){section.append(el('p',t('附魔目录暂未收录。'),'small muted'));panel.append(section);continue;}
    if(expanded&&unlock.cards.length>1)section.append(el('h4',data.name));
    const state=recorded?recordedCustomizationState(data,reference):null;
    if(recorded&&!state.options.length)continue;
    const counts=state?{...state.counts}:{},views=[],headingCount={used:0,maximum:data.maximum};totals.push(headingCount);countSummary.hidden=false;
    const baseline=state?customizationPreview(data,counts).producePoint:0;
    const total=el('p','','customization-summary customization-cost');total.setAttribute('aria-live','polite');
    if(data.options.length)section.append(total);
    for(const option of state?.options??data.options){
      const block=el('article','','customization-option'),header=el('header','','customization-option-header');
      const names=[...new Set((option.levels.find(level=>level.level===(state?.counts[option.id]??0)+1)?.effects??[]).map(effect=>effect.name).filter(Boolean))];
      header.append(el('h5',names.join(' · ')||t('技能附魔预览')));
      const controls=el('div','','customization-preview-controls'),minus=el('button','−'),value=el('output','0'),plus=el('button','+');
      controls.setAttribute('role','group');controls.setAttribute('aria-label',t('附魔预览'));
      minus.type=plus.type='button';minus.setAttribute('aria-label',t('减少附魔次数'));plus.setAttribute('aria-label',t('增加附魔次数'));
      controls.append(el('span',t('附魔预览')),minus,value,plus);header.append(controls);block.append(header);
      const content=el('div','','customization-level');block.append(content);
      const change=delta=>{counts[option.id]=(counts[option.id]??0)+delta;render();};
      minus.onclick=()=>change(-1);plus.onclick=()=>change(1);
      views.push({option,minus,value,plus,content});section.append(block);
    }
    function render(){
      const preview=customizationPreview(data,counts),used=preview.count+(state?.outsideCount??0);headingCount.used=used;countSummary.textContent=t('累计附魔次数({0}/{1})',[totals.reduce((sum,value)=>sum+value.used,0),totals.reduce((sum,value)=>sum+value.maximum,0)]);total.textContent=t('累计消耗 P 点数：{0}',[preview.producePoint-baseline]);
      for(const view of views){
        const selected=preview.selected.find(option=>option.id===view.option.id);
        const minimum=state?.counts[view.option.id]??0;
        view.value.value=String(selected.count-minimum);view.minus.disabled=selected.count<=minimum;
        view.plus.disabled=used>=data.maximum||!view.option.levels.some(level=>level.level===selected.count+1);
        view.content.replaceChildren();
        const level=recorded&&selected.count===minimum?view.option.levels.find(level=>level.level===minimum+1):selected.level??view.option.levels[0];
        if(level)view.content.append(customizationEffects(level,{preview:true,showNames:false}),el('p',t('所需 P 点数：{0}',[level.producePoint]),'customization-step-cost'));
        else view.content.append(el('p',t('附魔目录暂未收录。'),'small muted'));
        view.content.classList.toggle('customization-preview-inactive',selected.count===minimum);
      }
    }
    render();
    if(!data.options.length)section.append(el('p',t('当前技能卡版本没有可选附魔记录。'),'small muted'));
    panel.append(section);
  }
  return recorded&&!panel.querySelector('.customization-card')?null:panel;
}

export function customizationEffects(level,{preview=false,showNames=true,current=false}={}){
  const block=el('div','','customization-effects');
  for(const effect of level.effects){
    const part=el('div','','customization-effect');if(showNames&&effect.name)part.append(el('h6',effect.name));
    if(!current&&effect.replaces?.length){part.append(el('small',t('替换前')));for(const [index,text] of effect.replaces.entries())if(text)part.append(effectReading(text,{descriptionParts:effect.replacesParts?.[index]}));part.append(el('small',t('替换后')));}
    if(effect.removesCondition)part.append(el('small',t('移除以下触发条件')));
    let parts=effect.descriptionParts;
    if(preview&&effect.increment!==undefined){
      parts=parts.map(part=>({...part}));
      const amount=parts.at(-1),prefix=parts.at(-2);
      if(prefix)prefix.text=prefix.text.replace(/[+−-]$/,'');
      const value=effect.increment;
      amount.text=`(${value.startsWith('-')?'':'+'}${value})`;
    }
    if(effect.text)part.append(effectReading(effect.text,{descriptionParts:parts}));
    if(!effect.complete)part.append(el('p',t('这项附魔的说明未完整联接。'),'small muted'));
    block.append(part);
  }
  return block;
}
