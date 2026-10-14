import test from 'node:test';
import assert from 'node:assert/strict';
import {contentChunks,applyContentChunk} from '../application/content-transfer.mjs';

test('大对象分批回传保持嵌套表、数组顺序、空值和原文',()=>{
  const value={scope:'effects',tables:{cards:Array.from({length:1800},(_,id)=>({id,text:'日本語说明'.repeat(20),values:[id,null,false]})),empty:[],record:{}},nested:{values:Array.from({length:1200},(_,i)=>String(i))}};
  const chunks=[...contentChunks(value)];
  assert.ok(chunks.length>8);
  assert.ok(chunks.every(chunk=>(chunk.patch??chunk.json??'').length<=64*1024));
  assert.deepEqual(chunks.reduce(applyContentChunk,undefined),value);
});

test('多个分包交错组装互不串包，支持标量和超长单字段',()=>{
  const values=[{rows:Array.from({length:1000},(_,id)=>({id,text:'测试'.repeat(80)}))},[null,{},[],false,0,'長い原文'.repeat(20000)]];
  const iterators=values.map(value=>contentChunks(value)),results=[];
  let pending=true;
  while(pending){pending=false;for(const [i,iterator] of iterators.entries()){const next=iterator.next();if(!next.done){pending=true;results[i]=applyContentChunk(results[i],next.value);}}}
  assert.deepEqual(results,values);
  for(const value of [null,false,0,'原文',[],{}])assert.deepEqual([...contentChunks(value)].reduce(applyContentChunk,undefined),value);
});


test('JSON 字典中的特殊字段保持自有数据属性',()=>{
  const value=JSON.parse('{"__proto__":{"label":"原文"},"rows":[]}');
  value.rows=Array.from({length:1000},()=>({text:'描述'.repeat(80)}));
  value.constructor={data:1};
  const restored=[...contentChunks(value)].reduce(applyContentChunk,undefined);
  assert.deepEqual(restored,value);assert.equal(Object.getPrototypeOf(restored),Object.prototype);
  assert.ok(Object.hasOwn(restored,'__proto__'));
});
