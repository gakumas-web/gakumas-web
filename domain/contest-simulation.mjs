// 比赛配置与属性评分曲线共用固定公开资料，不从配置编号推断当前赛期。
export function createContestCatalog(tables={},presets=[]){
  const groups=name=>{const map=new Map();for(const row of tables[name]??[]){if(!map.has(row.id))map.set(row.id,[]);map.get(row.id).push(row);}return map;};
  const curves=groups('ProduceExamBattleScoreConfig'),decks=groups('PvpRateCommonProduceCard'),gimmicks=groups('ProduceExamGimmickEffectGroup');
  for(const rows of curves.values())rows.sort((a,b)=>a.parameter-b.parameter);
  for(const rows of gimmicks.values())rows.sort((a,b)=>a.startTurn-b.startTurn||a.priority-b.priority);
  const settings=new Map((tables.ExamSetting??[]).map(row=>[row.id,row]));
  const seasons=[...(tables.PvpRateConfig??[])].sort((a,b)=>a.id.localeCompare(b.id,'en',{numeric:true})).reverse();
  const catalog={seasons,stage(seasonId,index){
    const season=seasons.find(row=>row.id===seasonId),stage=season?.stages[index];if(!stage)return null;
    return {season,...stage,curve:curves.get(stage.produceExamBattleScoreConfigId||season.produceExamBattleScoreConfigId)??[],
      decks:decks.get(season.pvpRateCommonProduceCardId)??[],gimmicks:gimmicks.get(stage.produceExamGimmickEffectGroupId)??[],setting:settings.get(season.examSettingId)};
  }};
  const plans={sense:'ProducePlanType_Plan1',logic:'ProducePlanType_Plan2',anomaly:'ProducePlanType_Plan3',free:'ProducePlanType_Common'};
  const references=new Map(presets.filter(row=>row.type==='contest').map(row=>[`${row.season}:${row.stage}`,row]));
  catalog.choices=seasons.flatMap(season=>season.stages.map((_,index)=>{
    const stage=catalog.stage(season.id,index),number=Number(season.id.split('-').at(-1)),preset=references.get(`${number}:${index+1}`);
    return {...stage,id:`contest:${season.id}:${index}`,kind:'contest',seasonNumber:number,stageNumber:index+1,preset,
      criteria:preset?.criteria??null,turnCounts:preset?.turnCounts??null,firstTurns:preset?.firstTurns??null};
  }));
  for(const preset of presets.filter(row=>row.type!=='contest').sort((a,b)=>b.id-a.id))catalog.choices.push({
    id:`reference:${preset.id}`,kind:preset.type,preset,planType:plans[preset.plan],turn:Object.values(preset.turnCounts).reduce((sum,value)=>sum+value,0),
    criteria:preset.criteria,turnCounts:preset.turnCounts,firstTurns:preset.firstTurns,curve:[],decks:[],gimmicks:[],produceItemIds:[],manualMultipliers:true,
  });
  return catalog;
}
export function customizeContestStage(base,{criteria,turnCounts,firstTurns,planType}){
  const attributes=['vocal','dance','visual'];
  if(!base||!attributes.every(key=>Number.isFinite(criteria[key])&&criteria[key]>=0&&Number.isInteger(turnCounts[key])&&turnCounts[key]>=0&&Number.isFinite(firstTurns[key])&&firstTurns[key]>=0))throw new Error('invalid_custom_stage');
  if(Math.abs(attributes.reduce((n,key)=>n+criteria[key],0)-1)>1e-6||Math.abs(attributes.reduce((n,key)=>n+firstTurns[key],0)-1)>1e-6)throw new Error('invalid_custom_stage');
  const turn=attributes.reduce((n,key)=>n+turnCounts[key],0);if(turn<1||turn>100)throw new Error('invalid_custom_stage');
  if(!['ProducePlanType_Common','ProducePlanType_Plan1','ProducePlanType_Plan2','ProducePlanType_Plan3'].includes(planType))throw new Error('invalid_custom_stage');
  const scalable=attributes.every(key=>base.criteria?.[key]>0);
  const curve=base.manualMultipliers||!scalable?[]:base.curve.map(row=>({...row,...Object.fromEntries(attributes.map(key=>[key+'Permil',row[key+'Permil']*criteria[key]/base.criteria[key]]))}));
  return {...base,id:'custom',custom:true,baseId:base.id,criteria,turnCounts,firstTurns,planType,turn,curve,manualMultipliers:base.manualMultipliers||!scalable};
}
export function contestPlanMatches(stage,planType){
  const plan=({2:'ProducePlanType_Plan1',3:'ProducePlanType_Plan2',4:'ProducePlanType_Plan3'})[planType];
  return Boolean(plan)&&(stage.planType==='ProducePlanType_Common'||stage.planType===plan);
}
// 区间内按原表端点线性插值；超出已知范围不外推、不把缺失数值当成零。
export function contestAttributeMultiplier(curve,attribute,value){
  if(!Number.isFinite(value)||!curve.length)return null;
  const key=attribute+'Permil';
  const exact=curve.find(row=>row.parameter===value);if(exact)return Number.isFinite(exact[key])?exact[key]/1000:null;
  const end=curve.findIndex(row=>row.parameter>value);if(end<=0)return null;
  const a=curve[end-1],b=curve[end];if(!Number.isFinite(a[key])||!Number.isFinite(b[key]))return null;
  return (a[key]+(b[key]-a[key])*(value-a.parameter)/(b.parameter-a.parameter))/1000;
}
export function contestMemoryEntries(memories,stage,sort='ordinal',manual={}){
  if(!stage)return [];
  const rows=memories.filter(memory=>contestPlanMatches(stage,memory.planType)&&memory.examBattleProduceCards?.length).map(memory=>({memory,multipliers:Object.fromEntries(['vocal','dance','visual'].map(key=>[key,stage.manualMultipliers?(Number.isFinite(manual[key])&&manual[key]>=0?manual[key]/100:null):contestAttributeMultiplier(stage.curve,key,memory[key])]))}));
  if(['vocal','dance','visual'].includes(sort))rows.sort((a,b)=>(b.multipliers[sort]??-Infinity)-(a.multipliers[sort]??-Infinity)||(a.memory.ordinal??0)-(b.memory.ordinal??0));
  return rows;
}

