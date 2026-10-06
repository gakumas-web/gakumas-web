// 奖励定义只用于参考，采集到的 Ending 枚举不直接证明奖励已生效。
const fields=['produceVocal','produceDance','produceVisual','produceStamina','produceVocalGrowthRatePermil','produceDanceGrowthRatePermil','produceVisualGrowthRatePermil'];
const typeIds={ProduceType_FirstStar:1,ProduceType_NextIdolAudition:2,ProduceType_HatsuboshiIdolFestival:3};
export function endingBonusReference(tables,characterId,capturedCharacter){
  const id=tables?.Character?.find(row=>row.id===characterId)?.characterTrueEndBonusId;
  const rows=(tables?.CharacterTrueEndBonus??[]).filter(row=>id&&row.id===id).map(row=>({...row,type:typeIds[row.produceType],recorded:capturedCharacter===undefined?undefined:capturedCharacter.trueEndProduceTypes.includes(typeIds[row.produceType])}));
  const total=Object.fromEntries(fields.map(field=>[field,rows.reduce((sum,row)=>sum+row[field],0)]));
  return {rows,total};
}

// 按已达成剧本汇总彩色部分，其余剧本构成灰色部分；保持原始奖励定义不变。
export function endingRewardStats(entry){
  const calculations={},stats=[];
  function value(label,field,growth=false){
    const unit=growth?'%':'',parts=recorded=>entry.rows.filter(row=>(row.recorded===true)===recorded&&row[field]>0).map(row=>({type:row.type,value:row[field]/(growth?10:1)}));
    const contributions=parts(true),remainingContributions=parts(false),sum=rows=>Number(rows.reduce((n,row)=>n+row.value,0).toFixed(6));
    const current=sum(contributions),remaining=sum(remainingContributions);
    calculations[label]={value:current,remaining,reachable:Number((current+remaining).toFixed(6)),contributions,remainingContributions};
    stats.push({label,after:`+${current}${unit}`,unit});
  }
  for(const key of ['Vocal','Dance','Visual']){value('初始 '+key,'produce'+key);value(key+' 成长率','produce'+key+'GrowthRatePermil',true);}
  value('体力','produceStamina');
  stats.push({label:'合计',after:'+'+['Vocal','Dance','Visual'].reduce((n,key)=>n+calculations['初始 '+key].value,0)});
  return {stats,calculations,statMaximum:Math.max(1,...['Vocal','Dance','Visual'].map(key=>calculations['初始 '+key].reachable)),growthMaximum:Math.max(1,...['Vocal','Dance','Visual'].map(key=>calculations[key+' 成长率'].reachable))};
}
