import test from 'node:test';
import assert from 'node:assert/strict';
import {optimizationConfigurationKey,optimizationMemoryStructureKey,optimizationFinalDiagnostics} from '../domain/contest-optimization-diagnostics.mjs';
const memory=(id,upgradeCount=0)=>({characterId:'test',vocal:100,dance:200,visual:300,stamina:40,grade:15,examBattleProduceCards:[{id,upgradeCount,customizes:[]}],examBattleProduceItemIds:[]});
test('精确身份区分强化、附魔、属性、顺序和主副归属，排除账号字段',()=>{
  const a=[memory('a'),memory('b')],b=structuredClone(a);b[0].publicUserId='private';b[0].userMemoryId='private';
  assert.equal(optimizationConfigurationKey(a),optimizationConfigurationKey(b));assert.ok(!optimizationConfigurationKey(b).includes('private'));
  for(const change of [v=>v[0].vocal++,v=>v[0].examBattleProduceCards[0].upgradeCount++,v=>v[0].examBattleProduceCards[0].customizes.push({id:'x',customizeCount:1}),v=>v.reverse()]){
    const copy=structuredClone(a);change(copy);assert.notEqual(optimizationConfigurationKey(a),optimizationConfigurationKey(copy));
  }
  const upgraded=[memory('a',1),memory('b')];assert.equal(optimizationMemoryStructureKey(a),optimizationMemoryStructureKey(upgraded));
});
test('结构分差采用最终复评的最佳同结构候选，不自设可用阈值',()=>{
  const rows=[{key:'a',memories:[memory('a'),memory('b')],stats:{score:100},result:{runs:500}}, {key:'b',memories:[memory('a',1),memory('b')],stats:{score:99},result:{runs:500}}, {key:'c',memories:[memory('c'),memory('b')],stats:{score:95},result:{runs:500}}];
  const details=optimizationFinalDiagnostics(rows);assert.equal(details.finalists.length,3);assert.equal(details.structures.length,2);
  assert.equal(details.champion.key,'a');assert.equal(details.structures[1].gap,-5);assert.equal(details.structures[1].relativeGap,-.05);assert.equal(details.structures[1].rank,3);
  assert.equal(optimizationFinalDiagnostics([{...rows[0],stats:{score:0}}]).champion.relativeGap,null);
});
