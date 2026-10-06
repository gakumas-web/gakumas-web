import {captureHeader} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSelectionDetail,restoreSelectionDetail,mergeSelectionDetails} from '../domain/selection-details.mjs';
const raw=()=>({...captureHeader(),source:'selection_memory_get',captured_at:'2026-10-02T00:00:00Z',publicUserId:'synthetic-A',userSelectionMemoryId:'synthetic-record',memories:[{number:1,userMemoryId:'synthetic-inherited',isRental:true,memory:{produceCardPhaseType:1,characterId:'hski',idolCardId:'synthetic-idol',grade:1,power:100,planType:2,vocal:1,dance:2,visual:3,stamina:20,produceCard:{id:'synthetic-skill',upgradeCount:1,customizes:[]},abilities:[],imagePath:'must-not-save'},memoryAbilities:[{id:'synthetic-ability',level:1,triggerCount:4}]}],supportCards:[{number:2,supportCardId:'synthetic-support',level:47,levelLimitRank:3,isRental:true,produceSkills:[{id:'synthetic-effect',level:2,triggerCount:3}],eventDetailIds:['synthetic-event']}]});

test('详情只保留必要字段，原始记录 ID 转为稳定键，租借与培养时等级保留',async()=>{
  const detail=await prepareSelectionDetail(raw());
  assert.match(detail.key,/^[a-f0-9]{64}$/);assert.match(detail.memories[0].memoryKey,/^[a-f0-9]{64}$/);
  assert.equal(detail.memories[0].isRental,true);assert.equal(detail.supportCards[0].level,47);
  assert.equal(detail.supportCards[0].produceSkills[0].triggerCount,3);
  assert.ok(!JSON.stringify(detail).includes('imagePath'));assert.ok(!JSON.stringify(detail).includes('synthetic-record'));
  assert.deepEqual(restoreSelectionDetail(detail),detail);
});
test('详情仅关联同账号现有回忆，较旧捕获不覆盖新版，也不改变源快照',async()=>{
  const detail=await prepareSelectionDetail(raw()),snapshot={publicUserId:'synthetic-A',selectionMemories:[{key:detail.key}]};
  const merged=mergeSelectionDetails(snapshot,[detail]);assert.equal(snapshot.details,undefined);
  assert.equal(merged.details.length,1);
  assert.throws(()=>mergeSelectionDetails({...snapshot,publicUserId:'synthetic-B'},[detail]));
  assert.throws(()=>mergeSelectionDetails({...snapshot,selectionMemories:[]},[detail]));
  assert.equal(mergeSelectionDetails(merged,[{...detail,captured_at:'2026-10-01T00:00:00Z',supportCards:[]}]).details[0].supportCards.length,1);
});
test('无账号、损坏槽位或重复槽位被拒绝；返回空条目与未采集仍可区分',async()=>{
  await assert.rejects(prepareSelectionDetail({...raw(),publicUserId:undefined}));
  const duplicate=raw();duplicate.memories.push(duplicate.memories[0]);await assert.rejects(prepareSelectionDetail(duplicate));
  const detail=await prepareSelectionDetail({...raw(),memories:[],supportCards:[]});assert.deepEqual(detail.memories,[]);assert.equal(detail.source,'selection_memory_get');
});

test('当前详情不接受旧版本或缺少开局继承字段',async()=>{
  await assert.rejects(prepareSelectionDetail({...raw(),schema_version:2}));
  const missing=raw();delete missing.memories[0].memory.produceCardPhaseType;await assert.rejects(prepareSelectionDetail(missing));
});
test('同一毫秒内较旧的微秒详情不能覆盖新详情',async()=>{
  const newer=await prepareSelectionDetail({...raw(),captured_at:'2026-10-03T12:00:00.000900+00:00'});
  const older=await prepareSelectionDetail({...raw(),captured_at:'2026-10-03T12:00:00.000100+00:00'});
  const merged=mergeSelectionDetails({publicUserId:'synthetic-A',selectionMemories:[{key:newer.key}],details:[newer]},[older]);
  assert.equal(merged.details[0].captured_at,newer.captured_at);
});
