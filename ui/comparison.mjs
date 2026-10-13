import {$,el,openDialog} from './dom.mjs';
import {canCompareMemory,comparisonFieldEntries} from '../domain/memories.mjs';
import {t,onLocaleChange} from '../i18n.mjs';
import {title,shown,shotDate} from '../domain/model.mjs';
import {selectionGrades} from '../domain/selection-memories.mjs';
import {characterInfo,idolInfo,memoryExclusiveSkill,selectionChoiceMetadata,cardRewardInfo,itemRewardInfo} from '../domain/catalog.mjs';
import {characterArt,characterAccent,skillThumbnailFor} from './illustrations.mjs';
import {rewardHint,closeRewardPopover} from './card-rewards.mjs';

let comparing=[];
const compactComparison=window.matchMedia('(max-width:599px)');
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
function baseOptions(){
  const selected=$('compare-base').value;
  $('compare-base').replaceChildren(...comparing.map((memory,index)=>new Option(`${title(memory)} · ${characterInfo(memory.characterId).name}`,String(index))));
  $('compare-base').value=selected&&Number(selected)<comparing.length?selected:'0';
}
export function showComparison(memories,{returnFocus=()=>$('compare')}={}){
  comparing=memories.filter(canCompareMemory);if(comparing.length<2)return;
  closeRewardPopover();$('compare-base').value='0';baseOptions();$('differences-only').checked=false;
  $('compare-base').onchange=()=>{renderComparison();revealComparisonBase();};$('differences-only').onchange=renderComparison;
  $('compare-dialog').addEventListener('close',closeRewardPopover,{once:true});
  renderComparison();openDialog($('compare-dialog'),{dismissOnBackdrop:true,returnFocus});
}
function revealComparisonBase(){
  const container=$('comparison'),base=container.querySelector('thead .comparison-base-column'),label=container.querySelector('thead th');
  if(compactComparison.matches){container.scrollLeft=0;container.scrollTop=0;return;}
  // 基准列对齐到固定字段列右侧；只滚动比较区，不移动页面或控件焦点。
  const bounds=container.getBoundingClientRect(),cell=base.getBoundingClientRect(),left=bounds.left+container.clientLeft+label.getBoundingClientRect().width;
  if(cell.left<left||cell.right>bounds.left+container.clientLeft+container.clientWidth)container.scrollLeft+=cell.left-left;
  container.scrollTop=0;
}
function memoryHeading(memory,isBase,{candidate=false}={}){
  const head=characterAccent(el('div','','comparison-memory-head'),memory.characterId),exclusive=memoryExclusiveSkill(memory);
  const picture=el('span','','comparison-memory-art');picture.append(exclusive?skillThumbnailFor(exclusive.reference,memory.characterId,{compact:true}):characterArt(memory.characterId));
  const identity=el('div','','comparison-memory-identity'),name=el('div','','comparison-memory-name');name.append(el('strong',characterInfo(memory.characterId).name));
  if(isBase)name.append(el('span',t('基准'),'comparison-base-badge'));
  else if(candidate)name.append(el('span',t('候选回忆'),'comparison-candidate-badge'));
  const card=el('span',idolInfo(memory).name,'comparison-idol-name');card.title=card.textContent;
  identity.append(name,card,el('small',`${title(memory)} · ${shotDate(memory)}`));head.append(picture,identity);return head;
}
function configIcon(field,entry,memory){
  const box=el('span','','comparison-item');box.dataset.configKey=entry.key;
  {
    const isCard=field!=='examBattleProduceItemIds',reward=isCard?cardRewardInfo(entry.value,memory.characterId):itemRewardInfo(entry.value);
    const hint=rewardHint(reward,{label:''},false,'',{chooseVersion:false,recorded:isCard,customization:null});hint.classList.add('support-art-event');box.append(hint);
    if(isCard){
      box.dataset.cardId=entry.value.id;box.dataset.upgrade=String(entry.value.upgradeCount);
      const count=(entry.value.customizes??[]).reduce((sum,value)=>sum+value.customizeCount,0);
      if(count){const badge=el('span',String(count),'selection-custom-count');badge.title=t('附魔次数：{0}',[count]);hint.querySelector('button').append(badge);}
    }
  }
  if(entry.count>1){const count=el('b',`×${entry.count}`,'comparison-count');count.title=t('数量 ×{0}',[entry.count]);box.append(count);}
  return box;
}
function configurationPairs(baseIndex,only){
  const container=el('div','','comparison-pairs'),base=comparing[baseIndex];
  comparing.forEach((memory,index)=>{
    if(index===baseIndex)return;
    const pair=el('div','','comparison-pair');pair.dataset.targetIndex=String(index);
    const labels=el('div','','comparison-pair-labels');labels.append(el('span',''));
    for(const [value,isBase] of [[base,true],[memory,false]]){
      const label=el('div',`${isBase?t('基准')+' · ':''}${title(value)} · ${characterInfo(value.characterId).name}`,'comparison-pair-label');
      label.classList.toggle('comparison-base-column',isBase);label.title=label.textContent;labels.append(label);
    }
    pair.append(labels);
    for(const [field,label] of [['examBattleProduceCards','考试技能卡'],['examBattleProduceItemIds','考试 P 道具']]){
      const model=comparisonFieldEntries([base,memory],field),entries=new Map(model.rows.flatMap(row=>row??[]).map(entry=>[entry.key,entry]));
      let columns=[...entries.values()];
      const sourceRank=entry=>{const source=selectionChoiceMetadata(field==='examBattleProduceCards'?'card':'item',entry.value).source;return source==='idol'?0:source==='support'?1:2;};
      columns.sort((a,b)=>sourceRank(a)-sourceRank(b));
      if(only)columns=columns.filter(entry=>model.different.has(entry.key));
      const group=el('section','','comparison-pair-config');group.dataset.compareField=field;group.append(el('div',t(label),'comparison-pair-caption'));
      const grid=el('div','','comparison-aligned-grid');grid.style.setProperty('--pair-columns',String(Math.max(columns.length,1)));
      model.rows.forEach((row,rowIndex)=>{
        const lookup=new Map((row??[]).map(entry=>[entry.key,entry]));
        for(const column of columns.length?columns:[null]){
          const slot=el('div','','comparison-aligned-slot');slot.dataset.pairRow=String(rowIndex);slot.dataset.configKey=column?.key??'';slot.classList.toggle('comparison-base-column',rowIndex===0);
          const entry=column&&lookup.get(column.key);
          if(entry){const icon=configIcon(field,entry,rowIndex===0?base:memory);icon.classList.toggle('comparison-config-different',model.different.has(entry.key));slot.append(icon);}
          else slot.append(el('span',row===null?t('未记录'):'—','comparison-empty'));
          grid.append(slot);
        }
      });group.append(grid);pair.append(group);
    }
    container.append(pair);
  });return container;
}

