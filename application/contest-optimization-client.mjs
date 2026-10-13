import {simulationWorkerCount} from './contest-compute-preferences.mjs';
import {createContestSimulationRequest} from '../domain/contest-engine-request.mjs';
import {createOptimizationProblem,optimizationPopulation,optimizationRandom} from '../domain/contest-optimization.mjs';
import {recommendationStatistics} from '../domain/contest-recommendations.mjs';
import {supportedOptimizationInput} from './contest-optimization-input.mjs';

export const OPTIMIZATION_BUDGETS={
  standard:{population:48,generations:28,samples:24,polishParents:3,polishNeighbors:48,polishRounds:2,polishRuns:32,reviewCandidates:32,reviewRuns:128,finalCandidates:5,finalRuns:500},
  deep:{population:80,generations:56,samples:32,polishParents:5,polishNeighbors:64,polishRounds:3,polishRuns:48,reviewCandidates:48,reviewRuns:256,finalCandidates:10,finalRuns:1000},
};
const rank=(a,b)=>b.stats.score-a.stats.score||b.stats.median-a.stats.median||a.key.localeCompare(b.key);
function workerClient(){
  const worker=new Worker(new URL('./contest-simulation-worker.mjs',import.meta.url),{type:'module'});let pending,timer;
  const settle=(error,result)=>{const current=pending;pending=null;clearTimeout(timer);if(current)error?current.reject(error):current.resolve(result);};
  worker.onmessage=({data})=>{if(data.type==='progress')pending?.onProgress(data.completed);else if(data.type==='result')settle(null,data.result);else settle(Object.assign(new Error(data.code),{code:data.code,details:data.details}));};
  worker.onerror=event=>{event.preventDefault();settle(Object.assign(new Error('engine_failed'),{code:'engine_failed'}));};
  return {run(data,onProgress=()=>{}){return new Promise((resolve,reject)=>{pending={resolve,reject,onProgress};timer=setTimeout(()=>{settle(Object.assign(new Error('simulation_timeout'),{code:'simulation_timeout'}));worker.terminate();},Math.max(120000,(data.runs??0)*60));worker.postMessage(data);});},cancel(){settle(new DOMException('Optimization cancelled','AbortError'));worker.terminate();}};
}

// 页面与发布审计共用相同的选项投影和正式 Worker 校验协议。
export function startContestCompatibilityAudit(options){
  const worker=workerClient();return {promise:worker.run({mode:'optimization-validate',options}).finally(()=>worker.cancel()),cancel:()=>worker.cancel()};
}

