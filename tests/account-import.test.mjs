import {inventory,captureHeader} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAccountDirectory,combineAccountDirectory} from '../domain/account-import.mjs';
import {readAccountDirectory} from '../application/account-directory.mjs';

const account='synthetic-directory-account',time=day=>`2026-10-${String(day).padStart(2,'0')}T00:00:00Z`;
const ordinary=day=>inventory({publicUserId:account,captured_at:time(day),memories:[{userMemoryId:`synthetic-memory-${day}`}]});
const memory=id=>({userSelectionMemoryId:id,memoryTagId:'',assetId:'',produceId:'',characterId:'hski',idolCardId:'card',idolCardSkinId:'',researchId:'',grade:1,planType:2,idolCardLevelLimitRank:0,idolCardPotentialRank:0,vocal:1,dance:1,visual:1,vocalGrowthRatePermil:1,danceGrowthRatePermil:1,visualGrowthRatePermil:1,stamina:1,star:1,clearedTime:0,lastUsedTime:0,isProtected:false,isPrimaStella:false,produceCards:[],produceItems:[],produceCustomizeItems:[]});
const selection=(day,ids=['one'])=>({...captureHeader(),publicUserId:account,source:'selection_memory_list',captured_at:time(day),count:ids.length,selectionMemories:ids.map(memory),eventExpiredSelectionMemoryIds:[]});
const detail=(day,id='one')=>({...captureHeader(),publicUserId:account,source:'selection_memory_get',captured_at:time(day),userSelectionMemoryId:id,memories:[],supportCards:[]});

test('无序目录按采集时间取最新，详情去重，旧列表中的孤立详情不复活条目',async()=>{
  const bundle=await prepareAccountDirectory([detail(2),ordinary(3),selection(1,['one','removed']),detail(4),ordinary(1),selection(3),detail(4,'removed')]);
  const result=combineAccountDirectory(bundle);
  assert.equal(result.snapshot.captured_at,time(3));assert.equal(result.history.length,2);
  assert.equal(result.selectionSnapshot.captured_at,time(3));assert.equal(result.selectionSnapshot.selectionMemories.length,1);
  assert.equal(result.selectionSnapshot.details.length,1);assert.equal(result.selectionSnapshot.details[0].captured_at,time(4));
  assert.equal(result.ignoredDetails,1);
});
test('旧目录重导不回滚当前库存或详情，缺少某类快照保留同账号现有数据',async()=>{
  const previous=combineAccountDirectory(await prepareAccountDirectory([ordinary(5),selection(5),detail(5)]));
  const before=JSON.stringify(previous);
  const result=combineAccountDirectory(await prepareAccountDirectory([ordinary(1),selection(1),detail(2)]),previous);
  assert.equal(result.snapshot.captured_at,time(5));assert.equal(result.selectionSnapshot.details[0].captured_at,time(5));
  assert.equal(JSON.stringify(previous),before);
  const updated=combineAccountDirectory(await prepareAccountDirectory([detail(6)]),previous);
  assert.equal(updated.snapshot,previous.snapshot);assert.equal(updated.selectionSnapshot.details[0].captured_at,time(6));
});
test('混合账号、缺失身份、坏结构和未知来源整批拒绝，详情必须有可关联列表',async()=>{
  for(const docs of [[],[ordinary(1),{...selection(1),publicUserId:'another'}],[{...ordinary(1),publicUserId:undefined}],[ordinary(1),{...selection(1),count:99}],[{...ordinary(1),source:'unknown'}]])await assert.rejects(prepareAccountDirectory(docs));
  const bundle=await prepareAccountDirectory([detail(1)]);assert.throws(()=>combineAccountDirectory(bundle));
  assert.throws(()=>combineAccountDirectory(bundle,{snapshot:{publicUserId:'another'}}));
});
test('目录只读取 snapshot.json，忽略清单和临时文件，损坏或超限文件停止读取',async()=>{
  const file=(name,value)=>({name,webkitRelativePath:`directory/nested/${name}`,size:100,text:async()=>JSON.stringify(value)});
  const bundle=await readAccountDirectory([file('snapshot.json',ordinary(1)),{...file('manifest.json',{}),text:()=>{throw new Error('不得读取');}},{...file('snapshot.part',{}),text:()=>{throw new Error('不得读取');}}]);
  assert.equal(bundle.snapshots.length,1);
  await assert.rejects(readAccountDirectory([{...file('snapshot.json',{}),text:async()=>'{'}]));
  await assert.rejects(readAccountDirectory([{...file('snapshot.json',{}),size:21*1024*1024,text:()=>{throw new Error('超限前应停止');}}]));
});


test('微秒排序保留较新库存、列表和详情，时区不影响顺序',async()=>{
  const newer='2026-10-03T12:00:00.000900+00:00',older='2026-10-03T20:00:00.000100+08:00';
  const current=combineAccountDirectory(await prepareAccountDirectory([{...ordinary(3),captured_at:newer},{...selection(3),captured_at:newer},{...detail(3),captured_at:newer}]));
  const result=combineAccountDirectory(await prepareAccountDirectory([{...ordinary(1),captured_at:older},{...selection(1),captured_at:older},{...detail(1),captured_at:older}]),current);
  assert.equal(result.snapshot.captured_at,newer);assert.equal(result.selectionSnapshot.captured_at,newer);assert.equal(result.selectionSnapshot.details[0].captured_at,newer);
});
test('目录含不受支持的详情版本或缺失格式标识时整批拒绝',async()=>{
 for(const invalid of [{...detail(1),schema_version:2},{...detail(1),format:undefined}])await assert.rejects(prepareAccountDirectory([ordinary(1),selection(1),invalid]));
});
