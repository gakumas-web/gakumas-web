import {startContestMultiplierPreview} from './contest-multiplier-preview.mjs';

// 三维倍率独立缓存；取消后未完成的属性仍会进入下一次计算。
export function createContestMultiplierController({stage,supportCards,manual,onEvent=()=>{},start=startContestMultiplierPreview,delay=160}){
  const keys=['vocal','dance','visual'],cache=new Map();
  let timer,handle=null,generation=0,disposed=false;
  function cancel(){clearTimeout(timer);generation++;handle?.cancel();handle=null;}
  return {
    dispose(){cancel();disposed=true;onEvent({type:'reset'});},
    update(params){
      if(disposed)return;
      cancel();const version=generation,values={...params},pending=[],cleared=[];
      onEvent({type:'reset'});
      for(const key of keys){
        if(values[key]===undefined){cache.delete(key);cleared.push(key);}
        else if(!cache.has(key)||cache.get(key)!==values[key]){pending.push(key);cache.delete(key);}
      }
      onEvent({type:'pending',pending,cleared});
      if(!pending.length)return;
      timer=setTimeout(async()=>{
        try{
          handle=start({params:values,stage,supportCards,manual});
          const result=await handle.promise;if(disposed||version!==generation)return;
          for(const key of pending){if(Number.isFinite(result[key]))cache.set(key,values[key]);else cache.delete(key);}
          onEvent({type:'completed',values:Object.fromEntries(pending.map(key=>[key,result[key]]))});
        }catch(error){if(!disposed&&version===generation&&error.name!=='AbortError')onEvent({type:'failed',error});}
        finally{if(!disposed&&version===generation){handle=null;onEvent({type:'idle',keys:pending});}}
      },delay);
    },
  };
}
