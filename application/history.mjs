import {parseSnapshot,configKey,digest,InputError} from '../domain/model.mjs';
import {configurationSignature} from '../domain/semantic-text.mjs';

export function memoryState(memory) {
  const {key,ordinal,config,...fields}=memory;
  return configurationSignature(fields);
}
export async function snapshotId(snapshot) { return digest(configurationSignature(snapshot)); }
export async function restorePrepared(input) {
  if(!input || !Array.isArray(input.memories) || input.memories.some(m=>!(/^[a-f0-9]{64}$/.test(m.key))))throw new InputError();
  const clean=parseSnapshot({...input,memories:input.memories.map(m=>({...m,userMemoryId:m.key}))});
  clean.memories=clean.memories.map(({userMemoryId,...m},i)=>({...m,key:userMemoryId,ordinal:i+1,config:configKey(m)}));
  clean.fingerprint=await digest(clean.memories.map(m=>m.key).sort().join('|'));return clean;
}
export function snapshotDifference(before,after) {
  const old=new Map(before.memories.map(m=>[m.key,m])),now=new Map(after.memories.map(m=>[m.key,m]));
  const added=[],missing=[],changed=[];
  for(const [key,m] of now)if(!old.has(key))added.push(m);else if(memoryState(old.get(key))!==memoryState(m))changed.push(m);
  for(const [key,m] of old)if(!now.has(key))missing.push(m);
  const catalogs=['idolCards','supportCards'].map(field=>({field,recorded:before[field]!==undefined&&after[field]!==undefined,
    changed:configurationSignature(before[field])!==configurationSignature(after[field]),before:before[field]?.length,after:after[field]?.length}));
  return {added,missing,changed,catalogs};
}

