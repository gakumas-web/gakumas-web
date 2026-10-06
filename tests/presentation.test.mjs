import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shotDate} from '../domain/model.mjs';
import {sortIdolEntries} from '../domain/catalog.mjs';
import {foldTitle} from '../domain/memories.mjs';

test('日期保留完整年月日，零与缺失不制造1970日期',()=>{
  assert.equal(shotDate({shotTime:new Date(2024,0,2,12).getTime()}),'2024/01/02');
  assert.equal(shotDate({shotTime:0}),'日期未记录');
  assert.equal(shotDate({}),'日期未记录');
});
test('折叠标题区分未记录、空集合与实际数量',()=>{
  assert.equal(foldTitle('能力',undefined),'能力 · 未记录');
  assert.equal(foldTitle('能力',[]),'能力 · 0（空）');
  assert.equal(foldTitle('能力',[{},{}]),'能力 · 2');
});
const entries=[
  {ordinal:0,held:{levelLimitRank:4},info:{rarity:'R',character:'い',characterId:'b',characterResolved:true}},
  {ordinal:1,held:{levelLimitRank:2},info:{rarity:'SSR',character:'あ',characterId:'a',characterResolved:true}},
  {ordinal:2,held:{levelLimitRank:7},info:{rarity:'SR',character:'い',characterId:'b',characterResolved:true}},
  {ordinal:3,held:{levelLimitRank:2},info:{rarity:'SSR',character:'あ',characterId:'a',characterResolved:true}},
  {ordinal:4,held:{},info:{rarity:'Future',character:'未解析',characterResolved:false}},
];
test('稀有度按SSR大于SR大于R，未知最后、同值稳定',()=>{
  assert.deepEqual(sortIdolEntries(entries,'rarity').map(x=>x.ordinal),[1,3,2,0,4]);
  assert.deepEqual(entries.map(x=>x.ordinal),[0,1,2,3,4]);
});
test('等级上限阶级降序且缺失最后，同阶级稳定',()=>{
  assert.deepEqual(sortIdolEntries(entries,'level').map(x=>x.ordinal),[2,0,1,3,4]);
});
test('角色按实际名称与标识稳定排序，未知最后',()=>{
  assert.deepEqual(sortIdolEntries(entries,'character').map(x=>x.ordinal),[1,3,0,2,4]);
  assert.deepEqual(sortIdolEntries(entries,'original').map(x=>x.ordinal),[0,1,2,3,4]);
});
