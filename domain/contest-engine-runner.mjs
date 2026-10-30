import {verifyEngineStageCapability as verifyContestStageCapability} from './contest-stage-engine-capability.mjs';
import {CONTEST_PARAMETER_TARGETS} from './contest-parameter-targets.mjs';
import {IdolConfig,StageConfig,IdolStageConfig,StageEngine,StagePlayer,STRATEGIES,resetRand,S,SkillCards,PItems,Customizations,Stages} from './upstream-contest-engine.mjs';
import {generatedSkillReference} from './contest-engine-display.mjs';
import {createContestStatistics} from './contest-simulation-stats.mjs';
import {contestEngineMap} from './contest-engine-map.mjs';
import {contestCardEffectScore} from './contest-card-effect-score.mjs';

export class ContestSimulationError extends Error{
  constructor(code,details=[]){super(code);this.name='ContestSimulationError';this.code=code;this.details=details;}
}
export const stableJSON=value=>JSON.stringify(value,(_,entry)=>entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])):entry);
// 按公开定义的完整内容缓存校验结果；定义变更会产生新键，不能命中旧校验。
// 缓存只存在于当前执行环境，不缓存或共享可变战斗配置。
const fingerprintCache=new Map(),FINGERPRINT_CACHE_LIMIT=512;
async function fingerprint(value){
  const key=stableJSON(value);
  if(fingerprintCache.has(key))return fingerprintCache.get(key);
  const pending=crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)).then(buffer=>[...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,'0')).join(''));
  fingerprintCache.set(key,pending);
  if(fingerprintCache.size>FINGERPRINT_CACHE_LIMIT)fingerprintCache.delete(fingerprintCache.keys().next().value);
  try{return await pending;}catch(error){if(fingerprintCache.get(key)===pending)fingerprintCache.delete(key);throw error;}
}

async function resolveContestCard(entry,problems){
  const ref=entry.reference,key=JSON.stringify([ref.id,ref.upgradeCount]),mapped=contestEngineMap.cards[key],name=entry.record?.name??ref.id;
  if(!mapped||!entry.record||await fingerprint(entry.record)!==mapped[1]){problems.push({kind:'card',name,reason:!mapped?'mapping_missing':'definition_mismatch'});return null;}
  const customizations={},supported=SkillCards.getById(mapped[0]);
  for(const [index,value] of (ref.customizes??[]).entries()){
    const custom=contestEngineMap.customizations[JSON.stringify([value.id,value.customizeCount])],material=entry.customizations[index];
    if(!custom||!material?.record||await fingerprint(material)!==custom[1]||!(supported.availableCustomizations.includes(String(custom[0]))||contestEngineMap.cardCustomizations?.[JSON.stringify([ref.id,ref.upgradeCount,value.id])]===custom[0])||value.customizeCount>Customizations.getById(custom[0]).max){
      const description=material?.effects?.map(effect=>effect.text?.replace(/<[^>]+>/g,'').replace(/\s+\/\s*/g,'').trim()).filter(Boolean).join('、')||material?.record?.description||(material?.grows?.some(grow=>grow.effectType==='ProduceCardGrowEffectType_PlayTriggerChange')?'使用条件変更':value.id);
      problems.push({kind:'customization',name:`${name} · ${description} ×${value.customizeCount}`,reason:!custom?'mapping_missing':'customization_mismatch'});continue;
    }
    customizations[custom[0]]=value.customizeCount;
  }
  return {id:mapped[0],customizations};
}

async function resolveContestItem(entry,problems){
  const mapped=contestEngineMap.items[entry.id];
  if(!mapped||!entry.record||await fingerprint(entry.record)!==mapped[1]){problems.push({kind:'item',name:entry.record?.name??entry.id,reason:!mapped?'mapping_missing':'definition_mismatch'});return null;}
  return mapped[0];
}

