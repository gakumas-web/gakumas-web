import {simulationHistory,saveSimulationRun,deleteSimulationRun,SIMULATION_HISTORY_LIMIT} from './storage.mjs';

export {simulationHistory,deleteSimulationRun,SIMULATION_HISTORY_LIMIT};
export const simulationStageKey=stage=>`${stage.kind}:${stage.preset?.id??stage.id}`;
// 保存的是独立编组副本；账号、回忆身份和采集时间不进入模拟记录内容。
export function captureSimulationLoadout(memories,manual={},originals){
  const fields=['characterId','idolCardId','planType','vocal','dance','visual','stamina','power','powerSource','grade','produceCard','examBattleProduceCards','examBattleProduceItemIds'];
  const capture=values=>values.map(memory=>memory?Object.fromEntries(fields.filter(key=>memory[key]!==undefined).map(key=>[key,memory[key]])):null);
  return structuredClone({memories:capture(memories),manual,...(originals?{originals:capture(originals)}:{})});
}
export function createSimulationRecord(request,stage,result,{characterId,loadout}={}){
  const keys=['id','kind','seasonNumber','stageNumber','name','planType','preset'];
  return structuredClone({format:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),stageKey:simulationStageKey(stage),
    stage:Object.fromEntries(keys.filter(key=>stage[key]!==undefined).map(key=>[key,stage[key]])),characterId:characterId??null,loadout:loadout??null,request,result});
}
export async function rememberSimulation(profile,entry){if(!profile)return false;await saveSimulationRun(profile,entry);return true;}
