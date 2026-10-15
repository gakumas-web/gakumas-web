import {createChoiceNavigation} from './choice-navigation.mjs';
import {choiceFilterIcons} from './choice-filter-icons.mjs';
import {updateSkillCustomizationBadge} from './memory-skill-badges.mjs';
import {contestExtraItemLimit} from '../domain/contest-item-rules.mjs';
import {annotateContestCardCost} from './contest-card-cost.mjs';
import {el,openDialog} from './dom.mjs';
import {t} from '../i18n.mjs';
import {memoryContestCard,recordedSkill} from './memories.mjs';
import {contestCardChanged,contestExtraItemCount} from '../domain/contest-loadout.mjs';
import {skillCardDetails} from './skill-card-details.mjs';
import {characterInfo,compareCharacterFilters,planLabel,idolInfo,memoryExclusiveSkill,selectionChoiceMetadata,selectionFlowDefinitions,cardRewardInfo,itemRewardInfo} from '../domain/catalog.mjs';
import {title,shown} from '../domain/model.mjs';
import {characterArt,skillThumbnailFor,illustration,characterAccent} from './illustrations.mjs';
import {rewardHint,supportHint,closeRewardPopover} from './card-rewards.mjs';

function memoryFlows(memory){
  const type=idolInfo(memory).examEffectType?.replace('ProduceExamEffectType_','');
  return selectionFlowDefinitions.filter(flow=>type&&flow.prefixes.some(prefix=>type.startsWith(prefix))).map(flow=>flow.id);
}

