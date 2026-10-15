// 使用候选站点的公开资料和正式校验器审计；不读取账号库存，不访问远程服务。
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
const {values:args}=parseArgs({options:{site:{type:'string'},program:{type:'string'},report:{type:'string'},baseline:{type:'string'},'write-baseline':{type:'string'},strict:{type:'boolean',default:false}}});
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
const result=await validateContestOptimizationOptions(options),unsupported=result.unsupported.map(row=>{const option=byKey.get(row.key);return {...row,fingerprint:hash(stableJSON(option.entry)),id:option.entry.reference?.id??option.entry.id,upgradeCount:option.entry.reference?.upgradeCount??null};}).sort((a,b)=>a.key.localeCompare(b.key));
const baseline=args.baseline?await read(args.baseline):null;
if(baseline&&(baseline.format!==1||!Array.isArray(baseline.unsupported)))throw new Error('不支持项基准格式无效');
const known=new Map((baseline?.unsupported??[]).map(row=>[row.key,row.fingerprint])),current=new Map(unsupported.map(row=>[row.key,row.fingerprint]));
const added=unsupported.filter(row=>known.get(row.key)!==row.fingerprint),resolved=(baseline?.unsupported??[]).filter(row=>!current.has(row.key));
// 卡牌支持不能证明最新赛季可用；使用实际内容和正式倍率入口核对默认赛季。
const stages=catalog.contestCatalog().choices.filter(stage=>stage.kind==='contest'),latest=Math.max(...stages.map(stage=>stage.seasonNumber)),stageChecks=[];
for(const stage of stages.filter(stage=>stage.seasonNumber===latest)){
  try{
    const request={...createContestSimulationRequest([],stage,[]),params:{vocal:1500,dance:1500,visual:1500},supportBonus:0};
    if(!stage.preset||Object.values(stage.preset.turnCounts).reduce((sum,value)=>sum+value,0)!==stage.turn)throw new Error('stage_reference_mismatch');
    const multipliers=await previewContestMultipliers(request),suggested=await suggestContestParameters(request);
    if(!Object.values(multipliers).every(Number.isFinite)||!Object.values(suggested.params).every(Number.isSafeInteger))throw new Error('invalid_stage_parameters');
    stageChecks.push({id:stage.id,supported:true});
  }catch(error){stageChecks.push({id:stage.id,supported:false,reason:error.code??error.message});}
}
const report={format:1,engine:contestEngineMap.source,engineSha256:hash(await fs.readFile(path.join(program,'domain/upstream-contest-engine.mjs'))),mappingSha256:hash(await fs.readFile(path.join(program,'domain/contest-engine-map.mjs'))),contentVersion:manifest.version,packages,summary:{total:options.length,supported:result.supported.length,unsupported:unsupported.length,newUnsupported:added.length,resolved:resolved.length,stageFailures:stageChecks.filter(row=>!row.supported).length},stageChecks,unsupported,newUnsupported:added,resolved};
await fs.mkdir(path.dirname(path.resolve(args.report)),{recursive:true});await fs.writeFile(args.report,JSON.stringify(report,null,2)+'\n');
if(args['write-baseline'])await fs.writeFile(args['write-baseline'],JSON.stringify({format:1,description:'已记录的当前不支持范围；新增或定义变化的不支持项必须复核，发布流程不得自动覆盖。',unsupported},null,2)+'\n');
console.log(JSON.stringify(report.summary));
if(args.strict&&unsupported.length||baseline&&added.length||report.summary.stageFailures)process.exitCode=1;
