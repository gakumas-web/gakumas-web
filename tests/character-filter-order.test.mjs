import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCharacterFilters} from '../domain/catalog.mjs';
import {setLocale} from '../i18n.mjs';
const expected=['hski','ttmr','fktn','hume','hmsz','jsna','kllj','ssmk','kcna','shro','hrnm','amao','atbm','nasr'];
test('角色筛选按指定顺序排列，中日界面保持一致',()=>{
  for(const locale of ['zh-CN','ja']){
    setLocale(locale);assert.deepEqual([...expected].reverse().sort(compareCharacterFilters),expected);
  }
  setLocale('zh-CN');
});
test('新增角色保留且排在现有角色之后，根緒亜紗里始终置后',()=>{
  assert.deepEqual(['nasr','new-b','ttmr','new-a','hski'].sort(compareCharacterFilters),['hski','ttmr','new-a','new-b','nasr']);
});