// 搜索前逐项复用正式的定义和附魔映射校验，排除不支持项后再生成种群。
export async function validateContestOptimizationOptions(options,onProgress=()=>{}){
  const supported=[],unsupported=[];
  for(const [index,option] of options.entries()){
    const problems=[];if(option.kind==='item')await resolveContestItem(option.entry,problems);else await resolveContestCard(option.entry,problems);
    if(problems.length)unsupported.push({key:option.key,details:problems});else supported.push(option.key);
    if((index+1)%32===0||index+1===options.length)onProgress(index+1);
  }
  return {supported,unsupported};
}

export async function previewContestMultipliers(request){
  const capability=await verifyContestStageCapability(request.stage);
  if(capability.state!=='ready')throw new ContestSimulationError(capability.code??'unsupported_stage');
  const preset=request.stage.preset,source=Stages.getById(preset.id);
  if(request.manualMultipliers)return Object.fromEntries(['vocal','dance','visual'].map(key=>[key,Number.isFinite(request.manualMultipliers[key])&&request.manualMultipliers[key]>=0?request.manualMultipliers[key]/100:null]));
  if(!Number.isFinite(request.supportBonus)||request.supportBonus<0)throw new ContestSimulationError('missing_support_bonus');
  const keys=['vocal','dance','visual'],valid=key=>Number.isSafeInteger(request.params[key])&&request.params[key]>=0;
  // 各属性独立换算；空白值仅用于占位，返回时仍保持未知，不生成战斗编组。
  const idol=new IdolConfig({params:[...keys.map(key=>valid(key)?request.params[key]:0),1],supportBonus:request.supportBonus,pItemIds:[],skillCardIdGroups:[[]],customizationGroups:[[]]});
  const config=new IdolStageConfig(idol,new StageConfig(structuredClone(source)));
  return Object.fromEntries(keys.map(key=>[key,valid(key)?config.typeMultipliers[key]:null]));
}

// 复用正式倍率换算反推最小整数属性，封顶目标取最早达到上限的属性值。
export async function suggestContestParameters(request){
  if(request.manualMultipliers||request.stage.kind!=='contest')throw new ContestSimulationError('unsupported_stage');
  const keys=['vocal','dance','visual'],params=Object.fromEntries(keys.map(key=>[key,0]));
  await previewContestMultipliers({...request,params});
  const order=[...keys].sort((a,b)=>request.stage.preset.criteria[b]-request.stage.preset.criteria[a]),targets=Object.fromEntries(order.map((key,index)=>[key,CONTEST_PARAMETER_TARGETS[index]]));
  const maximum=await previewContestMultipliers({...request,params:Object.fromEntries(keys.map(key=>[key,Number.MAX_SAFE_INTEGER]))}),limited=[];
  for(const key of keys){
    const target=Math.min(targets[key],maximum[key]);if(maximum[key]<targets[key])limited.push(key);
    let low=0,high=Number.MAX_SAFE_INTEGER;
    while(low<high){
      const middle=low+Math.floor((high-low)/2),value=await previewContestMultipliers({...request,params:{...params,[key]:middle}});
      if(value[key]>=target)high=middle;else low=middle+1;
    }
    params[key]=low;
  }
  return {params,targets,limited,multipliers:await previewContestMultipliers({...request,params})};
}

