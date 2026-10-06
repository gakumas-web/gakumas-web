import test from 'node:test';
import assert from 'node:assert/strict';
import {inventory} from './fixtures.mjs';
import {prepareSnapshot} from '../domain/model.mjs';
import {emptyLibrary} from '../domain/personal-library.mjs';
import {snapshotId} from '../application/history.mjs';
import {parseAccountBackup,encodeAccountPackage,decodeAccountPackage,inspectAccountPackage} from '../application/account-package.mjs';

const publicUserId='synthetic-package-account';
const snapshot=await prepareSnapshot(inventory({publicUserId,memories:[{userMemoryId:'synthetic-package-memory'}]}));
const library=emptyLibrary(`account-${publicUserId}`);library.tags=['多语言タグ 🌸'];library.memories[snapshot.memories[0].key]=library.tags;
const sample={format:'gakumas-web-account-backup',version:1,publicUserId,exportedAt:'2026-10-04T01:00:00Z',snapshots:[snapshot],currentSnapshotId:await snapshotId(snapshot),selectionSnapshot:null,library,
  preferences:{tab:'memories',views:{memories:{query:'收藏'}},idolArt:{'card-example':'upgraded'}},savedViews:[{name:'收藏',view:{query:'收藏'}}]};

test('明文包保留标签和偏好，剔除附加字段与原始回忆 ID',async()=>{
  const wrapped=await encodeAccountPackage({...sample,unexpected:'drop',notes:{entries:[]}});
  assert.equal(wrapped.encrypted,false);assert.equal(inspectAccountPackage(wrapped),false);
  const clean=await decodeAccountPackage(JSON.parse(JSON.stringify(wrapped)));
  assert.deepEqual(clean.library,sample.library);
  assert.equal(clean.preferences.idolArt['card-example'],'upgraded');assert.equal(clean.savedViews[0].name,'收藏');
  assert.equal(clean.currentSnapshotId,await snapshotId(clean.snapshots[0]));
  assert.ok(!JSON.stringify(wrapped).includes('synthetic-package-memory'));assert.equal(clean.unexpected,undefined);assert.equal(clean.notes,undefined);
});
test('AES-GCM 密码往返使用独立随机盐与 IV，错误密码与篡改均拒绝',async()=>{
  const first=await encodeAccountPackage(sample,'synthetic-password'),second=await encodeAccountPackage(sample,'synthetic-password');
  assert.equal(first.encrypted,true);assert.notEqual(first.encryption.salt,second.encryption.salt);assert.notEqual(first.encryption.iv,second.encryption.iv);assert.notEqual(first.data,second.data);
  assert.ok(!JSON.stringify(first).includes(publicUserId));assert.ok(!JSON.stringify(first).includes(library.tags[0]));
  assert.deepEqual(await decodeAccountPackage(first,'synthetic-password'),await parseAccountBackup(sample));
  await assert.rejects(decodeAccountPackage(first,'wrong-password'),/密码错误或数据包已损坏/);
  const bytes=Buffer.from(first.data,'base64');bytes[0]^=1;
  await assert.rejects(decodeAccountPackage({...first,data:bytes.toString('base64')},'synthetic-password'),/密码错误或数据包已损坏/);
  assert.throws(()=>inspectAccountPackage({...first,encryption:{...first.encryption,iterations:999999999}}));
  assert.throws(()=>inspectAccountPackage({...first,version:99}));
  await assert.rejects(encodeAccountPackage(sample,'short'),/8–1024/);
});
test('账号身份、收藏库、活动快照与偏好类型必须通过校验',async()=>{
  for(const bad of [{...sample,publicUserId:'another'}, {...sample,library:{...library,profile:'account-another'}},
    {...sample,currentSnapshotId:'0'.repeat(64)}, {...sample,preferences:{views:{memories:{query:{}}}}},
    {...sample,selectionSnapshot:{publicUserId:'another'}}, {...sample,savedViews:[{name:'name',view:{page:-1}}]}])await assert.rejects(parseAccountBackup(bad));
});
test('当前包固定使用 gzip，重复内容压缩且解压后完全相同',async()=>{
  const input={...sample,savedViews:Array.from({length:30},(_,i)=>({name:`synthetic-view-${i}`,view:{query:'回忆备份测试 '.repeat(100)}}))};
  const clean=await parseAccountBackup(input),wrapped=await encodeAccountPackage(input);
  assert.equal(wrapped.version,1);assert.equal(wrapped.compression,'gzip');
  assert.ok(Buffer.byteLength(JSON.stringify(wrapped))<Buffer.byteLength(JSON.stringify(clean))*.7);
  assert.deepEqual(await decodeAccountPackage(wrapped),clean);
  assert.throws(()=>inspectAccountPackage({...wrapped,compression:'unknown'}));
  await assert.rejects(decodeAccountPackage({...wrapped,data:Buffer.from('not gzip').toString('base64')}),/压缩内容损坏/);
  const truncated=Buffer.from(wrapped.data,'base64').subarray(0,-8);
  await assert.rejects(decodeAccountPackage({...wrapped,data:truncated.toString('base64')}),/压缩内容损坏/);
});
test('明确拒绝早期格式和版本，不恢复旧明文或加密备份',async()=>{
  const current=await encodeAccountPackage(sample);
  for(const version of [1,2]){
    for(const encrypted of [false,true])await assert.rejects(decodeAccountPackage({...current,format:'gakumas-account-package',version,encrypted}));
    await assert.rejects(parseAccountBackup({...sample,format:'gakumas-account-backup',version}));
  }
  await assert.rejects(decodeAccountPackage({...current,version:2}));
});
test('所有收藏分区无损往返，缺少分区不能冒充空收藏',async()=>{
  const clean=await parseAccountBackup(sample);clean.library.favorites.idolCardSkins=['synthetic-skin'];clean.library.favorites.memories=['c'.repeat(64)];clean.library.favorites.selectionMemories=['d'.repeat(64)];
  assert.deepEqual((await decodeAccountPackage(await encodeAccountPackage(clean))).library,clean.library);
  delete clean.library.favorites.idolCardSkins;
  await assert.rejects(parseAccountBackup(clean));
});