// 每次评分仍走正式舞台引擎；搜索、复评与最终结果分别使用独立样本种子。
export function startContestOptimization({input,stage,supportCards,manual={},conversionRules={}},{seed=crypto.getRandomValues(new Uint32Array(1))[0],multiCore=false,budget=OPTIMIZATION_BUDGETS.deep,onProgress=()=>{}}={}){
  let cancelled=false,totalRuns=0,evaluated=0,lastProgress=0;const workers=[];
  const assertActive=()=>{if(cancelled)throw new DOMException('Optimization cancelled','AbortError');};
  const progress=(value,force=false)=>{const now=performance.now();if(force||now-lastProgress>=80){lastProgress=now;onProgress({...value,totalRuns,evaluated});}};
  const promise=(async()=>{
    for(let index=0;index<Math.min(simulationWorkerCount(multiCore),budget.population);index++)workers.push(workerClient());
    progress({phase:'validate',completed:0,total:input.probes.length},true);
    let validated=0;const supported=new Set(),unsupported=[];
    await Promise.all(workers.map(async(worker,index)=>{
      const options=input.probes.filter((_,position)=>position%workers.length===index);let previous=0;
      if(!options.length)return;
      const result=await worker.run({mode:'optimization-validate',options},completed=>{validated+=completed-previous;previous=completed;progress({phase:'validate',completed:validated,total:input.probes.length});});assertActive();
      for(const key of result.supported)supported.add(key);unsupported.push(...result.unsupported);
    }));
    const fixedIssues=unsupported.filter(row=>(input.fixedProbes??[]).includes(row.key));
    if(fixedIssues.length)throw Object.assign(new Error('optimization_unsupported_fixed'),{code:'optimization_unsupported_fixed',details:fixedIssues.flatMap(row=>row.details)});
    const problem=createOptimizationProblem(supportedOptimizationInput(input,supported));
    if(!problem.possible)throw Object.assign(new Error('optimization_no_feasible_deck'),{code:'optimization_no_feasible_deck',details:unsupported.flatMap(value=>value.details)});
    const skipped=[],request=genome=>createContestSimulationRequest(problem.materialize(genome),stage,supportCards,manual,conversionRules);
    async function evaluate(genomes,{phase,runs,roundSeed,generation=0,generations=0,cache=new Map()}){
      const pending=[...new Map(genomes.filter(genome=>!cache.has(problem.key(genome))).map(genome=>[problem.key(genome),genome])).values()];let next=0,completed=0,best=[...cache.values()].filter(Boolean).sort(rank)[0]?.stats.score;
      const notify=force=>progress({phase,generation,generations,completed,total:pending.length,best},force);
      notify(true);
      await Promise.all(workers.map(async worker=>{
        while(next<pending.length){
          assertActive();const genome=pending[next++],key=problem.key(genome),value=request(genome);let previous=0;
          try{
            const result=await worker.run({mode:'batch-scores',request:value,runs,offset:0,seed:roundSeed},count=>{totalRuns+=count-previous;previous=count;notify(false);});assertActive();
            const stats=recommendationStatistics(result.scores);cache.set(key,{key,genome,stats});best=best===undefined?stats.score:Math.max(best,stats.score);
          }catch(error){
            if(error.code!=='unsupported_entities'||error.details?.some(detail=>detail.kind==='item'))throw error;
            skipped.push({key,details:error.details});cache.set(key,null);
          }
          evaluated++;completed++;notify(true);
        }
      }));
      return genomes.map(genome=>cache.get(problem.key(genome))).filter(Boolean).sort(rank);
    }
    async function evolve({phase,size,generations,runs,roundSeed}){
      const random=optimizationRandom(roundSeed),cache=new Map();let ranked=[],population=optimizationPopulation(problem,{size,random});
      for(let generation=1;generation<=generations&&population.length;generation++){
        assertActive();ranked=await evaluate(population,{phase,runs,roundSeed,generation,generations,cache});
        if(!ranked.length)break;
        if(generation<generations)population=optimizationPopulation(problem,{size,random,ranked});
      }
      return [...cache.values()].filter(Boolean).sort(rank);
    }
    const explored=await evolve({phase:'search',size:budget.population,generations:budget.generations,runs:budget.samples,roundSeed:(seed^0x85ebca6b)>>>0});assertActive();
    if(!explored.length)throw Object.assign(new Error('optimization_no_feasible_deck'),{code:'optimization_no_feasible_deck',details:skipped.flatMap(value=>value.details)});
    let polished=[];
    if(budget.polishRounds){
      const random=optimizationRandom((seed^0x165667b1)>>>0),cache=new Map();
      const diverse=rows=>{
        const chosen=[],seen=new Set();for(const row of rows){const key=row.genome.map(index=>problem.variants[index].reference.id).join(',');if(seen.has(key))continue;seen.add(key);chosen.push(row);if(chosen.length>=budget.polishParents)break;}return chosen;
      };
      let parents=diverse(explored);
      for(let round=1;round<=budget.polishRounds;round++){
        assertActive();const excluded=new Set(cache.keys()),genomes=parents.map(row=>row.genome);
        for(const parent of parents)for(const genome of problem.neighbors(parent.genome,random,budget.polishNeighbors,excluded)){genomes.push(genome);excluded.add(problem.key(genome));}
        await evaluate(genomes,{phase:'polish',runs:budget.polishRuns,roundSeed:(seed^0xd3a2646c)>>>0,generation:round,generations:budget.polishRounds,cache});
        polished=[...cache.values()].filter(Boolean).sort(rank);parents=diverse(polished);
      }
    }
    // 保留原探索前列，也给独立样本下更可靠的局部改进结果留出复筛名额。
    const reviewPool=new Map(),searchQuota=polished.length?Math.ceil(budget.reviewCandidates/4):budget.reviewCandidates;
    for(const row of explored.slice(0,searchQuota))reviewPool.set(row.key,row);
    for(const row of [...polished,...explored]){if(reviewPool.size>=budget.reviewCandidates)break;reviewPool.set(row.key,row);}
    const review=await evaluate([...reviewPool.values()].map(row=>row.genome),{phase:'review',runs:budget.reviewRuns,roundSeed:(seed^0xc2b2ae35)>>>0});
    const finalists=review.slice(0,budget.finalCandidates),rows=[];let next=0,completed=0;
    progress({phase:'final',completed,total:finalists.length},true);
    await Promise.all(workers.map(async worker=>{
      while(next<finalists.length){
        assertActive();const candidate=finalists[next++],value=request(candidate.genome),sessionId=`optimization:${candidate.key}`;let previous=0;
        await worker.run({mode:'session-start',request:value,sessionId,runs:budget.finalRuns,seed:(seed^0x27d4eb2f)>>>0},count=>{totalRuns+=count-previous;previous=count;progress({phase:'final',completed,total:finalists.length});});assertActive();
        const result=await worker.run({mode:'session-finish',sessionId,runs:0});assertActive();totalRuns+=result.detailRuns;
        rows.push({...candidate,stats:recommendationStatistics(result.scores),result,memories:problem.materialize(candidate.genome)});completed++;progress({phase:'final',completed,total:finalists.length},true);
      }
    }));
    return {rows:rows.sort(rank),seed,totalRuns,evaluated,explored:new Set([...explored,...polished].map(row=>row.key)).size,unsupported,skipped,missingCosts:input.missingCosts,settings:budget};
  })().finally(()=>{for(const worker of workers)worker.cancel();});
  return {promise,cancel(){cancelled=true;for(const worker of workers)worker.cancel();}};
}
