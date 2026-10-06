import {inventory} from './fixtures.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareSnapshot} from '../domain/model.mjs';
import {snapshotId,snapshotDifference,restorePrepared,memoryState} from '../application/history.mjs';
const raw=inventory({memories:[{userMemoryId:'test-only',vocal:10,isProtected:false}]});
const initial=await prepareSnapshot(raw);
test('历史标识覆盖状态而不只覆盖成员集合，差异区分变化与未出现',async()=>{
 const next=await prepareSnapshot({...raw,memories:[{...raw.memories[0],vocal:20}]});
 assert.equal(initial.fingerprint,next.fingerprint);assert.notEqual(await snapshotId(initial),await snapshotId(next));
 assert.equal(snapshotDifference(initial,next).changed.length,1);
 const empty=await prepareSnapshot({...raw,count:0,memories:[]});
 assert.equal(snapshotDifference(initial,empty).missing.length,1);assert.equal(snapshotDifference(empty,initial).added.length,1);
 assert.equal(snapshotDifference(initial,next).catalogs[1].recorded,true);
});
test('工作副本恢复稳定身份并剔除额外字段，拒绝损坏内容',async()=>{
 const restored=await restorePrepared({...initial,account:'discard',memories:initial.memories.map(m=>({...m,imagePath:'discard'}))});
 assert.equal(await snapshotId(restored),await snapshotId(initial));
 assert.equal(JSON.stringify(restored).includes('test-only'),false);assert.equal(JSON.stringify(restored).includes('discard'),false);
 await assert.rejects(restorePrepared({...initial,count:2}));
});
test('状态比较忽略列表序号，但识别保护与属性变化',()=>{
 const m=initial.memories[0];assert.equal(memoryState(m),memoryState({...m,ordinal:20}));
 assert.notEqual(memoryState(m),memoryState({...m,isProtected:true}));
});
