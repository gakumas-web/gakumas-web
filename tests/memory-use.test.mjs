import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryUse,parseSnapshot} from '../domain/model.mjs';
import {inventory} from './fixtures.mjs';

test('活动来源与空比赛配置联合识别，单凭空数组不能判断用途',()=>{
  const empty={examBattleProduceCards:[],examBattleProduceItemIds:[]};
  assert.equal(memoryUse({...empty,researchId:'event-reference'}),'training');
  assert.equal(memoryUse(empty),'unknown');
  assert.equal(memoryUse({...empty,researchId:''}),'unknown');
  assert.equal(memoryUse({researchId:'event-reference'}),'unknown');
  assert.equal(memoryUse({...empty,examBattleProduceCards:[{id:'card'}]}),'battle');
  assert.equal(memoryUse({...empty,researchId:'event-reference',examBattleProduceCards:[{id:'card'}]}),'unknown');
});

test('合成库存解析保留活动来源与五张比赛卡配置',()=>{
  const base={characterId:'synthetic-character',planType:1,idolCardId:'synthetic-idol',produceCard:null,abilities:[],examBattleProduceItemIds:[],unitCharacters:[]};
  const cards=Array.from({length:5},(_,i)=>({id:'synthetic-card-'+i,upgradeCount:0,customizes:[]}));
  const data=parseSnapshot(inventory({memories:[
    {...base,userMemoryId:'synthetic-training',researchId:'synthetic-event',examBattleProduceCards:[]},
    {...base,userMemoryId:'synthetic-battle',researchId:'',examBattleProduceCards:cards},
  ]}));
  assert.deepEqual(data.memories.map(memoryUse),['training','battle']);
  assert.equal(data.memories[1].examBattleProduceCards.length,5);
});

