import {startContestSimulation} from './contest-simulation-client.mjs';
import {createSimulationRecord,rememberSimulation} from './contest-simulation-history.mjs';

// 控制器随账号工作区存活；视图切换不会改变正在运行的输入与历史归属。
export function createContestSimulationController({profile,lifecycleId,onEvent=()=>{},start=startContestSimulation,remember=rememberSimulation}){
  let active=null,disposed=false,entry=null,signature='';
  const current=task=>!disposed&&active===task;
  const stop=()=>active?.handle?.cancel();
  return {
    get running(){return active!==null;},
    get entry(){return entry;},
    get signature(){return signature;},
    restore(value,resultSignature){
      if(disposed||active)return false;
      entry=value;signature=resultSignature;return true;
    },
    stop,
    dispose(){disposed=true;stop();active=null;},
    async run(input,{runs,multiCore,signature:inputSignature}){
      if(disposed||active)return;
      const task={handle:null};active=task;
      onEvent({type:'started',runs});
      try{
        task.handle=start(input.request,{runs,multiCore,onProgress:count=>{if(current(task))onEvent({type:'progress',count,runs});}});
        const result=await task.handle.promise;if(!current(task))return;
        entry=createSimulationRecord(input.request,input.stage,result,{characterId:input.characterId,loadout:input.loadout});signature=inputSignature;
        onEvent({type:'completed',entry});
        try{
          const saved=await remember(profile,entry,lifecycleId);
          if(current(task))await onEvent({type:'saved',saved,entry});
        }catch(error){if(current(task))onEvent({type:'save-failed',error});}
      }catch(error){if(current(task))onEvent({type:error.name==='AbortError'?'stopped':'failed',error});}
      finally{if(current(task)){active=null;onEvent({type:'idle'});}}
    },
  };
}
