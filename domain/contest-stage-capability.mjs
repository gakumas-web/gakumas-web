// 舞台可浏览与可计算分开；赛期日期不参与数值模拟能力判断。
import {contestStageIndex} from './contest-stage-index.mjs';
import {contestStagePreset,stableStageJSON} from './contest-stage-preset.mjs';
export {contestStagePreset,stableStageJSON} from './contest-stage-preset.mjs';
const cache=new WeakMap(),plans={sense:'ProducePlanType_Plan1',logic:'ProducePlanType_Plan2',anomaly:'ProducePlanType_Plan3',free:'ProducePlanType_Common'};
const signature=stage=>stableStageJSON([stage.kind,stage.id,stage.preset,stage.turn,stage.setting,stage.planType,stage.custom]);
const invalid=code=>({state:'invalid',reasons:[],code});
function structural(stage){
  if(!stage||!['contest','event'].includes(stage.kind)||stage.custom||!Number.isSafeInteger(stage.turn)||stage.turn<1)return invalid('unsupported_stage');
  if(stage.setting&&[['handLimit',5],['holdLimit',2],['turnStartDistribute',3],['examTurnEndRecoveryStamina',2]].some(([key,value])=>stage.setting[key]!==value))return invalid('unsupported_stage_rules');
  const preset=stage.preset,match=stage.kind==='contest'&&/^contest:pvp_rate_config-([1-9][0-9]*):([0-9]+)$/.exec(stage.id??'');
  const source=match?Object.values(contestStageIndex.stages).find(row=>row.type==='contest'&&row.season===Number(match[1])&&row.stage===Number(match[2])+1):preset&&contestStageIndex.stages[preset.id];
  const reasons=[];
  if(!preset)reasons.push('missing_stage_reference');
  if(!source)reasons.push('missing_engine_stage');
  if(reasons.length)return stage.kind==='contest'?{state:'pending',reasons}:invalid('unsupported_stage');
  if(source.id!==preset.id||source.type!==stage.kind||!plans[source.plan]||stage.planType&&source.plan!=='free'&&plans[source.plan]!==stage.planType||source.turn!==stage.turn)return invalid('unsupported_stage');
  if(!source.fingerprint)return invalid('unsupported_stage');
  return {state:'checking',reasons:[]};
}
export function contestStageCapability(stage){
  if(!stage||typeof stage!=='object')return invalid('unsupported_stage');
  const found=cache.get(stage);
  return found?.signature===signature(stage)?found.value:structural(stage);
}
export async function verifyContestStageCapability(stage){
  const initial=contestStageCapability(stage);
  if(initial.state!=='checking')return initial;
  const before=signature(stage),bytes=new TextEncoder().encode(stableStageJSON(contestStagePreset(stage.preset)));
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
  const value=hash===contestStageIndex.stages[stage.preset.id]?.fingerprint?{state:'ready',reasons:[]}:invalid('unsupported_stage');
  if(signature(stage)===before)cache.set(stage,{signature:before,value});
  return value;
}
export function latestAvailableContestStage(stages){
  return stages.find(stage=>stage.kind==='contest'&&contestStageCapability(stage).state==='ready')??stages.find(stage=>contestStageCapability(stage).state==='ready')??null;
}
