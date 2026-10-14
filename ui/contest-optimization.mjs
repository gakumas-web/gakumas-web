import {layerSimulationMetrics} from './contest-simulation-charts.mjs';
import {updateMemoryPower} from '../domain/memory-power.mjs';
import {memoryPower} from '../domain/catalog.mjs';
import {contestCompatibilityOptions} from '../application/contest-compatibility-input.mjs';
import {optimizationCardKey} from '../domain/contest-optimization.mjs';
import {sortedMemoryBattleCards} from '../domain/memories.mjs';
import {el} from './dom.mjs';
import {illustration,characterAccent,skillThumbnailFor} from './illustrations.mjs';
import {startContestMultiplierPreview} from '../application/contest-multiplier-preview.mjs';
import {contestRatingRules,contestRulesHelp} from './contest-card-cost.mjs';
import {t,locale} from '../i18n.mjs';
import {itemRewardInfo,characterInfo,compareCharacterFilters,idolInfo,progressionInfo,contestSimulationReference} from '../domain/catalog.mjs';
import {contestCostAliases,contestCostRanges,contestDeckCost,contestCapacityStatus} from '../domain/contest-card-cost.mjs';
import {contestExtraItemLimit} from '../domain/contest-item-rules.mjs';
import {contestCustomizationLimits} from '../domain/contest-customization-rules.mjs';
import {selectionGrades} from '../domain/selection-memories.mjs';
import {closeRewardPopover,rewardHint} from './card-rewards.mjs';
import {openOptimizationChoiceDialog} from './contest-optimization-picker.mjs';
import {loadoutPreview} from './contest-loadout-library.mjs';
import {comparisonScore,comparisonRange,scoreQuantile} from './contest-simulation-charts.mjs';
import {captureSimulationLoadout} from '../application/contest-simulation-history.mjs';
import {optimizationChoiceCatalog,buildContestOptimizationInput,sortOptimizationExclusives,validateOptimizationExclusiveReference} from '../application/contest-optimization-input.mjs';
import {startContestOptimization,startContestCompatibilityAudit,OPTIMIZATION_BUDGETS} from '../application/contest-optimization-client.mjs';
import {readSimulationMultiCore} from '../application/contest-compute-preferences.mjs';

