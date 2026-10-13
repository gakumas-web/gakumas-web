import {contestPlanMatches} from './contest-simulation.mjs';

export const RECOMMENDATION_LIMIT=10;
export const RECOMMENDATION_FINAL_RUNS=2000;
export const RECOMMENDATION_STABILITY_WEIGHT=.25;

// 主副作用不同，按两层搜索枚举有序组合；同一条回忆不能同时占两个槽位。
export function recommendationMemories(memories,stage,characterId){
  return memories.filter(memory=>(!characterId||memory.characterId===characterId)&&contestPlanMatches(stage,memory.planType)&&memory.examBattleProduceCards?.length);
}
export function recommendationPairCount(memories){
  return memories.reduce((count,main)=>count+memories.filter(sub=>sub!==main&&sub.characterId===main.characterId&&(!main.key||sub.key!==main.key)).length,0);
}
export function* recommendationPairs(memories){
  for(let main=0;main<memories.length;main++){
    for(let sub=0;sub<memories.length;sub++){
      if(main===sub||memories[main].characterId!==memories[sub].characterId||memories[main].key&&memories[main].key===memories[sub].key)continue;
      yield {id:`${main}:${sub}`,main,sub};
    }
  }
}

export function recommendationStatistics(scores){
  if(!scores.length||scores.some(value=>!Number.isFinite(value)||value<0))throw new Error('invalid_recommendation_scores');
  let mean=0,m2=0;for(const [index,value] of scores.entries()){const delta=value-mean;mean+=delta/(index+1);m2+=delta*(value-mean);}
  const sorted=[...scores].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2),median=sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
  const variance=scores.length>1?Math.max(0,m2/(scores.length-1)):0,deviation=Math.sqrt(variance);
  // 上下行波动均以中位数为基准，除以全部样本数，以同一系数奖励上行、惩罚下行。
  const downside=Math.sqrt(scores.reduce((sum,value)=>sum+Math.min(0,value-median)**2,0)/scores.length),upside=Math.sqrt(scores.reduce((sum,value)=>sum+Math.max(0,value-median)**2,0)/scores.length);
  return {runs:scores.length,mean,median,variance,deviation,downside,upside,score:(mean+median)/2+RECOMMENDATION_STABILITY_WEIGHT*(upside-downside)};
}
export const compareRecommendations=(a,b)=>b.stats.score-a.stats.score||b.stats.median-a.stats.median||b.stats.mean-a.stats.mean||a.stats.deviation-b.stats.deviation||a.main-b.main||a.sub-b.sub;

// 初筛留出四分之一名额探索高波动候选；这是资源分配启发式，不是置信区间保证。
export function promoteRecommendations(rows,limit){
  if(rows.length<=limit)return [...rows].sort(compareRecommendations);
  const ranked=[...rows].sort(compareRecommendations),selected=ranked.slice(0,Math.ceil(limit*.75)),ids=new Set(selected.map(row=>row.id));
  const potential=row=>row.stats.score+2*row.stats.deviation/Math.sqrt(row.stats.runs);
  for(const row of [...rows].sort((a,b)=>potential(b)-potential(a)||compareRecommendations(a,b))){
    if(ids.has(row.id))continue;selected.push(row);ids.add(row.id);if(selected.length===limit)break;
  }
  return selected;
}
// 按成功完成粗筛的配置数计算保留量，小候选池不被提前压到最终名额以下。
export const recommendationRoughLimit=count=>Math.min(count,Math.max(40,Math.ceil(count/3)));
export function recommendationPhases(count){
  return [...(count>40?[{name:'rough',runs:4},{name:'screen',runs:16,limit:40}]:[]),
    ...(count>20?[{name:'review',runs:64,limit:20}]:[]),{name:'final',runs:500,limit:RECOMMENDATION_LIMIT}];
}

export const RECOMMENDATION_FINAL_BUDGETS=[500,RECOMMENDATION_FINAL_RUNS];
// 综合分包含中位数和波动惩罚，直接重采样整个指标，不能套用均值标准误。
// 此区间只用于分配计算预算，不宣称具有经过多轮选择校正的置信覆盖率。
export function recommendationUncertainty(scores,{seed=0x6d2b79f5,resamples=96}={}){
  let state=seed>>>0;const values=[];
  for(let round=0;round<resamples;round++){
    const sample=Array.from({length:scores.length},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return scores[Math.floor(state/4294967296*scores.length)];});
    values.push(recommendationStatistics(sample).score);
  }
  const spread=recommendationStatistics(values).deviation,score=recommendationStatistics(scores).score;
  return {lower:score-2*spread,upper:score+2*spread,error:spread};
}
// 额外预算只用于前三顺序或席位竞争，不为远离前三的候选细排名。
export function recommendationRefinements(rows,limit=3){
  const ranked=[...rows].sort(compareRecommendations),selected=new Set();
  for(let i=0;i<Math.min(limit,ranked.length);i++){
    const inside=ranked[i];
    for(let j=i+1;j<ranked.length;j++){
      const challenger=ranked[j];
      if(challenger.uncertainty.upper<inside.uncertainty.lower||inside.uncertainty.upper<challenger.uncertainty.lower)continue;
      selected.add(inside.id);selected.add(challenger.id);
    }
  }
  return ranked.filter(row=>selected.has(row.id)&&row.stats.runs<RECOMMENDATION_FINAL_RUNS);
}
