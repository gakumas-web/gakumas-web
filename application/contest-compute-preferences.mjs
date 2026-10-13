// 多核开关是本机浏览器偏好，不属于账号数据，也不进入账号备份。
export const SIMULATION_MULTICORE_KEY='gakumas-web:recommendation-multicore';
export const simulationWorkerCount=(multiCore=false,cores=globalThis.navigator?.hardwareConcurrency??2)=>multiCore?Math.max(1,Math.floor(cores/2)):1;
let current;
const listeners=new Set();
export function readSimulationMultiCore(){
  if(current===undefined){try{current=localStorage.getItem(SIMULATION_MULTICORE_KEY)==='true';}catch{current=false;}}
  return current;
}
export function saveSimulationMultiCore(value){
  current=Boolean(value);
  try{localStorage.setItem(SIMULATION_MULTICORE_KEY,String(current));}finally{for(const listener of listeners)listener(current);}
}
export function onSimulationMultiCoreChange(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
