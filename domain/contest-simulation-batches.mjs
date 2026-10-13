// 固定分块与并行数无关，保证统计合并顺序及浮点求和顺序可复现。
export const CONTEST_SIMULATION_BATCH_SIZE=32;
export function contestSimulationBatches(runs){
  if(!Number.isInteger(runs)||runs<1||runs>10000)throw Object.assign(new Error('invalid_options'),{code:'invalid_options'});
  const batches=[];for(let offset=0;offset<runs;offset+=CONTEST_SIMULATION_BATCH_SIZE)batches.push({offset,runs:Math.min(CONTEST_SIMULATION_BATCH_SIZE,runs-offset)});
  return batches;
}
