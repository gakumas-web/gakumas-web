import {installMaster} from '../domain/catalog.mjs';
import {installEffectPresentation} from '../ui/effect-view.mjs';
import {takeMaster} from './master-prefetch.mjs';

export const masterDependencies={
  catalog:['catalog'],
  achievements:['catalog','achievements'],
  idolCardSkins:['catalog'],
  memories:['catalog','effects','abilities'],
  selectionMemories:['catalog','effects','abilities','progression'],
  idolCards:['catalog','effects','abilities','progression'],
  supportCards:['catalog','effects','abilities','progression'],
  full:['catalog','effects','abilities','progression','achievements'],
};
const packages=new Map(),pending=new Map(),installed=new Set();
let revision;
export const masterReadyFor=scope=>masterDependencies[scope].every(name=>installed.has(name));
export const masterLoadingFor=scope=>masterDependencies[scope].some(name=>pending.has(name));
function loadPackage(name){
  if(packages.has(name))return Promise.resolve(packages.get(name));
  if(!pending.has(name)){
    const task=takeMaster(name).then(input=>{
      // 发布身份由已校验的内容管理器提供；各分包允许有不同业务版本。
      const releaseRevision=input.releaseRevision??input.revision;
      if(input.scope!==name||typeof input.revision!=='string'||!input.revision||revision&&revision!==releaseRevision)throw new Error('master_version_mismatch');
      revision=releaseRevision;packages.set(name,input);return input;
    }).finally(()=>pending.delete(name));
    pending.set(name,task);
  }
  return pending.get(name);
}
// 每页所需分包全部就绪后统一安装；合并保留其它页面已加载的数据。
export async function loadMaster(scope='full'){
  if(masterReadyFor(scope))return;
  await Promise.all(masterDependencies[scope].map(loadPackage));
  const input={tables:Object.fromEntries(['MemoryAbility','ProduceSkill','ProduceEffect','ProduceCard','ProduceItem','ProduceExamEffect'].map(name=>[name,[]]))};
  for(const data of packages.values()){
    const {tables,...rest}=data;Object.assign(input,rest);if(tables)Object.assign(input.tables,tables);
  }
  installMaster(input);installEffectPresentation(input);
  for(const name of packages.keys())installed.add(name);
}
