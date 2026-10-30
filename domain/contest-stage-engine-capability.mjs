// 正式计算与审计同时校验轻量索引和真实引擎，索引过期不得放行。
import {Stages} from './upstream-contest-engine.mjs';
import {contestEngineMap} from './contest-engine-map.mjs';
import {contestStageIndex} from './contest-stage-index.mjs';
import {verifyContestStageCapability} from './contest-stage-capability.mjs';
import {stableStageJSON} from './contest-stage-preset.mjs';
export function contestStageIndexMatches(registry,mapping,index){
  if(index.format!==1||index.source?.commit!==mapping.source.commit||index.source?.repository!==mapping.source.repository)return false;
  const expected=Object.fromEntries(registry.map(row=>[row.id,{id:row.id,type:row.type,plan:row.plan,season:row.season,stage:row.stage,turn:Object.values(row.turnCounts).reduce((sum,value)=>sum+value,0),fingerprint:mapping.stages[row.id]}]));
  return stableStageJSON(expected)===stableStageJSON(index.stages);
}
const valid=contestStageIndexMatches(Stages.getAll(),contestEngineMap,contestStageIndex);
export async function verifyEngineStageCapability(stage){
  if(!valid)return {state:'invalid',reasons:[],code:'stage_index_mismatch'};
  return verifyContestStageCapability(stage);
}
