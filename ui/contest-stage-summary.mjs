import {appendContestCriteria} from './contest-criteria.mjs';
import {el} from './dom.mjs';
import {t} from '../i18n.mjs';
import {planLabel} from '../domain/catalog.mjs';
import {filterSymbol} from './illustrations.mjs';
import {contestGroupUpcoming} from '../domain/contest-period.mjs';
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
  if(!withinSeason&&!stage.custom&&contestGroupUpcoming({stages:[stage]}))heading.append(el('small',t('预告'),'badge'));
  summary.append(heading);
  if(stage.criteria)appendContestCriteria(summary,stage.criteria);
  else summary.append(el('small',t('属性分配未收录'),'muted'));
  const turns=el('span','','contest-turn-counts');turns.append(el('span',t('{0} 回合',[stage.turn])));
  if(stage.turnCounts)turns.append(el('span',attributes.map((key,index)=>`${short[index]} ${stage.turnCounts[key]}`).join(' / ')));
  summary.append(turns);return summary;
}
