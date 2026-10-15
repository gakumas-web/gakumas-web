import {el,openDialog} from './dom.mjs';
import {t,locale} from '../i18n.mjs';
import {contestStageName} from './contest-stage-summary.mjs';
import {contestMemoryCards} from '../domain/contest-simulation.mjs';
import {characterInfo,itemRewardInfo,contestCardNoDeckDuplication} from '../domain/catalog.mjs';
import {itemThumbnail} from './illustrations.mjs';
import {recordedSkill} from './memories.mjs';
import {closeRewardPopover} from './card-rewards.mjs';
import {simulationHistory,deleteSimulationRun,SIMULATION_HISTORY_LIMIT} from '../application/contest-simulation-history.mjs';
import {createSavedLoadout,savedSimulationLoadouts,saveSimulationLoadout,deleteSimulationLoadout} from '../application/contest-saved-loadouts.mjs';

export function loadoutPreview(loadout,conversionRules){
  const entries=conversionRules?contestMemoryCards(loadout.memories,contestCardNoDeckDuplication,conversionRules):null;
  const preview=el('div','','loadout-library-preview');
  for(const [index,memory] of loadout.memories.entries()){
    if(!memory)continue;
    const row=el('div','','loadout-library-memory'),cards=el('div','','loadout-library-cards');
    row.append(el('small',t(index===0?'主回忆':'副回忆')));
    for(const [cardIndex,card] of (memory.examBattleProduceCards??[]).entries()){
      const hint=recordedSkill(card,memory.characterId),entry=entries?.find(value=>value.memoryIndex===index&&value.cardIndex===cardIndex);
      if(entry&&!entry.retained){hint.classList.add('season-card-overridden');hint.append(el('span',t(entry.exclusion==='conversion'?'限制':'重复'),'season-duplicate-badge'));}
      cards.append(hint);
    }
    row.append(cards);preview.append(row);
  }
  const items=el('div','','loadout-library-items');
  for(const id of loadout.memories[0]?.examBattleProduceItemIds??[])items.append(itemThumbnail(itemRewardInfo(id)));
  if(items.childElementCount)preview.prepend(items);
  return preview;
}

