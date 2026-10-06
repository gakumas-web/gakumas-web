import test from 'node:test';
import assert from 'node:assert/strict';
import {canCompareMemory,comparisonFieldEntries} from '../domain/memories.mjs';
const card=(upgradeCount=0,customizes=[])=>({id:'skill',upgradeCount,customizes});
test('比较入口限非空考试卡组，重复数量、强化、附魔和缺失状态各自参与差异',()=>{
  assert.equal(canCompareMemory({examBattleProduceCards:[]}),false);assert.equal(canCompareMemory({}),false);assert.equal(canCompareMemory({examBattleProduceCards:[card()]}),true);
  const result=comparisonFieldEntries([{examBattleProduceCards:[card(),card()]},{examBattleProduceCards:[card(),card(1)]},{examBattleProduceCards:[card(0,[{id:'custom',customizeCount:1}])]},{ }],'examBattleProduceCards');
  assert.equal(result.rows[0][0].count,2);assert.equal(result.rows[3],null);assert.equal(result.different.size,3);
  assert.equal(comparisonFieldEntries([{examBattleProduceCards:[card()]},{examBattleProduceCards:[card()]}],'examBattleProduceCards').hasDifference,false);
  assert.equal(comparisonFieldEntries([{produceCard:card(),produceCardPhaseType:1},{produceCard:card(),produceCardPhaseType:2}],'produceCard').hasDifference,true);
});
