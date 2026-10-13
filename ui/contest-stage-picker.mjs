import {el,openDialog} from './dom.mjs';
import {t,locale} from '../i18n.mjs';
import {planLabel} from '../domain/catalog.mjs';
import {filterSymbol} from './illustrations.mjs';
const attributes=['vocal','dance','visual'],short=['Vo','Da','Vi'];
export const contestPlanName=value=>value==='ProducePlanType_Common'?t('不限计划'):planLabel(value.replace('ProducePlanType_',''));
export function contestStageName(stage){
  if(stage.custom)return t('自定义舞台');
  if(stage.kind==='contest')return t('第 {0} 赛季 · 舞台 {1}',[stage.seasonNumber,stage.stageNumber]);
  if(stage.kind==='linkContest')return t('链接比赛 · 舞台 {0}',[stage.preset.stage]);
  return [stage.preset.name,stage.preset.round?t('第 {0} 轮',[stage.preset.round]):'',stage.preset.stage?t('舞台 {0}',[stage.preset.stage]):''].filter(Boolean).join(' · ');
}
export function contestStageSummary(stage,{withinSeason=false}={}){
  const summary=el('span','','contest-stage-summary'),heading=el('span','','contest-stage-identity'),plan=el('span','','contest-stage-plan');
  const symbol=filterSymbol(stage.planType.replace('ProducePlanType_',''));if(symbol)plan.append(symbol);
  plan.append(el('span',contestPlanName(stage.planType)));heading.append(el('strong',withinSeason?t('舞台 {0}',[stage.kind==='contest'?stage.stageNumber:stage.preset.stage]):contestStageName(stage)),plan);
  if(stage.preset?.preview&&!stage.custom)heading.append(el('small',t('预告'),'badge'));
  summary.append(heading);
  if(stage.criteria){
    const bar=el('span','','contest-criteria-bar'),labels=el('span','','contest-criteria-labels');bar.setAttribute('aria-hidden','true');
    attributes.forEach((key,index)=>{const value=stage.criteria[key],part=el('span'),label=el('span',`${short[index]} ${Number((value*100).toFixed(1))}%`);part.style.flexGrow=String(value);part.dataset.attribute=key;label.dataset.attribute=key;bar.append(part);labels.append(label);});summary.append(bar,labels);
  }else summary.append(el('small',t('属性分配未收录'),'muted'));
  const turns=el('span','','contest-turn-counts');turns.append(el('span',t('{0} 回合',[stage.turn])));
  if(stage.turnCounts)turns.append(el('span',attributes.map((key,index)=>`${short[index]} ${stage.turnCounts[key]}`).join(' / ')));
  summary.append(turns);return summary;
}
let dialog;
export function openContestStagePicker(catalog,current,onSelect,returnFocus){
  if(!dialog){dialog=el('dialog','','contest-stage-picker');dialog.id='contest-stage-picker';dialog.setAttribute('aria-labelledby','contest-stage-picker-title');document.body.append(dialog);}
  const heading=el('div','','dialog-head'),title=el('h2',t('选择舞台'));title.id='contest-stage-picker-title';const close=el('button',t('取消'));close.onclick=()=>dialog.close();heading.append(title,close);
  const tabs=el('div','','contest-stage-types'),content=el('div','','contest-stage-options'),search=el('input');search.type='search';search.placeholder=t('搜索赛季或活动');search.setAttribute('aria-label',t('搜索赛季或活动'));search.id='contest-stage-search';
  const hint=el('p','','contest-stage-external-hint small muted'),link=el('a','Gakumas-Tools');link.href=`https://gktools.ris.moe/${locale()==='ja'?'ja':'zh-Hans'}/simulator`;link.target='_blank';link.rel='noopener noreferrer';
  const [before,after]=t('自定义舞台可前往 {0} 进行模拟。',['{link}']).split('{link}');hint.append(before,link,after);
  dialog.replaceChildren(heading,hint,tabs,search,content);let type=current.kind==='event'?'event':'contest';
  const kinds=[['contest','竞技场'],['event','活动']];
  const apply=stage=>{onSelect(stage);dialog.close();};
  function render(){
    tabs.replaceChildren();content.replaceChildren();
    for(const [key,label] of kinds){const button=el('button',t(label));button.dataset.stageType=key;button.setAttribute('aria-pressed',String(type===key));button.onclick=()=>{type=key;search.value='';render();};tabs.append(button);}
    const query=search.value.trim().toLowerCase(),rows=catalog.choices.filter(row=>row.kind===type&&contestStageName(row).toLowerCase().includes(query));
    for(const row of rows){const button=el('button','','contest-stage-option');button.dataset.stageId=row.id;button.setAttribute('aria-pressed',String(row.id===current.id));button.append(contestStageSummary(row));button.onclick=()=>apply(row);content.append(button);}
    if(!rows.length)content.append(el('p',t('没有匹配的舞台。'),'empty-result'));
    content.scrollTop=0;
  }
  search.oninput=render;render();openDialog(dialog,{returnFocus});
}