export function contestMemorySlot(memory,index,onChoose,onRemove,{reference,showRole=true}={}){
  const slot=el('div','','season-memory-slot'),button=el('button','','season-memory-slot-pick');slot.dataset.slot=String(index);button.setAttribute('aria-label',t('选择第 {0} 条回忆',[index+1]));
  button.title=t('选择第 {0} 条回忆',[index+1]);
  const selectedReference=reference??(memory&&memoryExclusiveSkill(memory)?.reference);
  if(memory)button.append(selectedReference?skillThumbnailFor(selectedReference,memory.characterId):characterArt(memory.characterId));
  else button.append(el('span','+','season-slot-plus'));
  if(showRole)slot.append(el('small',t(index===0?'主回忆':'副回忆'),'season-slot-role'));slot.append(button);
  if(selectedReference){
    updateSkillCustomizationBadge(button,selectedReference);
    const reward=cardRewardInfo(selectedReference,memory.characterId);if(reward.versions.length)supportHint(button,()=>skillCardDetails(reward,{recorded:true,chooseVersion:false}),{container:slot});
  }
  button.onclick=onChoose;

  if(memory){const actions=el('div','','season-slot-actions'),remove=el('button',t('移除'));remove.onclick=onRemove;remove.setAttribute('aria-label',t('移除第 {0} 条回忆',[index+1]));actions.append(remove);slot.append(actions);}
  return slot;
}
function contestConfig(values,kind,characterId){
  const strip=el('div','','season-board-'+kind+'s');
  const entries=kind==='card'?[...(values??[])].sort((a,b)=>Number(selectionChoiceMetadata('card',b).source==='idol')-Number(selectionChoiceMetadata('card',a).source==='idol')):values??[];
  for(const entry of entries){
    // 与回忆列表共用完整记录型缩略图，确保数值、附魔标记及定位容器一致。
    const isCard=kind==='card',hint=isCard?recordedSkill(entry,characterId):rewardHint(itemRewardInfo(entry),{label:''},false,'');
    hint.dataset.configId=isCard?entry.id:entry;strip.append(hint);
  }
  return strip;
}
function replacedOriginal(hint,id){
  delete hint.dataset.configId;delete hint.dataset.retained;
  const wrapper=el('div','','season-original-card');wrapper.dataset.originalConfigId=id;wrapper.append(hint,el('span',t('替换'),'season-replacement-badge'));return wrapper;
}
export function contestMemoryBoard({memory},entries,slot,{editing=false,onEditCard,onRestoreCard,originalCards=[]}={}){
  const board=el('article','','season-memory-board');board.dataset.memoryKey=memory.key;
  const strip=el('div','','season-board-cards');
  for(const entry of entries){
    const primary=Boolean(slot)&&entry.cardIndex===0,original=originalCards[entry.cardIndex]??entry.card,changed=contestCardChanged(original,entry.card),wrapper=primary?slot:el('div','','season-config-slot');
    let hint;
    if(changed){
      const before=primary?slot.querySelector('.season-memory-slot-pick'):contestConfig([original],'card',memory.characterId).firstElementChild;
      if(primary){const placeholder=el('span');before.replaceWith(placeholder);placeholder.replaceWith(replacedOriginal(before,original.id));}else wrapper.append(replacedOriginal(before,original.id));
      annotateContestCardCost(before,original);
      hint=contestConfig([entry.card],'card',memory.characterId).firstElementChild;hint.classList.add('season-card-replacement');
      if(primary)slot.insertBefore(hint,slot.querySelector('.season-slot-actions'));else wrapper.append(hint);
    }else{
      hint=primary?slot.querySelector('.season-memory-slot-pick'):contestConfig([entry.card],'card',memory.characterId).firstElementChild;if(!primary)wrapper.append(hint);
    }
    annotateContestCardCost(hint,entry.card);
    hint.dataset.retained=String(entry.retained);hint.dataset.configId=entry.card.id;
    if(!entry.retained){hint.classList.add('season-card-overridden');hint.append(el('span',t(entry.exclusion==='conversion'?'限制':'重复'),'season-duplicate-badge'));}
    if(!primary)strip.append(wrapper);
    if(editing){const edit=el('button',changed?t('还原'):t('槽位 {0}',[entry.cardIndex+1]),'contest-slot-edit');edit.dataset.editCard=String(entry.cardIndex);edit.dataset.action=changed?'restore':'edit';edit.onclick=()=>changed?onRestoreCard(entry.cardIndex):onEditCard(entry.cardIndex);if(primary)wrapper.insertBefore(edit,wrapper.querySelector('.season-slot-actions'));else wrapper.append(edit);}
  }
  board.append(strip);return board;
}
export function contestTeamSummary(memories,totals,ownedIdol,{onEditItem,onAddItem,onRestoreItem,originalItems=[],fixedItemIds=new Set()}={}){
  const summary=el('section','','season-team-summary'),first=memories[0],info=idolInfo({idolCardId:first.idolCardId,levelLimitRank:ownedIdol?.levelLimitRank}),head=el('div','','season-team-heading'),identity=el('div','','season-team-identity');
  const art=illustration(info.image,info.name,'portrait',{characterId:first.characterId});art.classList.add('season-team-idol-art');
  const name=el('div','','season-team-name');name.append(el('span',`【${info.name}】`),el('strong',characterInfo(first.characterId).name));
  const power=el('div','','season-board-power');power.append(el('span',t(totals.powerSource==='calculated'?'综合值合计（计算值）':'综合值合计')),el('strong',shown(totals.power)));name.append(power);identity.append(art,name);
  const stats=el('div','','season-board-stats');
  for(const [key,label] of [['vocal','Vo'],['dance','Da'],['visual','Vi'],['stamina','体力']]){
    const stat=el('div','','season-board-stat');stat.dataset.attribute=key;stat.append(el('small',t(label)),el('strong',shown(totals[key])));
    if(key!=='stamina'){const value=totals.multipliers[key],multiplier=el('span',value===null?'—':`${Number((value*100).toFixed(1))}%`,'season-board-multiplier');multiplier.title=t('属性倍率');stat.append(multiplier);}stats.append(stat);
  }
  head.append(identity,stats);summary.append(head);
  const items=el('section','','season-team-items');
  // P 道具只由主回忆提供，不混入副回忆。
  const ids=first.examBattleProduceItemIds??[],strip=el('div','','season-board-items');items.append(strip);
  for(const [index,id] of ids.entries()){
    const original=originalItems[index],changed=Boolean(original)&&original!==id,wrapper=el('div','','season-item-slot'),hint=contestConfig([id],'item',first.characterId).firstElementChild;
    wrapper.dataset.itemSlot=String(index);wrapper.dataset.fixed=String(fixedItemIds.has(original??id));
    if(changed){wrapper.append(replacedOriginal(contestConfig([original],'item',first.characterId).firstElementChild,original));hint.classList.add('season-card-replacement');}
    wrapper.append(hint);strip.append(wrapper);
    if(onEditItem&&!fixedItemIds.has(original??id)){const restore=changed||index>=originalItems.length,edit=el('button',t(restore?'还原':'替换'),'contest-slot-edit');edit.dataset.editItem=String(index);edit.dataset.action=restore?'restore':'edit';edit.setAttribute('aria-label',t(restore?'还原 P 道具 {0}':'替换 P 道具 {0}',[index+1]));edit.onclick=()=>restore?onRestoreItem(index):onEditItem(index);wrapper.append(edit);}
  }
  if(onAddItem&&contestExtraItemCount(ids,fixedItemIds)<(contestExtraItemLimit(first.grade)??0)){const empty=el('button','+','season-item-empty');empty.dataset.addItem='';empty.setAttribute('aria-label',t('添加 P 道具'));empty.title=t('添加 P 道具');empty.onclick=onAddItem;strip.append(empty);}
  if(first.examBattleProduceItemIds===undefined)items.append(el('span',t('未记录'),'small muted'));
  else if(!ids.length&&!onAddItem)items.append(el('span',t('无'),'small muted'));
  summary.append(items);return summary;
}

