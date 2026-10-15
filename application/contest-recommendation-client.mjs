import {createContestWorkerClient} from './contest-worker-client.mjs';
import {simulationWorkerCount} from './contest-compute-preferences.mjs';
import {recommendationPairs,recommendationPairCount,recommendationPhases,recommendationRoughLimit,recommendationStatistics,promoteRecommendations,compareRecommendations,recommendationRefinements,RECOMMENDATION_FINAL_BUDGETS,RECOMMENDATION_LIMIT} from '../domain/contest-recommendations.mjs';
import {createContestSimulationRequest} from '../domain/contest-engine-request.mjs';

function simulationWorker(){
  const client=createContestWorkerClient({cancelMessage:'Recommendation cancelled'});
  return {run(request,{onProgress,offset=0,...options}){return client.run({request,...options,offset},onProgress);},cancel:client.cancel};
}

// 每个 Worker 串行处理组合，随机状态互不共享；同一轮使用相同种子，减少额外抽样差异。
export function startContestRecommendations({memories,stage,supportCards,manual={},conversionRules={}},{seed=crypto.getRandomValues(new Uint32Array(1))[0],onProgress=()=>{},multiCore=false}={}){
  let cancelled=false;const workers=[];
  const assertActive=()=>{if(cancelled)throw new DOMException('Recommendation cancelled','AbortError');};
  const promise=(async()=>{
    const pairCount=recommendationPairCount(memories);let combinations=0,rows=[],totalRuns=0;
    for(const pair of recommendationPairs(memories)){
      assertActive();combinations++;rows.push(pair);
      if(combinations%100===0){onProgress({phase:'prepare',completed:combinations,total:pairCount});await new Promise(resolve=>setTimeout(resolve,0));}
    }
    assertActive();const phases=recommendationPhases(combinations),skipped=[];
    if(!rows.length)return {rows:[],combinations,skipped,totalRuns,seed,screened:false};
    for(let index=0;index<Math.min(simulationWorkerCount(multiCore),combinations);index++)workers.push(simulationWorker());
    let keepFinal=[];const earlySamples=new Map();
    for(const phase of phases){
      if(!rows.length)break;assertActive();
      // 最终轮保留原来的独立种子分配，不因增加粗筛阶段而偏移。
      const roundSeed=(seed^(phase.name==='final'?(combinations>40?0xc2b2ae35:combinations>20?0x85ebca6b:0x9e3779b9):0x9e3779b9))>>>0;
      if(phase.name==='final'){
        earlySamples.clear();
        const owners=new Map(rows.map((row,index)=>[row.id,index%workers.length])),finalRows=new Map();let pending=rows;
        for(const budget of RECOMMENDATION_FINAL_BUDGETS){
          if(!pending.length)break;
          let completed=0,phaseRuns=0;
          const plannedRuns=pending.reduce((sum,row)=>sum+budget-(finalRows.get(row.id)?.stats.runs??0),0);
          const notify=()=>onProgress({phase:'final',budget,completed,total:pending.length,runs:phaseRuns,plannedRuns,skipped:skipped.length,combinations});notify();
          await Promise.all(workers.map(async(worker,index)=>{
            for(const candidate of pending.filter(row=>owners.get(row.id)===index)){
              assertActive();const existing=finalRows.get(candidate.id);let previous=0;
              try{
                const request=existing?undefined:createContestSimulationRequest([memories[candidate.main],memories[candidate.sub]],stage,supportCards,manual,conversionRules);
                const result=await worker.run(request,{runs:budget,seed:roundSeed,sessionId:candidate.id,mode:existing?'session-advance':'session-start',onProgress:count=>{const delta=count-previous;previous=count;phaseRuns+=delta;totalRuns+=delta;notify();}});assertActive();
                finalRows.set(candidate.id,{...candidate,stats:recommendationStatistics(result.scores),uncertainty:result.uncertainty});
              }catch(error){
                if(!['unsupported_entities','invalid_loadout'].includes(error.code))throw error;
                skipped.push({id:candidate.id,code:error.code,details:error.details??[]});
              }
              completed++;notify();
            }
          }));
          pending=recommendationRefinements([...finalRows.values()]);
        }
        keepFinal=[...finalRows.values()].sort(compareRecommendations).slice(0,RECOMMENDATION_LIMIT);
        await Promise.all(workers.map(async(worker,index)=>{
          for(const row of keepFinal.filter(row=>owners.get(row.id)===index)){
            assertActive();row.result=await worker.run(undefined,{sessionId:row.id,mode:'session-finish',runs:0});assertActive();totalRuns+=row.result.detailRuns;
          }
        }));
        rows=keepFinal;continue;
      }
      const candidates=rows,completedRuns=new Map(),results=[];let next=0,completed=0,phaseRuns=0;
      const plannedRuns=candidates.reduce((sum,row)=>sum+phase.runs-(earlySamples.get(row.id)?.scores.length??0),0);
      const notify=()=>onProgress({phase:phase.name,budget:phase.runs,completed,total:candidates.length,runs:phaseRuns,plannedRuns,skipped:skipped.length,combinations});notify();
      await Promise.all(workers.map(async worker=>{
        while(next<candidates.length){
          assertActive();const candidate=candidates[next++],request=createContestSimulationRequest([memories[candidate.main],memories[candidate.sub]],stage,supportCards,manual,conversionRules),previous=earlySamples.get(candidate.id)??{scores:[],cardEffectScores:[]},offset=previous.scores.length;
          try{
            const result=await worker.run(request,{runs:phase.runs-offset,offset,seed:roundSeed,mode:phase.name==='review'?'batch-scores':'batch-card-effects',onProgress:count=>{
              const delta=count-(completedRuns.get(candidate.id)??0);phaseRuns+=delta;totalRuns+=delta;completedRuns.set(candidate.id,count);notify();
            }});assertActive();
            const sample={scores:[...previous.scores,...result.scores],cardEffectScores:[...previous.cardEffectScores,...(result.cardEffectScores??[])]};earlySamples.set(candidate.id,sample);
            results.push({...candidate,stats:recommendationStatistics(phase.name==='review'?sample.scores:sample.cardEffectScores)});
          }catch(error){
            if(!['unsupported_entities','invalid_loadout'].includes(error.code))throw error;
            skipped.push({id:candidate.id,code:error.code,details:error.details??[]});
          }
          completed++;notify();
        }
      }));
      rows=promoteRecommendations(results,phase.name==='rough'?recommendationRoughLimit(results.length):phase.limit);
      const retained=new Set(rows.map(row=>row.id));for(const id of earlySamples.keys())if(!retained.has(id))earlySamples.delete(id);

    }
    return {rows:keepFinal,combinations,skipped,totalRuns,seed,screened:phases.length>1};
  })().finally(()=>{for(const worker of workers)worker.cancel();});
  return {promise,cancel(){cancelled=true;for(const worker of workers)worker.cancel();}};
}
