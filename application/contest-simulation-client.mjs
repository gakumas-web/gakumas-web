import {simulationWorkerCount} from './contest-compute-preferences.mjs';
import {contestSimulationBatches} from '../domain/contest-simulation-batches.mjs';

// 单次与多核使用相同固定分块；取消、失败和超时统一终止整个 Worker 池。
export function startContestSimulation(request,{runs=500,seed=crypto.getRandomValues(new Uint32Array(1))[0],multiCore=false,onProgress=()=>{},timeoutMs=Math.max(120000,runs*60)}={}){
  const workers=[];let settled=false,rejectRun,timer;
  const finish=()=>{settled=true;clearTimeout(timer);for(const worker of workers)worker.terminate();};
  const promise=new Promise((resolve,reject)=>{
    rejectRun=reject;
    const fail=error=>{if(!settled){finish();reject(error);}};
    try{
      const batches=contestSimulationBatches(runs),results=new Array(batches.length);let next=0,completed=0,totalProgress=0;
      const dispatch=worker=>{const index=next++;worker.task={index,previous:0};worker.postMessage({mode:'simulation-batch',request,...batches[index],seed});};
      for(let index=0;index<Math.min(simulationWorkerCount(multiCore),batches.length);index++){
        const worker=new Worker(new URL('./contest-simulation-worker.mjs',import.meta.url),{type:'module'});workers.push(worker);
        worker.onmessage=({data})=>{
          if(settled)return;
          if(data.type==='progress'){const task=worker.task;totalProgress+=data.completed-task.previous;task.previous=data.completed;onProgress(totalProgress);return;}
          if(data.type==='error'){fail(Object.assign(new Error(data.code),{code:data.code,details:data.details}));return;}
          if(worker.finishing){finish();resolve(data.result);return;}
          results[worker.task.index]=data.result;completed++;
          if(next<batches.length)dispatch(worker);
          else if(completed===batches.length){
            // 最后只由一个 Worker 合并原始统计并重现三局展示记录。
            for(const idle of workers.slice(1))idle.terminate();const collector=workers[0];collector.finishing=true;
            collector.postMessage({mode:'simulation-finish',request,batches:results,seed});
          }
        };
        worker.onerror=event=>{event.preventDefault();fail(Object.assign(new Error('engine_failed'),{code:'engine_failed'}));};
        dispatch(worker);
      }
      timer=setTimeout(()=>fail(Object.assign(new Error('simulation_timeout'),{code:'simulation_timeout'})),timeoutMs);
    }catch(error){fail(error);}
  });
  return {promise,cancel(){if(!settled){finish();rejectRun(new DOMException('Simulation cancelled','AbortError'));}}};
}
