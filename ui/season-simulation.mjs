import {createChoiceNavigation} from './choice-navigation.mjs';
import {updateMemoryPower} from '../domain/memory-power.mjs';
import {memoryPower} from '../domain/catalog.mjs';
import {contestExtraItemLimit} from '../domain/contest-item-rules.mjs';
import {createContestOptimization} from './contest-optimization.mjs';
import {cardConversionRules} from '../domain/card-conversions.mjs';
import {loadCardConversions,saveCardConversions} from '../application/card-conversion-preferences.mjs';
import {openContestCardConversionSettings} from './contest-card-conversions.mjs';
import {accountProducerLevel} from '../domain/catalog.mjs';
import {createContestSeasonPicker} from './contest-season-picker.mjs';
import {contestStageSummary,contestStageName,contestPlanName} from './contest-stage-summary.mjs';
import {el} from './dom.mjs';
import {createInfoDisclosure} from './info-disclosure.mjs';
import {t} from '../i18n.mjs';
import {contestCatalog,contestCardConversions,contestCardNoDeckDuplication,cardRewardInfo,itemRewardInfo,memoryExclusiveSkill,contestCustomizationCatalog,contestFixedItemIds} from '../domain/catalog.mjs';
import {contestMemoryEntries,contestMemoryTotals,contestMemoryCards,contestSupportBonus,contestSeasonGroups} from '../domain/contest-simulation.mjs';
import {contestMemorySlot,contestMemoryBoard,contestTeamSummary,openContestMemoryPicker} from './contest-memory-picker.mjs';
import {rewardHint,supportHint,itemRewardSummary,closeRewardPopover} from './card-rewards.mjs';
import {effectReading} from './effect-view.mjs';
import {itemThumbnail,filterSymbol} from './illustrations.mjs';
import {semanticContent} from './semantic-view.mjs';
import {createContestSimulationRequest} from '../domain/contest-engine-request.mjs';
import {createContestSimulationPanel} from './contest-simulation-result.mjs';
import {contestScoreCurve} from './contest-score-curve.mjs';
import {createContestMemoryDraft,contestExtraItemCount} from '../domain/contest-loadout.mjs';
import {openContestLoadoutEditor} from './contest-loadout-editor.mjs';
import {captureSimulationLoadout} from '../application/contest-simulation-history.mjs';
import {contestMemoryCost,contestRatingRules,contestRulesHelp} from './contest-card-cost.mjs';
import {createContestLoadoutLibrary} from './contest-loadout-library.mjs';
import {createContestRecommendations} from './contest-recommendations.mjs';
const planName=contestPlanName;
function stageItem(reward){
  const row=el('div','','season-stage-item'),button=el('button','','season-stage-item-icon');button.setAttribute('aria-label',reward.name);button.append(itemThumbnail(reward));
  const hint=supportHint(button,()=>itemRewardSummary(reward));hint.querySelector('.support-reward-popover').classList.add('season-stage-item-name');
  const description=el('div','','season-stage-item-description'),content=semanticContent({entries:[reward.description]});content.querySelector('h4')?.remove();description.append(content);row.append(hint,description);return row;
}