export async function prepareContestSimulation(request){
  if(!['sense','logic','anomaly'].includes(request.plan)||!['vocal','dance','visual','stamina'].every(key=>Number.isFinite(request.params[key])&&request.params[key]>=0)||request.params.stamina<=0||!request.cards.length)throw new ContestSimulationError('invalid_loadout');
  if(!Number.isFinite(request.supportBonus)||request.supportBonus<0)throw new ContestSimulationError('missing_support_bonus');
  const capability=await verifyContestStageCapability(request.stage);
  if(capability.state!=='ready')throw new ContestSimulationError(capability.code??'unsupported_stage');
  const preset=request.stage.preset,source=Stages.getById(preset.id);
  if(source.plan!=='free'&&source.plan!==request.plan)throw new ContestSimulationError('invalid_loadout');
  if(request.stage.setting&&[['handLimit',5],['holdLimit',2],['turnStartDistribute',3],['examTurnEndRecoveryStamina',2]].some(([key,value])=>request.stage.setting[key]!==value))throw new ContestSimulationError('unsupported_stage_rules');
  if(request.manualMultipliers&&!['vocal','dance','visual'].every(key=>Number.isFinite(request.manualMultipliers[key])&&request.manualMultipliers[key]>=0))throw new ContestSimulationError('missing_manual_multipliers');
  const problems=[];
  const cards=await Promise.all(request.cards.map(entry=>resolveContestCard(entry,problems))),defaultCards=await Promise.all(request.defaultCards.map(entry=>resolveContestCard(entry,problems))),items=[];
  for(const entry of request.items){const id=await resolveContestItem(entry,problems);if(id!==null)items.push(id);}
  if(problems.length)throw new ContestSimulationError('unsupported_entities',problems);
  const idol=new IdolConfig({params:['vocal','dance','visual','stamina'].map(key=>request.params[key]),supportBonus:request.supportBonus,pItemIds:items,skillCardIdGroups:[cards.map(card=>card.id)],customizationGroups:[cards.map(card=>card.customizations)]});
  idol.plan=request.plan;
  const config=new IdolStageConfig(idol,new StageConfig(structuredClone(source)));
  if(request.manualMultipliers)config.typeMultipliers=Object.fromEntries(Object.entries(request.manualMultipliers).map(([key,value])=>[key,value/100]));
  if(source.type==='contest'){
    if(!defaultCards.length)throw new ContestSimulationError('missing_default_deck');
    const actual=defaultCards.map(card=>card.id),sorted=values=>[...values].sort((a,b)=>a-b);
    // 相同卡组沿用上游初始化顺序，使固定种子结果可直接对照；不同配置仍使用所选舞台卡组。
    if(JSON.stringify(sorted(actual))!==JSON.stringify(sorted(config.defaultCardIds)))config.defaultCardIds=actual;
  }
  return config;
}

