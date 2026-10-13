// 只读取已授权的本地模拟副本；不读取原始账号、凭据或外部安装目录。
import fs from 'node:fs/promises';
import path from 'node:path';
import {producerLevelCap} from '../domain/producer-level.mjs';
import {parseSnapshot} from '../domain/model.mjs';
import {parseSelectionSnapshot} from '../domain/selection-memories.mjs';
import {prepareSelectionDetail} from '../domain/selection-details.mjs';
import {prepareAccountDirectory,combineAccountDirectory} from '../domain/account-import.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,all)=>index%2?pairs:[...pairs,[value,all[index+1]]],[]));
if(!args['--source']||!args['--public']||!args['--output'])throw Error('需要 --source、--public 和 --output');
const files=async directory=>{const output=[];for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())output.push(...await files(file));else if(entry.name==='snapshot.json')output.push(file);}return output.sort();};
const publicStrings=new Set();
function publicValues(value){if(typeof value==='string')publicStrings.add(value);else if(Array.isArray(value))value.forEach(publicValues);else if(value&&typeof value==='object')Object.values(value).forEach(publicValues);}
const levelCaps=[];
for(const entry of await fs.readdir(args['--public']))if(entry.endsWith('.json')){
  const value=JSON.parse(await fs.readFile(path.join(args['--public'],entry),'utf8'));publicValues(value);
  const cap=producerLevelCap(value.progression?.tables?.ProducerLevel??value.tables?.ProducerLevel);if(cap)levelCaps.push(cap);
}
if(!levelCaps.length||levelCaps.some(cap=>cap.level!==levelCaps[0].level||cap.totalExp!==levelCaps[0].totalExp))throw Error('公开配置缺少唯一有效的 P 等级上限');
const producerExp=levelCaps[0].totalExp;
const documents=await Promise.all((await files(args['--source'])).map(async file=>JSON.parse(await fs.readFile(file,'utf8'))));
const accountId='synthetic-preview-account',maps=new Map(),removed=new Set();let clock=0;
const times=new Set(['shotTime','createdTime','primaStellaUpgradedTime','expiryTime','clearedTime','lastUsedTime']);
function alias(kind,value){if(!value)return '';removed.add(value);if(!maps.has(kind))maps.set(kind,new Map());const map=maps.get(kind);if(!map.has(value))map.set(value,`preview-${kind}-${String(map.size+1).padStart(5,'0')}`);return map.get(value);}
function sanitize(value){
  if(Array.isArray(value))return value.map(sanitize);if(!value||typeof value!=='object')return value;
  const output={};for(const [key,entry] of Object.entries(value)){
    if(key==='publicUserId'){removed.add(entry);output[key]=accountId;}
    else if(key==='userMemoryId')output[key]=alias('memory',entry);
    else if(key==='userSelectionMemoryId')output[key]=alias('selection',entry);
    else if(key==='eventExpiredSelectionMemoryIds')output[key]=entry.map(id=>alias('selection',id));
    else if(['researchId','produceId','memoryTagId'].includes(key))output[key]=entry&&!publicStrings.has(entry)?alias(key,entry):entry;
    else if(key==='assetId'){if(entry)removed.add(entry);output[key]='';}
    else if(key==='captured_at')output[key]='2025-02-01T00:00:00.000Z';
    else if(times.has(key))output[key]=entry>0?Date.UTC(key==='expiryTime'?2030:2025,0,1)+(++clock)*60000:0;
    else output[key]=sanitize(entry);
  }return output;
}
const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));
const card=value=>value===null?null:{...pick(value,['id','upgradeCount']),customizes:value.customizes.map(entry=>pick(entry,['id','customizeCount']))};
const skill=rows=>rows.map(value=>pick(value,['id','level','triggerCount']));
const cleaned=[];
for(const raw of documents){
  const value=sanitize(raw);
  if(value.source==='user_get'){
    // 预览经验使用公开等级上限，避免依赖模拟来源是否包含该字段。
    value.producerExp=producerExp;
    cleaned.push(parseSnapshot(value));
  }
  else if(value.source==='selection_memory_list')cleaned.push(parseSelectionSnapshot(value));
  else if(value.source==='selection_memory_get'){
    await prepareSelectionDetail(value);
    cleaned.push({...pick(value,['format','schema_version','source','publicUserId','captured_at','userSelectionMemoryId']),
      memories:value.memories.map(slot=>({...pick(slot,['number','isRental','userMemoryId']),memory:slot.memory===null?null:{...pick(slot.memory,['characterId','idolCardId','grade','power','planType','vocal','dance','visual','stamina','produceCardPhaseType']),produceCard:card(slot.memory.produceCard),abilities:slot.memory.abilities.map(entry=>pick(entry,['id','level']))},memoryAbilities:skill(slot.memoryAbilities)})),
      supportCards:value.supportCards.map(slot=>({...pick(slot,['number','supportCardId','level','levelLimitRank','isRental']),produceSkills:skill(slot.produceSkills),eventDetailIds:[...slot.eventDetailIds]}))});
  }else throw Error('不支持的模拟快照来源');
}
const serialized=JSON.stringify({format:1,accountId,documents:cleaned});
for(const value of removed)if(value&&serialized.includes(JSON.stringify(value)))throw Error('预览数据仍包含待替换标识');
if(/"(?:token|cookie|authorization|imagePath|produceHighScoreId)"/i.test(serialized))throw Error('预览数据包含禁止字段');
const bundle=await prepareAccountDirectory(cleaned),result=combineAccountDirectory(bundle);
await fs.mkdir(path.dirname(args['--output']),{recursive:true});await fs.writeFile(args['--output'],serialized+'\n');
console.log(JSON.stringify({documents:cleaned.length,memories:result.snapshot.memories.length,selections:result.selectionSnapshot.count,details:result.selectionSnapshot.details.length,validation:'合同、详情关联、直接标识清理检查通过'}));
