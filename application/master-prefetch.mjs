import {contentManager} from './content-manager.mjs';
// 分包分别复用在途请求；页面依赖由加载器统一调度。
const pending=new Map();
export function prefetchMaster(scope='catalog'){
  if(!pending.has(scope)){
    const task=contentManager.take(scope);
    pending.set(scope,task);
    void task.catch(()=>{if(pending.get(scope)===task)pending.delete(scope);});
  }
  return pending.get(scope);
}
export async function takeMaster(scope='full'){
  const task=prefetchMaster(scope);
  try{return await task;}
  finally{if(pending.get(scope)===task)pending.delete(scope);}
}
// 首屏只预取各页面共用的基础目录；失败留给正式载入入口重试。
if(typeof document!=='undefined')void prefetchMaster().catch(()=>{});