const cardReferences=new Map(Object.entries(contestEngineMap.cards).map(([key,[id]])=>{const [gameId,upgradeCount]=JSON.parse(key);return [String(id),{id:gameId,upgradeCount,customizes:[]}];}));
const itemReferences=new Map(Object.entries(contestEngineMap.items).map(([id,[engineId]])=>[String(engineId),id]));
const stateFields=new Map(['score','stamina','genki','motivation','concentration','goodConditionTurns','perfectConditionTurns','goodImpressionTurns','enthusiasm','fullPowerCharge'].map(key=>[S[key],key]));
// 从本次公开输入恢复实际附魔引用；不把带附魔的记录当成基础卡展示。
function requestCardReference(request){
  const candidates=[];
  for(const {reference} of [...request.cards,...request.defaultCards]){
    const engineId=contestEngineMap.cards[JSON.stringify([reference.id,reference.upgradeCount])]?.[0];
    if(engineId===undefined)continue;
    const customs={};for(const custom of reference.customizes??[]){const id=contestEngineMap.customizations[JSON.stringify([custom.id,custom.customizeCount])]?.[0];if(id!==undefined)customs[id]=custom.customizeCount;}
    candidates.push({engineId,reference,customs:stableJSON(customs)});
  }
  return (id,customs)=>{
    const base=cardReferences.get(String(id))??generatedSkillReference(id);
    if(customs===undefined){
      const matched=candidates.filter(row=>row.engineId===id);
      return matched.length&&matched.every(row=>row.customs===matched[0].customs)?matched[0].reference:base?{...base,customizationsKnown:false}:null;
    }
    const key=stableJSON(customs),matched=candidates.find(row=>row.customs===key&&(row.engineId===id||row.reference.id===base?.id));
    if(matched)return {...matched.reference,upgradeCount:base?.upgradeCount??matched.reference.upgradeCount};
    return Object.keys(customs).length?(base?{...base,customizationsKnown:false}:null):base??null;
  };
}
function summarizeRun(result,referenceFor=(id)=>cardReferences.get(String(id))??generatedSkillReference(id),includeEvents=true){
  let score=0,current,selectedCard;const turns=[],groups=[];
  const describe=(id,customs)=>{const reference=referenceFor(id,customs);return {id,name:SkillCards.getById(id)?.name??String(id),reference,customizationsKnown:Boolean(reference)&&reference.customizationsKnown!==false};};
  const append=event=>{if(current&&includeEvents)(groups.at(-1)?.events??current.events).push(event);};
  const cardEvents=new Set(['drawCard','addCardToHand','addCardToTopOfDeck','addCardToDeckAtRandom','upgradeRandomCardInHand','holdCard','discardCard','moveCardToHand','moveCardToTopOfDeck','moveCardToDeckAtRandom','removeCard']);
  for(const {logType,data} of result.logs){
    if(logType==='startTurn'){current={turn:data.num,attribute:data.type,multiplier:data.multiplier,cards:[],cardDetails:[],changes:[],events:[],score};turns.push(current);groups.length=0;selectedCard=null;continue;}
    if(logType==='hand'){
      selectedCard=data.handCards?.[data.selectedIndex];if(!includeEvents)continue;
      const state=[...stateFields].filter(([field])=>Number.isFinite(data.state?.[field])).map(([field,name])=>({field:name,value:data.state[field]}));
      append({type:'hand',cards:data.handCards.map((card,index)=>({...describe(card.id,card.c??{}),selected:index===data.selectedIndex,estimate:Number.isFinite(data.scores?.[index])?data.scores[index]:null})),state});continue;
    }
    if(logType==='entityStart'&&current){
      const card=data.type==='skillCard'||data.type==='skillCardEffect'?describe(data.id,selectedCard?.id===data.id?selectedCard.c??{}:undefined):null;
      if(data.type==='skillCard'&&data.idx===undefined){current.cards.push(card.name);current.cardDetails.push(card);}
      if(!includeEvents)continue;
      const group={type:'entity',kind:data.type,name:card?.name??(data.type==='pItem'?PItems.getById(data.id)?.name??String(data.id):String(data.id??'')),card,itemId:data.type==='pItem'?itemReferences.get(String(data.id))??null:null,events:[]};append(group);groups.push(group);continue;
    }
    if(logType==='entityEnd'){groups.pop();continue;}
    if(includeEvents&&cardEvents.has(logType)&&data.id!==undefined){append({type:'card',action:logType,card:describe(data.id,data.c)});continue;}
    if(logType==='diff'&&current&&stateFields.has(data.field)&&Number.isFinite(data.prev)&&Number.isFinite(data.next)&&data.prev!==data.next){const change={field:stateFields.get(data.field),previous:data.prev,next:data.next};current.changes.push(change);append({type:'change',...change});}
    if(logType==='diff'&&data.field===S.score){score=data.next;if(current)current.score=score;}
  }
  if(current)current.score=result.score;
  return {score:result.score,turns};
}

// 推荐初筛只收集得分，使用同一引擎与出牌策略，省去逐回合展示和统计归并。
export async function sampleContestScores(request,{runs=16,seed=1,onProgress=()=>{},cardEffects=false}={}){
  if(!Number.isInteger(runs)||runs<1||runs>10000||!Number.isInteger(seed))throw new ContestSimulationError('invalid_options');
  const config=await prepareContestSimulation(request),engine=new StageEngine(config),strategy=new STRATEGIES.HeuristicStrategy(engine);engine.strategy=strategy;resetRand(seed);
  const scores=[],cardEffectScores=[];
  for(let index=0;index<runs;index++){
    const result=await new StagePlayer(engine,strategy).play();
    if(!Number.isFinite(result.score)||result.score<0)throw new ContestSimulationError('engine_failed');
    scores.push(result.score);
    if(cardEffects)cardEffectScores.push(contestCardEffectScore(result.logs,S.score,config.typeMultipliers,request.stage.preset.criteria));
    if((index+1)%Math.max(1,Math.floor(runs/20))===0||index+1===runs)onProgress(index+1);
  }
  return {runs,seed,scores,...(cardEffects?{cardEffectScores}:{})};
}

