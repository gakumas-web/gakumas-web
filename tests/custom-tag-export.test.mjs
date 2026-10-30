import test from 'node:test';
import assert from 'node:assert/strict';
import {createCustomTagExport,CustomTagExportError} from '../application/custom-tag-export.mjs';
import {accountProfile} from '../domain/account.mjs';
import {emptyLibrary,changeTag} from '../domain/personal-library.mjs';
import {digest,prepareSnapshot} from '../domain/model.mjs';
import {prepareSelectionSnapshot} from '../domain/selection-memories.mjs';
import {inventory,captureHeader} from './fixtures.mjs';

const now='2026-10-16T06:00:00.000Z';
const profile=accountProfile(captureHeader().publicUserId);
const orphan='f'.repeat(64);
const card={id:'synthetic-skill',upgradeCount:1,customizes:[{id:'synthetic-customize',customizeCount:2}]};
function selectionRecord(id='synthetic-selection'){
  return {userSelectionMemoryId:id,memoryTagId:'synthetic-game-tag',assetId:'synthetic-asset',produceId:'synthetic-produce',characterId:'hski',idolCardId:'synthetic-idol',idolCardSkinId:'synthetic-skin',researchId:'',
    grade:13,planType:2,idolCardLevelLimitRank:1,idolCardPotentialRank:2,vocal:100,dance:200,visual:300,vocalGrowthRatePermil:100,danceGrowthRatePermil:200,visualGrowthRatePermil:300,stamina:30,star:810,
    clearedTime:1700000000000,lastUsedTime:0,isProtected:true,isPrimaStella:false,produceCards:[{...structuredClone(card),fromMemory:true}],
    produceItems:[{id:'synthetic-item',triggerCount:2,reactionCount:3}],produceCustomizeItems:[{id:'synthetic-custom-item',triggerCount:1,reactionCount:0}]};
}
const selectionInput=(rows=[selectionRecord()])=>({...captureHeader(),source:'selection_memory_list',count:rows.length,selectionMemories:rows,eventExpiredSelectionMemoryIds:[]});
async function sample(){
  const raw=inventory({captured_at:'2026-10-16T00:00:00.123456789Z',memories:[
    {userMemoryId:'synthetic-a',isProtected:true,isInUse:true,inheritCount:0,produceCard:structuredClone(card),
      abilities:[{id:'synthetic-ability',level:2}],examBattleProduceCards:[structuredClone(card)],examBattleProduceItemIds:['synthetic-item'],
      unitCharacters:[{characterId:'ttmr',liveCostumeId:'synthetic-costume',liveCostumeHeadId:'synthetic-head'}]},
    {userMemoryId:'synthetic-b',isInUse:false},{userMemoryId:'synthetic-c'},{userMemoryId:'synthetic-unmarked'},
  ]});
  const snapshot=await prepareSnapshot(raw),selectionRaw=selectionInput([selectionRecord(),selectionRecord('synthetic-unmarked-selection')]);
  const selectionSnapshot=await prepareSelectionSnapshot(selectionRaw),library=emptyLibrary(profile);
  library.tags=['日本語タグ','中文标签','unused-tag'];
  for(const row of snapshot.memories.slice(0,3))library.memories[row.key]=['日本語タグ','中文标签','日本語タグ'];
  library.selectionMemories[selectionSnapshot.selectionMemories[0].key]=['中文标签'];
  library.memories[orphan]=['中文标签'];library.selectionMemories[orphan]=['日本語タグ'];
  library.favorites.memories=[snapshot.memories[3].key];
  return {profile,snapshot,selectionSnapshot,library,raw,selectionRaw};
}
const create=input=>createCustomTagExport(input,{now});

test('账号级导出两类带标签记录的散列标识和全部标签，排除未标记与孤立关联',async()=>{
  const input=await sample(),output=create(input);
  assert.deepEqual(Object.keys(output),['format','schema_version','publicUserId','exported_at','sources','memories','selectionMemories']);
  assert.equal(output.format,'gakumas-custom-tag-export');assert.equal(output.schema_version,1);
  assert.equal(output.publicUserId,input.snapshot.publicUserId);assert.equal(output.exported_at,now);
  assert.deepEqual(output.sources,{memories:{captured_at:input.snapshot.captured_at,identity_type:'userMemoryId-sha256'},
    selectionMemories:{captured_at:input.selectionSnapshot.captured_at,identity_type:'selection-prefixed-userSelectionMemoryId-sha256'}});
  const expected=input.snapshot.memories.slice(0,3).map(row=>({key:row.key,customTags:['中文标签','日本語タグ']})).sort((a,b)=>a.key<b.key?-1:1);
  assert.deepEqual(output.memories,expected);
  assert.deepEqual(output.selectionMemories,[{key:input.selectionSnapshot.selectionMemories[0].key,customTags:['中文标签']}]);
  for(const row of [...output.memories,...output.selectionMemories])assert.deepEqual(Object.keys(row),['key','customTags']);
  assert.equal(output.memories.some(row=>row.key===orphan),false);
});

