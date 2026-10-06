import {inventory,memoryRecord} from './fixtures.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshot, configKey, shotDate } from '../domain/model.mjs';

const memory=()=>memoryRecord({characterId:'character',planType:1,idolCardId:'idol'});
const snapshot=(m=memory())=>inventory({memories:[m]});

test('当前完整快照拒绝缺失属性', () => {
  const input = snapshot();
  delete input.memories[0].vocal;
  assert.throws(()=>parseSnapshot(input));
});
test('拍摄日期按毫秒解释', () => {
  const input = {shotTime: Date.UTC(2026, 8, 28, 12)};
  assert.match(shotDate(input), /^2026\/09\/28$/);
});
test('拒绝重复身份与错误嵌套类型', () => {
  const input = snapshot();
  input.memories.push(memory()); input.count = 2;
  assert.throws(() => parseSnapshot(input));
  assert.throws(() => parseSnapshot(snapshot({ ...memory(), abilities: [{id: 'a', level: '1'}] })));
});
test('多重集忽略顺序而保留重复与强化', () => {
  const a = { id: 'card', upgradeCount: 0, customizes: [{id: 'x', customizeCount: 1}] };
  const b = { id: 'other', upgradeCount: 1, customizes: [] };
  const input = {...memory(), examBattleProduceCards: [a, b, a]};
  assert.equal(configKey(input), configKey({...input, examBattleProduceCards: [b, a, a]}));
  assert.notEqual(configKey(input), configKey({...input, examBattleProduceCards: [a, b]}));
  assert.notEqual(configKey(input), configKey({...input, examBattleProduceCards: [a, b, {...a, upgradeCount: 1}]}));
  assert.notEqual(configKey(input), configKey({...input, examBattleProduceCards: [a, b, {...a, customizes: []}]}));
});
test('不完整配置不参与分组', () => {
  const input = memory(); delete input.abilities;
  assert.equal(configKey(input), null);
});
test('丢弃图片路径与未知账户字段', () => {
  const result = parseSnapshot(snapshot({...memory(), imagePath: 'private', account: 'private'}));
  assert.equal('imagePath' in result.memories[0], false);
  assert.equal('account' in result.memories[0], false);
});
