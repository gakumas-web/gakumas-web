import test from 'node:test';
import assert from 'node:assert/strict';
import {installMaster} from '../domain/catalog.mjs';
import {supportEntries} from '../domain/catalog-selectors.mjs';
const groups={a:['a'],b:['b'],ab:['a','b'],abc:['a','b','c'],c:['c']};
installMaster({tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},
  supports:{cards:Object.entries(groups).map(([id,characterIds])=>({id,characterIds,name:id,rarity:'SupportCardRarity_Sr',type:'SupportCardType_Vocal',events:[]}))}});
const results=filters=>supportEntries({supportCards:[]},'','original',{ownership:'all',...filters}).map(row=>row.held.supportCardId);
test('关联角色默认同卡同时满足全部选择，关闭时匹配任意角色',()=>{
  assert.deepEqual(results({supportCharacter:['a','b']}),['ab','abc']);
  assert.deepEqual(results({supportCharacter:['a','b'],supportCharacterAll:false}),['a','b','ab','abc']);
  assert.deepEqual(results({supportCharacter:['a','c']}),['abc']);
});
test('空选择不限制，单个选择两种模式一致，未知关联不能冒充匹配',()=>{
  assert.deepEqual(results({supportCharacter:[]}),['a','b','ab','abc','c']);
  assert.deepEqual(results({supportCharacter:['a']}),results({supportCharacter:['a'],supportCharacterAll:false}));
  assert.deepEqual(results({supportCharacter:['missing']}),[]);
});
