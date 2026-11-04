// 候选回归显式绑定已经校验的当前公开内容；普通 CI 继续使用固定测试样本。
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {installMaster,contestSimulationReference} from '../domain/catalog.mjs';
import {contestEngineMap} from '../domain/contest-engine-map.mjs';

const effectsPath=process.env.GAKUMAS_CONTEST_TEST_EFFECTS;
let effects=null;
if(effectsPath){
  const raw=fs.readFileSync(effectsPath),hash=createHash('sha256').update(raw).digest('hex');
  effects=JSON.parse(raw);
  if(hash!==contestEngineMap.source.effectsSha256||effects.revision!==contestEngineMap.source.effectsRevision)throw new Error('候选回归内容与生成映射身份不一致');
}
const install=()=>{if(effects)installMaster({tables:{ProduceEffect:[],...effects.tables},semantics:effects.semantics});};
function resolveEntry(entry){
  const kind=entry.reference?'card':'item',current=contestSimulationReference(kind,entry.reference??entry.id);
  if(!current.record||(current.customizations??[]).some(material=>!material.record||[...material.grows,...material.effects,...(material.triggers??[])].some(value=>!value)))throw new Error('候选回归缺少原身份或附魔等级：'+JSON.stringify(entry.reference??entry.id));
  return {...entry,...current};
}
function bind(value){
  if(Array.isArray(value))return value.map(bind);
  if(!value||typeof value!=='object')return value;
  if('record' in value&&(value.reference||typeof value.id==='string'))return resolveEntry(value);
  return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,bind(entry)]));
}
export function bindContestEntry(entry){
  if(!effects)return entry;
  install();return resolveEntry(entry);
}
export function readContestFixture(url){
  const fixture=JSON.parse(fs.readFileSync(url));
  if(!effects)return fixture;
  install();return bind(fixture);
}
