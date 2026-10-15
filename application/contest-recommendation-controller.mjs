import {recommendationMemories} from '../domain/contest-recommendations.mjs';
import {createContestMemoryDraft} from '../domain/contest-loadout.mjs';
import {memoryExclusiveSkill} from '../domain/catalog.mjs';
import {startContestRecommendations} from './contest-recommendation-client.mjs';

export function createContestRecommendationController({initialState,onEvent=()=>{},start=startContestRecommendations}={}){
  const completed=new Map(initialState?.results??[]);
  let context,signature=null,active=null,disposed=false;
  const current=task=>!disposed&&active===task;
  function invalidate(){const previous=active;active=null;previous?.handle?.cancel();return Boolean(previous);}
  const stop=()=>active?.handle?.cancel();
  return {
    get running(){return active!==null;},
    resultFor:characterId=>completed.get(characterId)??null,
    captureResults:()=>[...completed],
    setContext(value){
      if(disposed)return false;
      const next=JSON.stringify([value.stage.id,value.manual,value.supportCards?.map(card=>card.level),value.memories.map(memory=>memory.key),value.conversionRules]);
      if(signature===next)return false;
      if(invalidate())onEvent({type:'invalidated'});
      context=value;signature=next;
      for(const [id,result] of completed)if(result.signature!==signature)completed.delete(id);
      return true;
    },
    stop,
    dispose(){disposed=true;invalidate();},
    async run(characterId,{multiCore}={}){
      if(disposed||active)return;
      const task={handle:null},startedAt=performance.now(),runContext=context,runSignature=signature;active=task;
      onEvent({type:'started'});
      try{
        const originals=recommendationMemories(runContext.memories,runContext.stage,characterId),memories=originals.map(memory=>createContestMemoryDraft(memory,memoryExclusiveSkill(memory)?.reference.id));
        task.handle=start({memories,stage:runContext.stage,supportCards:runContext.supportCards,manual:runContext.manual,conversionRules:runContext.conversionRules},{multiCore,onProgress:update=>{if(current(task))onEvent({type:'progress',update});}});
        const report=await task.handle.promise;if(!current(task))return;
        const result={signature:runSignature,characterId,memories,originals,stage:runContext.stage,manual:runContext.manual,report,elapsedSeconds:(performance.now()-startedAt)/1000};
        completed.set(characterId,result);onEvent({type:'completed',result});
      }catch(error){if(current(task))onEvent({type:error.name==='AbortError'?'stopped':'failed',error});}
      finally{if(current(task)){active=null;onEvent({type:'idle'});}}
    },
  };
}