const errors={optimization_unsupported_fixed:'固定技能、附魔或 P 道具未被引擎支持，请调整配置。',optimization_invalid_exclusive_customization:'当前专属技能附魔不符合持有解锁或评级限制，请调整配置。',optimization_unknown_item_rules:'当前资料缺少 P 道具携带规则，请应用资料更新。',optimization_unknown_customization_rules:'当前资料没有所选评级的附魔规则。',optimization_unknown_level:'当前账号的 P 等级未知，请更新账号快照后搜索。',optimization_exclusive_mismatch:'请选择已持有、同一角色且符合舞台计划的主副专属技能。',optimization_unknown_capacity:'当前资料没有所选评级的容量区间。',optimization_missing_parameters:'请填写编组总 Vo、Da、Vi 和体力。',optimization_invalid_customization_limit:'请检查附魔次数和附魔卡数量上限。',optimization_invalid_items:'P 道具需符合当前角色、计划和持有条件，且不能重复。',optimization_no_feasible_deck:'在当前评级、持有技能和附魔约束下，没有可用的完整编组。',missing_support_bonus:'支援卡持有信息未采集，无法计算当前支援奖励。',missing_manual_multipliers:'请先填写此舞台的 Vo、Da、Vi 比赛倍率。',unsupported_entities:'固定技能或 P 道具尚未完整匹配到模拟引擎。',unsupported_stage:'当前舞台尚不支持模拟。',unsupported_stage_rules:'当前舞台规则尚不支持模拟。',simulation_timeout:'搜索耗时过长，已停止；请降低搜索强度后重试。'};
const format=value=>new Intl.NumberFormat(locale(),{maximumFractionDigits:0}).format(value);
// 属性面板使用同一套线性图标，颜色仅辅助识别，不替代文字标签。
function parameterIcon(kind){
  const paths={
    vocal:'M12 14a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4ZM5 10a7 7 0 0 0 14 0M12 17v5M8 22h8',
    dance:'M13 3h6v9l3 5v3H3v-4l6-2 4-4V3ZM3 17h19M13 7h6',
    visual:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
    stamina:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
    chart:'M4 20V13h3v7M10 20V8h3v12M16 20V3h3v17',
    fill:'m4 20 12-12 4 4L8 24ZM3 5v4M1 7h4M16 1v4M14 3h4M21 5v4M19 7h4',
    info:'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  };
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(icon.namespaceURI,'path');
  icon.setAttribute('viewBox','0 0 24 26');icon.setAttribute('aria-hidden','true');icon.classList.add('optimization-parameter-icon');path.setAttribute('d',paths[kind]);icon.append(path);return icon;
}

export function createContestOptimization({profile,getContext,onRestore,onSave,initialState,onTaskChange=()=>{}}){
  const element=el('div','','contest-optimization');element.id='contest-optimization';
  let context,contextSignature=null,formState=initialState?.form??null,report=initialState?.report??null,reportSignature=initialState?.reportSignature??'',reportContext=initialState?.reportContext??null;
  let active=null,fillHandle=null,disposed=false,busy=false,readForm=()=>formState??{},updateStale=()=>{},viewId=0,picker=null,disposePreview=()=>{};
  const signatureFor=value=>JSON.stringify([value.stage,value.manual,value.producerLevel,value.conversionRules,value.idolCards.map(card=>[card.idolCardId,card.levelLimitRank,card.potentialRank]),value.supportCards?.map(card=>[card.supportCardId,card.level])]);
  function refresh(){
    if(disposed)return;
    const next=getContext(),signature=signatureFor(next);
    if(signature===contextSignature)return;
    formState=readForm();if(active){active.cancel();active=null;onTaskChange({state:'stopped'});}busy=false;
    if(contextSignature!==null||initialState?.contextSignature!==signature){report=null;reportSignature='';reportContext=null;}
    context=next;contextSignature=signature;draw();
  }
  let poolTask=null;
  function draw(){
    disposePreview();fillHandle?.cancel();fillHandle=null;poolTask?.cancel();picker?.close();closeRewardPopover();const currentView=++viewId,catalog=optimizationChoiceCatalog(context);
    const description=el('p',t('选择偶像、回忆与 P 道具，填写属性后推荐并模拟当前舞台的编组。'),'small muted');
    const candidateHint=el('p',t('候选仅使用当前持有卡与已解锁奖励，非当前转换版本不参与搜索。'),'small muted');
    const prerequisites=el('section','','optimization-prerequisites'),prerequisiteTitle=el('h3',t('开始搜索前')),prerequisiteNotice=el('div'),prerequisiteList=el('ul'),prerequisiteActions=el('div','','optimization-prerequisite-actions');
    prerequisiteTitle.id='optimization-prerequisite-title';prerequisites.setAttribute('aria-labelledby',prerequisiteTitle.id);prerequisiteNotice.setAttribute('role','status');prerequisiteNotice.setAttribute('aria-live','polite');prerequisiteNotice.append(prerequisiteList);
    const updateAccount=el('button',t('导入或更新账号')),updateResources=el('button',t('打开资料'));
    updateAccount.onclick=()=>{picker?.close();closeRewardPopover();updateAccount.focus({preventScroll:true});document.getElementById('data-open')?.click();};
    updateResources.onclick=()=>{picker?.close();closeRewardPopover();updateResources.focus({preventScroll:true});document.getElementById('resources-open')?.click();};
    prerequisiteActions.append(updateAccount,updateResources);prerequisites.append(prerequisiteTitle,prerequisiteNotice,prerequisiteActions);
    let prerequisiteSignature='';
    const explanation=el('details','','recommendation-algorithm'),searchExplanation=el('p'),polishExplanation=el('p'),reviewExplanation=el('p'),finalExplanation=el('p');
    explanation.append(el('summary',t('推荐算法')),searchExplanation,polishExplanation,reviewExplanation,finalExplanation,
      el('p',t('搜索、局部改进、复筛和最终复评使用独立样本；复筛加测接续已有样本。结果仅代表本次有限搜索与抽样的排名，不保证全局最优或实际战斗表现。')));
    const capacity=contestRatingRules(),help=contestRulesHelp(capacity,explanation);
    const form=el('form','','optimization-form'),fields=el('fieldset','','optimization-fields'),rolesBox=el('div','','optimization-roles'),roleControls=[];
    const roleNames=['主回忆','副回忆'];let poolResult=null,poolFailure=false;const poolOptions=contestCompatibilityOptions(catalog);
    const supportedReference=reference=>!poolResult||[({...reference,customizes:[]}),...(reference.customizes??[]).map(value=>({...reference,customizes:[value]}))].every(value=>poolResult.supported.has(optimizationCardKey(value)));
    const ranks=[...new Set([...contestCostRanges().map(row=>row.rank),...contestCostAliases()])].filter(rank=>selectionGrades.includes(rank)&&contestCustomizationLimits(rank)).sort((a,b)=>selectionGrades.indexOf(b)-selectionGrades.indexOf(a));
    const label=(text,input)=>{const box=el('label','','optimization-field');box.append(el('span',t(text)),input);return box;};
    const numeric=(value,{min=0,max,placeholder='未填写',required=false}={})=>{const input=el('input');input.type='number';input.min=String(min);if(max!==undefined)input.max=String(max);input.step='1';input.value=value??'';input.required=required;input.placeholder=t(placeholder);return input;};
    const stagePlan=context.stage.planType.replace('ProducePlanType_',''),characters=new Map();
    for(const held of new Map(context.idolCards.map(card=>[card.idolCardId,card])).values()){
      const info=idolInfo(held);if(!info.cardResolved||stagePlan!=='Common'&&info.plan!==stagePlan)continue;
      characters.set(info.characterId,(characters.get(info.characterId)??0)+1);
    }
    const orderedCharacters=[...characters].sort(([a,ac],[b,bc])=>bc-ac||compareCharacterFilters(a,b));
    let characterId=characters.has(formState?.characterId)?formState.characterId:orderedCharacters[0]?.[0]??'';
    const idolGroup=el('fieldset','','recommendation-characters'),characterButtons=[],characterTitle=el('legend'),changeNotice=el('p','','optimization-change-notice small muted');changeNotice.setAttribute('role','status');changeNotice.hidden=true;
    idolGroup.setAttribute('role','radiogroup');idolGroup.setAttribute('aria-label',t('模拟偶像(按偶像卡持有数排序)'));idolGroup.append(characterTitle,el('p',t('按偶像卡持有数排序'),'small muted'));
    for(const [id,count] of orderedCharacters){
      const info=characterInfo(id),button=el('button','','recommendation-character'),text=t('{0}（{1} 张偶像卡）',[info.name,count]);
      button.dataset.characterId=id;button.title=text;button.setAttribute('role','radio');button.setAttribute('aria-label',text);characterAccent(button,id);
      const face=illustration(info.face,info.name,'filter-face');face.setAttribute('aria-hidden','true');button.append(face,el('span',String(count),'recommendation-character-count'));
      button.onclick=()=>{if(characterId===id)return;const before=roleControls.map(control=>control.exclusiveId).join('|');characterId=id;syncCharacters();updateMain();if(before!==roleControls.map(control=>control.exclusiveId).join('|')){changeNotice.textContent=t('已切换模拟偶像，相关专属技能卡已更新。');changeNotice.hidden=false;}updateStale();};
      button.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const index=characterButtons.indexOf(button),next=event.key==='Home'?0:event.key==='End'?characterButtons.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+characterButtons.length)%characterButtons.length;characterButtons[next].click();characterButtons[next].focus();};
      characterButtons.push(button);idolGroup.append(button);
    }
    function syncCharacters(){characterTitle.textContent=t('模拟偶像：{0} · 持有 {1} 张',[characterInfo(characterId).name,characters.get(characterId)??0]);for(const button of characterButtons){const selected=button.dataset.characterId===characterId;button.setAttribute('aria-checked',String(selected));button.tabIndex=selected?0:-1;}}syncCharacters();
    function openChoices(options){
      closeRewardPopover();picker?.close();picker=openOptimizationChoiceDialog({...options,context,characterId,supportedReference,onClose:dialog=>{if(picker===dialog)picker=null;}});
    }

    for(const [index,roleName] of roleNames.entries()){
      const state=formState?.roles?.[index]??{},box=el('section','','optimization-role'),grade=el('select'),slot=el('div','','optimization-slot'),settings=el('div','','optimization-role-settings');
      grade.dataset.optimizationGrade=String(index);for(const rank of ranks)grade.append(new Option(rank,String(selectionGrades.indexOf(rank))));grade.value=ranks.includes(selectionGrades[Number(state.grade)])?state.grade:String(selectionGrades.indexOf(ranks.includes('SSS+')?'SSS+':ranks[0]));
      grade.setAttribute('aria-label',`${t(roleName)} · ${t('回忆评级')}`);settings.append(grade);
      const roleHeading=el('div','','optimization-role-heading'),capacity=el('small','','optimization-role-capacity muted');roleHeading.append(el('strong',t(roleName),'season-choice-label'),capacity);box.append(roleHeading,settings,slot);rolesBox.append(box);
      roleControls.push({exclusiveId:state.exclusiveId??'',exclusiveReference:state.exclusiveReference?structuredClone(state.exclusiveReference):null,grade,slot,capacity});
      grade.onchange=()=>{drawExclusive(index);if(index===0)updateItems();updateStale();};
    }

    const totalsBox=el('section','','season-team-summary optimization-total'),attributes=el('div','','optimization-attributes'),params={},multipliers={};
    const totalsHeading=el('div','','optimization-total-heading'),fillActions=el('div','','optimization-total-actions'),fill=el('button',t('填入参考属性'),'optimization-autofill'),fillNotice=el('p','','small muted optimization-autofill-notice');let filling=false,fillUndo=null;const undoFill=el('button',t('撤销'),'optimization-autofill-undo');undoFill.hidden=true;undoFill.title=t('撤销填入');undoFill.setAttribute('aria-label',t('撤销填入'));
    const fillUnavailable=context.stage.manualMultipliers||context.stage.custom||context.stage.kind!=='contest'||!context.stage.preset;
    if(fillUnavailable||context.supportCards===undefined)fill.title=t(fillUnavailable?'当前舞台无法由倍率反推属性。':'支援卡持有信息未采集，无法计算当前支援奖励。');
    const totalsTitle=el('h3',t('编组总属性')),inputHelp=el('details','','optimization-input-help');
    const helpSummary=el('summary'),helpText=el('span',t('可填入参考属性，再手动调整。'));helpSummary.append(parameterIcon('info'),helpText);helpSummary.setAttribute('aria-label',t('填写说明'));
    inputHelp.append(helpSummary,el('p',t('输入为主回忆属性 + 向下取整（副回忆属性 ÷ 5）；支援奖励由模拟引擎另行计入。')),el('p',t('根据当前舞台和支援奖励填入 Vo、Da、Vi 参考值，体力保持不变。')));
    const fillLabel=el('span',t('填入参考属性'));totalsTitle.prepend(parameterIcon('chart'));fill.replaceChildren(parameterIcon('fill'),fillLabel);
    fillNotice.hidden=true;fillNotice.setAttribute('role','status');fillActions.append(fill,undoFill);totalsHeading.append(totalsTitle,fillActions);
    totalsBox.append(totalsHeading,el('p',t('填写主副回忆折算后的总属性，支援奖励在模拟时计入。'),'optimization-total-description'),attributes,fillNotice,inputHelp);
    undoFill.onclick=()=>{
      if(!fillUndo||busy||filling)return;
      for(const [key,value] of Object.entries(fillUndo))if(params[key].value===value.after){params[key].value=value.before;params[key].dispatchEvent(new Event('input',{bubbles:true}));}
      fillUndo=null;undoFill.hidden=true;fillNotice.hidden=true;
    };
    for(const [key,text] of [['vocal','Vo'],['dance','Da'],['visual','Vi'],['stamina','体力']]){
      const input=numeric(formState?.params?.[key],{min:key==='stamina'?1:0,required:true,placeholder:'未填写'});input.dataset.optimizationAttribute=key;input.setAttribute('aria-label',t('编组总属性')+' '+t(text));params[key]=input;const field=label(text,input);field.dataset.attribute=key;
      field.querySelector('span').prepend(parameterIcon(key));
      const issue=el('small','','optimization-field-error');issue.id=`optimization-error-${key}`;issue.hidden=true;input.setAttribute('aria-describedby',issue.id);field.append(issue);const validate=()=>{const invalid=!input.validity.valid;issue.hidden=!invalid;issue.textContent=invalid?t('请填写有效的{0}数值。',[t(text)]):'';input.setAttribute('aria-invalid',String(invalid));};input.oninvalid=validate;input.onblur=validate;input.addEventListener('input',()=>{if(input.getAttribute('aria-invalid')==='true')validate();});
      if(key!=='stamina'){const output=el('output','','optimization-multiplier'),value=el('span'),empty=el('span','—','optimization-multiplier-empty');value.hidden=true;value.dataset.optimizationMultiplier=key;empty.setAttribute('aria-hidden','true');output.append(el('small',t('当前倍率')),value,empty);output.setAttribute('aria-label',t(text)+' '+t('当前倍率'));output.setAttribute('aria-live','polite');multipliers[key]=value;field.append(output);}attributes.append(field);
    }
    const itemsBox=el('section','','season-team-items optimization-items');itemsBox.append(el('h3',t('P 道具')));
    const itemGrid=el('div','','optimization-item-selection'),fixedItem=el('div','','optimization-fixed-item'),selectedItems=el('div','','optimization-selected-items'),itemActions=el('div','','optimization-item-actions'),chooseItems=el('button',t('选择 P 道具'),'optimization-items-open optimization-exclusive-change'),itemCount=el('span','','small muted');
    let fixedItemId='',extraItemIds=[...new Set((formState?.items??[]).slice(1).filter(Boolean))];
    itemCount.setAttribute('aria-live','polite');itemsBox.querySelector('h3').append(itemCount);itemActions.append(chooseItems);itemGrid.append(fixedItem,itemActions,selectedItems);itemsBox.append(itemGrid);
    chooseItems.onclick=()=>openChoices({title:t('选择 P 道具'),kind:'item',grade:Number(roleControls[0].grade.value),choices:availableItems(1),current:extraItemIds,onSelect:ids=>{extraItemIds=ids;drawItemPreview();updateStale();},returnFocus:()=>chooseItems});
    function availableExclusive(index){
      const main=catalog.exclusive.find(choice=>choice.id===roleControls[0].exclusiveId);
      return sortOptimizationExclusives(catalog.exclusive.filter(choice=>choice.metadata.ownerCharacterId===characterId&&(index===0||main&&choice.metadata.plan===main.metadata.plan)).map(choice=>({...choice,versions:choice.versions.filter(version=>supportedReference({id:choice.id,upgradeCount:version.upgradeCount,customizes:[]}))})).filter(choice=>choice.versions.length),context.idolCards);
    }
    function drawExclusive(index){
      const control=roleControls[index],choice=catalog.exclusive.find(choice=>choice.id===control.exclusiveId);
      if(choice&&control.exclusiveReference?.id!==choice.id)control.exclusiveReference={id:choice.id,upgradeCount:choice.versions.find(version=>version.upgradeCount===1)?.upgradeCount??choice.versions[0].upgradeCount,customizes:[]};
      const held=context.idolCards.find(card=>card.idolCardId===choice?.idolCardId),name=choice?`${idolInfo(held).name} · ${choice.name}`:t('选择角色专属技能卡');
      const slot=el('div','','optimization-exclusive-field'),button=el('button','','season-memory-slot-pick optimization-exclusive-choice');slot.dataset.slot=String(index);button.setAttribute('aria-label',`${t(roleNames[index])} · ${name}`);button.title=name;
      if(choice){button.append(skillThumbnailFor(control.exclusiveReference,characterId));const count=control.exclusiveReference.customizes.reduce((sum,value)=>sum+value.customizeCount,0);if(count){const badge=el('span',String(count),'selection-custom-count');badge.setAttribute('aria-label',t('附魔次数：{0}',[count]));button.append(badge);}}else button.append(el('span',t('选择技能卡')));
      button.onclick=()=>openChoices({title:t('选择角色专属技能卡'),choices:availableExclusive(index),current:control.exclusiveReference,grade:Number(control.grade.value),onSelect:reference=>{control.exclusiveId=reference.id;control.exclusiveReference=reference;drawExclusive(index);if(index===0){updateSub();updateItems();}updateStale();},returnFocus:()=>control.slot.querySelector('.season-memory-slot-pick')});slot.append(button);
      if(choice){const identity=el('div','','optimization-exclusive-identity'),change=el('button',t('更换技能卡'),'optimization-exclusive-change');identity.append(el('strong',choice.name));change.onclick=()=>button.click();identity.append(change);slot.append(identity);}
      if(choice){const remove=el('button',t('移除'),'optimization-exclusive-remove');remove.setAttribute('aria-label',t('移除第 {0} 条回忆',[index+1]));remove.onclick=()=>{control.exclusiveId='';control.exclusiveReference=null;drawExclusive(index);if(index===0){updateSub();updateItems();}updateStale();};slot.append(remove);}
      const range=contestCapacityStatus(null,selectionGrades[Number(control.grade.value)]).range;control.capacity.textContent=range?t('卡组容量 {0}–{1}',[range.min,range.max]):t('评级规则暂未收录');control.slot.replaceChildren(slot);
    }
    function availableItems(index){
      const main=catalog.exclusive.find(choice=>choice.id===roleControls[0].exclusiveId);
      return catalog.items.filter(choice=>(!poolResult||poolResult.supported.has(`item:${choice.id}`))&&main&&['Common',main.metadata.plan].includes(choice.metadata.plan)&&(index===0?choice.metadata.source==='idol'&&(choice.definition.originIdolCardId||choice.definition.originPrimaStellaIdolCardId)===main.idolCardId:choice.metadata.source==='support'));
    }
    function drawItemPreview(){
      closeRewardPopover();fixedItem.replaceChildren();selectedItems.replaceChildren();
      if(fixedItemId){const hint=rewardHint(itemRewardInfo(fixedItemId),{label:''},false,'');hint.querySelector('button').dataset.optimizationItem='0';fixedItem.append(hint);}else fixedItem.append(el('span','—','small muted'));
      for(const id of extraItemIds){const hint=rewardHint(itemRewardInfo(id),{label:''},false,'');hint.dataset.optimizationSelectedItem=id;selectedItems.append(hint);}
      selectedItems.hidden=!extraItemIds.length;
      const limit=contestExtraItemLimit(Number(roleControls[0].grade.value));chooseItems.disabled=limit===null||!roleControls[0].exclusiveId;itemCount.textContent=limit===null?'':t('额外道具 {0}/{1}',[extraItemIds.length,limit]);
    }
    function updateItems(){
      const main=catalog.exclusive.find(choice=>choice.id===roleControls[0].exclusiveId),held=context.idolCards.find(card=>card.idolCardId===main?.idolCardId);
      const fixed=held?progressionInfo('idol',held)?.changes.find(change=>change.beforeItem)?.beforeItem:null;
      fixedItemId=availableItems(0).some(choice=>choice.id===fixed)?fixed:'';
      const available=new Set(availableItems(1).map(choice=>choice.id)),limit=contestExtraItemLimit(Number(roleControls[0].grade.value))??0;
      const previousCount=extraItemIds.length;extraItemIds=extraItemIds.filter(id=>available.has(id)).slice(0,limit);if(extraItemIds.length<previousCount){changeNotice.textContent=t('已按当前角色与评级保留 {0} 个额外道具，请确认配置。',[extraItemIds.length]);changeNotice.hidden=false;}drawItemPreview();
    }
    function updateSub(){
      const control=roleControls[1],available=availableExclusive(1),main=catalog.exclusive.find(choice=>choice.id===roleControls[0].exclusiveId);
      if(!available.some(choice=>choice.id===control.exclusiveId)){
        const paired=available.find(choice=>choice.idolCardId===main?.idolCardId&&choice.id!==main.id&&choice.metadata.secondExclusive!==main.metadata.secondExclusive);
        control.exclusiveId=paired?.id??main?.id??available[0]?.id??'';
      }
      drawExclusive(1);
    }
    function updateMain(){
      const control=roleControls[0],available=availableExclusive(0);
      if(!available.some(choice=>choice.id===control.exclusiveId))control.exclusiveId=available[0]?.id??'';
      drawExclusive(0);updateSub();updateItems();
    }
    updateMain();
    const settings=el('div','','optimization-settings'),strength=el('select'),seedInput=numeric(formState?.seed,{max:4294967295,placeholder:'留空时随机'});
    strength.id='optimization-strength';for(const [key,name] of [['standard','标准'],['deep','极致'],['custom','自定义']])strength.append(new Option(t(name),key));strength.value=['standard','deep','custom'].includes(formState?.strength)?formState.strength:'standard';
    settings.append(label('搜索强度',strength),label('随机种子',seedInput));
    const advanced=el('details','','optimization-advanced'),advancedTitle=el('summary'),customSettings=el('fieldset','','optimization-custom-budget'),customInputs={},customError=el('p','','optimization-field-error');
    let customEdited=Boolean(formState?.customBudget),lastPreset=strength.value==='deep'?'deep':'standard';customError.id='optimization-budget-error';customError.hidden=true;customError.setAttribute('role','status');
    const budgetGroups=[
      ['搜索',[['population','每代编组数'],['generations','搜索代数'],['samples','每组模拟次数',10000]]],
      ['局部改进',[['polishParents','起始编组数'],['polishNeighbors','每组尝试数'],['polishRounds','改进轮数（0 为关闭）'],['polishRuns','每组模拟次数',10000]]],
      ['复筛',[['reviewCandidates','候选编组数'],['screenRuns','初筛模拟次数',10000],['reviewRuns','加测后模拟次数',10000]]],
      ['最终复评',[['finalCandidates','最终编组数'],['finalRuns','每组模拟次数',10000]]],
    ];
    for(const [title,entries] of budgetGroups){
      const group=el('section','','optimization-budget-group'),grid=el('div','','optimization-budget-fields');group.append(el('h4',t(title)),grid);
      for(const [key,text,max] of entries){const input=numeric(formState?.customBudget?.[key]??OPTIMIZATION_BUDGETS[lastPreset][key],{min:key==='polishRounds'?0:1,max,required:true});input.dataset.optimizationBudget=key;input.setAttribute('aria-label',`${t(title)} · ${t(text)}`);input.setAttribute('aria-describedby',customError.id);input.oninput=showBudget;input.oninvalid=()=>{advanced.open=true;};customInputs[key]=input;grid.append(label(text,input));}
      customSettings.append(group);
    }
    const readBudget=()=>strength.value==='custom'?Object.fromEntries(Object.entries(customInputs).map(([key,input])=>[key,input.value===''?NaN:Number(input.value)])):OPTIMIZATION_BUDGETS[strength.value];
    advanced.append(advancedTitle,settings,customSettings,customError,el('p',t('搜索强度越高，探索与复评次数越多，等待时间也会增加。'),'small muted'));
    const availability=el('p','','small muted');
    function showBudget(){
      const custom=strength.value==='custom';customSettings.hidden=customSettings.disabled=!custom;
      if(!custom)lastPreset=strength.value;
      else if(!customEdited){for(const [key,input] of Object.entries(customInputs))input.value=String(OPTIMIZATION_BUDGETS[lastPreset][key]);customEdited=true;}
      const budget=readBudget();
      for(const input of Object.values(customInputs)){input.setCustomValidity('');if(input.value!==''&&!Number.isSafeInteger(Number(input.value)))input.setCustomValidity(t('请输入整数。'));}
      if(custom&&budget.screenRuns>budget.reviewRuns)customInputs.reviewRuns.setCustomValidity(t('加测后模拟次数不能小于初筛模拟次数。'));
      if(custom&&budget.finalCandidates>budget.reviewCandidates)customInputs.finalCandidates.setCustomValidity(t('最终编组数不能超过候选编组数。'));
      const invalid=custom?Object.values(customInputs).find(input=>!input.validity.valid):null;
      customError.hidden=!invalid;customError.textContent=invalid?(invalid.validity.customError?invalid.validationMessage:t('请填写有效的自定义搜索参数；次数和数量须为整数，每组模拟次数为 1–10000。')):'';
      for(const paragraph of [searchExplanation,polishExplanation,reviewExplanation,finalExplanation])paragraph.hidden=Boolean(invalid);
      if(invalid){updateStale();return;}
      searchExplanation.textContent=t('搜索：每代最多 {0} 个合法编组，最多 {1} 代，每个新编组模拟 {2} 次。保留高分编组，通过交叉、少量换卡和随机新编组继续探索；固定专属、P 道具及评级约束保持不变。',[budget.population,budget.generations,budget.samples]);
      polishExplanation.textContent=t('局部改进：从高分且技能组成不同的编组出发，尝试换卡及强化、附魔调整，共 {0} 轮，每个新编组模拟 {1} 次。',[budget.polishRounds,budget.polishRuns]);
      reviewExplanation.textContent=t('复筛：兼顾高分与不同技能组合，先各模拟 {0} 次，再为第一名或最终入选名额竞争接近的编组追加到 {1} 次。复筛总预算为 {2} 次，追加受剩余预算限制，各组实际次数可能不同。',[budget.screenRuns,budget.reviewRuns,budget.reviewCandidates*budget.reviewRuns]);
      finalExplanation.textContent=t('最终复评：取复筛前 {0} 组，各用全新样本模拟 {1} 次，再按综合分排名；最终分数不混入前面阶段的样本。有效编组不足时按实际数量展示。',[budget.finalCandidates,budget.finalRuns]);
      updateStale();
    }
    strength.onchange=showBudget;showBudget();
    const composition=el('div','','optimization-composition'),loadout=el('div','','optimization-loadout');loadout.append(rolesBox,itemsBox);composition.append(loadout,totalsBox);fields.append(idolGroup,changeNotice,composition,advanced,availability);form.append(fields);
    const retryPool=el('button',t('重新准备候选'),'optimization-pool-retry');retryPool.type='button';retryPool.onclick=preparePool;form.append(retryPool);
    const actions=el('div','','optimization-actions'),configuration=el('p','','optimization-configuration small'),start=el('button',t('开始搜索'),'primary optimization-start'),stop=el('button',t('停止'),'optimization-stop');start.type='submit';configuration.setAttribute('role','status');actions.append(start,stop,configuration);form.append(actions);
    const status=el('p','','optimization-status small muted'),progress=el('progress'),failure=el('div','','optimization-error'),output=el('section','','optimization-output'),stale=el('p',t('约束已调整，以下保留上次结果；重新搜索后更新。'),'optimization-stale small muted');
    status.setAttribute('role','status');status.setAttribute('aria-live','polite');progress.setAttribute('aria-label',t('搜索进度'));stale.hidden=true;
    element.replaceChildren(description,candidateHint,help,prerequisites,form,status,progress,failure,stale,output);
    readForm=()=>({characterId,params:Object.fromEntries(Object.entries(params).map(([key,input])=>[key,input.value])),roles:roleControls.map(control=>({exclusiveId:control.exclusiveId,exclusiveReference:control.exclusiveReference?structuredClone(control.exclusiveReference):undefined,grade:control.grade.value})),items:[fixedItemId,...extraItemIds],strength:strength.value,seed:seedInput.value,customBudget:customEdited?Object.fromEntries(Object.entries(customInputs).map(([key,input])=>[key,input.value])):undefined});
    const currentSignature=()=>JSON.stringify([contextSignature,readForm()]);
    updateStale=()=>{stale.hidden=!report||reportSignature===currentSignature();sync();};
    let previewTimer,previewHandle,previewGeneration=0;
    disposePreview=()=>{clearTimeout(previewTimer);previewGeneration++;previewHandle?.cancel();previewHandle=null;};
    function updateMultipliers(){
      disposePreview();const generation=previewGeneration;
      for(const output of Object.values(multipliers)){output.textContent='';output.hidden=true;}
      const values=Object.fromEntries(Object.entries(params).map(([key,input])=>[key,input.value!==''&&input.validity.valid?Number(input.value):undefined]));
      if(!context.stage.manualMultipliers&&!['vocal','dance','visual'].some(key=>values[key]!==undefined))return;
      previewTimer=setTimeout(async()=>{
        try{
          previewHandle=startContestMultiplierPreview({params:values,stage:context.stage,supportCards:context.supportCards,manual:context.manual});
          const result=await previewHandle.promise;if(disposed||currentView!==viewId||generation!==previewGeneration)return;
          for(const [key,output] of Object.entries(multipliers)){output.hidden=values[key]===undefined||!Number.isFinite(result[key]);output.textContent=output.hidden?'':`${Number((result[key]*100).toFixed(1))}%`;}
        }catch{}finally{if(generation===previewGeneration)previewHandle=null;}
      },160);
    }
    for(const input of Object.values(params))input.oninput=updateMultipliers;
    updateMultipliers();
    form.oninput=updateStale;form.onchange=updateStale;
    fill.onclick=async()=>{
      if(filling||busy||fillUnavailable)return;
      filling=true;fillNotice.hidden=true;sync();
      const handle=startContestMultiplierPreview({params:{vocal:0,dance:0,visual:0},stage:context.stage,supportCards:context.supportCards,manual:context.manual},{suggestParameters:true});fillHandle=handle;
      try{
        const result=await handle.promise;if(disposed||viewId!==currentView||fillHandle!==handle)return;
        fillUndo=Object.fromEntries(Object.entries(result.params).map(([key,value])=>[key,{before:params[key].value,after:String(value)}]));undoFill.hidden=false;
        for(const [key,value] of Object.entries(result.params)){params[key].value=String(value);params[key].dispatchEvent(new Event('input',{bubbles:true}));}
        fillNotice.textContent=result.limited.length?t('部分目标超过舞台可达上限，已填入可达值：{0}。',[result.limited.map(key=>`${({vocal:'Vo',dance:'Da',visual:'Vi'})[key]} ${Number((result.multipliers[key]*100).toFixed(1))}%`).join('、')]):t('已填入参考属性，体力未变。');fillNotice.hidden=false;
      }catch(error){if(!disposed&&viewId===currentView&&error.name!=='AbortError'){fillNotice.textContent=t('无法反推属性，请确认舞台资料与支援卡持有信息。');fillNotice.hidden=false;}}
      finally{if(fillHandle===handle)fillHandle=null;if(!disposed&&viewId===currentView){filling=false;sync();}}
    };
    function sync(){
      retryPool.hidden=!poolFailure;retryPool.disabled=busy||filling;fields.disabled=busy||filling||!poolResult;fill.disabled=fillUnavailable||context.supportCards===undefined;fillLabel.textContent=t(filling?'填入中…':'填入参考属性');stop.hidden=!busy;progress.hidden=!busy;
      let exclusiveIssue=null;for(const control of roleControls){if(!control.exclusiveId)continue;try{validateOptimizationExclusiveReference(context,{exclusiveId:control.exclusiveId,exclusiveReference:control.exclusiveReference,grade:Number(control.grade.value)});}catch{exclusiveIssue=errors.optimization_invalid_exclusive_customization;}}
      const fixedIssues=poolResult?[...roleControls.filter(control=>control.exclusiveReference&&!supportedReference(control.exclusiveReference)).map(control=>catalog.exclusive.find(choice=>choice.id===control.exclusiveId)?.name??control.exclusiveId),...[fixedItemId,...extraItemIds].filter(id=>id&&!poolResult.supported.has(`item:${id}`)).map(id=>itemRewardInfo(id).name)]:[];
      const missing=(!poolResult?t(poolFailure?'候选准备失败，请重试。当前配置已保留。':'正在准备候选…'):fixedIssues.length?t('固定配置不支持：{0}',[fixedIssues.join('、')]):null)||exclusiveIssue||(!ranks.length?errors.optimization_unknown_customization_rules:contestExtraItemLimit(Number(roleControls[0].grade.value))===null?errors.optimization_unknown_item_rules:!Number.isSafeInteger(context.producerLevel)?errors.optimization_unknown_level:context.supportCards===undefined?errors.missing_support_bonus:roleControls.some(control=>!control.exclusiveId)?'请选择主副回忆的专属技能卡':context.stage.manualMultipliers&&!['vocal','dance','visual'].every(key=>Number.isFinite(context.manual?.[key])&&context.manual[key]>=0)?errors.missing_manual_multipliers:null);
      const unknownLevel=!Number.isSafeInteger(context.producerLevel),unknownSupports=context.supportCards===undefined,unknownRules=!ranks.length||contestExtraItemLimit(Number(roleControls[0].grade.value))===null;
      const prerequisitesMissing=[...(!ranks.length?[errors.optimization_unknown_customization_rules]:[]),...(contestExtraItemLimit(Number(roleControls[0].grade.value))===null?[errors.optimization_unknown_item_rules]:[]),...(unknownLevel?[errors.optimization_unknown_level]:[]),...(unknownSupports?[errors.missing_support_bonus]:[]),...(context.stage.manualMultipliers&&!['vocal','dance','visual'].every(key=>Number.isFinite(context.manual?.[key])&&context.manual[key]>=0)?[errors.missing_manual_multipliers]:[])];
      const nextPrerequisiteSignature=JSON.stringify(prerequisitesMissing);
      if(nextPrerequisiteSignature!==prerequisiteSignature){prerequisiteList.replaceChildren(...prerequisitesMissing.map(message=>el('li',t(message))));prerequisiteSignature=nextPrerequisiteSignature;}
      prerequisites.hidden=!prerequisitesMissing.length;updateAccount.hidden=!unknownLevel&&!unknownSupports;updateResources.hidden=!unknownRules;prerequisiteActions.hidden=updateAccount.hidden&&updateResources.hidden;updateAccount.disabled=updateResources.disabled=busy;
      availability.hidden=!missing;availability.textContent=missing?t(missing):'';start.disabled=busy||filling||Boolean(missing)||!customError.hidden;start.textContent=t(busy?'搜索中…':'开始搜索');
      const unfinished=Object.entries(params).filter(([,input])=>!input.validity.valid).map(([key])=>t(({vocal:'Vo',dance:'Da',visual:'Vi',stamina:'体力'})[key]));
      if(!customError.hidden)unfinished.push(t('自定义搜索参数'));
      configuration.textContent=[t(roleControls.every(control=>control.exclusiveId)?'主副回忆已配置':'主副回忆尚未配置'),itemCount.textContent,missing?t(missing):unfinished.length?t('待填写或修正：{0}',[unfinished.join('、')]):t('配置完成，可以推荐并模拟')].filter(Boolean).join(' · ');
      advancedTitle.textContent=t('高级搜索设置 · {0} · {1}',[strength.selectedOptions[0].textContent,seedInput.value===''?t('随机种子'):t('种子 {0}',[seedInput.value])]);
    }
    function sourceFor(row,index){
      const memories=row.memories.map(memory=>updateMemoryPower({...memory,examBattleProduceCards:sortedMemoryBattleCards(memory.examBattleProduceCards)},null,memoryPower));
      return {id:`optimization-${report.seed}-${index}`,stage:reportContext.stage,loadout:captureSimulationLoadout(memories,reportContext.manual),characterId:memories[0].characterId};
    }
    function render(){
      closeRewardPopover();output.replaceChildren();if(!report)return;
      output.append(el('p',t('推荐结果暂存于当前页面；保存编组可再次载入。载入自选并完成模拟后，结果才会记入模拟历史。'),'small muted'));
      output.append(el('p',t('搜索 {0} 个目标舞台编组 · 共 {1} 次模拟 · 种子 {2}',[report.explored,report.totalRuns,report.seed]),'optimization-summary small muted'));
      const unsupported=report.unsupported.flatMap(value=>value.details).concat(report.skipped.flatMap(value=>value.details??[]));
      if(unsupported.length||report.missingCosts.length){const details=el('details'),names=[...new Set([...unsupported.map(value=>value.name),...report.missingCosts])];details.append(el('summary',t('部分技能或附魔未完整收录，已排除 {0} 项。',[names.length])),el('p',names.join('、'),'small muted'));output.append(details);}
      const minimum=Math.min(...report.rows.map(row=>row.result.minimum)),maximum=Math.max(...report.rows.map(row=>row.result.maximum));
      for(const [index,row] of report.rows.entries()){
        const entry=el('article','','recommendation-entry optimization-entry'),head=el('div','','recommendation-entry-heading'),identity=el('div','','recommendation-entry-identity'),metrics=el('div','','recommendation-metrics'),source=sourceFor(row,index);entry.dataset.rank=String(index+1);
        const character=characterInfo(source.characterId),face=illustration(character.face,character.name,'recommendation-entry-face');face.title=character.name;
        const capacities=el('div','','optimization-result-capacities');
        for(const [role,memory] of row.memories.entries()){
          const cost=contestDeckCost(memory.examBattleProduceCards.map(card=>contestSimulationReference('card',card))),count=memory.examBattleProduceCards.flatMap(card=>card.customizes).reduce((sum,value)=>sum+value.customizeCount,0),customized=memory.examBattleProduceCards.filter(card=>card.customizes.length).length;
          capacities.append(el('small',t('{0}：{1} · 容量 {2} · 附魔 {3} 张 / {4} 次',[t(roleNames[role]),selectionGrades[memory.grade],cost.total,customized,count]),'muted'));
        }
        identity.append(el('span',`#${index+1}`,'recommendation-rank'),face,capacities,el('span',t('{0} 次模拟',[row.result.runs]),'recommendation-run-count small muted'));head.append(identity,comparisonScore(row.stats));
        const values={...row.stats,p75:scoreQuantile(row.result.scores,.75),p25:scoreQuantile(row.result.scores,.25)};
        for(const [key,text] of [['mean','平均值'],['median','中位数'],['deviation','标准差'],['p25','P25'],['p75','P75']]){
          const metric=el('div');metric.dataset.metric=key;if(key==='p75'||key==='p25')metric.title=t(key==='p75'?'第 75 百分位得分':'第 25 百分位得分');metric.append(el('small',t(text)),el('strong',format(values[key])));metrics.append(metric);
        }
      layerSimulationMetrics(metrics,row.result);
        const details=el('section','','recommendation-loadout'),preview=loadoutPreview(source.loadout,reportContext.conversionRules),items=preview.querySelector('.loadout-library-items');
        if(items){const itemRow=el('div','','recommendation-item-row');itemRow.append(items);preview.prepend(itemRow);}
        const result=el('div','','recommendation-result');result.append(metrics,comparisonRange(row.result,minimum,maximum));details.append(preview,result);
        const buttons=el('div','','recommendation-entry-actions'),load=el('button',t('载入编组至自选模拟'),'primary'),save=el('button',t('保存编组'));load.onclick=()=>onRestore(source);save.onclick=()=>onSave(source);buttons.append(load,save);
        const footer=el('div','','recommendation-entry-footer');footer.append(buttons);entry.append(head,details,footer);output.append(entry);
      }
      updateStale();
    }
    function showProgress(value){
      const {phase,completed=0,total=0,generation,generations}=value;
      const label=phase==='refine'?t('入围竞争加测 {0}/{1} 组',[completed,total]):phase==='validate'?t('正在校验技能与附魔 {0}/{1}',[completed,total]):phase==='polish'?t('局部改进 · 第 {0}/{1} 轮 · {2}/{3} 组',[generation,generations,completed,total]):phase==='search'?t('目标舞台 · 第 {0}/{1} 代 · {2}/{3} 组',[generation,generations,completed,total]):t(phase==='review'?'独立样本复筛 {0}/{1} 组':'最终复评 {0}/{1} 组',[completed,total]);
      status.textContent=`${label} · ${t('累计 {0} 次模拟',[value.totalRuns])}${Number.isFinite(value.best)?` · ${t('当前初筛最佳 {0}',[format(value.best)])}`:''}`;
      if(total){progress.max=total;progress.value=completed;}else progress.removeAttribute('value');
    }
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||start.disabled||!form.reportValidity())return;
      const state=readForm(),signature=currentSignature();busy=true;failure.replaceChildren();status.textContent=t('正在生成合法技能候选…');sync();
      let handle;
      try{
        await new Promise(resolve=>setTimeout(resolve,0));if(disposed||viewId!==currentView)return;
        const constraints={params:Object.fromEntries(Object.entries(state.params).map(([key,value])=>[key,value===''?NaN:Number(value)])),roles:state.roles.map(role=>({...role,grade:Number(role.grade)})),items:state.items};
        const input=buildContestOptimizationInput(context,constraints),seed=state.seed===''?crypto.getRandomValues(new Uint32Array(1))[0]:Number(state.seed);
        const runContext={stage:context.stage,manual:structuredClone(context.manual??{}),conversionRules:structuredClone(context.conversionRules)};
        handle=startContestOptimization({input,stage:context.stage,supportCards:context.supportCards,manual:context.manual,conversionRules:context.conversionRules},
          {seed,multiCore:readSimulationMultiCore(),budget:readBudget(),onProgress:value=>{if(!disposed&&viewId===currentView)showProgress(value);}});
        active=handle;onTaskChange({state:'running',stop:()=>handle.cancel()});
        const result=await handle.promise;if(disposed||viewId!==currentView||active!==handle)return;
        report=result;reportSignature=signature;reportContext=runContext;onTaskChange({state:'completed'});status.textContent=t('搜索完成。');render();
      }catch(error){
        if(disposed||viewId!==currentView)return;onTaskChange({state:'stopped'});
        if(error.name==='AbortError')status.textContent=t('搜索已停止，保留上次完成结果。');
        else{status.textContent=t('搜索未完成');const message=el('p',t(errors[error.code]??'搜索失败，请检查约束后重试。'),'message');message.setAttribute('role','alert');failure.append(message);if(error.details?.length)failure.append(el('p',[...new Set(error.details.map(value=>value.name))].join('、'),'small muted'));}
      }finally{if(active===handle)active=null;if(!disposed&&viewId===currentView){busy=false;sync();}}
    };
    stop.onclick=()=>active?.cancel();render();sync();
    function preparePool(){
      if(disposed||currentView!==viewId||busy||filling)return;
      poolTask?.cancel();poolFailure=false;sync();
      const handle=startContestCompatibilityAudit(poolOptions);poolTask=handle;
      handle.promise.then(result=>{
        if(disposed||viewId!==currentView||poolTask!==handle)return;
        poolResult={supported:new Set(result.supported),unsupported:result.unsupported};sync();
      }).catch(error=>{
        if(disposed||viewId!==currentView||poolTask!==handle||error.name==='AbortError')return;
        poolFailure=true;sync();
      });
    }
    preparePool();
  }
  return {element,refresh,captureState:()=>({form:readForm(),report,reportSignature,reportContext,contextSignature}),dispose(){disposed=true;poolTask?.cancel();fillHandle?.cancel();disposePreview();picker?.close();active?.cancel();active=null;viewId++;}};
}
