import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installMaster,sortCollectionEntries} from '../domain/catalog.mjs';
const entry=(id,ordinal,held={},info={})=>({held:{id,ownership:'owned',...held},info:{name:id,...info},ordinal});
const ids=rows=>rows.map(row=>row.held.id);
test('培养升降序始终把未持有和缺失置后，同值稳定且不修改输入',()=>{
  const rows=[entry('unknown',0,{ownership:'unknown',potentialRank:0}),entry('high',1,{potentialRank:4}),entry('low',2,{potentialRank:1}),entry('tie',3,{potentialRank:1}),entry('missing',4)];
  const original=JSON.stringify(rows);
  assert.deepEqual(ids(sortCollectionEntries(rows,'potentialAsc','idolCards')),['low','tie','high','unknown','missing']);
  assert.deepEqual(ids(sortCollectionEntries(rows,'potential','idolCards')),['high','low','tie','unknown','missing']);
  assert.equal(JSON.stringify(rows),original);
});
test('角色按筛选顺序，多角色卡不依赖目录中的角色数组顺序',()=>{
  const rows=[entry('mao',0,{}, {characterId:'amao'}),entry('temari',1,{}, {characterId:'ttmr'}),entry('saki',2,{}, {characterId:'hski'})];
  assert.deepEqual(ids(sortCollectionEntries(rows,'character','idolCards')),['saki','temari','mao']);
  const multi=[entry('a',0,{}, {characterIds:['amao','ttmr']}),entry('b',1,{}, {characterIds:['amao','hski']})];
  assert.deepEqual(ids(sortCollectionEntries(multi,'character','supportCards')),['b','a']);
});
test('主题分组、实装日期缺失置后与已持有优先可叠加',()=>{
  const rows=[entry('old',0,{ownership:'unowned'},{theme:'夏',themeStartTime:0,viewStartTime:100}),entry('new',1,{}, {theme:'夏',themeStartTime:0,viewStartTime:200}),entry('missing',2,{}, {theme:'冬',themeStartTime:300})];
  assert.deepEqual(ids(sortCollectionEntries(rows,'releaseAsc','idolCardSkins')),['old','new','missing']);
  assert.deepEqual(ids(sortCollectionEntries(rows,'release','idolCardSkins')),['new','old','missing']);
  assert.deepEqual(ids(sortCollectionEntries(rows,'releaseAsc','idolCardSkins',{ownedFirst:true})),['new','missing','old']);
  assert.deepEqual(ids(sortCollectionEntries(rows,'theme','idolCardSkins')),['old','new','missing']);
});
test('支援卡等级差取当前突破上限而非最高突破上限',()=>{
  installMaster({tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},progression:{tables:{SupportCard:[{id:'a',supportCardLevelLimitId:'limits'},{id:'b',supportCardLevelLimitId:'limits'}],SupportCardLevelLimit:[{id:'limits',rank:'Rank__0',levelLimit:40},{id:'limits',rank:'Rank__1',levelLimit:50}]}}});
  const rows=[entry('a',0,{supportCardId:'a',level:39,levelLimitRank:0}),entry('b',1,{supportCardId:'b',level:45,levelLimitRank:1}),entry('missing',2,{supportCardId:'absent',level:1,levelLimitRank:0})];
  assert.deepEqual(ids(sortCollectionEntries(rows,'levelGap','supportCards')),['b','a','missing']);
});
test('计划和属性组合排序使用固定分类，同类支援按稀有度与实际等级排列',()=>{
  const rows=[entry('dance',0,{level:50},{plan:'Plan2',type:'Dance',rarity:'SSR'}),entry('vocalLow',1,{level:30},{plan:'Plan1',type:'Vocal',rarity:'SSR'}),entry('vocalHigh',2,{level:50},{plan:'Plan1',type:'Vocal',rarity:'SSR'}),entry('vocalSR',3,{level:60},{plan:'Plan1',type:'Vocal',rarity:'SR'})];
  assert.deepEqual(ids(sortCollectionEntries(rows,'type','supportCards')),['vocalHigh','vocalLow','vocalSR','dance']);
  assert.deepEqual(ids(sortCollectionEntries(rows,'plan','idolCards')),['vocalLow','vocalHigh','vocalSR','dance']);
});
test('缺失装扮日期按已核对批次补齐，原始日期优先且不污染目录',async()=>{
  const {skinSortTimes}=await import('../domain/catalog.mjs');
  const {readFileSync}=await import('node:fs');
  const skins=JSON.parse(readFileSync(new URL('./fixtures/public-data/idols.json',import.meta.url))).skins;
  const before=JSON.stringify(skins),times=skinSortTimes(skins);
  const displayed=skins.filter(s=>s.theme||s.name);
  assert.ok(displayed.every(s=>times.has(s.id)));
  assert.equal(displayed.filter(s=>times.get(s.id).source!=='catalog').length,11);
  assert.equal(times.get('i_card-skin-amao-3-001').time,Date.parse('2024-07-01T00:00:00+09:00'));
  assert.equal(times.get('i_card-skin-hrnm-3-001').time,Date.parse('2024-07-12T00:00:00+09:00'));
  assert.equal(times.get('i_card-skin-jsna-3-016').source,'same-batch');
  assert.equal(times.get('i_card-skin-jsna-3-016').referenceIds.length,12);
  assert.equal(JSON.stringify(skins),before);
  const changed=skins.map(s=>s.id==='i_card-skin-amao-3-001'?{...s,viewStartTime:'123'}:s);
  assert.deepEqual(skinSortTimes(changed).get('i_card-skin-amao-3-001'),{time:123,source:'catalog'});
  const conflicted=skins.map(s=>s.id==='i_card-skin-hmsz-3-015'?{...s,viewStartTime:'123'}:s);
  assert.equal(skinSortTimes(conflicted).has('i_card-skin-jsna-3-016'),false);
  assert.equal(skinSortTimes([{id:'unknown',theme:'夏 · キミとセミブルー',viewStartTime:'0'}]).size,0);
});

test('偶像卡按计划、稀有度降序、固定角色顺序逐级排序',()=>{
  const rows=[entry('senseR',0,{}, {plan:'Plan1',rarity:'R',characterId:'hski'}),entry('senseMaoSSR',1,{}, {plan:'Plan1',rarity:'SSR',characterId:'amao'}),entry('logicSSR',2,{}, {plan:'Plan2',rarity:'SSR',characterId:'hski'}),entry('senseSakiSSR',3,{}, {plan:'Plan1',rarity:'SSR',characterId:'hski'}),entry('senseSR',4,{}, {plan:'Plan1',rarity:'SR',characterId:'ttmr'})];
  assert.deepEqual(ids(sortCollectionEntries(rows,'plan','idolCards')),['senseSakiSSR','senseMaoSSR','senseSR','senseR','logicSSR']);
});
