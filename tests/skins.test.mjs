import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeCollection} from '../domain/model.mjs';
import {installMaster,collectionRecords,skinInfo} from '../domain/catalog.mjs';
const definitions=[{id:'base',idolCardId:'card',assetId:'base',name:'',theme:'夏'},{id:'theme',idolCardId:'card',assetId:'theme',name:'夏'}];
test('装扮持有独立于偶像卡，未采集不当作未拥有',()=>{
  installMaster({tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},
    characters:{a:'角色'},idols:{cards:[{id:'card',characterId:'a',name:'关联卡'}],skins:definitions}});
  const rows=collectionRecords({idolCards:[{idolCardId:'card'}],idolCardSkins:[{idolCardSkinId:'base'}]},'idolCardSkins','all');
  assert.deepEqual(rows.map(r=>[r.idolCardSkinId,r.ownership]),[['base','owned'],['theme','unowned']]);
  assert.ok(collectionRecords({},'idolCardSkins','all').every(r=>r.ownership==='unknown'));
  assert.equal(skinInfo(rows[1]).theme,'夏');assert.equal(skinInfo(rows[1]).cardName,'关联卡');
  assert.equal(skinInfo(rows[0]).name,'关联卡');
  assert.equal('levelLimitRank' in rows[1],false);
});
test('目录未收录的持有装扮仍保留',()=>{
  assert.equal(mergeCollection([{idolCardSkinId:'missing'}],definitions,'idolCardSkins','owned')[0].idolCardSkinId,'missing');
});

test('夏主题联接三张主题偶像卡与跨年份装扮，完整覆盖13位角色',async()=>{
  const {readFileSync}=await import('node:fs');
  const catalog=JSON.parse(readFileSync(new URL('./fixtures/public-data/idols.json',import.meta.url)));
  const rows=catalog.skins.filter(s=>s.theme==='夏 · キミとセミブルー');
  const cards=new Map(catalog.cards.map(c=>[c.id,c]));
  assert.equal(rows.length,13);
  assert.equal(new Set(rows.map(s=>cards.get(s.idolCardId).characterId)).size,13);
  assert.equal(rows.filter(s=>s.name==='').length,3);
  assert.deepEqual([...new Set(rows.filter(s=>s.name).map(s=>s.name))].sort(),["'24夏","'25夏","'26夏"]);
  assert.ok(rows.every(s=>s.themeAliases.includes("'24夏")));
  const held=rows.slice(0,4).map(s=>({idolCardSkinId:s.id}));
  const owned=mergeCollection(held,rows,'idolCardSkins','owned');
  const unowned=mergeCollection(held,rows,'idolCardSkins','unowned');
  assert.equal(owned.length+unowned.length,13);
});

test('同曲不同角色的 cover 版本不会拆散主题偶像卡和替换装扮',async()=>{
  const {readFileSync}=await import('node:fs');
  const catalog=JSON.parse(readFileSync(new URL('./fixtures/public-data/idols.json',import.meta.url)));
  const rows=catalog.skins.filter(s=>s.theme==='GO MY WAY!!');
  assert.equal(rows.length,13);assert.equal(rows.filter(s=>s.name==='').length,3);
});


test('装扮目录排除无主题基础装扮，但保留夏和水着主题的基础装扮',async()=>{
  const {readFileSync}=await import('node:fs');
  const catalog=JSON.parse(readFileSync(new URL('./fixtures/public-data/idols.json',import.meta.url)));
  installMaster({tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},idols:catalog});
  const snapshot={idolCardSkins:catalog.skins.map(s=>({idolCardSkinId:s.id}))};
  const before=JSON.stringify(snapshot),rows=collectionRecords(snapshot,'idolCardSkins','all');
  assert.equal(rows.length,catalog.skins.filter(s=>s.theme||s.name).length);
  assert.ok(rows.length<catalog.skins.length);
  for(const theme of ['夏 · キミとセミブルー','水着 · 「ねえ、言っちゃうよ。」']){
    const themed=rows.filter(r=>skinInfo(r).theme===theme);
    assert.equal(themed.length,13);
    assert.ok(themed.some(r=>catalog.skins.find(s=>s.id===r.idolCardSkinId).name===''));
  }
  assert.equal(JSON.stringify(snapshot),before);
});

test('主题选项按最早主题装扮记录排序，不随补发年份或文字顺序改变',async()=>{
  const {skinThemeNames}=await import('../domain/catalog.mjs');
  const {readFileSync}=await import('node:fs');
  const catalog=JSON.parse(readFileSync(new URL('./fixtures/public-data/idols.json',import.meta.url)));
  const names=skinThemeNames(catalog.skins.map(s=>({theme:s.theme,themeStartTime:s.themeStartTime})));
  assert.deepEqual(names,[
    '夏 · キミとセミブルー','祭 · 冠菊','ハロウィン · 仮装狂騒曲','クリスマス · White Night! White Wish!',
    'バレンタイン · ハッピーミルフィーユ','ひな祭り · 雪解けに','桜 · 桜フォトグラフ',
    'アニメイト · 古今東西ちょちょいのちょい','Howling over the World','ミラクルナナウ(ﾟ∀ﾟ)！',
    'がむしゃらに行こう！','ENDLESS DANCE','GO MY WAY!!','水着 · 「ねえ、言っちゃうよ。」']);
  assert.deepEqual(skinThemeNames([{theme:'未记录'},{theme:'早期',themeStartTime:0},{theme:'后来',themeStartTime:20}]),['早期','后来','未记录']);
});