function statCell(field,value,baseValue,isBase,format){
  const cell=el('td');cell.classList.toggle('comparison-base-column',isBase);cell.classList.toggle('comparison-different',!isBase&&value!==baseValue);
  cell.append(el('strong',format(value),'comparison-stat-value'));
  if(field!=='grade'&&!isBase&&numeric(value)&&numeric(baseValue)){const delta=value-baseValue,difference=el('span',delta?`${delta>0?'+':''}${delta}`:'±0','comparison-delta');difference.dataset.direction=delta>0?'up':delta<0?'down':'same';cell.append(difference);}
  return cell;
}
function mobileSummary(baseIndex,only,stats){
  const summary=el('div','','comparison-mobile-summary'),base=comparing[baseIndex];
  comparing.forEach((memory,index)=>{
    if(index===baseIndex)return;
    const pair=el('section','','comparison-summary-pair');pair.dataset.targetIndex=String(index);
    const table=el('table','','comparison-summary-table');table.setAttribute('aria-label',t('候选：{0}',[title(memory)]));
    const head=el('thead'),heading=el('tr');heading.append(el('th',t('比较项')));
    for(const [value,isBase] of [[base,true],[memory,false]]){const cell=el('th');cell.scope='col';cell.classList.toggle('comparison-base-column',isBase);cell.append(memoryHeading(value,isBase,{candidate:!isBase}));heading.append(cell);}
    head.append(heading);table.append(head);const body=el('tbody');
    for(const {field,label,values,format} of stats){
      const baseline=values[baseIndex],value=values[index],unknown=[baseline,value].some(entry=>entry===undefined||entry===null);
      if(only&&value===baseline&&!unknown)continue;
      const row=el('tr','','comparison-stat-row');row.dataset.compareField=field;const labelCell=el('th',label);labelCell.scope='row';row.append(labelCell,statCell(field,baseline,baseline,true,format),statCell(field,value,baseline,false,format));body.append(row);
    }
    if(!body.childNodes.length){const row=el('tr'),cell=el('td',t('这些回忆的已记录数值相同。'),'comparison-equal');cell.colSpan=3;row.append(cell);body.append(row);}
    table.append(body);pair.append(table);summary.append(pair);
  });return summary;
}
function syncComparisonViewport(){
  const dialog=$('compare-dialog');if(!dialog?.open)return;
  dialog.querySelector('.comparison-help').textContent=t(compactComparison.matches?'差值相对基准 · 技能卡和 P 道具可横向滚动 · 点击图标查看效果':'差值相对基准 · 横向滚动查看其他回忆 · 点击图标查看效果');
  $('comparison').querySelector('.comparison-config-scroll').tabIndex=compactComparison.matches?0:-1;
  revealComparisonBase();
}

