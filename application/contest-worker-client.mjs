// 每个客户端仅处理一个在途请求，调用方负责串行调度与会话分配。
export function createContestWorkerClient({cancelMessage='Simulation cancelled',createWorker=()=>new Worker(new URL('./contest-simulation-worker.mjs',import.meta.url),{type:'module'})}={}){
  const worker=createWorker();let pending=null,timer,closed=false;
  const settle=(error,result)=>{
    const current=pending;if(!current)return;
    pending=null;clearTimeout(timer);error?current.reject(error):current.resolve(result);
  };
  const terminate=()=>{if(!closed){closed=true;worker.terminate();}};
  worker.onmessage=({data})=>{
    if(!pending)return;
    if(data.type==='progress')pending.onProgress(data.completed);
    else if(data.type==='result')settle(null,data.result);
    else settle(Object.assign(new Error(data.code),{code:data.code,details:data.details}));
  };
  worker.onerror=event=>{event.preventDefault();settle(Object.assign(new Error('engine_failed'),{code:'engine_failed'}));terminate();};
  return {
    run(data,onProgress=()=>{}){
      if(closed)return Promise.reject(new DOMException(cancelMessage,'AbortError'));
      return new Promise((resolve,reject)=>{
        pending={resolve,reject,onProgress};
        timer=setTimeout(()=>{settle(Object.assign(new Error('simulation_timeout'),{code:'simulation_timeout'}));terminate();},Math.max(120000,(data.runs??0)*60));
        try{worker.postMessage(data);}catch(error){settle(error);terminate();}
      });
    },
    cancel(){settle(new DOMException(cancelMessage,'AbortError'));terminate();},
  };
}
