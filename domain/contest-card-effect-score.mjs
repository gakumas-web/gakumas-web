// 首轮使用真实出牌轨迹，将回合得分还原属性倍率后按舞台权重汇总；不改写战斗状态。
export function contestCardEffectScore(logs,scoreField,multipliers,criteria){
  let type=null,total=0;
  for(const {logType,data} of logs){
    if(logType==='startTurn'){type=data.type;continue;}
    if(logType!=='diff'||data.field!==scoreField||!type)continue;
    const delta=data.next-data.prev,multiplier=multipliers[type],weight=criteria[type];
    if(!Number.isFinite(delta)||!Number.isFinite(weight)||weight<=0)continue;
    if(delta<=0)total+=delta*weight;
    else if(multiplier>0)total+=delta/multiplier*weight;
  }
  return total;
}
