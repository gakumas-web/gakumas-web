import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedValues,matchesAny} from '../domain/model.mjs';

test('当前单选与多选统一匹配，多选去重且不修改原条件',()=>{
  assert.deepEqual(selectedValues('amao'),['amao']);
  assert.deepEqual(selectedValues(''),[]);
  const values=['amao','ttmr','amao'];
  assert.deepEqual(selectedValues(values),['amao','ttmr']);
  assert.equal(values.length,3);
});
test('组内满足任意项，空选择不限制；跨组分别匹配',()=>{
  assert.equal(matchesAny([],[]),true);
  assert.equal(matchesAny(['amao','ttmr'],['ttmr']),true);
  assert.equal(matchesAny(['review','buff'],['buff']),true);
  assert.equal(matchesAny(['review'],[]),false);
  assert.equal(matchesAny(['amao','ttmr'],['ttmr'])&&matchesAny(['review'],['buff']),false);
});
