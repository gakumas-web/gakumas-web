import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCollection} from '../domain/model.mjs';

test('按卡片 ID 联接并保留目录外持有记录，数量零仍属已拥有，不修改快照',()=>{
  const held=Object.freeze([Object.freeze({supportCardId:'a',level:30,levelLimitRank:2,stockQuantity:0}),Object.freeze({supportCardId:'outside',level:20})]);
  const definitions=[{id:'a'},{id:'b'},{id:'b'}];
  const owned=mergeCollection(held,definitions,'supportCards');
  assert.equal(owned.length,2);
  assert.equal(owned[0].level,30);
  assert.equal(owned[0].ownership,'owned');
  const all=mergeCollection(held,definitions,'supportCards','all');
  assert.deepEqual(all.map(row=>row.supportCardId),['a','outside','b']);
  assert.equal(all[2].ownership,'unowned');
  assert.equal(all[2].stockQuantity,undefined);
  assert.equal(all[2].createdTime,undefined);
  assert.equal(held[0].ownership,undefined);
});

test('未采集与空持有集合不同，未知不归入未拥有',()=>{
  const definitions=[{id:'a'}];
  assert.deepEqual(mergeCollection(undefined,definitions,'supportCards','unowned'),[]);
  assert.equal(mergeCollection(undefined,definitions,'supportCards','all')[0].ownership,'unknown');
  assert.equal(mergeCollection([],definitions,'supportCards','unowned')[0].ownership,'unowned');
});

test('偶像卡的参考阶段与实际持有阶段隔离',()=>{
  const held=[{idolCardId:'a',levelLimitRank:6,potentialRank:4}];
  const all=mergeCollection(held,[{id:'a'},{id:'b'}],'idolCards','all');
  assert.equal(all[0].levelLimitRank,6);
  assert.deepEqual(all[1],{idolCardId:'b',ownership:'unowned',levelLimitRank:0,potentialRank:0});
  assert.deepEqual(mergeCollection(held,[{id:'a'},{id:'b'}],'idolCards','unowned'),[all[1]]);
});