export async function runContestSimulation(request,{runs=500,seed=1,onProgress=()=>{}}={}){
  if(!Number.isInteger(runs)||runs<1||runs>10000||!Number.isInteger(seed))throw new ContestSimulationError('invalid_options');
  const config=await prepareContestSimulation(request),engine=new StageEngine(config),strategy=new STRATEGIES.HeuristicStrategy(engine);engine.strategy=strategy;resetRand(seed);
  const referenceFor=requestCardReference(request),results=[],statistics=createContestStatistics(S.score);let total=0;
  for(let index=0;index<runs;index++){
    const result=await new StagePlayer(engine,strategy).play();
    if(!Number.isFinite(result.score)||result.score<0)throw new ContestSimulationError('engine_failed');
    statistics.accumulate(result.logs);total+=result.score;results.push(summarizeRun(result,referenceFor));if((index+1)%Math.max(1,Math.floor(runs/50))===0||index+1===runs)onProgress(index+1);
  }
  results.sort((a,b)=>a.score-b.score);const mean=total/runs,representative=results.reduce((best,current)=>Math.abs(current.score-mean)<Math.abs(best.score-mean)?current:best);
  const usage=statistics.finish(entry=>entry.type==='pItem'?{name:PItems.getById(entry.id)?.name??String(entry.id),itemId:itemReferences.get(String(entry.id))??null}:{name:SkillCards.getById(entry.id)?.name??String(entry.id),reference:referenceFor(entry.id,entry.c??{}),customizationCount:Object.values(entry.c??{}).reduce((sum,count)=>sum+count,0)});
  return {runs,seed,statistics:usage,mean:Math.round(mean),minimum:results[0].score,maximum:results.at(-1).score,median:results.length%2?results[(results.length-1)/2].score:(results[results.length/2-1].score+results[results.length/2].score)/2,scores:results.map(result=>result.score),representative,minimumRun:results[0],maximumRun:results.at(-1),turnAverages:representative.turns.map((turn,index)=>({turn:turn.turn,score:results.reduce((sum,run)=>sum+(run.turns[index]?.score??run.score),0)/runs})),multipliers:config.typeMultipliers,supportBonus:request.supportBonus,manualMultipliers:Boolean(request.manualMultipliers),source:contestEngineMap.source};
}

