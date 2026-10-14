import test from 'node:test';
import assert from 'node:assert/strict';
import {optimizationCompetition,optimizationStructureKey,diverseOptimizationRows,optimizationRefinements} from '../domain/contest-optimization-selection.mjs';
import {recommendationStatistics} from '../domain/contest-recommendations.mjs';
const row=(key,structure,scores)=>({key,structure,scores,stats:recommendationStatistics(scores)});
test('结构身份保留主副归属，忽略同卡强化附魔及组内排列',()=>{
  const variants=Array.from({length:24},(_,index)=>({reference:{id:String(index%12),upgradeCount:Math.floor(index/12)}})),a=Array.from({length:12},(_,index)=>index);
  assert.equal(optimizationStructureKey(a,variants),optimizationStructureKey(a.map(index=>index+12),variants));
  assert.equal(optimizationStructureKey(a,variants),optimizationStructureKey([...a.slice(0,6).reverse(),...a.slice(6).reverse()],variants));
  assert.notEqual(optimizationStructureKey(a,variants),optimizationStructureKey([...a.slice(6),...a.slice(0,6)],variants));
});
test('软结构名额保留冠军和不同思路，不强行保留明显落后者',()=>{
  const rows=[row('a','same',[100,100]),row('b','same',[99,99]),row('c','same',[98,98]),row('d','same',[97,97]),row('e','different',[95,95]),row('f','bad',[1,1])];
  assert.deepEqual(diverseOptimizationRows(rows,0),[]);
  assert.deepEqual(diverseOptimizationRows(rows,4).map(value=>value.key),['a','b','c','e']);
  assert.deepEqual(diverseOptimizationRows(rows.filter(value=>value.key!=='e'),4).map(value=>value.key),['a','b','c','d']);
  assert.deepEqual(diverseOptimizationRows(rows,4,{fraction:0}).map(value=>value.key),['a','b','c','d']);
});
test('晋级加测覆盖竞争双方，排除无竞争者及已足量样本',()=>{
  const a=row('a','a',[80,120,90,110]),b=row('b','b',[81,119,91,109]),c=row('c','c',[1,1,1,1]);
  assert.deepEqual(optimizationRefinements([a,b,c],[1],8).map(value=>value.key),['a','b']);
  assert.deepEqual(optimizationRefinements([a,b,c],[1],4),[]);
  assert.deepEqual(optimizationRefinements([row('a','a',[100,100]),c],[1],8),[]);
});

test('诊断保留竞争边界及双方，观察回调不改变加测选择',()=>{
  const rows=[row('a','a',[80,120,90,110]),row('b','b',[81,119,91,109]),row('c','c',[82,118,92,108])];
  const expected=optimizationRefinements(rows,[1,2],8);let observed;
  assert.deepEqual(optimizationRefinements(rows,[1,2],8,value=>{observed=value;}),expected);
  assert.deepEqual(observed,optimizationCompetition(rows,[1,2]));
  assert.ok(observed.contests.some(value=>value.limit===1&&value.inside==='a'&&value.challenger==='b'));
  assert.ok(observed.contests.some(value=>value.limit===2&&value.challenger==='c'));
});
