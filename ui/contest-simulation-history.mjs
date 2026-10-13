import {el} from './dom.mjs';
import {t,locale} from '../i18n.mjs';
import {simulationHistory,deleteSimulationRun,simulationStageKey,SIMULATION_HISTORY_LIMIT} from '../application/contest-simulation-history.mjs';
import {loadoutPreview} from './contest-loadout-library.mjs';
import {illustration,skillThumbnailFor,itemThumbnail} from './illustrations.mjs';
import {itemRewardInfo,characterInfo} from '../domain/catalog.mjs';
import {recommendationStatistics} from '../domain/contest-recommendations.mjs';
import {comparisonScore,comparisonRange,scoreQuantile} from './contest-simulation-charts.mjs';

const number=value=>new Intl.NumberFormat(locale(),{maximumFractionDigits:0}).format(value);
export function simulationLoadoutSummary(entry){
  const details=el('details','','simulation-history-loadout');details.append(el('summary',t('本次编组')));
  const params=el('p','','simulation-history-params');for(const [key,label] of [['vocal','Vo'],['dance','Da'],['visual','Vi'],['stamina','体力']])params.append(el('span',`${t(label)} ${number(entry.request.params[key])}`));
  params.append(el('span',t('支援奖励 +{0}%',[(entry.request.supportBonus*100).toFixed(2)])));details.append(params);
  if(entry.request.manualMultipliers)details.append(el('p',t('使用手动输入的倍率，不再叠加支援奖励。'),'small muted'));
  const strip=el('div','','simulation-history-deck');
  for(const item of entry.request.items){const tile=el('span','','simulation-history-card');tile.append(itemThumbnail(itemRewardInfo(item.id)),el('small',item.record.name));strip.append(tile);}
  for(const card of entry.request.cards){const tile=el('span','','simulation-history-card');tile.append(skillThumbnailFor(card.reference,entry.characterId,{compact:true}),el('small',card.record.name));const count=card.reference.customizes.reduce((sum,value)=>sum+value.customizeCount,0);if(count)tile.append(el('small',t('附魔次数：{0}',[count])));strip.append(tile);}
  details.append(strip);return details;
}
export function createSimulationHistoryPanel({profile,stage,onView,onRestore}){
  const element=el('section','','simulation-history'),status=el('p','','small muted'),list=el('div','','simulation-history-list');
  element.append(status,list);
  let entries=[],currentId=null,baselineId=null,busy=false,version=0;
  function draw(){
    const shown=entries.filter(entry=>entry.stageKey===simulationStageKey(stage)),minimum=Math.min(...shown.map(entry=>entry.result.minimum)),maximum=Math.max(...shown.map(entry=>entry.result.maximum));
    const baseline=shown.find(entry=>entry.id===baselineId);if(!baseline)baselineId=null;
    const baselineValues=baseline?{mean:baseline.result.mean,median:baseline.result.median,p75:scoreQuantile(baseline.result.scores,.75)}:null;
    list.replaceChildren();
    status.textContent=profile?t('每个舞台保留最近 {0} 次模拟，仅保存于当前浏览器。',[SIMULATION_HISTORY_LIMIT]):t('当前没有账号档案，模拟结果不会保存。');
    if(!shown.length){list.append(el('p',t('此舞台尚无模拟历史。'),'small muted'));return;}
    status.textContent+=' '+t('分布条使用相同分数刻度；色块为中间 50% 的结果。');
    for(const entry of shown){
      const row=el('article','','simulation-history-entry');row.dataset.historyId=entry.id;row.classList.toggle('is-current',entry.id===currentId);row.classList.toggle('is-baseline',entry.id===baselineId);
      const heading=el('div','','simulation-history-heading'),date=el('time',new Intl.DateTimeFormat(locale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(entry.createdAt)));date.dateTime=entry.createdAt;
      const identity=el('div','','simulation-history-identity'),statistics=recommendationStatistics(entry.result.scores);identity.append(date);
      if(entry.characterId){const character=characterInfo(entry.characterId),face=illustration(character.face,character.name,'simulation-history-face');face.title=character.name;identity.append(face);}
      identity.append(el('span',t('{0} 次模拟',[entry.result.runs])));if(entry.id===currentId)identity.append(el('strong',t('当前查看')));if(entry.id===baselineId)identity.append(el('strong',t('比较基准'),'simulation-history-baseline-label'));heading.append(identity,comparisonScore(statistics));
      const scores=el('div','','simulation-history-scores'),values={...entry.result,deviation:statistics.deviation,p25:scoreQuantile(entry.result.scores,.25),p75:scoreQuantile(entry.result.scores,.75)};for(const [key,title] of [['mean','平均值'],['median','中位数'],['deviation','标准差'],['p25','P25'],['p75','P75']]){const cell=el('span');cell.dataset.metric=key;cell.append(el('small',t(title)),el('strong',number(values[key])));scores.append(cell);}
      const actions=el('div','','simulation-history-actions'),view=el('button',t('查看结果')),restore=el('button',t('载入编组至自选模拟'),'primary'),remove=el('button',t('删除')),compare=el('button',t(entry.id===baselineId?'取消基准':'设为基准'));compare.dataset.action='baseline';compare.setAttribute('aria-pressed',String(entry.id===baselineId));compare.onclick=()=>{baselineId=entry.id===baselineId?null:entry.id;draw();list.querySelector(`[data-history-id="${entry.id}"] [data-action=baseline]`)?.focus({preventScroll:true});};
      view.disabled=busy;view.onclick=()=>{if(busy)return;currentId=entry.id;onView(entry);draw();};restore.disabled=busy||!entry.loadout||!onRestore;restore.onclick=()=>{if(!busy)onRestore?.(entry);};
      remove.onclick=async()=>{
        if(!remove.dataset.confirmed){remove.dataset.confirmed='true';remove.textContent=t('确认删除');return;}
        remove.disabled=true;try{await deleteSimulationRun(profile,entry.id);await refresh();}catch{status.textContent=t('历史记录删除失败，请重试。');remove.disabled=false;}
      };
      const body=el('div','','simulation-history-body'),result=el('div','','simulation-history-result');
      const preview=entry.loadout?.memories?.some(Boolean)?loadoutPreview(entry.loadout):simulationLoadoutSummary(entry);
      if(preview.tagName==='DETAILS')preview.open=true;
      result.append(scores,comparisonRange(entry.result,minimum,maximum));body.append(preview,result);
      if(baseline&&entry.id!==baselineId){
        const comparison=el('section','','simulation-history-comparison'),deltas=el('div','','simulation-history-deltas');comparison.setAttribute('aria-label',t('与基准比较'));comparison.append(el('p',t('相对基准（本次 − 基准）'),'small muted'));
        for(const [key,label] of [['mean','平均值'],['median','中位数'],['p75','P75']]){
          const delta=Math.round(values[key]-baselineValues[key]),cell=el('div'),value=el('strong',new Intl.NumberFormat(locale(),{maximumFractionDigits:0,signDisplay:'exceptZero'}).format(delta===0?0:delta));cell.dataset.delta=key;value.dataset.direction=delta>0?'up':delta<0?'down':'same';cell.append(el('small',t(label)),value);deltas.append(cell);
        }
        comparison.append(deltas);
        if(entry.result.runs!==baseline.result.runs)comparison.append(el('p',t('模拟次数不同：本次 {0} 次，基准 {1} 次。',[number(entry.result.runs),number(baseline.result.runs)]),'simulation-history-comparison-note small muted'));
        const different=['vocal','dance','visual'].filter(key=>entry.result.multipliers[key]!==baseline.result.multipliers[key]);
        if(different.length){
          const percent=value=>new Intl.NumberFormat(locale(),{maximumFractionDigits:2}).format(value*100)+'%',names={vocal:'Vo',dance:'Da',visual:'Vi'};
          comparison.append(el('p',t('比赛倍率不同（本次 / 基准）：{0}。',[different.map(key=>`${names[key]} ${percent(entry.result.multipliers[key])} / ${percent(baseline.result.multipliers[key])}`).join(' · ')]),'simulation-history-comparison-note small muted'));
        }
        result.append(comparison);
      }
      actions.append(view,restore,compare,remove);row.append(heading,body,actions);list.append(row);
    }
  }
  async function refresh(id=currentId){
    currentId=id;const ticket=++version;element.inert=true;element.setAttribute('aria-busy','true');
    try{const rows=await simulationHistory(profile);if(ticket!==version)return;entries=rows;draw();}
    catch{if(ticket===version)status.textContent=t('历史记录读取失败，请重试。');}
    finally{if(ticket===version){element.inert=false;element.setAttribute('aria-busy','false');}}
  }
  draw();
  return {element,refresh,setStage(value){stage=value;draw();void refresh();},setBusy(value){if(busy!==value){busy=value;draw();}}};
}