// 每局种子由任务种子和局序号确定，分批、交错执行不会重复样本或改变随机序列。
function indexedSeed(seed,index){
  let value=(seed+Math.imul(index+1,0x9e3779b9))>>>0;
  value=Math.imul(value^(value>>>16),0x85ebca6b);value=Math.imul(value^(value>>>13),0xc2b2ae35);
  return (value^(value>>>16))>>>0;
}
// 初筛仅追加指定局序号范围；跨 Worker 续跑只需得分前缀，不保留成千上万个战斗引擎。
export async function sampleContestScoreBatch(request,{runs,offset=0,seed=1,cardEffects=false,onProgress=()=>{}}={}){
  if(!Number.isInteger(runs)||runs<1||!Number.isInteger(offset)||offset<0||offset+runs>10000||!Number.isInteger(seed))throw new ContestSimulationError('invalid_options');
  const config=await prepareContestSimulation(request),engine=new StageEngine(config),strategy=new STRATEGIES.HeuristicStrategy(engine);engine.strategy=strategy;
  const scores=[],cardEffectScores=[];
  for(let index=offset;index<offset+runs;index++){
    resetRand(indexedSeed(seed,index));const result=await new StagePlayer(engine,strategy).play();
    if(!Number.isFinite(result.score)||result.score<0)throw new ContestSimulationError('engine_failed');
    scores.push(result.score);
    if(cardEffects)cardEffectScores.push(contestCardEffectScore(result.logs,S.score,config.typeMultipliers,request.stage.preset.criteria));
    if(scores.length%Math.max(1,Math.floor(runs/20))===0||scores.length===runs)onProgress(scores.length);
  }
  return {runs,offset,seed,sampling:'indexed-v1',scores,...(cardEffects?{cardEffectScores}:{})};
}
export async function createContestSimulationSession(request,{seed=1,details=true}={}){
  if(!Number.isInteger(seed))throw new ContestSimulationError('invalid_options');
  const config=await prepareContestSimulation(request),engine=new StageEngine(config),strategy=new STRATEGIES.HeuristicStrategy(engine);engine.strategy=strategy;
  const referenceFor=requestCardReference(request),scores=[],turnTotals=[],statistics=details?createContestStatistics(S.score):null;let total=0;
  async function play(index){resetRand(indexedSeed(seed,index));return new StagePlayer(engine,strategy).play();}
  return {
    async advance(runs,onProgress=()=>{}){
      if(!Number.isInteger(runs)||runs<scores.length||runs>10000)throw new ContestSimulationError('invalid_options');
      const initial=scores.length;
      while(scores.length<runs){
        const result=await play(scores.length);
        if(!Number.isFinite(result.score)||result.score<0)throw new ContestSimulationError('engine_failed');
        if(details){
          statistics.accumulate(result.logs);const summary=summarizeRun(result,undefined,false);
          // 有额外回合时，较短对局在其结束后沿用最终分数。
          while(turnTotals.length<summary.turns.length)turnTotals.push(total);
          for(let i=0;i<turnTotals.length;i++)turnTotals[i]+=summary.turns[i]?.score??result.score;
        }
        scores.push(result.score);total+=result.score;
        if((scores.length-initial)%Math.max(1,Math.floor((runs-initial)/20))===0||scores.length===runs)onProgress(scores.length-initial);
      }
      return {runs:scores.length,seed,sampling:'indexed-v1',scores:[...scores]};
    },
    async finish(){
      if(!details||!scores.length)throw new ContestSimulationError('invalid_options');
      const runs=scores.length,mean=total/runs,ordered=scores.map((score,index)=>({score,index})).sort((a,b)=>a.score-b.score);
      const chosen=ordered.reduce((best,row)=>Math.abs(row.score-mean)<Math.abs(best.score-mean)?row:best),indices=[chosen.index,ordered[0].index,ordered.at(-1).index],summaries=new Map();
      // 仅重现展示需要的三局，避免为每个候选保存数千份逐回合日志；不计入得分样本。
      for(const index of new Set(indices))summaries.set(index,summarizeRun(await play(index),referenceFor));
      const describe=entry=>entry.type==='pItem'?{name:PItems.getById(entry.id)?.name??String(entry.id),itemId:itemReferences.get(String(entry.id))??null}:{name:SkillCards.getById(entry.id)?.name??String(entry.id),reference:referenceFor(entry.id,entry.c??{}),customizationCount:Object.values(entry.c??{}).reduce((sum,count)=>sum+count,0)};
      const representative=summaries.get(chosen.index);
      return {runs,seed,sampling:'indexed-v1',detailRuns:summaries.size,statistics:statistics.finish(describe),mean:Math.round(mean),minimum:ordered[0].score,maximum:ordered.at(-1).score,median:runs%2?ordered[(runs-1)/2].score:(ordered[runs/2-1].score+ordered[runs/2].score)/2,scores:ordered.map(row=>row.score),representative,minimumRun:summaries.get(indices[1]),maximumRun:summaries.get(indices[2]),turnAverages:representative.turns.map((turn,index)=>({turn:turn.turn,score:turnTotals[index]/runs})),multipliers:config.typeMultipliers,supportBonus:request.supportBonus,manualMultipliers:Boolean(request.manualMultipliers),source:contestEngineMap.source};
    },
  };
}

