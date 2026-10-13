import {createContestSimulationRequest} from '../domain/contest-engine-request.mjs';

// 与正式模拟共用输入投影和引擎换算；只传属性、舞台和支援汇总值。
export function startContestMultiplierPreview({params,stage,supportCards,manual},{suggestParameters=false}={}){
  const projected=createContestSimulationRequest([{...params,examBattleProduceCards:[],examBattleProduceItemIds:[]}],stage,supportCards,manual);
  const request=Object.fromEntries(['params','stage','supportBonus','manualMultipliers'].map(key=>[key,projected[key]]));
  let worker,timer,settled=false,rejectRun;
  const finish=()=>{settled=true;clearTimeout(timer);worker?.terminate();};
  const promise=new Promise((resolve,reject)=>{
    rejectRun=reject;
    try{
      worker=new Worker(new URL('./contest-simulation-worker.mjs',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{if(settled)return;finish();if(data.type==='result')resolve(data.result);else reject(Object.assign(new Error(data.code),{code:data.code}));};
      worker.onerror=event=>{event.preventDefault();if(!settled){finish();reject(new Error('multiplier_preview_failed'));}};
      timer=setTimeout(()=>{if(!settled){finish();reject(new Error('multiplier_preview_timeout'));}},30000);
      worker.postMessage({mode:suggestParameters?'suggest-parameters':'multipliers',request});
    }catch(error){finish();reject(error);}
  });
  return {promise,cancel(){if(!settled){finish();rejectRun(new DOMException('Preview cancelled','AbortError'));}}};
}
