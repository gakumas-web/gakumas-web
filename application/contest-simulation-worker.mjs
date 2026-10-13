import {suggestContestParameters,previewContestMultipliers,validateContestOptimizationOptions,runContestSimulation,sampleContestScores,sampleContestScoreBatch,createContestSimulationSession,runContestSimulationBatch,finishContestSimulationBatches} from '../domain/contest-engine-runner.mjs';

import {recommendationUncertainty} from '../domain/contest-recommendations.mjs';

const sessions=new Map();

// 工作者只接收本次编组的最小投影，不访问账号存储或网络接口。
self.onmessage=async({data})=>{
  try{
    const progress=completed=>self.postMessage({type:'progress',completed});
    if(data.mode==='multipliers'){const result=await previewContestMultipliers(data.request);self.postMessage({type:'result',result});return;}
    if(data.mode==='suggest-parameters'){const result=await suggestContestParameters(data.request);self.postMessage({type:'result',result});return;}
    if(data.mode==='optimization-validate'){const result=await validateContestOptimizationOptions(data.options,progress);self.postMessage({type:'result',result});return;}
    if(data.mode==='simulation-batch'||data.mode==='simulation-finish'){
      const result=data.mode==='simulation-batch'?await runContestSimulationBatch(data.request,{runs:data.runs,offset:data.offset,seed:data.seed,onProgress:progress}):await finishContestSimulationBatches(data.request,data.batches,{seed:data.seed});
      self.postMessage({type:'result',result});return;
    }
    if(data.mode?.startsWith('session-')){
      if(data.mode==='session-start')sessions.set(data.sessionId,await createContestSimulationSession(data.request,{seed:data.seed}));
      const session=sessions.get(data.sessionId);
      const result=data.mode==='session-finish'?await session.finish():await session.advance(data.runs,progress);
      if(data.mode==='session-finish')sessions.delete(data.sessionId);
      else result.uncertainty=recommendationUncertainty(result.scores);
      self.postMessage({type:'result',result});return;
    }
    const batch=['batch-scores','batch-card-effects'].includes(data.mode),run=batch?sampleContestScoreBatch:['scores','card-effects'].includes(data.mode)?sampleContestScores:runContestSimulation;
    const result=await run(data.request,{runs:data.runs,seed:data.seed,offset:data.offset,cardEffects:['card-effects','batch-card-effects'].includes(data.mode),onProgress:completed=>self.postMessage({type:'progress',completed})});self.postMessage({type:'result',result});
  }catch(error){sessions.delete(data.sessionId);self.postMessage({type:'error',code:error.code??'engine_failed',details:error.details??[]});}
};