// 主、副槽位不可压缩；副回忆各项按 20% 向下取整，缺失数值不视为零。
export function contestMemoryTotals(memories,stage,manual={}){
  const [main,sub]=memories;
  const totals=Object.fromEntries(['vocal','dance','visual','stamina','power'].map(key=>[key,Number.isFinite(main?.[key])&&(!sub||Number.isFinite(sub[key]))?main[key]+(sub?Math.floor(sub[key]/5):0):undefined]));
  return {...totals,...(Number.isFinite(totals.power)&&memories.some(memory=>memory?.powerSource==='calculated')?{powerSource:'calculated'}:{}),multipliers:Object.fromEntries(['vocal','dance','visual'].map(key=>[key,stage.manualMultipliers?(Number.isFinite(manual[key])&&manual[key]>=0?manual[key]/100:null):contestAttributeMultiplier(stage.curve,key,totals[key])]))};
}
// 先排除转换开关禁用的版本，再对禁止重复的同 ID 卡按附魔、强化和主回忆优先级去重。
export function contestMemoryCards(memories,noDeckDuplication,conversionRules={}){
  const excluded=new Set(conversionRules.excludedCardIds??[]);
  const entries=memories.flatMap((memory,memoryIndex)=>(memory?.examBattleProduceCards??[]).map((card,cardIndex)=>({card,memoryIndex,cardIndex,retained:false}))),winners=new Map();
  const customized=entry=>entry.card.customizes?.some(value=>value.customizeCount>0)??false;
  for(const entry of entries){
    if(excluded.has(entry.card.id)){entry.exclusion='conversion';continue;}
    if(!noDeckDuplication(entry.card)){entry.retained=true;continue;}
    const current=winners.get(entry.card.id);
    if(!current){winners.set(entry.card.id,entry);continue;}
    const a=customized(entry),b=customized(current);
    if(a&&!b||a===b&&(a?entry.memoryIndex<current.memoryIndex:entry.card.upgradeCount>current.card.upgradeCount||entry.card.upgradeCount===current.card.upgradeCount&&entry.memoryIndex<current.memoryIndex))winners.set(entry.card.id,entry);
  }
  for(const entry of winners.values())entry.retained=true;
  return entries;
}

// 逐卡按已达到的等级档位累加百分之一百分点，避免小数逐项相加误差。
export function contestSupportBonus(supportCards){
  if(supportCards===undefined)return null;
  const steps=[[10,1],[20,1],[30,2],[40,2],[50,2],[60,2]];
  return supportCards.reduce((total,card)=>total+steps.reduce((sum,[level,amount])=>sum+(card.level>=level?amount:0),0),0)/100;
}

// 竞技场按赛季聚合；活动按活动编号与轮次聚合，保留三舞台及早期五舞台配置。
export function contestSeasonGroups(choices){
  const groups=new Map();
  for(const stage of choices){
    if(!['contest','event'].includes(stage.kind))continue;
    const id=stage.kind==='contest'?`contest:${stage.season.id}`:`event:${stage.preset?.season??stage.preset?.name}:${stage.preset?.round??1}`;
    if(!groups.has(id))groups.set(id,{id,kind:stage.kind,seasonNumber:stage.seasonNumber,name:stage.preset?.name,round:stage.preset?.round,stages:[]});
    groups.get(id).stages.push(stage);
  }
  for(const group of groups.values()){
    if(group.kind!=='event')continue;
    group.stages.sort((a,b)=>String(a.preset.stage??'').localeCompare(String(b.preset.stage??''),undefined,{numeric:true}));
    const names=[...new Set(group.stages.map(stage=>stage.preset.name))];
    let common=names[0];for(const name of names.slice(1)){while(common&&!name.startsWith(common))common=common.slice(0,-1);}
    group.name=common.trim()||names.join(' / ');
  }
  return [...groups.values()];
}
