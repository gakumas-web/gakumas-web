import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyLibrary,parseLibrary,changeTag,removeTag,mergeLibraries,matchesTag,favoriteRecords} from '../domain/personal-library.mjs';
import {createViews} from '../application/view-state.mjs';
const profile='account-synthetic-library',key='a'.repeat(64);

test('标签重命名及删除同步两类关联且不改原件',()=>{
  const first=emptyLibrary(profile);first.tags=['保留','待清理'];first.memories[key]=['保留','待清理'];first.selectionMemories[key]=['保留'];
  const source=JSON.stringify(first);
  const renamed=changeTag(first,'保留','自定义');
  assert.deepEqual(renamed.tags,['自定义','待清理']);assert.deepEqual(renamed.selectionMemories[key],['自定义']);
  assert.deepEqual(first.selectionMemories[key],['保留']);assert.equal(JSON.stringify(first),source);
  assert.throws(()=>changeTag(renamed,null,'自定义'),/同名/);assert.throws(()=>changeTag(first,null,' '.repeat(3)),/1–40/);
  const removed=removeTag(renamed,'自定义');assert.deepEqual(removed.memories[key],['待清理']);assert.deepEqual(removed.selectionMemories[key],[]);
});
test('同键普通和选拔关联隔离，保留无关联标签，备份合并不丢其它记录',()=>{
  const before=emptyLibrary(profile);before.tags=['旧'];before.memories[key]=['旧'];before.favorites.idolCards=['old-card'];
  const after=changeTag(emptyLibrary(profile),null,'新');after.selectionMemories[key]=['新'];after.favorites.supportCards=['new-card'];
  const merged=mergeLibraries(before,after);assert.deepEqual(merged.memories[key],['旧']);assert.deepEqual(merged.selectionMemories[key],['新']);
  assert.deepEqual(merged.favorites,{idolCards:[],supportCards:['new-card'],idolCardSkins:[],memories:[],selectionMemories:[]});
  assert.ok(matchesTag(merged,'memories',key,'tag:旧'));assert.ok(!matchesTag(merged,'selectionMemories',key,'tag:旧'));
  assert.ok(matchesTag(merged,'memories','b'.repeat(64),'__untagged__'));
  assert.deepEqual(parseLibrary(changeTag(after,null,'空标签'),profile).tags,['新','空标签']);
});
test('外部数据拒绝跨账号、未知标签、坏关联和坏收藏结构',()=>{
  const source=emptyLibrary(profile);
  for(const bad of [{...source,profile:'main'},{...source,tags:['x'.repeat(41)]},{...source,memories:{[key]:['缺失']}},
    {...source,selectionMemories:{bad:[]}},{...source,favorites:{idolCards:[1],supportCards:[]}}])assert.throws(()=>parseLibrary(bad,profile));
});
test('收藏从完整目录筛选，未持有仍可收藏，两类范围刷新恢复',()=>{
  const rows=[{idolCardId:'owned',ownership:'owned'},{idolCardId:'unowned',ownership:'unowned'}];let mode;
  const result=favoriteRecords({},'idolCards',{ownership:'favorites',favorites:['unowned']},(_snapshot,_field,value)=>{mode=value;return rows;});
  assert.equal(mode,'all');assert.deepEqual(result,[rows[1]]);
  const views=createViews({supportCards:{ownership:'favorites'},idolCards:{ownership:'favorites'}});
  assert.equal(views.supportCards.ownership,'favorites');assert.equal(views.idolCards.ownership,'favorites');
});

test('装扮收藏独立于偶像卡且拒绝缺失字段与错误类型',()=>{
  const legacy=emptyLibrary(profile);delete legacy.favorites.idolCardSkins;
  assert.throws(()=>parseLibrary(legacy,profile));
  assert.throws(()=>parseLibrary(legacy,profile));const current=emptyLibrary(profile);current.favorites.idolCardSkins=['skin-a','skin-a'];
  const parsed=parseLibrary(current,profile);assert.deepEqual(parsed.favorites.idolCardSkins,['skin-a']);assert.deepEqual(parsed.favorites.idolCards,[]);
  assert.throws(()=>parseLibrary({...current,favorites:{...current.favorites,idolCardSkins:null}},profile));
  assert.deepEqual(favoriteRecords({},'idolCardSkins',{ownership:'favorites',favorites:['skin-a']},()=>[{idolCardSkinId:'skin-a'},{idolCardSkinId:'skin-b'}]),[{idolCardSkinId:'skin-a'}]);
});

test('回忆收藏按唯一标识保存且与装扮独立',()=>{
  const legacy=emptyLibrary(profile);delete legacy.favorites.memories;
  assert.throws(()=>parseLibrary(legacy,profile));const current=emptyLibrary(profile);assert.deepEqual(current.favorites.memories,[]);
  current.favorites.memories=[key,key];const parsed=parseLibrary(current,profile);
  assert.deepEqual(parsed.favorites.memories,[key]);assert.deepEqual(parsed.favorites.idolCardSkins,[]);
});

test('选拔回忆收藏按独立分区保存，缺字段拒绝读取',()=>{
  const legacy=emptyLibrary(profile);delete legacy.favorites.selectionMemories;
  assert.throws(()=>parseLibrary(legacy,profile));const current=emptyLibrary(profile);assert.deepEqual(current.favorites.selectionMemories,[]);
  current.favorites.selectionMemories=[key];assert.deepEqual(parseLibrary(current,profile).favorites.selectionMemories,[key]);assert.deepEqual(current.favorites.memories,[]);
});
