import test from 'node:test';
import assert from 'node:assert/strict';
import {installMaster} from '../domain/catalog.mjs';
import {missingSelectionRewards} from '../domain/selection-memories.mjs';

test('未取得项按阵容等级、计划与专属归属筛选，忽略技能强化差异并去重',()=>{
  const definition={originSupportCardId:'support',planType:'ProducePlanType_Plan1'};
  const rewards=[['ProduceCard','skill'],['ProduceItem','item'],['ProduceItem','other-plan'],['ProduceItem','common']].map(([type,resourceId])=>({resourceType:'ProduceResourceType_'+type,resourceId,resourceLevel:0}));
  installMaster({tables:{ProduceCard:[{id:'skill',upgradeCount:0,definition}],ProduceItem:[{id:'item',definition},{id:'other-plan',definition:{...definition,planType:'ProducePlanType_Plan2'}},{id:'common',definition:{}}],MemoryAbility:[],ProduceSkill:[],ProduceExamEffect:[],ProduceEffect:[{id:'reward',definition:{produceRewards:rewards}}]},supports:{cards:[{id:'support',events:[{unlockLevel:10,effectIds:['reward']},{unlockLevel:20,effectIds:['reward']}]}]}});
  const memory={planType:2,produceItems:[],produceCards:[]};
  const detail={supportCards:[{supportCardId:'support',level:20,isRental:true}]};
  assert.deepEqual(missingSelectionRewards(memory,detail).map(r=>[r.kind,r.value.id]),[['cards','skill'],['items','item']]);
  assert.deepEqual(missingSelectionRewards({...memory,produceCards:[{id:'skill',upgradeCount:2,customizes:[]}],produceItems:[{id:'item'}]},detail),[]);
  assert.deepEqual(missingSelectionRewards(memory,{supportCards:[{supportCardId:'support',level:1}]}),[]);
  assert.equal(missingSelectionRewards(memory),null);
});
