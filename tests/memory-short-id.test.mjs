import test from 'node:test';
import assert from 'node:assert/strict';
import {inventory} from './fixtures.mjs';
import {prepareSnapshot,memoryShortId,title} from '../domain/model.mjs';
import {restorePrepared,snapshotDifference} from '../application/history.mjs';

test('短码取完整标识前八位，重排、新增、移除与恢复不改变既有短码',async()=>{
  const prepare=ids=>prepareSnapshot(inventory({memories:ids.map(userMemoryId=>({userMemoryId}))}));
  const first=await prepare(['synthetic-a','synthetic-b']),next=await prepare(['synthetic-c','synthetic-a']),returned=await prepare(['synthetic-b','synthetic-a']);
  const a=first.memories[0],b=first.memories[1];
  assert.match(memoryShortId(a),/^[a-f0-9]{8}$/);assert.equal(title(a),`回忆 ${a.key.slice(0,8)}`);
  assert.notEqual(a.ordinal,next.memories[1].ordinal);assert.equal(title(a),title(next.memories[1]));
  assert.equal(title(b),title(returned.memories[0]));
  const restored=await restorePrepared(JSON.parse(JSON.stringify(next)));assert.deepEqual(restored.memories.map(title),next.memories.map(title));
});
test('短码碰撞不合并内部身份，没有完整标识的模拟副本不显示伪造编号',async()=>{
  const snapshot=await prepareSnapshot(inventory({memories:[{userMemoryId:'synthetic-a'},{userMemoryId:'synthetic-b'}]}));
  const [a,b]=snapshot.memories.map((m,index)=>({...m,key:'1234abcd'+String(index).repeat(56)}));
  assert.equal(title(a),title(b));assert.notEqual(a.key,b.key);
  const diff=snapshotDifference({...snapshot,memories:[a]},{...snapshot,memories:[b]});assert.deepEqual(diff.added,[b]);assert.deepEqual(diff.missing,[a]);
  assert.equal(memoryShortId({key:'simulation-synthetic'}),null);assert.equal(title({ordinal:12}), '回忆');
});
