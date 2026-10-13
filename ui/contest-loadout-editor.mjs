import {conversionChoiceAvailable,conversionChoiceEnabled} from '../domain/card-conversions.mjs';
import {loadCardConversions} from '../application/card-conversion-preferences.mjs';
import {customizationColorKind} from './contest-customization-colors.mjs';
import {el,openDialog} from './dom.mjs';
import {t} from '../i18n.mjs';
import {choiceFilterIcons} from './choice-filter-icons.mjs';
import {cardInfo,cardRewardInfo,itemRewardInfo,cardCustomizations,selectionChoiceMetadata,selectionFlowDefinitions,planLabel} from '../domain/catalog.mjs';
import {groupedInheritanceCardChoices} from '../domain/memories.mjs';
import {contestSlotChoices,contestCustomizationValid,contestChoiceOwned} from '../domain/contest-loadout.mjs';
import {skillThumbnailFor,itemThumbnail} from './illustrations.mjs';
import {skillCardDetails} from './skill-card-details.mjs';
import {itemRewardDetails,supportHint,closeRewardPopover} from './card-rewards.mjs';

let dialog;
export function openContestLoadoutEditor({profile,catalog,memory,memoryIndex,slotIndex,kind='card',current,ownership={idolCardIds:new Set(),supportCardIds:new Set(),supportsKnown:false},includeIdolItems=true,onApply,returnFocus}){
  closeRewardPopover();
  if(!dialog){dialog=el('dialog','','contest-loadout-editor contest-loadout-picker');dialog.id='contest-loadout-editor';dialog.setAttribute('aria-labelledby','contest-loadout-editor-title');dialog.addEventListener('close',closeRewardPopover);document.body.append(dialog);}
  const isCard=kind==='card',head=el('div','','dialog-head'),title=el('h2',isCard?t('自定义技能槽位 {0}',[slotIndex+1]):current?t('替换 P 道具 {0}',[slotIndex+1]):t('添加 P 道具')),close=el('button',t('取消'));title.id='contest-loadout-editor-title';close.onclick=()=>dialog.close();head.append(title,close);
  let choices=contestSlotChoices(isCard?catalog.cards:catalog.items,{memoryIndex,slotIndex,planType:memory.planType,characterId:memory.characterId,kind,includeIdolItems});
  const currentId=isCard?current.id:current;
  const conversionPreferences=loadCardConversions(profile);
  const availableChoice=choice=>!isCard||conversionChoiceAvailable(choice,ownership.producerLevel);
  const restricted=choice=>isCard&&!conversionChoiceEnabled(choice,ownership.producerLevel,conversionPreferences);
  // 技能原槽位作为保留项补入；道具必须满足比赛候选规则。
  if(isCard&&slotIndex!==0&&currentId&&selectionChoiceMetadata('card',current).rarity!=='LEGEND'&&!choices.some(choice=>choice.id===currentId)){
    const original=(isCard?catalog.cards:catalog.items).find(choice=>choice.id===currentId);
    choices=[original??{id:currentId,name:isCard?cardInfo(current,memory.characterId).name:itemRewardInfo(currentId).name,metadata:selectionChoiceMetadata(kind,isCard?current:{id:currentId}),...(isCard?{versions:[{id:current.id,upgradeCount:current.upgradeCount>0?1:0,customizes:[]}]}:{})},...choices];
  }
  const plan=({2:'Plan1',3:'Plan2',4:'Plan3'})[memory.planType];
  const instructions=el('p',t(isCard?'选中技能后用加减按钮调整附魔，悬停卡片查看完整说明。':'勾选 P 道具，悬停或点击卡片查看说明。'),'small muted');
  const filters=el('div','','selection-picker-filters contest-loadout-filters'),planFilter=el('select'),flow=el('select'),rarity=el('select'),showN=el('input');
  showN.type='checkbox';showN.id='contest-loadout-show-n';showN.checked=false;
  planFilter.id='contest-loadout-plan';flow.id='contest-loadout-flow';rarity.id='contest-loadout-rarity';
  planFilter.append(new Option(t('全部'),''));for(const value of [plan,'Common'])if(choices.some(choice=>choice.metadata.plan===value))planFilter.append(new Option(value==='Common'?t('通用'):planLabel(value),value));
  flow.append(new Option(t('全部流派'),''));for(const value of selectionFlowDefinitions)if(choices.some(choice=>choice.metadata.flows.includes(value.id)))flow.append(new Option(t(value.label),value.id));
  flow.append(new Option(t('未分类'),'unclassified'));
  rarity.append(new Option(t('全部'),''));for(const value of isCard?['SSR','SR','R','N']:['SSR','SR','R'])if(choices.some(choice=>choice.metadata.rarity===value))rarity.append(new Option(value,value));
  const iconGroups=[];
  filters.classList.add('contest-memory-plan-flows','contest-item-filters');
  for(const [kind,text,input] of [['plan','计划',planFilter],['flow','流派',flow],['rarity','稀有度',rarity]]){
    const group=choiceFilterIcons(input,kind,text,()=>{syncIconFilters();drawChoices();});iconGroups.push(group);filters.append(group.group);
  }
  syncIconFilters();
  function syncIconFilters(){
    const available=choices.filter(choice=>availableChoice(choice)&&(!planFilter.value||choice.metadata.plan===planFilter.value)&&(!isCard||showN.checked||choice.metadata.rarity!=='N')),hasFlow=value=>!value||available.some(choice=>value==='unclassified'?!choice.metadata.flows.length:choice.metadata.flows.includes(value));
    if(!hasFlow(flow.value))flow.value='';
    for(const {input,buttons} of iconGroups)for(const button of buttons){button.hidden=input===flow&&!hasFlow(button.dataset.value)||input===rarity&&button.dataset.value==='N'&&!showN.checked;const selected=button.dataset.value===input.value;button.setAttribute('aria-checked',String(selected));button.tabIndex=selected?0:-1;}
  }

  const toggles=el('div','','contest-loadout-toggles'),enhanced=el('input'),ownedOnly=el('input');enhanced.type='checkbox';enhanced.id='contest-loadout-enhanced';enhanced.checked=!isCard||current.upgradeCount>0;ownedOnly.type='checkbox';ownedOnly.id='contest-loadout-owned';ownedOnly.checked=true;
  if(isCard){
    for(const [text,input] of [['强化',enhanced],['仅显示已持有',ownedOnly],['显示 N 稀有度',showN]]){const label=el('label');label.append(input,el('span',t(text)));toggles.append(label);}
    enhanced.title=t('切换强化会重置本次附魔选择。');
    if(!ownership.supportsKnown)toggles.append(el('small',t('持有情况未采集'),'muted'));
  }
  const listCount=el('p','','small muted'),list=el('div','','contest-loadout-groups'),footer=el('div','','contest-loadout-footer'),selection=el('span','','small'),error=el('p','','message'),apply=el('button',t('应用到槽位'),'primary');error.setAttribute('role','alert');error.hidden=true;footer.append(selection,error,apply);
  const customizer=el('section','','contest-inline-customizer');
  if(isCard){footer.classList.add('contest-card-footer');footer.insertBefore(customizer,error);}
  dialog.replaceChildren(head,instructions,filters,...(isCard?[toggles]:[]),el('hr','','contest-memory-divider'),listCount,list,footer);
  let selected=choices.find(choice=>choice.id===currentId)??null;const drafts=new Map(),views=new Map();
  const availableVersion=(choice,enhanced)=>choice.versions.find(value=>value.upgradeCount===(enhanced?1:0))??choice.versions.find(value=>value.upgradeCount<=1);
  if(isCard&&selected){const version=availableVersion(selected,enhanced.checked);drafts.set(currentId,{...version,customizes:current.upgradeCount===version.upgradeCount?(current.customizes??[]).map(value=>({...value})):[]});}
  if(isCard&&selected&&(!availableChoice(selected)||!showN.checked&&selected.metadata.rarity==='N'))selected=null;
  function referenceFor(choice){
    if(!drafts.has(choice.id))drafts.set(choice.id,{...availableVersion(choice,enhanced.checked),customizes:[]});return drafts.get(choice.id);
  }
  function syncSelection(){
    error.hidden=true;apply.disabled=!selected;selection.textContent=selected?t('已选：{0}',[isCard?'':selected.name]):t(isCard?'请选择技能卡':'请选择 P 道具');
    for(const [id,view] of views){view.input.checked=id===selected?.id;view.button.setAttribute('aria-pressed',String(id===selected?.id));}
    if(isCard)renderCustomizer();
  }
  function updateVisual(choice){
    const view=views.get(choice.id);if(!view)return;
    view.art.replaceChildren(isCard?skillThumbnailFor(referenceFor(choice),memory.characterId):itemThumbnail(itemRewardInfo(choice.id)));
    view.button.querySelector('.selection-custom-count')?.remove();
    if(isCard){const count=referenceFor(choice).customizes.reduce((sum,value)=>sum+value.customizeCount,0);if(count){const badge=el('span',String(count),'selection-custom-count');badge.setAttribute('aria-label',t('附魔次数：{0}',[count]));view.button.append(badge);}}
  }
  function choose(choice){
    if(isCard&&selected?.id!==choice.id){
      for(const [id,reference] of drafts){
        drafts.set(id,{...reference,customizes:[]});const entry=choices.find(value=>value.id===id);updateVisual(entry);
        const popup=views.get(id)?.button.parentElement.querySelector('.support-reward-popover');if(popup?.childElementCount)popup.replaceChildren(cardPopover(entry));
      }
    }
    selected=choice;syncSelection();
  }
  function cardPopover(choice){
    const reward=cardRewardInfo(referenceFor(choice),memory.characterId);
    const details=reward.versions.length?skillCardDetails(reward,{recorded:true,chooseVersion:false}):el('p',t('技能说明暂未收录。'),'small muted');
    details.querySelector('.card-customizations')?.remove();
    if(restricted(choice))details.prepend(el('p',t('非当前转换版本，在实际比赛中视为空技能卡槽位。'),'small muted'));
    if(choice.metadata.source==='common'&&Number.isSafeInteger(choice.unlockProducerLevel)&&choice.unlockProducerLevel>0)details.prepend(el('small',t('P{0} 解锁',[choice.unlockProducerLevel]),'muted'));
    return details;
  }
  function renderCustomizer(){
    customizer.replaceChildren();
    if(!selected)return;
    const choice=selected,reference=referenceFor(choice),data=cardCustomizations(reference);
    const preview=el('button','','contest-selected-card'),previewSlot=el('div','','contest-selected-card-slot'),settings=el('div','','contest-customizer-settings');preview.setAttribute('aria-label',cardInfo(reference,memory.characterId).name);previewSlot.append(preview);supportHint(preview,()=>cardPopover(choice),{container:previewSlot});customizer.append(previewSlot,settings);
    const options=el('div','','contest-customizer-options'),controls=[];settings.append(options);
    if(reference.customizes.some(value=>!data?.options.some(option=>option.id===value.id)))customizer.append(el('p',t('未收录的当前附魔会保留；切换技能卡后清除。'),'small muted'));
    for(const option of data?.options??[]){
      const names=[...new Set(option.levels.flatMap(level=>level.effects.map(effect=>effect.name)).filter(Boolean))],label=names.join('／')||t('附魔'),row=el('div','','contest-customizer-stepper'),minus=el('button','−'),value=el('output'),plus=el('button','+'),text=el('span',label,'contest-customizer-name');
      row.dataset.customizeId=option.id;row.dataset.colorKind=customizationColorKind(option);row.setAttribute('role','group');row.setAttribute('aria-label',label);minus.type=plus.type='button';minus.dataset.step='-1';plus.dataset.step='1';minus.setAttribute('aria-label',`${t('减少附魔次数')} · ${label}`);plus.setAttribute('aria-label',`${t('增加附魔次数')} · ${label}`);value.setAttribute('aria-live','polite');
      row.append(text,minus,value,plus);options.append(row);controls.push({option,minus,value,plus});
      const change=delta=>{
        const active=referenceFor(choice),own=active.customizes.find(entry=>entry.id===option.id)?.customizeCount??0,customizes=active.customizes.filter(entry=>entry.id!==option.id);
        if(own+delta>0)customizes.push({id:option.id,customizeCount:own+delta});
        drafts.set(choice.id,{...active,customizes});refresh();
      };
      minus.onclick=()=>change(-1);plus.onclick=()=>change(1);
    }
    if(!data?.options.length)options.append(el('p',t('当前技能卡版本没有可选附魔记录。'),'small muted'));
    function sync(){
      const active=referenceFor(choice),used=active.customizes.reduce((sum,entry)=>sum+entry.customizeCount,0);
      for(const control of controls){const own=active.customizes.find(entry=>entry.id===control.option.id)?.customizeCount??0;control.value.value=String(own);control.minus.disabled=own<=0;control.plus.disabled=used>=data.maximum||!control.option.levels.some(level=>level.level===own+1);control.value.closest('.contest-customizer-stepper').classList.toggle('has-customization',own>0);}
    }
    function refresh(){
      error.hidden=true;sync();updateVisual(choice);updatePreview();
      const popup=views.get(choice.id)?.button.parentElement.querySelector('.support-reward-popover');if(popup?.childElementCount)popup.replaceChildren(cardPopover(choice));
    }
    function updatePreview(){
      const active=referenceFor(choice);preview.replaceChildren(skillThumbnailFor(active,memory.characterId));
      const used=active.customizes.reduce((sum,entry)=>sum+entry.customizeCount,0);if(used){const badge=el('span',String(used),'selection-custom-count');preview.append(badge);}
      const popup=previewSlot.querySelector('.support-reward-popover');if(popup.childElementCount)popup.replaceChildren(cardPopover(choice));
    }
    sync();updatePreview();
  }
  function drawChoices(){
    closeRewardPopover();views.clear();list.replaceChildren();
    const visible=choices.filter(choice=>availableChoice(choice)&&(!planFilter.value||choice.metadata.plan===planFilter.value)&&(!flow.value||(flow.value==='unclassified'?!choice.metadata.flows.length:choice.metadata.flows.includes(flow.value)))&&(!rarity.value||choice.metadata.rarity===rarity.value)&&(!isCard||showN.checked||choice.metadata.rarity!=='N')&&(!isCard||!ownedOnly.checked||contestChoiceOwned(choice,ownership,currentId)));
    listCount.textContent=t('候选：{0}',[visible.length]);
    const groups=[];
    for(const [id,label] of [['idol','角色专属'],['support','支援卡'],['common','通用'],['unknown','未分类']]){
      const matches=visible.filter(choice=>choice.metadata.source===id);if(!matches.length)continue;
      if(isCard&&id==='common')for(const group of groupedInheritanceCardChoices(matches.map(choice=>({...choice,key:choice.id,reference:referenceFor(choice)})))){
        const label=group.flows.length?group.flows.map(id=>t(selectionFlowDefinitions.find(flow=>flow.id===id).label)).join('／'):group.plan==='Common'?t('通用'):t('{0} 通用',[planLabel(group.plan)]);groups.push({id:`common-${group.id}`,label,matches:group.values});
      }else groups.push({id,label:t(label),matches});
    }
    for(const group of groups){
      const section=el('section','','selection-source-column'),heading=el('h3',group.label),options=el('div','','selection-source-options');section.dataset.source=group.id;heading.append(el('span',String(group.matches.length),'selection-source-count'));section.append(heading,options);
      for(const choice of group.matches){
        const wrapper=el('div','','selection-filter-choice contest-loadout-choice'),button=el('button','','contest-loadout-art'),art=el('span','','support-reward-art'),input=el('input');input.type='checkbox';input.name='contest-loadout-choice';input.value=choice.id;input.setAttribute('aria-label',choice.name);input.onchange=()=>choose(choice);
        wrapper.dataset.choiceKind=isCard?'cards':'items';wrapper.dataset.choiceId=choice.id;wrapper.dataset.source=choice.metadata.source;wrapper.dataset.plan=choice.metadata.plan;wrapper.dataset.owner=choice.metadata.ownerCharacterId??'';wrapper.dataset.supportCardId=choice.supportCardId??'';button.setAttribute('aria-label',choice.name);button.append(art);wrapper.append(button,input);
        if(restricted(choice)){wrapper.dataset.conversionRestricted='true';const badge=el('span',t('限制'),'contest-conversion-restricted');badge.title=t('非当前转换版本，在实际比赛中视为空技能卡槽位。');wrapper.append(badge);}
        supportHint(button,()=>isCard?cardPopover(choice):itemRewardDetails(itemRewardInfo(choice.id)),{container:wrapper});wrapper.querySelector('.support-reward-popover').classList.add('contest-customization-popover');
        const togglePopover=button.onclick;button.onclick=()=>{togglePopover();choose(choice);};views.set(choice.id,{input,button,art});updateVisual(choice);options.append(wrapper);
      }
      list.append(section);
    }
    if(!visible.length)list.append(el('p',t('没有匹配选项'),'empty-result'));syncSelection();list.scrollTop=0;
  }
  showN.onchange=()=>{
    if(!showN.checked){if(rarity.value==='N')rarity.value='';if(selected?.metadata.rarity==='N')selected=null;}
    syncIconFilters();drawChoices();
  };
  ownedOnly.onchange=()=>{
    if(ownedOnly.checked&&selected&&!contestChoiceOwned(selected,ownership,currentId))selected=null;
    drawChoices();
  };
  enhanced.onchange=()=>{
    for(const [id,reference] of drafts){const version=availableVersion(choices.find(choice=>choice.id===id),enhanced.checked);if(version.upgradeCount!==reference.upgradeCount)drafts.set(id,{...version,customizes:[]});}
    drawChoices();
  };
  apply.onclick=()=>{
    if(!selected)return;
    const reference=isCard?referenceFor(selected):null;
    if(isCard&&!availableChoice(selected))return;
    if(isCard&&(reference.upgradeCount>1||!contestCustomizationValid(cardCustomizations(reference),reference.customizes)&&JSON.stringify(reference)!==JSON.stringify(current))){error.textContent=t('请检查附魔选项与累计次数。');error.hidden=false;return;}
    closeRewardPopover();onApply(isCard?{...reference,customizes:reference.customizes.map(value=>({...value}))}:selected.id);dialog.close();
  };
  drawChoices();openDialog(dialog,{returnFocus});
}