test('分别声明并验证普通与选拔身份算法，不输出原始实例 ID',async()=>{
  const input=await sample(),output=create(input);
  assert.equal(input.snapshot.memories[0].key,await digest('synthetic-a'));
  assert.equal(output.selectionMemories[0].key,await digest('selection:synthetic-selection'));
  assert.notEqual(output.selectionMemories[0].key,await digest('synthetic-selection'));
  for(const row of [...output.memories,...output.selectionMemories]){
    assert.match(row.key,/^[a-f0-9]{64}$/);assert.equal('userMemoryId' in row,false);assert.equal('userSelectionMemoryId' in row,false);
  }
});

test('精简白名单移除采集字段、运行时、收藏偏好和详情，并隔离导出标签副本',async()=>{
  const input=await sample();
  input.snapshot.auth='private-auth';input.snapshot.memories[0].config={private:'private-config'};
  input.snapshot.memories[0].produceCard.customizes[0].auth='private-customize';
  input.snapshot.memories[0].examBattleProduceCards[0].cookie='private-cookie';
  input.selectionSnapshot.details=[{auth:'private-detail'}];
  input.selectionSnapshot.selectionMemories[0].produceCards[0].auth='private-card';
  input.selectionSnapshot.selectionMemories[0].produceItems[0].cookie='private-item';
  input.selectionSnapshot.selectionMemories[0].derived='private-derived';
  const before=structuredClone(input),output=create(input),serialized=JSON.stringify(output);
  for(const value of ['private-','unused-tag','favorites','preferences','details','ordinal','config','synthetic-unmarked'])assert.equal(serialized.includes(value),false,value);
  assert.deepEqual(input,before);
  output.memories[0].customTags.push('只修改普通导出');
  output.selectionMemories[0].customTags.push('只修改选拔导出');
  assert.deepEqual(input,before);
});

test('重命名、中日标签去重与排序不受快照或关联数组顺序影响',async()=>{
  const input=await sample();input.library=changeTag(input.library,'中文标签','新标签');
  const output=create(input),reordered=structuredClone(input);
  reordered.snapshot.memories.reverse();reordered.selectionSnapshot.selectionMemories.reverse();
  for(const kind of ['memories','selectionMemories'])for(const names of Object.values(reordered.library[kind]))names.reverse();
  assert.deepEqual(create(reordered),output);
  assert.ok(output.memories.every(row=>row.customTags.includes('新标签')&&!row.customTags.includes('中文标签')));
  assert.deepEqual(output.memories[0].customTags,['新标签','日本語タグ']);
});

test('仅有普通或选拔快照也能导出，对缺失来源使用 null',async()=>{
  const input=await sample();
  const ordinary=create({...input,selectionSnapshot:null});
  assert.equal(ordinary.memories.length,3);assert.deepEqual(ordinary.selectionMemories,[]);assert.equal(ordinary.sources.selectionMemories,null);
  const selection=create({...input,snapshot:null});
  assert.deepEqual(selection.memories,[]);assert.equal(selection.selectionMemories.length,1);assert.equal(selection.sources.memories,null);
  const date=createCustomTagExport(input,{now:new Date(now)});assert.equal(date.exported_at,now);
});

test('没有当前带标签记录时拒绝导出，不把过期孤立标签或收藏当作目标',async()=>{
  const input=await sample(),library=emptyLibrary(profile);library.tags=['中文标签'];
  library.memories[orphan]=['中文标签'];library.selectionMemories[orphan]=['中文标签'];
  library.favorites.memories=[input.snapshot.memories[0].key];
  assert.throws(()=>create({...input,library}),CustomTagExportError);
  assert.throws(()=>create({...input,snapshot:null,selectionSnapshot:null}),CustomTagExportError);
});

test('严格绑定档案、两类快照与标签账号，拒绝非法散列及无效采集合同',async()=>{
  const input=await sample();
  for(const profile of ['',null,'main','account-invalid/id'])assert.throws(()=>create({...input,profile}),CustomTagExportError);
  assert.throws(()=>create({...input,library:{...input.library,profile:'account-synthetic-other'}}),CustomTagExportError);
  for(const kind of ['snapshot','selectionSnapshot']){
    assert.throws(()=>create({...input,[kind]:{...input[kind],publicUserId:'synthetic-other'}}),CustomTagExportError);
    assert.throws(()=>create({...input,[kind]:{...input[kind],captured_at:'2026-10-16'}}),CustomTagExportError);
    const field=kind==='snapshot'?'memories':'selectionMemories';
    for(const key of ['synthetic-raw-id','A'.repeat(64),'a'.repeat(63),undefined]){
      const invalid=structuredClone(input);invalid[kind][field][0].key=key;
      assert.throws(()=>create(invalid),CustomTagExportError);
    }
    const duplicate=structuredClone(input);duplicate[kind][field][1]=duplicate[kind][field][0];
    assert.throws(()=>create(duplicate),CustomTagExportError);
  }
  const invalid=structuredClone(input);invalid.snapshot.memories[0].isInUse=null;
  assert.throws(()=>create(invalid),CustomTagExportError);
  const invalidSelection=structuredClone(input);invalidSelection.selectionSnapshot.selectionMemories[0].grade=null;
  assert.throws(()=>create(invalidSelection),CustomTagExportError);
  assert.throws(()=>createCustomTagExport(input,{now:new Date(NaN)}),CustomTagExportError);
});