export function createContestLoadoutLibrary({profile,lifecycleId,getCurrent,onRestore,onChange}){
  const element=el('div','','season-loadout-actions'),open=el('button',t('读取回忆编组'),'season-loadout-library-open'),save=el('button',t('保存编组'),'season-loadout-save');element.append(open,save);
  element.append(el('span',t('仅保存到当前浏览器，不包含在账号数据包中。'),'small muted loadout-local-notice'));
  let dialog=null,disposed=false,available=false,view='history',revision=0;
  function show(source=null){
    if(disposed||dialog)return;
    closeRewardPopover();if(source)view='saved';
    dialog=el('dialog','','contest-loadout-library');dialog.id='contest-loadout-library';dialog.setAttribute('aria-labelledby','contest-loadout-library-title');
    const currentDialog=dialog,heading=el('div','','dialog-head'),title=el('h2',t('回忆编组')),close=el('button',t('关闭'));title.id='contest-loadout-library-title';const headingText=el('div','','loadout-library-heading-text');headingText.append(title);heading.append(headingText,close);
    const tabs=el('div','','simulation-segments loadout-library-tabs'),historyTab=el('button',t('历史')),savedTab=el('button',t('已保存')),filter=el('select'),filterLabel=el('label',t('舞台筛选'),'loadout-library-filter');filter.setAttribute('aria-label',t('舞台筛选'));filterLabel.replaceChildren(el('span',t('舞台筛选'),'sr-only'),filter);tabs.append(historyTab,savedTab);
    const idolFilter=el('select'),idolLabel=el('label','','loadout-library-filter'),filters=el('div','','loadout-library-filters'),toolbar=el('div','','loadout-library-toolbar');idolFilter.setAttribute('aria-label',t('偶像筛选'));idolLabel.append(el('span',t('偶像筛选'),'sr-only'),idolFilter);filters.append(filterLabel,idolLabel);toolbar.append(tabs,filters);
    const note=el('p','','small muted'),status=el('p','','loadout-library-status small muted'),list=el('div','','loadout-library-list');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const form=el('form','','loadout-library-name-form'),nameLabel=el('label',t('编组名称')),name=el('input'),submit=el('button',t('保存'),'primary'),cancel=el('button',t('取消'));name.maxLength=60;name.required=true;name.id='loadout-library-name';nameLabel.htmlFor=name.id;submit.type='submit';form.hidden=true;form.append(nameLabel,name,submit,cancel);
    headingText.append(note);currentDialog.append(heading,toolbar,form,status,list);document.body.append(currentDialog);
    let history=[],saved=[],selectedStage='all',selectedIdol='all',pending=null,busy=false;
    const active=()=>!disposed&&dialog===currentDialog;
    const defaultName=entry=>`${characterInfo(entry.loadout.memories[0].characterId).name} · ${contestStageName(entry.stage)}`.slice(0,60);
    function edit(entry,previous=null){pending={entry,previous};form.hidden=false;name.value=previous?.name??defaultName(entry);status.textContent='';name.focus();name.select();}
    function draw(){
      closeRewardPopover();
      historyTab.setAttribute('aria-pressed',String(view==='history'));savedTab.setAttribute('aria-pressed',String(view==='saved'));
      const stages=new Map([...history,...saved].map(entry=>[entry.stageKey,contestStageName(entry.stage)]));
      if(selectedStage!=='all'&&!stages.has(selectedStage))selectedStage='all';
      filter.replaceChildren(new Option(t('全部舞台'),'all'),...[...stages].map(([key,label])=>new Option(label,key)));filter.value=selectedStage;
      const idols=new Map([...history,...saved].map(entry=>{const id=entry.loadout.memories[0].characterId;return [id,characterInfo(id).name];}));
      if(selectedIdol!=='all'&&!idols.has(selectedIdol))selectedIdol='all';
      idolFilter.replaceChildren(new Option(t('全部偶像'),'all'),...[...idols].map(([key,label])=>new Option(label,key)));idolFilter.value=selectedIdol;
      note.textContent=t(view==='history'?'完成模拟后自动加入历史，每个舞台保留最近 {0} 次；重要编组可另存到“已保存”。':'已保存编组仅保存在当前浏览器，按账号隔离，不随模拟历史淘汰。',[SIMULATION_HISTORY_LIMIT]);
      const entries=(view==='history'?history:saved).filter(entry=>(selectedStage==='all'||entry.stageKey===selectedStage)&&(selectedIdol==='all'||entry.loadout.memories[0].characterId===selectedIdol));list.replaceChildren();
      if(!entries.length)list.append(el('p',t((view==='history'?history:saved).length?'没有符合筛选条件的编组。':view==='history'?'暂无编组历史，完成一次模拟后会自动加入。':'暂无已保存编组。'),'empty-result'));
      for(const entry of entries){
        const row=el('article','','loadout-library-entry');row.dataset.loadoutId=entry.id;
        const head=el('div','','loadout-library-entry-heading'),date=el('time',new Intl.DateTimeFormat(locale(),{dateStyle:'short',timeStyle:'short'}).format(new Date(entry.updatedAt??entry.createdAt)));
        const identity=el('div','','loadout-library-entry-identity');identity.append(el('strong',entry.name??characterInfo(entry.loadout.memories[0].characterId).name));head.append(identity,date);
        const stage=el('p',contestStageName(entry.stage),'small muted'),actions=el('div','','loadout-library-entry-actions'),load=el('button',t('载入编组'),'loadout-library-load'),keep=el('button',t(view==='history'?'保存编组':'重命名'),'loadout-library-keep'),remove=el('button',t('删除'),'loadout-library-delete');
        load.onclick=()=>{if(busy)return;if(onRestore(entry)===false){status.textContent=t('当前资料已不包含此舞台，无法载入编组。');return;}currentDialog.close();};
        keep.onclick=()=>{if(!busy)edit(entry,view==='saved'?entry:null);};
        remove.onclick=async()=>{
          if(busy)return;
          if(!remove.dataset.confirmed){remove.dataset.confirmed='true';remove.textContent=t('确认删除');return;}
          busy=true;list.inert=true;form.inert=true;
          try{await (view==='history'?deleteSimulationRun:deleteSimulationLoadout)(profile,entry.id);onChange?.();await refresh();}
          catch{if(active()){status.textContent=t('编组删除失败，请重试。');remove.disabled=false;}}
          finally{busy=false;list.inert=false;form.inert=false;}
        };
        actions.append(load,keep,remove);identity.prepend(stage);row.append(head,loadoutPreview(entry.loadout),actions);list.append(row);
      }
    }
    async function refresh(){
      const ticket=++revision;
      try{
        const entries=await Promise.all([simulationHistory(profile),savedSimulationLoadouts(profile)]);
        if(!active()||ticket!==revision)return;
        history=entries[0].filter(entry=>entry.loadout?.memories?.length===2&&entry.loadout.memories.every(Boolean));saved=entries[1];draw();
      }catch{if(active())status.textContent=t('编组读取失败，请关闭后重试。');}
    }
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||!pending)return;
      if(!name.value.trim()){name.setCustomValidity(t('请输入编组名称。'));name.reportValidity();return;}
      busy=true;submit.disabled=true;cancel.disabled=true;list.inert=true;const entry=createSavedLoadout(pending.entry,name.value,pending.previous);
      try{
        await saveSimulationLoadout(profile,entry,lifecycleId);
        if(active()){pending=null;form.hidden=true;view='saved';selectedStage='all';selectedIdol='all';await refresh();status.textContent=t('编组已保存。');savedTab.focus();}
      }catch{if(active())status.textContent=t('编组保存失败，请重试。');}
      finally{busy=false;submit.disabled=false;cancel.disabled=false;list.inert=false;}
    };
    name.oninput=()=>name.setCustomValidity('');cancel.onclick=()=>{pending=null;form.hidden=true;};
    historyTab.onclick=()=>{if(!busy){view='history';pending=null;form.hidden=true;draw();}};savedTab.onclick=()=>{if(!busy){view='saved';pending=null;form.hidden=true;draw();}};filter.onchange=()=>{selectedStage=filter.value;draw();};idolFilter.onchange=()=>{selectedIdol=idolFilter.value;draw();};
    close.onclick=()=>currentDialog.close();currentDialog.addEventListener('close',()=>{closeRewardPopover();if(dialog===currentDialog)dialog=null;revision++;currentDialog.remove();});
    draw();openDialog(currentDialog,{returnFocus:()=>document.querySelector('.season-loadout-library-open')});void refresh();if(source)edit(source);
  }
  open.onclick=()=>show();save.onclick=()=>{if(available)show(getCurrent());};save.disabled=true;
  return {element,saveEntry:source=>show(source),update(value){available=value;save.disabled=!value;},dispose(){disposed=true;revision++;dialog?.close();dialog?.remove();dialog=null;}};
}
