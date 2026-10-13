import {cardCustomizations,contestSimulationReference} from '../domain/catalog.mjs';
import {optimizationCardKey} from '../domain/contest-optimization.mjs';

// 审计原卡和每项附魔的所有等级；组合合法性仍由正式编组规则控制。
export function contestCompatibilityOptions(catalog){
  const options=new Map();
  const add=reference=>{const key=optimizationCardKey(reference);if(!options.has(key))options.set(key,{key,kind:'card',entry:contestSimulationReference('card',reference)});};
  for(const choice of catalog.cards)for(const version of choice.versions){
    const reference={id:choice.id,upgradeCount:version.upgradeCount,customizes:[]};add(reference);
    for(const option of cardCustomizations(reference)?.options??[])for(const level of option.levels)add({...reference,customizes:[{id:option.id,customizeCount:level.level}]});
  }
  for(const choice of catalog.items){const key=`item:${choice.id}`;options.set(key,{key,kind:'item',entry:contestSimulationReference('item',choice.id)});}
  return [...options.values()];
}
