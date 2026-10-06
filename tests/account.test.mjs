import {inventory,captureHeader} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {accountProfile,profileAccountId,snapshotFitsProfile,validPublicUserId,maskedAccountId} from '../domain/account.mjs';
import {parseSnapshot,prepareSnapshot} from '../domain/model.mjs';
import {prepareSelectionSnapshot,restoreSelectionSnapshot} from '../domain/selection-memories.mjs';
import {restorePrepared} from '../application/history.mjs';
import {normalizeProfile} from '../application/view-state.mjs';

const ordinary=inventory();
const selection={...captureHeader(),source:'selection_memory_list',captured_at:'2026-10-02T00:00:00Z',count:0,selectionMemories:[],eventExpiredSelectionMemoryIds:[]};
const id='synthetic-account-A';

test('游戏公开 ID 决定档案，旧槽位不冒充账号，大小写不折叠',()=>{
  assert.equal(accountProfile(id),'account-synthetic-account-A');
  assert.equal(profileAccountId(accountProfile(id)),id);
  assert.equal(normalizeProfile(accountProfile(id)),accountProfile(id));
  assert.equal(profileAccountId('main'),null);
  assert.equal(validPublicUserId('with space'),false);
  assert.notEqual(accountProfile(id),accountProfile(id.toLowerCase()));
  assert.equal(snapshotFitsProfile({publicUserId:id},accountProfile(id)),true);
  assert.equal(snapshotFitsProfile({publicUserId:id},'main'),false);
  assert.equal(snapshotFitsProfile({},accountProfile(id)),false);
});

test('两类快照和工作副本保留账号 ID，缺失或无效身份均拒绝',async()=>{
  const normal=await prepareSnapshot({...ordinary,publicUserId:id});
  assert.equal((await restorePrepared(normal)).publicUserId,id);
  const selected=await prepareSelectionSnapshot({...selection,publicUserId:id});
  assert.equal(restoreSelectionSnapshot(selected).publicUserId,id);
  const noId={...ordinary};delete noId.publicUserId;assert.throws(()=>parseSnapshot(noId));
  const noSelectionId={...selection};delete noSelectionId.publicUserId;await assert.rejects(prepareSelectionSnapshot(noSelectionId));
  for(const invalid of ['',null,'contains space','x'.repeat(65)]){
    assert.throws(()=>parseSnapshot({...ordinary,publicUserId:invalid}));
    await assert.rejects(prepareSelectionSnapshot({...selection,publicUserId:invalid}));
  }
});

test('账号展示只遮蔽中间四位，真实身份及短 ID 的处理明确',()=>{
  assert.equal(maskedAccountId('123456789012'),'1234****9012');
  assert.equal(maskedAccountId('12345678901'),'123****8901');
  assert.equal(maskedAccountId('1234'),'****');
  assert.equal(maskedAccountId('1'),'****');
  assert.equal(maskedAccountId(null),'');
  assert.equal(accountProfile('123456789012'),'account-123456789012');
});
