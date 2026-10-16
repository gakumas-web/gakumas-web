import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installMaster,skinSortTimes,skinThemeNames} from '../domain/catalog.mjs';
import {idolEntries,skinEntries} from '../domain/catalog-selectors.mjs';

const time=date=>Date.parse(`${date}T00:00:00+09:00`);
const september30=time('2026-09-30'),october9=time('2026-10-09');
const ids=rows=>rows.map(row=>row.held.idolCardSkinId);
const entries=(snapshot,filters={})=>skinEntries(snapshot,'',{ownership:'all',catalogSort:'release',...filters});

function master(){
  const cards=[
    {id:'ume',characterId:'hume',originalIdolCardSkinId:'ume-native',viewStartTime:'0'},
    {id:'saki',characterId:'hski',originalIdolCardSkinId:'saki-native',viewStartTime:'0'},
    {id:'lilja',characterId:'kllj',originalIdolCardSkinId:'lilja-native',viewStartTime:String(september30)},
    {id:'base',characterId:'ttmr',originalIdolCardSkinId:'base-native',viewStartTime:String(time('2024-05-16'))},
  ].map(card=>({...card,name:card.id,assetId:card.id,rarity:'IdolCardRarity_Ssr'}));
  const skins=[
    {id:'ume-native',idolCardId:'ume',assetId:'ume',name:'',theme:'Agitato',musicId:'music-ume',musicViewStartTime:String(september30)},
    {id:'saki-native',idolCardId:'saki',assetId:'saki',name:'',theme:'Agitato',musicId:'music-saki',musicViewStartTime:String(october9)},
    {id:'lilja-native',idolCardId:'lilja',assetId:'lilja',name:'',theme:'Agitato',musicId:'music-lilja',musicViewStartTime:String(october9)},
    {id:'base-native',idolCardId:'base',assetId:'base',name:'',viewStartTime:String(time('2024-05-16'))},
    {id:'fallback',theme:'Agitato',musicId:'music-zero',musicViewStartTime:'0'},
    {id:'early',theme:'早期主题',themeStartTime:time('2026-09-20'),viewStartTime:String(time('2026-09-20'))},
    {id:'middle',theme:'中间主题',themeStartTime:time('2026-10-05'),viewStartTime:String(time('2026-10-05'))},
    {id:'unknown-no-music',theme:'未知主题',musicViewStartTime:String(october9)},
    {id:'unknown-zero',theme:'未知主题',musicId:'music-zero',musicViewStartTime:'0'},
    {id:'unknown-missing',theme:'未知主题',musicId:'music-missing'},
  ].map(skin=>({idolCardId:'base',assetId:skin.id,name:'小悪魔',viewStartTime:'0',themeStartTime:0,...skin}));
  return {
    tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},
    characters:{hski:'花海咲季',ttmr:'月村手毬',hume:'花海佑芽',kllj:'葛城リーリヤ'},
    idols:{cards,skins},
  };
}

function snapshot(){
  return {
    idolCardSkins:['ume-native','lilja-native','saki-native','fallback','middle','early','unknown-no-music','unknown-zero','unknown-missing'].map(idolCardSkinId=>({idolCardSkinId})),
    idolCards:['ume','lilja','saki','base'].map(idolCardId=>({idolCardId,levelLimitRank:0,potentialRank:0})),
  };
}

test('具体装扮日期、原生偶像卡日期和已核对补充日期优先于关联曲目日期',()=>{
  const skins=['catalog','idol-card','supplement','music'].map(id=>({id,viewStartTime:'0',musicId:`music-${id}`,musicViewStartTime:'400'}));
  skins[0].viewStartTime='100';
  const cards=skins.slice(0,2).map(skin=>({id:`card-${skin.id}`,originalIdolCardSkinId:skin.id,viewStartTime:'200'}));
  const supplements=Object.fromEntries(skins.slice(0,3).map(skin=>[skin.id,{time:300,source:'verified',referenceIds:['checked']}]));
  const before=JSON.stringify({skins,cards,supplements}),times=skinSortTimes(skins,supplements,cards);
  assert.deepEqual(times.get('catalog'),{time:100,source:'catalog'});
  assert.equal(times.get('idol-card').time,200);
  assert.equal(times.get('idol-card').source,'idol-card');
  assert.equal(times.get('idol-card').idolCardId,'card-idol-card');
  assert.deepEqual(times.get('supplement'),supplements.supplement);
  assert.deepEqual(times.get('music'),{time:400,source:'linked-music',musicId:'music-music'});
  assert.equal(JSON.stringify({skins,cards,supplements}),before);
});

test('零值与缺失日期保持未知，无关联曲目不能使用曲目日期',()=>{
  const skins=[
    {id:'zero',viewStartTime:'0',musicId:'zero',musicViewStartTime:'0'},
    {id:'missing',musicId:'missing'},
    {id:'no-music',musicViewStartTime:'100'},
    {id:'empty-music',musicId:'',musicViewStartTime:'100'},
    {id:'negative',viewStartTime:'-1',musicId:'negative',musicViewStartTime:'-1'},
    {id:'fallback',viewStartTime:'0',musicId:'fallback',musicViewStartTime:'100'},
  ];
  const cards=skins.map(skin=>({id:`card-${skin.id}`,originalIdolCardSkinId:skin.id,viewStartTime:'0'}));
  const supplements=Object.fromEntries(skins.map(skin=>[skin.id,{time:0,source:'verified'}]));
  const times=skinSortTimes(skins,supplements,cards);
  assert.deepEqual([...times],[[
    'fallback',{time:100,source:'linked-music',musicId:'fallback'},
  ]]);
});

