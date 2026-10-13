// 缺经验或缺表保持未知；不从培育记录、排行或租借解锁等级推断账号等级。
export function validProducerLevels(rows){
  return Array.isArray(rows)&&rows.length>0&&rows.every((row,index)=>
    row&&row.level===index+1&&Number.isSafeInteger(row.totalExp)&&row.totalExp>=0&&
    (index===0?row.totalExp===0:row.totalExp>rows[index-1].totalExp));
}
export function producerLevelFromExp(exp,rows){
  if(!Number.isSafeInteger(exp)||exp<0||!validProducerLevels(rows))return null;
  let level=1;
  for(const row of rows){if(row.totalExp>exp)break;level=row.level;}
  return level;
}
export function commonCardUnlocked(choice,level){
  const required=choice.unlockProducerLevel;
  if(!Number.isSafeInteger(level)||level<1||!Number.isSafeInteger(required)||required<0)return null;
  return level>=required;
}

// 上限来自当前完整等级表，不把某一发行版的等级或经验常量写进程序。
export function producerLevelCap(rows){
  if(!validProducerLevels(rows))return null;
  const {level,totalExp}=rows.at(-1);return {level,totalExp};
}