function renderComparison(){
  closeRewardPopover();
  const baseIndex=Number($('compare-base').value)||0,only=$('differences-only').checked;
  const stats=[{field:'grade',label:t('评级'),values:comparing.map(memory=>memory.grade),format:value=>selectionGrades[value]||'—'},...[['vocal','Vo'],['dance','Da'],['visual','Vi'],['stamina',t('体力')],['power',t('综合值')]].map(([field,label])=>({field,label,values:comparing.map(memory=>memory[field]),format:shown}))];
  const table=el('table','','comparison-table');table.style.setProperty('--comparison-columns',String(comparing.length));
  const head=el('thead'),heading=el('tr');heading.append(el('th',t('比较项')));
  comparing.forEach((memory,index)=>{const cell=el('th','','comparison-memory-column');cell.scope='col';cell.classList.toggle('comparison-base-column',index===baseIndex);cell.append(memoryHeading(memory,index===baseIndex));heading.append(cell);});head.append(heading);table.append(head);
  const body=el('tbody');
  const add=(field,label,values,format=shown)=>{
    const unknown=values.some(value=>value===undefined||value===null),different=new Set(values).size>1;
    if(only&&!different&&!unknown)return;
    const row=el('tr','','comparison-stat-row');row.dataset.compareField=field;const labelCell=el('th',label);labelCell.scope='row';row.append(labelCell);
    values.forEach((value,index)=>row.append(statCell(field,value,values[baseIndex],index===baseIndex,format)));body.append(row);
  };
  for(const {field,label,values,format} of stats)add(field,label,values,format);
  if(!body.childNodes.length&&!['examBattleProduceCards','examBattleProduceItemIds'].some(field=>comparisonFieldEntries(comparing,field).hasDifference)){const row=el('tr'),cell=el('td',t('这些回忆的已记录数值与配置相同。'),'comparison-equal');cell.colSpan=comparing.length+1;row.append(cell);body.append(row);}
  const configurations=el('section','','comparison-config-scroll');configurations.setAttribute('aria-label',`${t('考试技能卡')} · ${t('考试 P 道具')}`);configurations.tabIndex=compactComparison.matches?0:-1;configurations.append(configurationPairs(baseIndex,only));
  table.append(body);$('comparison').setAttribute('aria-label',t('比较回忆'));$('comparison').replaceChildren(table,mobileSummary(baseIndex,only,stats),configurations);
  $('compare-dialog').querySelector('.comparison-help').textContent=t(compactComparison.matches?'差值相对基准 · 技能卡和 P 道具可横向滚动 · 点击图标查看效果':'差值相对基准 · 横向滚动查看其他回忆 · 点击图标查看效果');
}

compactComparison.addEventListener('change',syncComparisonViewport);
onLocaleChange(()=>{if($('compare-dialog')?.open){baseOptions();renderComparison();}});