let picker;
export function openContestMemoryPicker({rows,stagePlanType,requiredCharacterId,selectedKey,usedKeys,onSelect,returnFocus}){
  closeRewardPopover();
  if(!picker){picker=el('dialog','','contest-memory-picker');picker.id='contest-memory-picker';picker.setAttribute('aria-labelledby','contest-memory-picker-title');document.body.append(picker);}
  const head=el('div','','dialog-head'),heading=el('h2',t('选择回忆'));heading.id='contest-memory-picker-title';const close=el('button',t('关闭'));close.onclick=()=>picker.close();head.append(heading,close);
  const filters=el('div','','contest-memory-filters'),character=el('fieldset','','contest-memory-icon-filters contest-memory-characters'),sort=el('select');character.id='contest-memory-character';sort.id='season-memory-sort';
  const stagePlan=({ProducePlanType_Plan1:'2',ProducePlanType_Plan2:'3',ProducePlanType_Plan3:'4'})[stagePlanType]??'';
  let characterValue=requiredCharacterId??'',planValue=stagePlan,flowValue='';
  const allIcon=()=>{const icon=el('span','','contest-filter-all');icon.setAttribute('aria-hidden','true');for(let i=0;i<4;i++)icon.append(el('i'));return icon;};
  character.setAttribute('role','radiogroup');character.setAttribute('aria-label',t('角色'));character.setAttribute('aria-disabled',String(Boolean(requiredCharacterId)));
  const characterButtons=[],navigateCharacters=createChoiceNavigation({getButtons:()=>characterButtons,onMove:button=>button.click()});
  for(const id of ['',...[...new Set(rows.map(row=>row.memory.characterId))].sort(compareCharacterFilters)]){
    const button=el('button','','character-choice');button.dataset.characterId=id;button.setAttribute('role','radio');button.disabled=Boolean(requiredCharacterId);
    const label=id?characterInfo(id).name:t('全部角色');button.title=label;button.setAttribute('aria-label',label);
    if(id){const info=characterInfo(id);characterAccent(button,id);button.append(illustration(info.face,info.name,'filter-face'));}else button.append(allIcon());
    button.onclick=()=>{characterValue=id;page=0;syncCharacters();draw();};button.onkeydown=navigateCharacters;characterButtons.push(button);character.append(button);
  }
  function syncCharacters(){for(const button of characterButtons){const selected=button.dataset.characterId===characterValue;button.setAttribute('aria-checked',String(selected));button.tabIndex=selected?0:-1;}}syncCharacters();
  // 图标使用公共计划键；回忆筛选与现有 data-plan 仍使用数字计划值。
  const planValues={'':'',Plan1:'2',Plan2:'3',Plan3:'4'},planInput=el('select'),flowInput=el('select');
  for(const [symbol,value] of Object.entries(planValues))if(!stagePlan||value===stagePlan)planInput.append(new Option(value?planLabel(Number(value)):t('全部'),symbol));
  planInput.value=Object.keys(planValues).find(key=>planValues[key]===planValue);
  const planIcons=choiceFilterIcons(planInput,'plan','计划',()=>{planValue=planValues[planInput.value];page=0;planIcons.sync();syncFlows();draw();},{id:'contest-memory-plan'}),plans=planIcons.group;
  plans.classList.add('contest-memory-plans');
  for(const button of planIcons.buttons){button.classList.add('contest-plan-choice');button.dataset.plan=planValues[button.dataset.value];}
  for(const value of [{id:'',label:'全部流派'},...selectionFlowDefinitions])flowInput.append(new Option(t(value.label),value.id));
  const flowIcons=choiceFilterIcons(flowInput,'flow','流派',()=>{flowValue=flowInput.value;page=0;syncFlows();draw();},{id:'contest-memory-flow'}),flow=flowIcons.group;
  flow.classList.add('contest-memory-flows');
  for(const button of flowIcons.buttons){button.classList.add('contest-flow-choice');button.dataset.flow=button.dataset.value;}
  const planFlows={2:['parameter','lesson'],3:['aggressive','review'],4:['concentration','fullPower']};
  function syncFlows(){
    const allowed=planFlows[planValue];if(allowed&&flowValue&&!allowed.includes(flowValue))flowValue='';
    flowInput.value=flowValue;flowIcons.sync({isVisible:value=>!allowed||!value||allowed.includes(value)});
  }syncFlows();
  const planFlowRow=el('div','','contest-memory-plan-flows');planFlowRow.append(plans,flow);

  for(const [key,label] of [['ordinal','快照顺序'],['vocal','Vo 倍率 ↓'],['dance','Da 倍率 ↓'],['visual','Vi 倍率 ↓']])sort.append(new Option(t(label),key));
  for(const [label,input] of [['排序',sort]]){const wrap=el('label',t(label));wrap.append(input);filters.append(wrap);}
  const count=el('p','','small muted'),list=el('div','','contest-memory-options'),paging=el('div','','season-result-paging'),previous=el('button',t('上一页')),next=el('button',t('下一页')),pageInfo=el('span');count.setAttribute('aria-live','polite');paging.append(previous,pageInfo,next);const filterPanel=el('div','','contest-memory-filter-panel');filterPanel.append(character,planFlowRow,filters,...(requiredCharacterId?[el('p',t('两张回忆须属于同一角色；如需更换角色，请先移除另一张回忆。'),'small muted')]:[]));picker.replaceChildren(head,filterPanel,el('hr','','contest-memory-divider'),count,list,paging);let page=0;const size=20;
  function draw(){
    const visible=rows.filter(row=>(!characterValue||row.memory.characterId===characterValue)&&(!planValue||String(row.memory.planType)===planValue)&&(!flowValue||memoryFlows(row.memory).includes(flowValue)));
    if(sort.value!=='ordinal')visible.sort((a,b)=>(b.multipliers[sort.value]??-Infinity)-(a.multipliers[sort.value]??-Infinity)||(a.memory.ordinal??0)-(b.memory.ordinal??0));
    count.textContent=t('符合筛选：{0} 条回忆',[visible.length]);list.replaceChildren();
    if(!visible.length)list.append(el('p',t('没有匹配选项'),'empty-result'));
    for(const {memory,multipliers} of visible.slice(page*size,(page+1)*size)){
      const option=memoryContestCard(memory,multipliers),disabled=usedKeys.has(memory.key)&&memory.key!==selectedKey;option.dataset.memoryKey=memory.key;option.dataset.character=memory.characterId;option.dataset.plan=String(memory.planType);option.dataset.flows=memoryFlows(memory).join(' ');option.setAttribute('aria-disabled',String(disabled));option.classList.toggle('selected',memory.key===selectedKey);
      const footer=el('div','','contest-memory-choice-footer'),choose=el('button',t(disabled?'已在其他槽位':memory.key===selectedKey?'已选择':'选择'),'contest-memory-choose');choose.disabled=disabled;choose.setAttribute('aria-label',t('选择回忆')+' · '+title(memory));
      const apply=()=>{if(disabled)return;closeRewardPopover();onSelect(memory);picker.close();};choose.onclick=apply;option.onclick=event=>{if(!event.target.closest('button,a,input,select,summary,[popover]'))apply();};footer.append(choose);option.querySelector('.memory-card-topline').append(footer);list.append(option);

    }
    previous.disabled=page===0;next.disabled=(page+1)*size>=visible.length;pageInfo.textContent=`${visible.length?page+1:0} / ${Math.ceil(visible.length/size)}`;
  }
  for(const input of [sort])input.onchange=()=>{page=0;draw();};previous.onclick=()=>{page--;draw();};next.onclick=()=>{page++;draw();};draw();openDialog(picker,{returnFocus});
}