export function createSeasonSimulation({profile,lifecycleId,memories,idolCards=[],supportCards,producerExp,initialState,onOpenMemory}){
  const catalog=contestCatalog(),groups=contestSeasonGroups(catalog.choices),element=el('section','','season-simulation-dialog season-simulation-page');element.id='season-simulation-page';element.setAttribute('aria-label',t('赛季模拟'));
  if(!groups.length){element.append(el('p',t('当前资料尚未包含比赛配置，请更新资料后重试。')));return {element,dispose(){}};}
  const tabs=el('div','','season-stage-tabs'),content=el('section','','season-stage-content');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',t('选择舞台'));content.id='season-stage-content';content.setAttribute('role','tabpanel');
  const picker=createContestSeasonPicker(groups,group=>activate(group.stages[0]));const taskList=el('div','','season-simulation-tasks');taskList.setAttribute('aria-label',t('模拟任务'));taskList.hidden=true;element.append(tabs,taskList,content);
  const workspaces=new Map(),saved=new Map(initialState?.stageStates??[]);let currentStage=initialState?.stage??groups[0].stages[0],currentGroup;
  const producerLevel=accountProducerLevel(producerExp);
  let conversionPreferences=loadCardConversions(profile),conversionRules=cardConversionRules(contestCardConversions(),producerLevel,conversionPreferences);
  const getConversionRules=()=>conversionRules;
  function openConversions(){
    openContestCardConversionSettings({choices:contestCustomizationCatalog().cards,level:producerLevel,preferences:conversionPreferences,onChange:next=>{
      saveCardConversions(profile,next);conversionPreferences=next;conversionRules=cardConversionRules(contestCardConversions(),producerLevel,next);
      for(const workspace of workspaces.values())workspace.refreshConversions();
    }});
  }

  const jump=el('button',t('前往模拟'),'season-jump-simulation');jump.type='button';
  jump.onclick=()=>{picker.hide();const title=content.querySelector('#contest-simulation-result-title');if(title){title.tabIndex=-1;title.focus({preventScroll:true});title.scrollIntoView({block:'start'});}};
  picker.element.insertBefore(jump,picker.element.querySelector('.season-activity-toggle'));
  const tasks=new Map();
  function drawTasks(){
    for(const button of tabs.children){
      button.querySelector('.season-stage-task-status')?.remove();
      const states=[...tasks.values()].filter(task=>task.stage.id===button.dataset.stageId);
      if(states.length)button.append(el('small',t(states.some(task=>task.state==='running')?'模拟中':'已完成'),'season-stage-task-status'));
    }
    taskList.replaceChildren();
    for(const task of tasks.values()){
      if(task.state!=='running'&&(task.seen||task.stage.id===currentStage.id))continue;
      const row=el('div','','season-simulation-task'),label=el('span',`${contestStageName(task.stage)} · ${t(({recommended:'推荐编组模拟',optimization:'自定义推荐编组模拟',selected:'自选编组模拟'})[task.mode])} · ${t(task.state==='running'?'模拟中':'已完成')}`),view=el('button',t('查看任务'));
      view.onclick=()=>{activate(task.stage);workspaces.get(task.stage.id).showTask(task.mode);content.querySelector('.contest-simulation-result')?.scrollIntoView({block:'start'});};row.append(label,view);
      if(task.state==='running'){const stop=el('button',t('停止'));stop.onclick=()=>task.stop();row.append(stop);}taskList.append(row);
    }
    taskList.hidden=!taskList.childElementCount;
  }
  function taskChanged(stage,mode,task){
    const key=`${stage.id}:${mode}`;
    if(task.state==='stopped')tasks.delete(key);else tasks.set(key,{...task,stage,mode,seen:stage.id===currentStage.id});
    drawTasks();
  }
  const narrow=matchMedia('(max-width:699px)'),syncOrientation=()=>tabs.setAttribute('aria-orientation',narrow.matches?'vertical':'horizontal');narrow.addEventListener('change',syncOrientation);syncOrientation();
  function activate(stage){
    closeRewardPopover();currentStage=stage;for(const task of tasks.values())if(task.stage.id===stage.id&&task.state==='completed')task.seen=true;const group=groups.find(group=>group.stages.some(value=>value.id===stage.id));
    if(!group)return;picker.update(group);
    if(currentGroup!==group.id){
      currentGroup=group.id;tabs.dataset.stageCount=String(group.stages.length);tabs.style.setProperty('--stage-count',String(group.stages.length));tabs.replaceChildren();
      const navigateStages=createChoiceNavigation({getButtons:()=>[...tabs.children],onMove:button=>button.click()});
      for(const [index,value] of group.stages.entries()){
        const button=el('button','','season-stage-tab');button.id=`season-stage-tab-${index}`;button.dataset.stageId=value.id;button.setAttribute('role','tab');button.setAttribute('aria-controls',content.id);button.setAttribute('aria-label',contestStageName(value));button.append(contestStageSummary(value,{withinSeason:true}));button.onclick=()=>activate(value);
        button.onkeydown=navigateStages;tabs.append(button);
      }
    }
    for(const button of tabs.children){const selected=button.dataset.stageId===stage.id;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;if(selected)content.setAttribute('aria-labelledby',button.id);}
    if(!workspaces.has(stage.id)){
      const workspace=createStageWorkspace({profile,lifecycleId,memories,idolCards,supportCards,producerExp,stage,getConversionRules,onOpenConversions:openConversions,initialState:saved.get(stage.id),onOpenMemory,onTaskChange:(mode,task)=>taskChanged(stage,mode,task),onQuickStage:(targetId,loadout)=>{
        const target=catalog.choices.find(value=>value.id===targetId);if(!target)return;
        activate(target);workspaces.get(target.id).useLoadout(loadout);content.scrollIntoView({block:'start'});
      },onRestore:entry=>{
        const target=catalog.choices.find(value=>value.id===entry.stage.id||value.kind===entry.stage.kind&&entry.stage.preset?.id!==undefined&&value.preset?.id===entry.stage.preset.id);if(!target||!entry.loadout)return false;
        activate(target);const restored=workspaces.get(target.id).restore(entry);if(restored)content.scrollIntoView({block:'start'});return restored;
      }});saved.delete(stage.id);workspaces.set(stage.id,workspace);
    }
    if(content.firstElementChild!==workspaces.get(stage.id).element)content.replaceChildren(workspaces.get(stage.id).element);
    drawTasks();
  }
  activate(currentStage);
  return {element,controls:picker.element,hidePicker:picker.hide,dispose(){picker.dispose();for(const workspace of workspaces.values())workspace.dispose();narrow.removeEventListener('change',syncOrientation);closeRewardPopover();},captureState(){return {stage:currentStage,stageStates:[...saved,...[...workspaces].map(([id,workspace])=>[id,workspace.captureState()])]};},useMemory(memory){
    const planType=({2:'ProducePlanType_Plan1',3:'ProducePlanType_Plan2',4:'ProducePlanType_Plan3'})[memory?.planType],group=groups.find(group=>group.id===currentGroup);
    const stage=currentStage.planType===planType?currentStage:group.stages.find(value=>value.planType===planType)??catalog.choices.find(value=>value.kind==='contest'&&value.planType===planType);if(!stage)return false;
    activate(stage);return workspaces.get(stage.id).useMemory(memory);
  }};
}