// 普通舞台模拟按固定局序号分块，多个 Worker 只返回紧凑统计，不搬运完整日志。
export async function runContestSimulationBatch(request,{runs,offset=0,seed=1,onProgress=()=>{}}={}){
  if(!Number.isInteger(runs)||runs<1||!Number.isInteger(offset)||offset<0||offset+runs>10000||!Number.isInteger(seed))throw new ContestSimulationError('invalid_options');
  const config=await prepareContestSimulation(request),engine=new StageEngine(config),strategy=new STRATEGIES.HeuristicStrategy(engine);engine.strategy=strategy;
  const scores=[],turnTotals=[],statistics=createContestStatistics(S.score);let total=0;
  for(let index=offset;index<offset+runs;index++){
    resetRand(indexedSeed(seed,index));const result=await new StagePlayer(engine,strategy).play();
    if(!Number.isFinite(result.score)||result.score<0)throw new ContestSimulationError('engine_failed');
    statistics.accumulate(result.logs);const summary=summarizeRun(result,undefined,false);
    while(turnTotals.length<summary.turns.length)turnTotals.push(total);
    for(let turn=0;turn<turnTotals.length;turn++)turnTotals[turn]+=summary.turns[turn]?.score??result.score;
    scores.push(result.score);total+=result.score;
    if(scores.length%Math.max(1,Math.floor(runs/4))===0||scores.length===runs)onProgress(scores.length);
  }
  return {offset,runs,seed,sampling:'indexed-v1',scores,total,turnTotals,statistics:statistics.snapshot()};
}

export async function finishContestSimulationBatches(request,batches,{seed=1}={}){
  const referenceFor=requestCardReference(request),orderedBatches=[...batches].sort((a,b)=>a.offset-b.offset),scores=[],turnTotals=[],statistics=createContestStatistics(S.score);let total=0;
  for(const batch of orderedBatches){
    if(batch.offset!==scores.length||batch.seed!==seed||batch.runs!==batch.scores.length)throw new ContestSimulationError('invalid_options');
    statistics.mergeSnapshot(batch.statistics);
    while(turnTotals.length<batch.turnTotals.length)turnTotals.push(total);
    for(let turn=0;turn<turnTotals.length;turn++)turnTotals[turn]+=batch.turnTotals[turn]??batch.total;
    scores.push(...batch.scores);total+=batch.total;
  }
  if(!scores.length)throw new ContestSimulationError('invalid_options');
  const config=await prepareContestSimulation(request),engine=new StageEngine(config),strategy=new STRATEGIES.HeuristicStrategy(engine);engine.strategy=strategy;
  const runs=scores.length,mean=total/runs,ordered=scores.map((score,index)=>({score,index})).sort((a,b)=>a.score-b.score);
  const chosen=ordered.reduce((best,row)=>Math.abs(row.score-mean)<Math.abs(best.score-mean)?row:best),indices=[chosen.index,ordered[0].index,ordered.at(-1).index],summaries=new Map();
  for(const index of new Set(indices)){resetRand(indexedSeed(seed,index));summaries.set(index,summarizeRun(await new StagePlayer(engine,strategy).play(),referenceFor));}
  const describe=entry=>entry.type==='pItem'?{name:PItems.getById(entry.id)?.name??String(entry.id),itemId:itemReferences.get(String(entry.id))??null}:{name:SkillCards.getById(entry.id)?.name??String(entry.id),reference:referenceFor(entry.id,entry.c??{}),customizationCount:Object.values(entry.c??{}).reduce((sum,count)=>sum+count,0)};
  const representative=summaries.get(chosen.index);
  return {runs,seed,sampling:'indexed-v1',detailRuns:summaries.size,statistics:statistics.finish(describe),mean:Math.round(mean),minimum:ordered[0].score,maximum:ordered.at(-1).score,median:runs%2?ordered[(runs-1)/2].score:(ordered[runs/2-1].score+ordered[runs/2].score)/2,scores:ordered.map(row=>row.score),representative,minimumRun:summaries.get(indices[1]),maximumRun:summaries.get(indices[2]),turnAverages:representative.turns.map((turn,index)=>({turn:turn.turn,score:turnTotals[index]/runs})),multipliers:config.typeMultipliers,supportBonus:request.supportBonus,manualMultipliers:Boolean(request.manualMultipliers),source:contestEngineMap.source};
}
