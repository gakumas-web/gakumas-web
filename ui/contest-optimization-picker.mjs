import {el,openDialog} from './dom.mjs';
import {t} from '../i18n.mjs';
import {choiceFilterIcons} from './choice-filter-icons.mjs';
import {contestExtraItemLimit} from '../domain/contest-item-rules.mjs';
import {cardCustomizations,cardRewardInfo,itemRewardInfo,idolInfo,selectionFlowDefinitions,planLabel} from '../domain/catalog.mjs';
import {optimizationExclusiveCustomizationLimit,validateOptimizationExclusiveReference} from '../application/contest-optimization-input.mjs';
import {skillThumbnailFor,itemThumbnail} from './illustrations.mjs';
import {skillCardDetails} from './skill-card-details.mjs';
import {groupedInheritanceCardChoices} from '../domain/memories.mjs';
import {customizationColorKind} from './contest-customization-colors.mjs';
import {itemRewardDetails,supportHint,closeRewardPopover} from './card-rewards.mjs';

// 候选用悬停说明，附魔复用自选编组的底部卡图与彩色步进器；草稿确认后才应用。
export function openOptimizationChoiceDialog({title,choices,current,context,characterId,grade,onSelect,returnFocus,kind='card',supportedReference=()=>true,onClose=()=>{}}){
  const isCard=kind==='card',dialog=el('dialog','','contest-memory-picker optimization-picker'),head=el('div','','dialog-head'),heading=el('h2',title),close=el('button',t(isCard?'取消':'关闭'));
  heading.id='optimization-picker-title';dialog.setAttribute('aria-labelledby',heading.id);head.append(heading,close);close.onclick=()=>dialog.close();
  const body=el('div','','optimization-picker-body'),collection=el('section','','optimization-picker-collection'),grid=el('div','','optimization-picker-icons selection-source-options'),customizer=el('section','','optimization-manual-customizations optimization-picker-customizer');
  collection.append(grid);grid.setAttribute('role',isCard?'radiogroup':'group');grid.setAttribute('aria-label',title);body.append(collection);
  const footer=el('div','','selection-picker-footer'),clear=el('button',t('清空选择')),actions=el('div','','actions'),cancel=el('button',t('取消')),confirm=el('button',t(isCard?'应用到槽位':'确认'),'primary optimization-picker-confirm');actions.append(...(isCard?[]:[cancel]),confirm);footer.append(actions);cancel.onclick=()=>dialog.close();
  let draft=isCard?current&&structuredClone(current):[...new Set(current??[])],error='',activeItemId=isCard?'':draft[0]??choices[0]?.id??'';
  const buttons=[],views=new Map(),itemLimit=isCard?null:contestExtraItemLimit(grade),itemCount=el('p','','optimization-picker-count small muted');itemCount.setAttribute('aria-live','polite');
  if(!isCard){const selectionStatus=el('div','','optimization-picker-selection-status');selectionStatus.append(clear,itemCount);footer.prepend(selectionStatus);}
  const filterPanel=el('div','','optimization-picker-filters'),flow=el('select'),enhanced=el('input'),toggles=el('div','','contest-loadout-toggles');
  enhanced.type='checkbox';enhanced.id='optimization-picker-enhanced';enhanced.checked=isCard&&(current?current.upgradeCount>0:true);enhanced.title=t('切换强化会重置本次附魔选择。');
  let flowIcons;
  if(isCard){
    flow.id='optimization-picker-flow';flow.append(new Option(t('全部流派'),''));
    for(const value of selectionFlowDefinitions)if(choices.some(choice=>choice.metadata.flows.includes(value.id)))flow.append(new Option(t(value.label),value.id));
    if(choices.some(choice=>!choice.metadata.flows.length))flow.append(new Option(t('未分类'),'unclassified'));
    flowIcons=choiceFilterIcons(flow,'flow','流派',applyFlow);const label=el('label');label.append(enhanced,el('span',t('强化')));toggles.append(label);filterPanel.append(flowIcons.group,toggles);
    enhanced.onchange=()=>{closeRewardPopover();if(draft)draft=defaultReference(choices.find(choice=>choice.id===draft.id));refreshVisuals();drawCustomizer();};
  }
  function applyFlow(){
    closeRewardPopover();
    for(const button of flowIcons.buttons){const selected=button.dataset.value===flow.value;button.setAttribute('aria-checked',String(selected));button.tabIndex=selected?0:-1;}
    for(const choice of choices){const view=views.get(choice.id);view.button.parentElement.hidden=Boolean(flow.value&&(flow.value==='unclassified'?choice.metadata.flows.length:!choice.metadata.flows.includes(flow.value)));}
    for(const section of grid.children)section.hidden=![...section.querySelectorAll('.optimization-picker-choice')].some(wrapper=>!wrapper.hidden);
    sync();body.scrollTop=0;
  }
  const defaultReference=choice=>({id:choice.id,upgradeCount:choice.versions.find(version=>version.upgradeCount===(enhanced.checked?1:0))?.upgradeCount??choice.versions[0].upgradeCount,customizes:[]});
  const selectedId=()=>isCard?draft?.id:activeItemId;
  const referenceFor=choice=>draft?.id===choice.id?draft:defaultReference(choice);
  function cardPopover(choice){
    const details=skillCardDetails(cardRewardInfo(referenceFor(choice),characterId),{recorded:true,chooseVersion:false});details.querySelector('.card-customizations')?.remove();return details;
  }
  function refreshVisuals(){
    if(!isCard)return;
    for(const choice of choices){const view=views.get(choice.id),reference=referenceFor(choice);view.art.replaceChildren(skillThumbnailFor(reference,characterId));view.button.querySelector('.selection-custom-count')?.remove();const count=reference.customizes.reduce((sum,entry)=>sum+entry.customizeCount,0);if(count){const badge=el('span',String(count),'selection-custom-count');badge.setAttribute('aria-label',t('附魔次数：{0}',[count]));view.button.append(badge);}if(view.popup.childElementCount)view.popup.replaceChildren(cardPopover(choice));}
  }
  function sync(){
    const visible=buttons.filter(button=>!button.parentElement.hidden),focusId=visible.some(button=>button.dataset.choiceId===selectedId())?selectedId():visible[0]?.dataset.choiceId;
    for(const button of buttons){const selected=isCard?button.dataset.choiceId===selectedId():draft.includes(button.dataset.choiceId);button.setAttribute('aria-checked',String(selected));button.tabIndex=button.dataset.choiceId===focusId?0:-1;if(!isCard)button.setAttribute('aria-disabled',String(!selected&&(itemLimit===null||draft.length>=itemLimit)));}
    error='';if(isCard&&draft){try{validateOptimizationExclusiveReference(context,{exclusiveId:draft.id,exclusiveReference:draft,grade});}catch{error=t('当前专属技能附魔不符合持有解锁或评级限制，请调整配置。');}}
    if(isCard&&draft&&!supportedReference(draft))error=t('此技能或附魔尚未被引擎支持，请更换配置。');
    confirm.disabled=isCard?(!draft||Boolean(error)):itemLimit===null||draft.length>itemLimit;if(!isCard)itemCount.textContent=t('额外道具 {0}/{1}',[draft.length,itemLimit??'—']);
  }
  function drawCustomizer(){
    if(!isCard){sync();return;}
    customizer.replaceChildren();const choice=choices.find(value=>value.id===draft?.id);
    if(!choice){customizer.append(el('p',t('请选择技能卡'),'small muted'));sync();return;}
    const notice=el('p','','message error');notice.setAttribute('role','status');
    const inline=el('div','','contest-inline-customizer'),previewSlot=el('div','','contest-selected-card-slot'),preview=el('button','','contest-selected-card'),settings=el('div','','contest-customizer-settings'),options=el('div','','contest-customizer-options');preview.setAttribute('aria-label',choice.name);previewSlot.append(preview);supportHint(preview,()=>cardPopover(choice),{container:previewSlot});previewSlot.querySelector('.support-reward-popover').classList.add('contest-customization-popover');settings.append(options);inline.append(previewSlot,settings);customizer.append(inline,notice);
    const data=cardCustomizations(draft),counts=Object.fromEntries((draft.customizes??[]).map(entry=>[entry.id,entry.customizeCount])),roleLimit=optimizationExclusiveCustomizationLimit(context,{exclusiveId:choice.id,grade}),limit=Math.min(data?.maximum??0,roleLimit??0),controls=[];
    for(const option of data?.options??[]){
      const levels=option.levels.filter(level=>supportedReference({...draft,customizes:[{id:option.id,customizeCount:level.level}]}));if(!levels.length)continue;
      const names=[...new Set(option.levels.flatMap(level=>level.effects.map(effect=>effect.name)).filter(Boolean))],label=names.join('／')||t('附魔'),row=el('div','','contest-customizer-stepper'),minus=el('button','−'),output=el('output'),plus=el('button','+');
      row.dataset.customizeId=option.id;row.dataset.colorKind=customizationColorKind(option);row.setAttribute('role','group');row.setAttribute('aria-label',label);minus.dataset.step='-1';plus.dataset.step='1';minus.setAttribute('aria-label',`${t('减少附魔次数')} · ${label}`);plus.setAttribute('aria-label',`${t('增加附魔次数')} · ${label}`);output.setAttribute('aria-live','polite');row.append(el('span',label,'contest-customizer-name'),minus,output,plus);options.append(row);controls.push({option:{...option,levels},row,minus,output,plus});
      const change=delta=>{counts[option.id]=(counts[option.id]??0)+delta;draft.customizes=Object.entries(counts).filter(([,value])=>value>0).map(([id,customizeCount])=>({id,customizeCount}));render();};minus.onclick=()=>change(-1);plus.onclick=()=>change(1);
    }
    if(!controls.length)options.append(el('p',t('当前技能卡版本没有可选附魔记录。'),'small muted'));
    function render(){
      const used=Object.values(counts).reduce((sum,count)=>sum+count,0);
      for(const control of controls){const count=counts[control.option.id]??0;control.output.value=String(count);control.minus.disabled=count<=0;control.plus.disabled=used>=limit||!control.option.levels.some(level=>level.level===count+1);control.row.classList.toggle('has-customization',count>0);}
      preview.replaceChildren(skillThumbnailFor(draft,characterId));if(used)preview.append(el('span',String(used),'selection-custom-count'));const popup=previewSlot.querySelector('.support-reward-popover');if(popup.childElementCount)popup.replaceChildren(cardPopover(choice));refreshVisuals();sync();notice.hidden=!error;notice.textContent=error;
    }
    render();
  }
  const itemRarityRank={LEGEND:4,SSR:3,SR:2,R:1,N:0};
  const choiceGroups=isCard?groupedInheritanceCardChoices(choices.map(choice=>({...choice,key:choice.id,reference:referenceFor(choice)}))):[{values:[...choices].sort((a,b)=>(itemRarityRank[b.metadata.rarity]??-1)-(itemRarityRank[a.metadata.rarity]??-1))}];
  if(isCard)grid.className='contest-loadout-groups optimization-picker-groups';
  for(const group of choiceGroups){
    let options=grid;
    if(isCard){
      const section=el('section','','selection-source-column'),label=group.flows.length?group.flows.map(id=>t(selectionFlowDefinitions.find(flow=>flow.id===id).label)).join('／'):group.plan==='Common'?t('通用'):t('{0} 通用',[planLabel(group.plan)]);
      options=el('div','','selection-source-options');section.dataset.source=group.id;section.append(el('h3',label),options);grid.append(section);
    }
    for(const choice of group.values){
      const name=isCard?idolInfo(context.idolCards.find(card=>card.idolCardId===choice.idolCardId)).name+' · '+choice.name:choice.name,wrapper=el('div','','selection-filter-choice optimization-picker-choice'),button=el('button','','selection-filter-choice optimization-picker-icon'),art=el('span','','support-reward-art');wrapper.dataset.choiceKind=button.dataset.choiceKind=isCard?'cards':'items';button.dataset.choiceId=choice.id;button.setAttribute('role',isCard?'radio':'checkbox');button.setAttribute('aria-label',name);button.append(art);wrapper.append(button);
      supportHint(button,()=>isCard?cardPopover(choice):itemRewardDetails(itemRewardInfo(choice.id)),{container:wrapper});const popup=wrapper.querySelector('.support-reward-popover');popup.classList.add('contest-customization-popover');const togglePopover=button.onclick;
      button.onclick=()=>{if(isCard){if(selectedId()!==choice.id)draft=defaultReference(choice);}else{activeItemId=choice.id;if(draft.includes(choice.id))draft=draft.filter(id=>id!==choice.id);else if(itemLimit!==null&&draft.length<itemLimit)draft.push(choice.id);}drawCustomizer();togglePopover();};
      button.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const visible=buttons.filter(value=>!value.parentElement.hidden),index=visible.indexOf(button),next=event.key==='Home'?0:event.key==='End'?visible.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+visible.length)%visible.length,target=visible[next],choice=choices.find(value=>value.id===target.dataset.choiceId);if(isCard){if(draft?.id!==choice.id)draft=defaultReference(choice);drawCustomizer();}else{activeItemId=target.dataset.choiceId;sync();}target.focus();};
      if(!isCard)art.append(itemThumbnail(itemRewardInfo(choice.id)));views.set(choice.id,{button,art,popup});options.append(wrapper);buttons.push(button);
    }
  }
  if(!choices.length)grid.append(el('p',t('没有匹配的选项'),'small muted'));
  clear.onclick=()=>{closeRewardPopover();draft=[];sync();};confirm.onclick=()=>{sync();if(confirm.disabled)return;onSelect(isCard?structuredClone(draft):[...draft]);dialog.close();};
  if(isCard){footer.classList.add('contest-card-footer');footer.prepend(el('span',t('已选：{0}',['']),'optimization-picked-label'),customizer);}dialog.append(head,...(isCard?[filterPanel]:[]),body,footer);document.body.append(dialog);refreshVisuals();drawCustomizer();if(isCard)applyFlow();dialog.addEventListener('close',()=>{closeRewardPopover();dialog.remove();onClose(dialog);},{once:true});openDialog(dialog,{returnFocus});return dialog;
}
