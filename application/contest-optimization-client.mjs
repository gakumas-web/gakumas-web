import {createContestWorkerClient} from './contest-worker-client.mjs';
import {optimizationConfigurationKey,optimizationFinalDiagnostics} from '../domain/contest-optimization-diagnostics.mjs';
import {compareOptimizationRows,optimizationCompetition,optimizationStructureKey,diverseOptimizationRows,optimizationRefinements} from '../domain/contest-optimization-selection.mjs';
import {simulationWorkerCount} from './contest-compute-preferences.mjs';
import {createContestSimulationRequest} from '../domain/contest-engine-request.mjs';
import {createOptimizationProblem,optimizationPopulation,optimizationRandom} from '../domain/contest-optimization.mjs';
import {recommendationStatistics} from '../domain/contest-recommendations.mjs';
import {supportedOptimizationInput} from './contest-optimization-input.mjs';
import {OPTIMIZATION_RUN_LIMIT,validateOptimizationBudget} from '../domain/contest-optimization-budget.mjs';

export const OPTIMIZATION_BUDGETS={
  standard:{population:80,generations:28,samples:24,screenRuns:64,polishParents:3,polishNeighbors:48,polishRounds:2,polishRuns:32,reviewCandidates:32,reviewRuns:128,finalCandidates:20,finalRuns:500,totalRunLimit:OPTIMIZATION_RUN_LIMIT},
  deep:{population:80,generations:56,samples:32,screenRuns:128,polishParents:5,polishNeighbors:64,polishRounds:3,polishRuns:48,reviewCandidates:48,reviewRuns:256,finalCandidates:20,finalRuns:500,totalRunLimit:OPTIMIZATION_RUN_LIMIT},
};
const rank=compareOptimizationRows;
const workerClient=()=>createContestWorkerClient({cancelMessage:'Optimization cancelled'});

// 页面与发布审计共用相同的选项投影和正式 Worker 校验协议。
export function startContestCompatibilityAudit(options){
  const worker=workerClient();return {promise:worker.run({mode:'optimization-validate',options}).finally(()=>worker.cancel()),cancel:()=>worker.cancel()};
}

