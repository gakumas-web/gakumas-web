import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSimulationLoadout} from '../application/contest-simulation-history.mjs';
import {createSavedLoadout} from '../application/contest-saved-loadouts.mjs';

test('手动保存保留自定义和还原依据，剔除账号身份并独立拷贝',()=>{
  const original={characterId:'hski',userMemoryId:'private-memory',publicUserId:'private-account',examBattleProduceCards:[{id:'original',upgradeCount:1,customizes:[]}],examBattleProduceItemIds:['item']};
  const draft={...original,examBattleProduceCards:[{id:'replacement',upgradeCount:1,customizes:[{id:'custom',customizeCount:2}]}]};
  const source={profile:'private-account',stage:{id:'stage',kind:'contest',planType:'ProducePlanType_Plan1'},loadout:captureSimulationLoadout([draft,original],{vocal:123},[original,original]),result:{largeLog:true}};
  const entry=createSavedLoadout(source,'  我的编组  ');
  assert.equal(entry.name,'我的编组');assert.equal(entry.loadout.memories[0].examBattleProduceCards[0].id,'replacement');assert.equal(entry.loadout.originals[0].examBattleProduceCards[0].id,'original');assert.equal(entry.loadout.manual.vocal,123);
  assert.equal(JSON.stringify(entry).includes('private'),false);assert.equal(entry.result,undefined);
  entry.loadout.memories[0].examBattleProduceCards[0].customizes[0].customizeCount=4;
  assert.equal(draft.examBattleProduceCards[0].customizes[0].customizeCount,2);assert.equal(source.loadout.memories[0].examBattleProduceCards[0].customizes[0].customizeCount,2);
});

test('历史另存不依赖模拟结果，重命名保留保存记录身份与编组',()=>{
  const source={stage:{id:'event',kind:'event',preset:{id:180}},loadout:{memories:[{characterId:'hski'},{characterId:'hski'}],manual:{dance:200}}};
  const entry=createSavedLoadout(source,'历史另存'),renamed=createSavedLoadout(entry,'新名称',entry);
  assert.equal(renamed.id,entry.id);assert.equal(renamed.createdAt,entry.createdAt);assert.equal(renamed.stageKey,'event:180');assert.deepEqual(renamed.loadout,entry.loadout);assert.equal(renamed.name,'新名称');
});
