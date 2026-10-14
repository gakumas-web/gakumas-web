import {recommendationUncertainty} from './contest-recommendations.mjs';

export const compareOptimizationRows=(a,b)=>b.stats.score-a.stats.score||b.stats.median-a.stats.median||a.key.localeCompare(b.key);
// 主副分别排序，忽略强化和附魔；结构键仅用于名额分配，不能作为评分缓存键。
export const optimizationStructureKey=(genome,variants)=>JSON.stringify([0,6].map(start=>genome.slice(start,start+6).map(index=>variants[index].reference.id).sort()));

export function diverseOptimizationRows(rows,limit,{fraction=.25,maxLoss=.2}={}){
  if(limit<=0)return [];
  const ranked=[...rows].sort(compareOptimizationRows);if(ranked.length<=limit)return ranked;
  const selected=ranked.slice(0,Math.max(1,limit-Math.floor(limit*fraction))),keys=new Set(selected.map(row=>row.key)),structures=new Set(selected.map(row=>row.structure));
  const floor=ranked[0].stats.score-Math.max(1,Math.abs(ranked[0].stats.score))*maxLoss;
  for(const row of ranked){
    if(selected.length>=limit)break;
    if(keys.has(row.key)||structures.has(row.structure)||row.stats.score<floor)continue;
    selected.push(row);keys.add(row.key);structures.add(row.structure);
  }
  for(const row of ranked){if(selected.length>=limit)break;if(!keys.has(row.key)){selected.push(row);keys.add(row.key);}}
  return selected.sort(compareOptimizationRows);
}

// 只比较晋级边界及前列竞争者；区间用于分配预算，不作为置信保证。
export function optimizationCompetition(rows,limits){
  const ranked=[...rows].sort(compareOptimizationRows),contests=[];
  const intervals=ranked.map(row=>recommendationUncertainty(row.scores));
  for(const limit of limits){
    const boundary=Math.min(limit,ranked.length)-1;if(boundary<0)continue;
    for(let i=0;i<=boundary;i++)for(let j=boundary+1;j<ranked.length;j++){
      if(intervals[j].upper<intervals[i].lower||intervals[i].upper<intervals[j].lower)continue;
      contests.push({limit,inside:ranked[i].key,challenger:ranked[j].key});
    }
  }
  return {ranked,intervals,contests};
}
export function optimizationRefinements(rows,limits,targetRuns,onCompetition){
  const competition=optimizationCompetition(rows,limits),selected=new Set(competition.contests.flatMap(value=>[value.inside,value.challenger]));
  onCompetition?.(competition);
  return competition.ranked.filter(row=>selected.has(row.key)&&row.scores.length<targetRuns);
}