// 每次评分仍走正式舞台引擎；搜索、复评与最终结果分别使用独立样本种子。
export function startContestOptimization({input,stage,supportCards,manual={},conversionRules={}},{seed=crypto.getRandomValues(new Uint32Array(1))[0],multiCore=false,budget=OPTIMIZATION_BUDGETS.deep,diagnosticDetails=false,onProgress=()=>{}}={}){
  let cancelled=false,totalRuns=0,evaluated=0,lastProgress=0,budgetLimited=false;const workers=[];
  const assertActive=()=>{if(cancelled)throw new DOMException('Optimization cancelled','AbortError');};
  const progress=(value,force=false)=>{const now=performance.now();if(force||now-lastProgress>=80){lastProgress=now;onProgress({...value,totalRuns,evaluated});}};
  const promise=(async()=>{
    const checked=validateOptimizationBudget(budget);budget=checked.budget;
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
    const details=diagnosticDetails?{allocationOrder:'score_descending',reviewBudget:budget.reviewCandidates*budget.reviewRuns,totalRunLimit:budget.totalRunLimit??null,allocations:[],candidates:[]}:null;
    const exploredKeys=new Set(),phaseRuns={},choose=(rows,limit)=>diverseOptimizationRows(rows,limit,{fraction:budget.diversityFraction??.25});
    const skipped=[],request=genome=>createContestSimulationRequest(problem.materialize(genome),stage,supportCards,manual,conversionRules);
    async function evaluate(genomes,{phase,runs,roundSeed,generation=0,generations=0,cache=new Map(),runLimit=Infinity}){
      const stageLimit=runLimit,finalReserve=budget.finalCandidates*(budget.finalRuns+3),reviewReserve=['review','refine'].includes(phase)?0:budget.reviewCandidates*budget.reviewRuns;
      const totalAvailable=(budget.totalRunLimit??Infinity)-totalRuns-finalReserve-reviewReserve;
      runLimit=Math.min(runLimit,totalAvailable);
      let reserved=0;const pending=[...new Map(genomes.map(genome=>[problem.key(genome),genome])).values()].filter(genome=>{
        const key=problem.key(genome),old=cache.get(key),offset=old?.scores.length??0,needed=runs-offset;
        const record=(decision,blockedBy=[])=>{if(details&&['review','refine'].includes(phase))details.allocations.push({phase,key,offset,targetRuns:runs,needed,decision,blockedBy,remaining:Math.max(0,runLimit-reserved)});};
        if(old===null){record('unsupported');return false;}
        if(needed<=0){record('at_target');return false;}
        if(reserved+needed>runLimit){if(reserved+needed>totalAvailable)budgetLimited=true;record('budget_skipped',[...(reserved+needed>stageLimit?['review_budget']:[]),...(reserved+needed>totalAvailable?['total_limit']:[])]);return false;}
        record('scheduled');reserved+=needed;return true;
      });let next=0,completed=0,best=[...cache.values()].filter(Boolean).sort(rank)[0]?.stats.score;
      const notify=force=>progress({phase,generation,generations,completed,total:pending.length,best},force);
      notify(true);
      await Promise.all(workers.map(async worker=>{
        while(next<pending.length){
          assertActive();const genome=pending[next++],key=problem.key(genome),value=request(genome);let previous=0;
          try{
            const previousRow=cache.get(key),offset=previousRow?.scores.length??0;
            if(previousRow&&previousRow.seed!==roundSeed)throw new Error('optimization_sample_seed_mismatch');
            const result=await worker.run({mode:'batch-scores',request:value,runs:runs-offset,offset,seed:roundSeed},count=>{totalRuns+=count-previous;phaseRuns[phase]=(phaseRuns[phase]??0)+count-previous;previous=count;notify(false);});assertActive();
            const scores=[...(previousRow?.scores??[]),...result.scores],stats=recommendationStatistics(scores);cache.set(key,{key,genome,stats,scores,seed:roundSeed,structure:optimizationStructureKey(genome,problem.variants)});exploredKeys.add(key);best=best===undefined?stats.score:Math.max(best,stats.score);
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
        if(budgetLimited)break;
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
        const chosen=[],seen=new Set();for(const row of rows){const key=row.structure;if(seen.has(key))continue;seen.add(key);chosen.push(row);if(chosen.length>=budget.polishParents)break;}return chosen;
      };
      let parents=diverse(explored);
      for(let round=1;round<=budget.polishRounds;round++){
        assertActive();const excluded=new Set(cache.keys()),genomes=parents.map(row=>row.genome);
        for(const parent of parents)for(const genome of problem.neighbors(parent.genome,random,budget.polishNeighbors,excluded)){genomes.push(genome);excluded.add(problem.key(genome));}
        await evaluate(genomes,{phase:'polish',runs:budget.polishRuns,roundSeed:(seed^0xd3a2646c)>>>0,generation:round,generations:budget.polishRounds,cache});
        polished=[...cache.values()].filter(Boolean).sort(rank);parents=diverse(polished);
        if(budgetLimited)break;
      }
    }
    // 保留原探索前列，也给独立样本下更可靠的局部改进结果留出复筛名额。
    const reviewPool=new Map(),searchQuota=polished.length?Math.ceil(budget.reviewCandidates/4):budget.reviewCandidates;
    for(const row of choose(explored,searchQuota))reviewPool.set(row.key,row);
    for(const row of [...choose(polished,budget.reviewCandidates-searchQuota),...polished,...explored]){if(reviewPool.size>=budget.reviewCandidates)break;reviewPool.set(row.key,row);}
    const reviewBudget=budget.reviewCandidates*budget.reviewRuns,reviewSeed=(seed^0xc2b2ae35)>>>0,reviewCache=new Map(),reviewStart=totalRuns;
    if(budget.screenRuns){
      // 复筛预算保持不变；原入围池之外，给搜索与局部改进各留少量探索名额。
      const extra=Math.floor(budget.reviewCandidates/4),maximum=reviewPool.size+extra;
      for(const group of [explored,polished]){
        const candidates=choose(group.filter(row=>!reviewPool.has(row.key)),Math.ceil(extra/2));
        for(const row of candidates){if(reviewPool.size>=maximum)break;reviewPool.set(row.key,row);}
      }
    }
    let review=await evaluate([...reviewPool.values()].map(row=>row.genome),{phase:'review',runs:budget.screenRuns??budget.reviewRuns,roundSeed:reviewSeed,cache:reviewCache,runLimit:reviewBudget});
    const beforeReview=details?new Map(review.map((row,index)=>[row.key,{rank:index+1,score:row.stats.score,runs:row.scores.length}])):null;
    let competitionBefore;
    if(budget.screenRuns){
      await new Promise(resolve=>setTimeout(resolve,0));assertActive();
      const uncertain=optimizationRefinements(review,[1,budget.finalCandidates],budget.reviewRuns,details?value=>{competitionBefore=value;}:undefined);
      await evaluate(uncertain.map(row=>row.genome),{phase:'refine',runs:budget.reviewRuns,roundSeed:reviewSeed,cache:reviewCache,runLimit:reviewBudget-(totalRuns-reviewStart)});
      review=[...reviewCache.values()].filter(Boolean).sort(rank);
    }
    if(details){
      const after=optimizationCompetition(review,[1,budget.finalCandidates]);
      const reasons=key=>[...new Set((competitionBefore?.contests??[]).filter(value=>value.inside===key||value.challenger===key).map(value=>value.limit===1?'championship':'final_seat'))];
      details.contestsBefore=competitionBefore?.contests??[];details.contestsAfter=after.contests;
      const afterRanks=new Map(review.map((row,index)=>[row.key,index+1])),beforeIntervals=new Map((competitionBefore?.ranked??[]).map((row,index)=>[row.key,competitionBefore.intervals[index]])),afterIntervals=new Map(after.ranked.map((row,index)=>[row.key,after.intervals[index]]));
      details.candidates=[...reviewPool.values()].map(candidate=>{
        const row=reviewCache.get(candidate.key),before=beforeReview.get(candidate.key),allocations=details.allocations.filter(value=>value.key===candidate.key),base=allocations.find(value=>value.phase==='review'),refinement=allocations.find(value=>value.phase==='refine');
        return {key:candidate.key,configurationKey:optimizationConfigurationKey(problem.materialize(candidate.genome)),structureKey:candidate.structure,
          status:row===null?'unsupported':row?'measured':'not_measured',uncertaintyBefore:beforeIntervals.get(candidate.key)??null,uncertaintyAfter:afterIntervals.get(candidate.key)??null,
          before:before??null,after:row?{rank:afterRanks.get(row.key),score:row.stats.score,runs:row.scores.length}:null,reasons:reasons(candidate.key),
          baseDecision:base?.decision??null,refinementDecision:refinement?.decision??'not_eligible',blockedBy:refinement?.blockedBy??base?.blockedBy??[],
          unresolvedCompetition:after.contests.some(value=>value.inside===candidate.key||value.challenger===candidate.key),selected:afterRanks.has(candidate.key)&&afterRanks.get(candidate.key)<=budget.finalCandidates};
      });
      details.reviewRunsUsed=totalRuns-reviewStart;
    }
    const finalists=review.slice(0,budget.finalCandidates),rows=[];let next=0,completed=0;
    progress({phase:'final',completed,total:finalists.length},true);
    await Promise.all(workers.map(async worker=>{
      while(next<finalists.length){
        assertActive();const candidate=finalists[next++],value=request(candidate.genome),sessionId=`optimization:${candidate.key}`;let previous=0;
        await worker.run({mode:'session-start',request:value,sessionId,runs:budget.finalRuns,seed:(seed^0x27d4eb2f)>>>0},count=>{totalRuns+=count-previous;phaseRuns.final=(phaseRuns.final??0)+count-previous;previous=count;progress({phase:'final',completed,total:finalists.length});});assertActive();
        const result=await worker.run({mode:'session-finish',sessionId,runs:0});assertActive();totalRuns+=result.detailRuns;phaseRuns.details=(phaseRuns.details??0)+result.detailRuns;
        rows.push({key:candidate.key,genome:candidate.genome,structure:candidate.structure,stats:recommendationStatistics(result.scores),result,memories:problem.materialize(candidate.genome)});completed++;progress({phase:'final',completed,total:finalists.length},true);
      }
    }));
    rows.sort(rank);if(details)details.final=optimizationFinalDiagnostics(rows);
    return {diagnostics:{...problem.diagnostics,phaseRuns,budgetLimited,budgetEstimate:checked.estimate,...(details?{details}:{}),reviewStructures:new Set([...reviewPool.values()].map(row=>row.structure)).size},rows,seed,totalRuns,evaluated,explored:exploredKeys.size,unsupported,skipped,missingCosts:input.missingCosts,settings:budget};
  })().finally(()=>{for(const worker of workers)worker.cancel();});
  return {promise,cancel(){cancelled=true;for(const worker of workers)worker.cancel();}};
}
