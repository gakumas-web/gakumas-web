import {captureSimulationLoadout,simulationStageKey} from './contest-simulation-history.mjs';
export {savedSimulationLoadouts,saveSimulationLoadout,deleteSimulationLoadout} from './storage.mjs';

// 仅保存可恢复的编组与舞台信息，不复制模拟日志或来源账号字段。
export function createSavedLoadout(source,name,previous=null){
  const now=new Date().toISOString(),stageKeys=['id','kind','seasonNumber','stageNumber','name','planType','preset'];
  return {format:1,id:previous?.id??crypto.randomUUID(),name:name.trim(),createdAt:previous?.createdAt??now,updatedAt:now,
    stageKey:simulationStageKey(source.stage),stage:structuredClone(Object.fromEntries(stageKeys.filter(key=>source.stage[key]!==undefined).map(key=>[key,source.stage[key]]))),
    loadout:captureSimulationLoadout(source.loadout.memories,source.loadout.manual,source.loadout.originals)};
}
