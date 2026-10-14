"""真实 Worker 验证追加样本连续性、预算上限、多核一致性及加测取消。"""


RUN='''async options=>{
 const {startContestOptimization}=await import('./application/contest-optimization-client.mjs');
 const {sampleContestScoreBatch}=await import('./domain/contest-engine-runner.mjs');
 const budget={population:12,generations:8,samples:8,screenRuns:16,refineRuns:32,polishParents:2,polishNeighbors:8,polishRounds:1,polishRuns:16,reviewCandidates:6,reviewRuns:32,finalCandidates:3,finalRuns:100,totalRunLimit:1500};
 const first=await startContestOptimization(options,{seed:991,budget,multiCore:false}).promise;
 const batches=window.samplingBatches.filter(row=>row.mode==='batch-scores'),continued=batches.find(row=>row.offset>0);
 if(!continued)throw Error('no incremental samples');
 const same=batches.filter(row=>row.seed===continued.seed&&row.key===continued.key).sort((a,b)=>a.offset-b.offset);let count=0;
 for(const row of same){if(row.offset!==count)throw Error('overlapping or missing samples');count+=row.runs;}
 const full=await sampleContestScoreBatch(continued.request,{seed:continued.seed,offset:0,runs:count});
 if(JSON.stringify(full.scores)!==JSON.stringify(same.flatMap(row=>row.scores)))throw Error('sample order changed');
 if(first.totalRuns>budget.totalRunLimit)throw Error('budget exceeded');
 const second=await startContestOptimization(options,{seed:991,budget,multiCore:true,diagnosticDetails:true}).promise;
 if(JSON.stringify(first.rows.map(row=>[row.key,row.result.scores]))!==JSON.stringify(second.rows.map(row=>[row.key,row.result.scores])))throw Error('multicore changed result');
 if(first.diagnostics.details||first.totalRuns!==second.totalRuns)throw Error('diagnostics changed default output or budget');
 const details=second.diagnostics.details;
 if(details.totalRunLimit!==1500||details.reviewBudget!==192||details.allocationOrder!=='score_descending')throw Error('budget layers missing');
 for(const phase of ['review','refine']){
   const scheduled=details.allocations.filter(row=>row.phase===phase&&row.decision==='scheduled').reduce((sum,row)=>sum+row.needed,0);
   if(scheduled!==second.diagnostics.phaseRuns[phase])throw Error('allocation does not match actual runs');
 }
 if(!details.candidates.some(row=>row.refinementDecision==='budget_skipped'&&row.blockedBy.includes('review_budget')))throw Error('missing skipped contender');
 if(details.candidates.filter(row=>row.selected).length!==second.rows.length)throw Error('final qualification mismatch');
 if(JSON.stringify(details.final.finalists.map(row=>[row.key,row.score,row.runs]))!==JSON.stringify(second.rows.map(row=>[row.key,row.stats.score,row.result.runs])))throw Error('final diagnostic mismatch');
 if(!details.contestsBefore.some(row=>row.limit===budget.finalCandidates))throw Error('missing seat competition');
 let handle,stopped=false;handle=startContestOptimization(options,{seed:993,budget,multiCore:true,onProgress:p=>{if(p.phase==='refine'){stopped=true;handle.cancel();}}});
 try{await handle.promise;throw Error('cancellation ignored');}catch(error){if(error.name!=='AbortError')throw error;}
 if(!stopped||window.samplingWorkers!==0)throw Error('worker leak');
 return {runs:first.totalRuns,batches:same.length,continuedSamples:count,diagnostics:first.diagnostics,trace:{candidates:details.candidates.length,budgetSkipped:details.candidates.filter(row=>row.refinementDecision==='budget_skipped').length,neutral:true}};
}'''
def check(page,options):
 page.evaluate("""()=>{window.samplingBatches=[];window.samplingWorkers=0;const Original=Worker;window.Worker=class extends Original{constructor(...args){super(...args);window.samplingWorkers++;this.addEventListener('message',({data})=>{if(data.type==='result'&&this.last?.mode==='batch-scores')samplingBatches.push({...this.last,scores:data.result.scores});});}postMessage(value,...args){this.last={...value,key:JSON.stringify(value.request?.cards.map(card=>card.reference))};super.postMessage(value,...args);}terminate(){if(!this.ended){this.ended=true;window.samplingWorkers--;}super.terminate();}}}""")
 result=page.evaluate(RUN,options);print(result,flush=True)
