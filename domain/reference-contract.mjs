// 内容边界只校验结构和可计算范围，不提供任何游戏规则默认值。
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const text=value=>typeof value==='string'&&value.length>0;
const invalid=()=>{throw new Error('content_reference_invalid');};
export function validateCatalogMetadata(value){
  if(!object(value)||value.schema_version!==1||!object(value.characterColors)||!object(value.skinReleaseTimes))invalid();
  if(Object.entries(value.characterColors).some(([key,color])=>!text(key)||typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)))invalid();
  for(const [key,row] of Object.entries(value.skinReleaseTimes)){
    if(!text(key)||!object(row)||!number(row.time)||row.time===0||!['reported-batch','same-batch'].includes(row.source))invalid();
    if(row.source==='reported-batch'&&(row.precision!=='day'||!text(row.url)))invalid();
    if(row.source==='same-batch'&&(!Array.isArray(row.referenceIds)||!row.referenceIds.length||!row.referenceIds.every(text)))invalid();
  }
  return value;
}
export function validateCommunityRules(value){
  if(!object(value)||value.schema_version!==1)invalid();
  const {hifStar:hif,contestCosts:costs}=value;
  for(const rule of [hif,costs])if(!object(rule)||rule.classification!=='player-inferred'||rule.verification!=='maintainer-confirmed-game-consistent')invalid();
  if(typeof hif.enabled!=='boolean'||!number(hif.finalCap)||!hif.finalCap||!number(hif.bonusMultiplier)||!hif.bonusMultiplier||!['floor','round','ceil','none'].includes(hif.rounding))invalid();
  const {item,battle}=hif;
  if(!object(item)||!text(item.id)||!text(item.name)||!Number.isInteger(item.limit)||item.limit<0||!number(item.baseReward)||!['triggerCount','reactionCount'].includes(item.countField)||![null,undefined,'triggerCount','reactionCount'].includes(item.matchingCountField))invalid();
  if(!object(battle)||['spLessons','rounds'].some(key=>!Array.isArray(battle[key])||!battle[key].every(number)))invalid();
  const pair=row=>object(row)&&number(row.base)&&number(row.upgraded);
  if(!number(costs.exclusiveCost)||!number(costs.initialProducerLevelMax)||!pair(costs.supportCard)||!object(costs.rarities)||!Object.keys(costs.rarities).length||Object.entries(costs.rarities).some(([key,row])=>!text(key)||!pair(row)||'initial' in row&&!pair(row.initial)))invalid();
  if(!Array.isArray(costs.ranges)||!costs.ranges.length||costs.ranges.some(row=>!object(row)||!text(row.rank)||!number(row.min)||!number(row.max)||row.min>row.max))invalid();
  const ranks=new Set(costs.ranges.map(row=>row.rank));
  if(ranks.size!==costs.ranges.length||!object(costs.rankAliases)||Object.entries(costs.rankAliases).some(([key,target])=>!text(key)||ranks.has(key)||!ranks.has(target)))invalid();
  const custom=value.contestCustomizations;
  if(custom!==undefined){
    const sources=['idol','support','common'],integer=value=>Number.isSafeInteger(value)&&value>=0;
    if(!object(custom)||custom.classification!=='player-inferred'||custom.verification!=='user-selected-reference'||!text(custom.source)||!text(custom.checked)||!object(custom.perCard)||sources.some(key=>!integer(custom.perCard[key]))||!object(custom.ranks)||!Object.keys(custom.ranks).length)invalid();
    for(const [rank,row] of Object.entries(custom.ranks))if(!text(rank)||!object(row)||!object(row.cards)||sources.some(key=>!integer(row.cards[key]))||!object(row.guaranteedCounts)||['idol','support','commonFirst','commonSecond'].some(key=>!integer(row.guaranteedCounts[key]))||typeof row.provisional!=='boolean')invalid();
  }
  const items=value.contestItems;
  if(items!==undefined&&(!object(items)||items.classification!=='player-inferred'||items.verification!=='maintainer-instruction'||!text(items.checked)||!object(items.ranks)||!Object.keys(items.ranks).length||Object.entries(items.ranks).some(([rank,limit])=>!text(rank)||!Number.isSafeInteger(limit)||limit<0)))invalid();
  return value;
}
