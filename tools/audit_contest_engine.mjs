// 使用候选站点的公开资料和正式校验器审计；不读取账号库存，不访问远程服务。
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
const {values:args}=parseArgs({options:{site:{type:'string'},program:{type:'string'},report:{type:'string'},baseline:{type:'string'},'stage-ids':{type:'string'},'baseline-ready-ids':{type:'string'},'baseline-program':{type:'string'},'baseline-snapshot':{type:'string'},'write-baseline':{type:'string'},strict:{type:'boolean',default:false}}});
if(!args.site||!args.report)throw new Error('需要 --site 公开站点目录和 --report 报告路径');
const site=path.resolve(args.site),program=path.resolve(args.program??site),hash=data=>createHash('sha256').update(data).digest('hex');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const local=(base,name)=>{if(/^[a-z]+:/i.test(name))throw new Error('审计仅接受已安装的本地公开资料');const result=path.resolve(base,name);if(!result.startsWith(site+path.sep))throw new Error('资料路径越出站点');return result;};
const config=await import(pathToFileURL(path.join(site,'content-config.mjs'))),channelPath=local(site,config.contentConfig.channelURL),channel=await read(channelPath),manifestPath=local(path.dirname(channelPath),channel.manifest),manifestBytes=await fs.readFile(manifestPath);
if(hash(manifestBytes)!==channel.sha256)throw new Error('内容清单哈希不匹配');
const manifest=JSON.parse(manifestBytes),input={tables:Object.fromEntries(['MemoryAbility','ProduceSkill','ProduceEffect','ProduceCard','ProduceItem','ProduceExamEffect'].map(name=>[name,[]]))},packages={};
for(const name of ['catalog','effects','abilities','progression']){
  const file=name+'.json',bytes=await fs.readFile(local(path.dirname(manifestPath),file));if(hash(bytes)!==manifest.files[file]?.sha256)throw new Error(file+' 哈希不匹配');
  const {tables,...rest}=JSON.parse(bytes);Object.assign(input,rest);Object.assign(input.tables,tables??{});packages[name]={revision:rest.revision,sha256:hash(bytes)};
}
const module=relative=>import(pathToFileURL(path.join(program,relative)));
const catalog=await module('domain/catalog.mjs'),{contestCompatibilityOptions}=await module('application/contest-compatibility-input.mjs'),{validateContestOptimizationOptions,stableJSON,previewContestMultipliers,suggestContestParameters}=await module('domain/contest-engine-runner.mjs'),{contestEngineMap}=await module('domain/contest-engine-map.mjs'),{createContestSimulationRequest}=await module('domain/contest-engine-request.mjs');
catalog.installMaster(input);const pool=catalog.contestCustomizationCatalog(),options=contestCompatibilityOptions({...pool,items:pool.items.filter(item=>item.metadata.use==='battle')}),byKey=new Map(options.map(option=>[option.key,option]));
const result=await validateContestOptimizationOptions(options),candidatePoolChecked=true,unsupported=result.unsupported.map(row=>{const option=byKey.get(row.key);return {...row,fingerprint:hash(stableJSON(option.entry)),id:option.entry.reference?.id??option.entry.id,upgradeCount:option.entry.reference?.upgradeCount??null};}).sort((a,b)=>a.key.localeCompare(b.key));
const baseline=args.baseline?await read(args.baseline):null;
if(baseline&&(baseline.format!==1||!Array.isArray(baseline.unsupported)))throw new Error('不支持项基准格式无效');
const known=new Map((baseline?.unsupported??[]).map(row=>[row.key,row.fingerprint])),current=new Map(unsupported.map(row=>[row.key,row.fingerprint]));
const added=unsupported.filter(row=>known.get(row.key)!==row.fingerprint),resolved=(baseline?.unsupported??[]).filter(row=>!current.has(row.key));
// 完整候选池始终执行；明确缺少输入的舞台保留为待补，其余失败继续阻止发布。
const {verifyEngineStageCapability:verifyContestStageCapability}=await module('domain/contest-stage-engine-capability.mjs');
const stages=catalog.contestCatalog().choices.filter(stage=>stage.kind==='contest'),latest=Math.max(...stages.map(stage=>stage.seasonNumber)),stageChecks=[],pendingStages=[];
let baselineReadyStageIds=[],deployedBaseline=null,baseline_snapshot_sha256=null;
if(args['baseline-snapshot']){
  if(args['baseline-ready-ids']||args['baseline-program'])throw new Error('已部署基线不能与其它基线范围混用');
  const raw=await fs.readFile(args['baseline-snapshot']);if(raw.length>65536)throw new Error('已部署基线过大');
  deployedBaseline=JSON.parse(raw);baseline_snapshot_sha256=hash(raw);
  const {fingerprint,...identity}=deployedBaseline,fields=['release_sha256','channel_sha256','content_manifest_sha256','progression_sha256','effects_sha256','engine_sha256','mapping_sha256','catalog_sha256'];
  const expectedKeys=['format','schema_version','state','site_url','engine_commit','readyStageIds','fingerprint',...fields];
  if(stableJSON(Object.keys(deployedBaseline).sort())!==stableJSON(expectedKeys.sort()))throw new Error('已部署基线字段无效');
  const siteURL=new URL(deployedBaseline.site_url);
  if(siteURL.protocol!=='https:'||siteURL.username||siteURL.password||siteURL.search||siteURL.hash||/\s/.test(deployedBaseline.site_url))throw new Error('已部署基线站点无效');
  if(deployedBaseline.format!=='gakumas-contest-deployed-baseline'||deployedBaseline.schema_version!==1||!['ready','bootstrap'].includes(deployedBaseline.state)||hash(stableJSON(identity))!==fingerprint)throw new Error('已部署基线身份无效');
  if(deployedBaseline.state==='ready'&&(!/^[a-f0-9]{40}$/.test(deployedBaseline.engine_commit)||fields.some(key=>!/^[a-f0-9]{64}$/.test(deployedBaseline[key]))))throw new Error('已部署基线哈希无效');
  if(deployedBaseline.state==='bootstrap'&&(deployedBaseline.readyStageIds?.length||deployedBaseline.engine_commit!==null||fields.some(key=>deployedBaseline[key]!==null)))throw new Error('首次部署基线必须为空');
  baselineReadyStageIds=deployedBaseline.readyStageIds;
}else if(args['baseline-ready-ids'])baselineReadyStageIds=await read(args['baseline-ready-ids']);
else if(args['baseline-program']){
  const {verifyEngineStageCapability:verifyBaseline}=await import(pathToFileURL(path.join(path.resolve(args['baseline-program']),'domain/contest-stage-engine-capability.mjs')));
  for(const stage of stages)if((await verifyBaseline(stage)).state==='ready')baselineReadyStageIds.push(stage.id);
}
if(!Array.isArray(baselineReadyStageIds)||new Set(baselineReadyStageIds).size!==baselineReadyStageIds.length||baselineReadyStageIds.some(id=>!stages.some(stage=>stage.id===id)))throw new Error('基线可用舞台范围无效');
const readySeasons=stages.filter(stage=>baselineReadyStageIds.includes(stage.id)).map(stage=>stage.seasonNumber),latestBaselineReady=Math.max(...readySeasons);
const mappedSeasons=stages.filter(stage=>stage.preset&&contestEngineMap.stages[stage.preset.id]).map(stage=>stage.seasonNumber),latestMapped=Math.max(...mappedSeasons);
const lostReadyStageIds=[];
for(const id of baselineReadyStageIds)if((await verifyContestStageCapability(stages.find(stage=>stage.id===id))).state!=='ready')lostReadyStageIds.push(id);
let selectedStages=stages.filter(stage=>stage.seasonNumber===latest||stage.seasonNumber===latestBaselineReady||stage.seasonNumber===latestMapped||lostReadyStageIds.includes(stage.id));
if(args['stage-ids']){
  const ids=await read(args['stage-ids']),byId=new Map(stages.map(stage=>[stage.id,stage]));
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^contest:pvp_rate_config-[1-9][0-9]*:[0-9]+$/.test(id)||!byId.has(id))||byId.size!==stages.length)throw new Error('显式舞台范围无效或舞台不存在');
  if(lostReadyStageIds.some(id=>!ids.includes(id)))throw new Error('显式范围遗漏已可用舞台的能力退化');
  selectedStages=ids.map(id=>byId.get(id));
}
for(const stage of selectedStages){
  try{
    const capability=await verifyContestStageCapability(stage);
    if(capability.state==='pending'){
      if(baselineReadyStageIds.includes(stage.id))throw new Error('ready_stage_regressed');
      pendingStages.push({id:stage.id,reasons:capability.reasons});continue;
    }
    if(capability.state!=='ready')throw new Error(capability.code??'unsupported_stage');
    const request={...createContestSimulationRequest([],stage,[]),params:{vocal:1500,dance:1500,visual:1500},supportBonus:0};
    const multipliers=await previewContestMultipliers(request),suggested=await suggestContestParameters(request);
    if(!Object.values(multipliers).every(Number.isFinite)||!Object.values(suggested.params).every(Number.isSafeInteger))throw new Error('invalid_stage_parameters');
    stageChecks.push({id:stage.id,supported:true});
  }catch(error){stageChecks.push({id:stage.id,supported:false,reason:error.code??error.message});}
}
const report={format:1,state:stageChecks.some(row=>!row.supported)||added.length?'blocked':pendingStages.length?'partial':'passed',candidatePoolChecked,baseline_snapshot_sha256,deployedBaseline,expectedStageIds:selectedStages.map(stage=>stage.id),pendingStages,baselineReadyStageIds,engine:contestEngineMap.source,engineSha256:hash(await fs.readFile(path.join(program,'domain/upstream-contest-engine.mjs'))),mappingSha256:hash(await fs.readFile(path.join(program,'domain/contest-engine-map.mjs'))),contentVersion:manifest.version,packages,summary:{total:options.length,supported:result.supported.length,unsupported:unsupported.length,newUnsupported:added.length,resolved:resolved.length,stageFailures:stageChecks.filter(row=>!row.supported).length},stageChecks,unsupported,newUnsupported:added,resolved};
await fs.mkdir(path.dirname(path.resolve(args.report)),{recursive:true});await fs.writeFile(args.report,JSON.stringify(report,null,2)+'\n');
if(args['write-baseline'])await fs.writeFile(args['write-baseline'],JSON.stringify({format:1,description:'已记录的当前不支持范围；新增或定义变化的不支持项必须复核，发布流程不得自动覆盖。',unsupported},null,2)+'\n');
console.log(JSON.stringify(report.summary));
if(args.strict&&unsupported.length||baseline&&added.length||report.summary.stageFailures)process.exitCode=1;
