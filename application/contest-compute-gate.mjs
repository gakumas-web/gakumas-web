// 同一页面的重计算任务共用一个许可；短倍率预览不经过此入口。
export function createContestComputeGate(){
  const waiting=[];let owner=null;
  function advance(){if(!owner&&waiting.length){owner=waiting.shift();owner.grant();}}
  return {
    get busy(){return owner!==null;},
    get pending(){return waiting.length;},
    acquire(){
      let state='waiting',resolve,reject;
      const ready=new Promise((yes,no)=>{resolve=yes;reject=no;});
      // 等待通知同步失败时也能取消票据；实际等待者仍会收到原始拒绝。
      ready.catch(()=>{});
      const ticket={
        ready,
        get granted(){return state==='granted';},
        get waiting(){return state==='waiting';},
        grant(){state='granted';resolve();},
        release(){
          if(state!=='granted')return;
          state='released';if(owner===ticket){owner=null;advance();}
        },
        cancel(){
          if(state==='waiting'){
            waiting.splice(waiting.indexOf(ticket),1);state='cancelled';
            reject(new DOMException('Queued computation cancelled','AbortError'));
          }else ticket.release();
        },
      };
      waiting.push(ticket);advance();return ticket;
    },
  };
}

export const contestComputeGate=createContestComputeGate();