test('小悪魔装扮按咲季十月九日及佑芽莉莉娅九月三十日排序，库存顺序不覆盖日期',()=>{
  const input=master(),held=snapshot(),before=JSON.stringify({input,held});
  installMaster(input);
  const rows=entries(held);
  assert.deepEqual(ids(rows),['saki-native','middle','ume-native','lilja-native','fallback','early','unknown-no-music','unknown-zero','unknown-missing']);
  assert.deepEqual(ids(entries(held,{catalogSort:'releaseAsc'})),['early','ume-native','lilja-native','fallback','middle','saki-native','unknown-no-music','unknown-zero','unknown-missing']);
  for(const [id,expected] of [['saki-native',october9],['ume-native',september30],['lilja-native',september30]]){
    assert.equal(rows.find(row=>row.held.idolCardSkinId===id).info.sortReleaseTime,expected);
  }
  assert.deepEqual(rows.find(row=>row.held.idolCardSkinId==='saki-native').info.releaseTimeSource,{time:october9,source:'linked-music',musicId:'music-saki'});
  for(const row of rows.filter(row=>row.held.idolCardSkinId.startsWith('unknown-'))){
    assert.equal(row.info.sortReleaseTime,undefined);
    assert.equal(row.info.releaseTimeSource,undefined);
    assert.equal(row.info.viewStartTime,undefined);
  }
  assert.equal(JSON.stringify({input,held}),before);
});

test('偶像卡共用原生装扮解析日期，替换装扮不会借用基础SSR旧日期',()=>{
  installMaster(master());
  const held=snapshot();
  held.idolCards.find(card=>card.idolCardId==='base').idolCardSkinId='unknown-no-music';
  const rows=idolEntries(held,'','release',{ownership:'all'});
  assert.deepEqual(rows.map(row=>row.held.idolCardId),['saki','ume','lilja','base']);
  assert.deepEqual(rows.map(row=>row.info.sortReleaseTime),[october9,september30,september30,time('2024-05-16')]);
  const skins=entries(held);
  assert.equal(skins.find(row=>row.held.idolCardSkinId==='unknown-no-music').info.sortReleaseTime,undefined);
  assert.equal(skins.find(row=>row.held.idolCardSkinId==='fallback').info.sortReleaseTime,september30);
});

test('主题排序使用原生卡最早解析日期九月三十日，角色筛选后日期与主题顺序稳定',()=>{
  installMaster(master());
  const held=snapshot(),rows=entries(held,{catalogSort:'theme'});
  assert.deepEqual(ids(rows),['early','saki-native','fallback','ume-native','lilja-native','middle','unknown-no-music','unknown-zero','unknown-missing']);
  assert.ok(rows.filter(row=>row.info.theme==='Agitato').every(row=>row.info.themeCardStartTime===september30));
  const filtered=entries(held,{catalogSort:'theme',skinCharacter:['ttmr']});
  assert.deepEqual(ids(filtered),['early','fallback','middle','unknown-no-music','unknown-zero','unknown-missing']);
  assert.equal(filtered.find(row=>row.held.idolCardSkinId==='fallback').info.themeCardStartTime,september30);
  assert.deepEqual(skinThemeNames(rows.map(row=>row.info)),['早期主题','Agitato','中间主题','未知主题']);
  assert.deepEqual(skinThemeNames(filtered.map(row=>row.info)),['早期主题','Agitato','中间主题','未知主题']);
});

test('同一日本发行日的偶像卡面优先于仅装扮，不同发行日仍按升降序排列',()=>{
  for(const [nativeDate,costumeDate,sameDay] of [
    ['2026-09-30T00:05:00+09:00','2026-09-30T23:55:00+09:00',true],
    ['2026-10-01T00:05:00+09:00','2026-09-30T23:55:00+09:00',false],
  ]){
    const input=master(),native=input.idols.skins.find(skin=>skin.id==='ume-native');
    native.musicViewStartTime=String(Date.parse(nativeDate));
    input.idols.skins.push({id:'costume',idolCardId:'base',assetId:'costume',name:'小悪魔',theme:'Agitato',viewStartTime:String(Date.parse(costumeDate))});
    const held={idolCardSkins:[{idolCardSkinId:'costume'},{idolCardSkinId:'ume-native'}]},before=JSON.stringify({input,held});
    installMaster(input);
    assert.deepEqual(ids(entries(held,{ownership:'owned'})),['ume-native','costume']);
    assert.deepEqual(ids(entries(held,{ownership:'owned',catalogSort:'releaseAsc'})),sameDay?['ume-native','costume']:['costume','ume-native']);
    assert.deepEqual(ids(entries(held,{ownership:'owned',catalogSort:'theme'})),['costume','ume-native']);
    assert.equal(JSON.stringify({input,held}),before);
  }
});

test('未知日期不会触发同日偶像卡面优先，两种日期排序均保留库存顺序',()=>{
  const input=master(),native=input.idols.skins.find(skin=>skin.id==='ume-native');
  native.musicViewStartTime='0';native.theme='无日期';
  input.idols.skins.push({id:'unknown-costume',idolCardId:'base',assetId:'unknown-costume',name:'小悪魔',theme:'无日期',viewStartTime:'0'});
  installMaster(input);
  const held={idolCardSkins:[{idolCardSkinId:'unknown-costume'},{idolCardSkinId:'ume-native'}]};
  for(const catalogSort of ['release','releaseAsc']){
    const rows=entries(held,{ownership:'owned',catalogSort});
    assert.deepEqual(ids(rows),['unknown-costume','ume-native']);
    assert.ok(rows.every(row=>row.info.sortReleaseTime===undefined));
  }
});
