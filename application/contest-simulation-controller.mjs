import {contestComputeGate} from './contest-compute-gate.mjs';
import {startContestSimulation} from './contest-simulation-client.mjs';
import {createSimulationRecord,rememberSimulation} from './contest-simulation-history.mjs';

// 控制器随账号工作区存活；视图切换不会改变正在运行的输入与历史归属。
export function createContestSimulationController({profile,lifecycleId,onEvent=()=>{},start=startContestSimulation,remember=rememberSimulation,gate=contestComputeGate}){
  let active=null,disposed=false,entry=null,signature='';
  const current=task=>!disposed&&active===task;
  function invalidate(){const previous=active;active=null;try{previous?.handle?.cancel();}finally{previous?.ticket?.cancel();}return Boolean(previous);}
  const stop=()=>{if(invalidate()){onEvent({type:'stopped'});onEvent({type:'idle'});}};
  return {
    get running(){return active!==null;},
    get queued(){return active?.ticket?.waiting??false;},
    get entry(){return entry;},
    get signature(){return signature;},
    restore(value,resultSignature){
      if(disposed||active)return false;
      entry=value;signature=resultSignature;return true;
    },
    stop,
    dispose(){disposed=true;invalidate();},
    async run(input,{runs,multiCore,signature:inputSignature}){
      if(disposed||active)return;
      const task={handle:null,ticket:null};active=task;
      try{
        const runInput=structuredClone(input);task.ticket=gate.acquire();
        if(task.ticket.waiting){onEvent({type:'queued',runs});await task.ticket.ready;if(!current(task))return;}
        onEvent({type:'started',runs});
        task.handle=start(runInput.request,{runs,multiCore,onProgress:count=>{if(current(task))onEvent({type:'progress',count,runs});}});
        const result=await task.handle.promise;if(!current(task))return;
        entry=createSimulationRecord(runInput.request,runInput.stage,result,{characterId:runInput.characterId,loadout:runInput.loadout});signature=inputSignature;
        onEvent({type:'completed',entry});
        try{
          const saved=await remember(profile,entry,lifecycleId);
          if(current(task))await onEvent({type:'saved',saved,entry});
        }catch(error){if(current(task))onEvent({type:'save-failed',error});}
      }catch(error){if(current(task))onEvent({type:error.name==='AbortError'?'stopped':'failed',error});}
      finally{task.ticket?.cancel();if(current(task)){active=null;onEvent({type:'idle'});}}
    },
  };
}
