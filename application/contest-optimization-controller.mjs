import {contestComputeGate} from './contest-compute-gate.mjs';
import {buildContestOptimizationInput} from './contest-optimization-input.mjs';
import {startContestOptimization} from './contest-optimization-client.mjs';

export function createContestOptimizationController({initialState,onEvent=()=>{},start=startContestOptimization,gate=contestComputeGate}={}){
  let context,contextSignature=null,active=null,disposed=false;
  let report=initialState?.report??null,reportSignature=initialState?.reportSignature??'',reportContext=initialState?.reportContext??null;
  const current=task=>!disposed&&active===task;
  function invalidate(){const previous=active;active=null;try{previous?.handle?.cancel();}finally{previous?.ticket?.cancel();}return Boolean(previous);}
  const stop=()=>{if(invalidate()){onEvent({type:'stopped'});onEvent({type:'idle'});}};
  return {
    get running(){return active!==null;},
    get queued(){return active?.ticket?.waiting??false;},
    get report(){return report;},
    get reportSignature(){return reportSignature;},
    get reportContext(){return reportContext;},
    get contextSignature(){return contextSignature;},
    captureState:()=>({report,reportSignature,reportContext,contextSignature}),
    setContext(value){
      if(disposed)return false;
      const next=JSON.stringify([value.stage,value.manual,value.producerLevel,value.conversionRules,value.idolCards.map(card=>[card.idolCardId,card.levelLimitRank,card.potentialRank]),value.supportCards?.map(card=>[card.supportCardId,card.level])]);
      if(next===contextSignature)return false;
      if(invalidate())onEvent({type:'invalidated'});
      if(contextSignature!==null||initialState?.contextSignature!==next){report=null;reportSignature='';reportContext=null;}
      context=value;contextSignature=next;return true;
    },
    stop,
    dispose(){disposed=true;invalidate();},
    async run(state,{signature,multiCore,budget}){
      if(disposed||active)return;
      const task={handle:null,ticket:null};active=task;
      try{
        const runContext=structuredClone(context),runState=structuredClone(state),runBudget=structuredClone(budget);
        task.ticket=gate.acquire();onEvent({type:'preparing'});
        if(task.ticket.waiting){onEvent({type:'queued'});await task.ticket.ready;if(!current(task))return;}
        // 先让界面显示忙碌，再生成候选；等待期间取消或切换上下文不启动 Worker。
        await new Promise(resolve=>setTimeout(resolve,0));if(!current(task))return;
        const constraints={params:Object.fromEntries(Object.entries(runState.params).map(([key,value])=>[key,value===''?NaN:Number(value)])),roles:runState.roles.map(role=>({...role,grade:Number(role.grade)})),items:runState.items};
        const input=buildContestOptimizationInput(runContext,constraints),seed=runState.seed===''?crypto.getRandomValues(new Uint32Array(1))[0]:Number(runState.seed);
        const resultContext={stage:runContext.stage,manual:structuredClone(runContext.manual??{}),conversionRules:structuredClone(runContext.conversionRules)};
        task.handle=start({input,stage:runContext.stage,supportCards:runContext.supportCards,manual:runContext.manual,conversionRules:runContext.conversionRules},{seed,multiCore,budget:runBudget,onProgress:value=>{if(current(task))onEvent({type:'progress',value});}});
        onEvent({type:'started'});
        const result=await task.handle.promise;if(!current(task))return;
        report=result;reportSignature=signature;reportContext=resultContext;onEvent({type:'completed'});
      }catch(error){if(current(task))onEvent({type:error.name==='AbortError'?'stopped':'failed',error});}
      finally{task.ticket?.cancel();if(current(task)){active=null;onEvent({type:'idle'});}}
    },
  };
}