function createStageWorkspace({profile,lifecycleId,memories,idolCards,supportCards,producerExp,stage,getConversionRules,onOpenConversions,initialState,onOpenMemory,onRestore,onQuickStage,onTaskChange}){
  const dialog=el('div','','season-stage-workspace'),body=el('div','','season-simulation-body');dialog.append(body);
  const catalog=contestCatalog(),editCatalog=contestCustomizationCatalog(),ownedIdols=new Map(idolCards.map(card=>[card.idolCardId,card]));
  const rules=el('div','','season-stage-rules'),ruleSection=el('section','','season-rules-section'),ruleTitle=el('h2',t('舞台规则')),results=el('section','','season-memory-results');ruleTitle.id='season-rules-title';ruleSection.setAttribute('aria-labelledby',ruleTitle.id);const ruleHeading=el('div','','season-rules-heading season-section-heading'),rulePlan=el('span','','contest-stage-plan season-rules-plan');ruleHeading.append(ruleTitle,rulePlan);ruleSection.append(ruleHeading,rules);body.append(ruleSection,results);
  let selected=Array(2).fill(null),drafts=Array(2).fill(null),editing=[false,false],currentStage=stage,rows=[],manual={};
  const manualBox=el('fieldset','','season-manual-multipliers');manualBox.append(el('legend',t('比赛倍率（%）')),el('p',t('活动和链接比赛使用独立倍率，请填写比赛界面中的百分比。'),'small muted'));
  const manualInputs={};for(const [index,key] of ['vocal','dance','visual'].entries()){const input=el('input');input.type='number';input.min='0';input.step='0.1';input.placeholder=t('未填写');input.id='season-manual-'+key;manualInputs[key]=input;const label=el('label',['Vo','Da','Vi'][index]);label.append(input);manualBox.append(label);input.oninput=()=>{manual[key]=input.value.trim()!==''&&input.validity.valid?Number(input.value):undefined;drawRows();};}body.insertBefore(manualBox,results);
  const count=el('p','','small muted'),slots=el('div','','season-memory-slots'),pickers=el('div','','season-memory-choices'),team=el('div','','season-team-preview');
  const bonus=contestSupportBonus(supportCards);
  const methodHint=el('p','','small muted'),loadoutBody=el('div','','season-loadout-body');loadoutBody.append(pickers,team,slots);results.append(el('p',t('选择主回忆和副回忆后即可开始模拟，属性、P 道具与卡组会自动带入。副回忆仅加算 20% 属性（含体力，向下取整），不提供 P 道具。'),'small muted'),contestRulesHelp(contestRatingRules()),count,loadoutBody,methodHint);
  let simulationPanel;
  const loadoutLibrary=createContestLoadoutLibrary({profile,lifecycleId,getCurrent:()=>({stage:currentStage,loadout:captureSimulationLoadout(drafts,manual,selected)}),onRestore,onChange:()=>simulationPanel?.refreshHistory()});loadoutBody.prepend(loadoutLibrary.element);
  const recommendations=createContestRecommendations({getContext:()=>({memories,stage:currentStage,supportCards,manual:{...manual},conversionRules:getConversionRules()}),onRestore,onOpenMemory,onSave:entry=>loadoutLibrary.saveEntry(entry),initialState:initialState?.recommendations,onTaskChange:task=>onTaskChange('recommended',task)});
  const ownership={idolCardIds:new Set(idolCards.map(card=>card.idolCardId)),supportCardIds:new Set((supportCards??[]).map(card=>card.supportCardId)),supportsKnown:supportCards!==undefined,producerLevel:accountProducerLevel(producerExp)};
  const optimization=createContestOptimization({profile,getContext:()=>({stage:currentStage,idolCards,supportCards,producerLevel:ownership.producerLevel,manual:{...manual},conversionRules:getConversionRules()}),onRestore,onSave:entry=>loadoutLibrary.saveEntry(entry),initialState:initialState?.optimization,onTaskChange:task=>onTaskChange('optimization',task)});
  const makeDraft=memory=>createContestMemoryDraft(memory,memoryExclusiveSkill(memory)?.reference.id);
  function editSlot(memoryIndex,slotIndex,kind='card'){
    const memory=drafts[memoryIndex],items=memory.examBattleProduceItemIds??[],fixedIds=contestFixedItemIds(selected[memoryIndex]);
    if(kind==='item'&&(fixedIds.has(items[slotIndex])||slotIndex>=items.length&&contestExtraItemCount(items,fixedIds)>=(contestExtraItemLimit(memory.grade)??0)))return;
    openContestLoadoutEditor({profile,catalog:editCatalog,ownership,memory,memoryIndex,slotIndex,kind,includeIdolItems:false,current:kind==='card'?memory.examBattleProduceCards[slotIndex]:items[slotIndex]??null,onApply:value=>{
      const field=kind==='card'?'examBattleProduceCards':'examBattleProduceItemIds',values=memory[field]??[];
      const updated=slotIndex<values.length?values.map((entry,index)=>index===slotIndex?value:entry):[...values,value];
      if(kind==='item'&&contestExtraItemCount(updated,fixedIds)>(contestExtraItemLimit(memory.grade)??0))return;
      drafts[memoryIndex]={...memory,[field]:updated};drawSelection();
    },returnFocus:()=>kind==='card'?slots.querySelector(`[data-memory-index="${memoryIndex}"] [data-edit-card="${slotIndex}"]`):team.querySelector(`[data-edit-item="${slotIndex}"]`)});
  }
  function restoreSlot(memoryIndex,slotIndex,kind='card'){
    const original=makeDraft(selected[memoryIndex]),field=kind==='card'?'examBattleProduceCards':'examBattleProduceItemIds',values=drafts[memoryIndex][field]??[],baseline=original[field]??[];
    drafts[memoryIndex]={...drafts[memoryIndex],[field]:slotIndex<baseline.length?values.map((value,index)=>index===slotIndex?baseline[index]:value):values.filter((_,index)=>index!==slotIndex)};
    drawSelection();
    if(kind==='card')slots.querySelector(`[data-memory-index="${memoryIndex}"] [data-edit-card="${slotIndex}"]`)?.focus();
    else (slotIndex<baseline.length?team.querySelector(`[data-edit-item="${slotIndex}"]`):team.querySelector('[data-add-item]'))?.focus();
  }
  function drawSelection(){
    drafts=drafts.map((memory,index)=>updateMemoryPower(memory,selected[index],memoryPower));
    const filled=selected.filter(Boolean);
    const cards=contestMemoryCards(drafts,contestCardNoDeckDuplication,getConversionRules());
    team.replaceChildren();if(drafts[0])team.append(contestTeamSummary(drafts,contestMemoryTotals(drafts,currentStage,manual),ownedIdols.get(drafts[0].idolCardId),{originalItems:selected[0].examBattleProduceItemIds??[],fixedItemIds:contestFixedItemIds(selected[0]),onEditItem:editing[0]?index=>editSlot(0,index,'item'):undefined,onAddItem:editing[0]?()=>editSlot(0,drafts[0].examBattleProduceItemIds?.length??0,'item'):undefined,onRestoreItem:editing[0]?index=>restoreSlot(0,index,'item'):undefined}));
    pickers.replaceChildren();
    slots.replaceChildren(...selected.map((memory,index)=>{
      const original=memory?makeDraft(memory):null,requiredCharacterId=selected.find((value,other)=>other!==index&&value)?.characterId;
      const slot=contestMemorySlot(original,index,()=>openContestMemoryPicker({stagePlanType:currentStage.planType,rows:requiredCharacterId?rows.filter(row=>row.memory.characterId===requiredCharacterId):rows,requiredCharacterId,selectedKey:memory?.key,usedKeys:new Set(filled.map(value=>value.key)),onSelect:value=>{selected[index]=value;drafts[index]=makeDraft(value);editing[index]=false;drawSelection();},returnFocus:()=>pickers.querySelector(`[data-slot="${index}"] .season-memory-slot-pick`)}),()=>{selected[index]=null;drafts[index]=null;editing[index]=false;drawSelection();pickers.querySelector(`[data-slot="${index}"] .season-memory-slot-pick`)?.focus();},{reference:original?.examBattleProduceCards[0],showRole:false});
      const row=el('div','','season-memory-row');row.dataset.memoryIndex=String(index);
      const role=el('div','','season-memory-role'),customize=el('button',t('自定义'),'season-memory-customize');customize.dataset.customizeMemory=String(index);customize.setAttribute('aria-pressed',String(editing[index]));customize.disabled=!memory;customize.onclick=()=>{editing[index]=!editing[index];drawSelection();slots.querySelector(`[data-customize-memory="${index}"]`)?.focus();};role.append(memory?contestMemoryCost(drafts[index],index===0?'主回忆':'副回忆'):el('span',t(index===0?'主回忆':'副回忆')));
      if(memory)role.append(slot.querySelector('.season-slot-actions'),customize);
      if(memory&&editing[index]){const reset=el('button',t('还原回忆'),'season-memory-reset');reset.disabled=JSON.stringify(drafts[index].examBattleProduceCards)===JSON.stringify(makeDraft(memory).examBattleProduceCards)&&JSON.stringify(drafts[index].examBattleProduceItemIds)===JSON.stringify(memory.examBattleProduceItemIds);reset.onclick=()=>{drafts[index]=makeDraft(memory);drawSelection();slots.querySelector(`[data-customize-memory="${index}"]`)?.focus();};role.append(reset);}
      const choice=el('div','','season-memory-choice');choice.append(el('span',t(index===0?'主回忆':'副回忆'),'season-choice-label'),slot);pickers.append(choice);
      row.hidden=!memory;row.append(role);if(memory)row.append(contestMemoryBoard({memory:drafts[index]},cards.filter(card=>card.memoryIndex===index),null,{editing:editing[index],onEditCard:cardIndex=>editSlot(index,cardIndex),onRestoreCard:cardIndex=>restoreSlot(index,cardIndex),originalCards:original.examBattleProduceCards}));return row;
    }));
    loadoutLibrary.update(Boolean(drafts[0]&&drafts[1]));
    simulationPanel?.update({stage:currentStage,available:Boolean(drafts[0]&&drafts[1]),signature:JSON.stringify([currentStage,captureSimulationLoadout(drafts,manual,selected),getConversionRules()])});
    closeRewardPopover();
  }
  function drawRows(){
    rows=contestMemoryEntries(memories,currentStage,'ordinal',manual);count.textContent='';count.hidden=rows.length>0;
    const allowed=new Set(rows.map(row=>row.memory.key));selected=selected.map(memory=>allowed.has(memory?.key)||memory?.simulationRestored?memory:null);drafts=drafts.map((memory,index)=>selected[index]?memory:null);editing=editing.map((value,index)=>Boolean(selected[index])&&value);
    if(!rows.length)count.textContent=t('当前账号没有符合舞台计划且包含考试卡组的回忆。');drawSelection();
  }
  function drawStage(){
    rulePlan.replaceChildren();const planSymbol=filterSymbol(currentStage.planType.replace('ProducePlanType_',''));if(planSymbol)rulePlan.append(planSymbol);rulePlan.append(el('span',planName(currentStage.planType)));
    closeRewardPopover();selected=Array(2).fill(null);drafts=Array(2).fill(null);editing=[false,false];rules.replaceChildren();manual={};for(const input of Object.values(manualInputs))input.value='';manualBox.hidden=!currentStage.manualMultipliers;
    methodHint.hidden=!currentStage.manualMultipliers;methodHint.textContent=currentStage.manualMultipliers?t('倍率由上方手动输入；普通回忆属性不直接换算活动或链接比赛的倍率。'):'';
    if(currentStage.custom){const base=catalog.choices.find(row=>row.id===currentStage.baseId);rules.append(el('p',t('基于：{0}',[contestStageName(base)]),'small muted'));}
    for(const gimmick of currentStage.gimmicks){const item=el('div','','season-gimmick');item.append(el('strong',t('第 {0} 回合',[gimmick.startTurn])),effectReading('',{descriptionParts:gimmick.descriptions,leadingEffectIcons:true}));rules.append(item);}
    const columns=el('div','','season-stage-columns'),effects=el('div','','season-stage-effects'),reference=el('div','','season-stage-reference');
    for(const id of currentStage.produceItemIds)effects.append(stageItem(itemRewardInfo(id)));columns.append(effects,reference);
    const guide=createInfoDisclosure(t('基础规则和属性评分曲线'),'season-stage-guide');
    if(currentStage.setting){
      const values=el('dl','','season-basic-values');
      for(const [key,label] of [['handLimit','手牌上限'],['holdLimit','保留上限'],['turnStartDistribute','回合开始抽牌'],['examTurnEndRecoveryStamina','回合结束体力恢复']])values.append(el('dt',t(label)),el('dd',String(currentStage.setting[key])));guide.append(values);
    }
    const common=el('section','','season-common-deck');common.setAttribute('aria-label',t('比赛公共卡组'));
    for(const deck of currentStage.decks.filter(row=>currentStage.planType==='ProducePlanType_Common'||row.planType===currentStage.planType)){
      const section=el('section'),strip=el('div','','season-common-cards');section.setAttribute('aria-label',planName(deck.planType));section.append(strip);
      for(const card of deck.produceCards)strip.append(rewardHint(cardRewardInfo(card),{label:''},false,'',{chooseVersion:false,recorded:true,customization:null}));common.append(section);
    }
    if(currentStage.decks.length)effects.append(common);
    if(currentStage.manualMultipliers)rules.append(el('p',t('此舞台暂未关联道具与效果说明，可按计划选择回忆。'),'small muted'));
    if(currentStage.curve.length)guide.append(contestScoreCurve(currentStage.curve));
    if(currentStage.setting||currentStage.curve.length)reference.append(guide);
    if(effects.childElementCount||reference.childElementCount)rules.append(columns);drawRows();
  }
  function restoreSimulation(entry){
    const stage=catalog.choices.find(stage=>stage.id===entry.stage.id||stage.kind===entry.stage.kind&&entry.stage.preset?.id!==undefined&&stage.preset?.id===entry.stage.preset.id);
    if(!stage||!entry.loadout)return false;
    simulationPanel.showSelected();currentStage=stage;drawStage();manual=structuredClone(entry.loadout.manual??{});for(const [key,input] of Object.entries(manualInputs))input.value=manual[key]===undefined?'':String(manual[key]);
    selected=(entry.loadout.originals??entry.loadout.memories).map((memory,index)=>memory?{...structuredClone(memory),key:`simulation-${entry.id}-${index}`,simulationRestored:true}:null);
    drafts=entry.loadout.memories.map((memory,index)=>memory?{...structuredClone(memory),key:selected[index].key,simulationRestored:true}:null);editing=[false,false];drawSelection();simulationPanel.showSelected();return true;
  }
  simulationPanel=createContestSimulationPanel({profile,lifecycleId,onOpenConversions,stage:currentStage,supportBonus:bonus,onTaskChange:task=>onTaskChange('selected',task),quickStages:contestSeasonGroups(catalog.choices).flatMap(group=>group.stages).filter(target=>target.kind==='contest'&&target.id!==currentStage.id&&target.planType===currentStage.planType),onQuickStage:currentStage.kind==='contest'?targetId=>onQuickStage(targetId,{selected,drafts}):undefined,getInput:()=>({request:createContestSimulationRequest(drafts,currentStage,supportCards,manual,getConversionRules()),stage:currentStage,loadout:captureSimulationLoadout(drafts,manual,selected),characterId:drafts[0]?.characterId}),onRestore:entry=>{
    return onRestore(entry);
  }});
  if(initialState)currentStage=initialState.stage;drawStage();
  if(initialState){selected=initialState.selected;drafts=initialState.drafts;editing=initialState.editing;manual=initialState.manual;for(const [key,input] of Object.entries(manualInputs))input.value=manual[key]??'';drawSelection();}
  simulationPanel.setModes(results,recommendations,optimization);dialog.append(simulationPanel.element);
  if(initialState)simulationPanel.restoreState(initialState.result);
  return {element:dialog,refreshConversions(){drawSelection();recommendations.refresh();optimization.refresh();},showTask:mode=>simulationPanel.showMode(mode),restore:restoreSimulation,useLoadout(loadout){selected=structuredClone(loadout.selected);drafts=structuredClone(loadout.drafts);editing=[false,false];drawSelection();simulationPanel.showSelected();},captureState(){return {stage:currentStage,selected,drafts,editing,manual,result:simulationPanel.captureState(),recommendations:recommendations.captureState(),optimization:optimization.captureState()};},dispose(){recommendations.dispose();optimization.dispose();loadoutLibrary.dispose();simulationPanel.dispose();closeRewardPopover();},useMemory(memory){
    if(!memory?.examBattleProduceCards?.length)return false;
    const planType=({2:'ProducePlanType_Plan1',3:'ProducePlanType_Plan2',4:'ProducePlanType_Plan3'})[memory.planType];
    if(currentStage.planType!==planType)return false;
    selected[0]=memory;drafts[0]=makeDraft(memory);editing[0]=false;
    if(selected[1]?.characterId!==memory.characterId||selected[1]?.key===memory.key){selected[1]=drafts[1]=null;editing[1]=false;}
    drawSelection();simulationPanel.showSelected();results.scrollIntoView({block:'start'});return true;
  }};
}
