import {inventory} from './fixtures.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSnapshot} from '../domain/model.mjs';
import {installMaster,supportInfo} from '../domain/catalog.mjs';
const sample=()=>inventory();
test('当前 schema 1 要求完整容器并拒绝旧版本',()=>{
 assert.deepEqual(parseSnapshot(sample()).supportCards,[]);
 for(const version of [2,3,4])assert.throws(()=>parseSnapshot({...sample(),schema_version:version}));
 for(const field of ['format','publicUserId','idolCards','items','idolCardSkins','supportCards','achievements','characters']){const value=sample();delete value[field];assert.throws(()=>parseSnapshot(value));}
});
test('支援卡养成字段拒绝错误类型且丢弃额外字段',()=>{
  const held={supportCardId:'fixture',level:10,levelLimitRank:2,stockQuantity:1,createdTime:1000,extra:'private'};
  const s={...sample(),supportCards:[held]};
  assert.equal(parseSnapshot(s).supportCards[0].extra,undefined);
  assert.throws(()=>parseSnapshot({...s,supportCards:[{...held,level:'10'}]}));
});
test('支援卡按公开目录精确匹配，未知不猜卡面',()=>{
  installMaster({tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},
    characters:{hski:'花海咲季'},supports:{cards:[{id:'fixture',name:'名前',assetId:'csprt-fixture',rarity:'SupportCardRarity_Ssr',type:'SupportCardType_Vocal',characterIds:['hski']}]}});
  const info=supportInfo({supportCardId:'fixture'});assert.equal(info.name,'名前');assert.equal(info.rarity,'SSR');assert.equal(info.image,'img_general_csprt-fixture_full.webp');
  assert.equal(supportInfo({supportCardId:'unknown'}).image,undefined);
});

import {compareConfigItems} from '../domain/memories.mjs';
test('比较逐项对齐，保留重复数量、强化差异和未记录状态',()=>{
  const a={id:'a',upgradeCount:0,customizes:[]},b={...a,upgradeCount:1};
  const rows=compareConfigItems([{examBattleProduceCards:[a,a,b]},{examBattleProduceCards:[b,a]},{}],'examBattleProduceCards');
  assert.deepEqual(rows.map(r=>r.counts),[[2,1,undefined],[1,1,undefined]]);
});

test('支援事件 P 道具按明确用途分类，缺少分类不猜测',()=>{
  const ids=['battle','training','unknown'];
  installMaster({tables:{ProduceCard:[],MemoryAbility:[],ProduceSkill:[],ProduceExamEffect:[],
    ProduceItem:ids.map((id,i)=>({id,name:id,definition:i===2?{}:{isExamEffect:i===0}})),
    ProduceEffect:[{id:'reward',definition:{produceRewards:ids.map(id=>({resourceType:'ProduceResourceType_ProduceItem',resourceId:id}))}}]},
    supports:{cards:[{id:'support',name:'支援',rarity:'SupportCardRarity_Ssr',type:'SupportCardType_Vocal',characterIds:[],events:[{effectIds:['reward']}]}]}});
  assert.deepEqual(supportInfo({supportCardId:'support'}).events[0].rewards.map(r=>[r.kind,r.use]),ids.map(id=>['item',id]));
});

test('支援触发时机将课程奖励前阶段归入课程结束，其余保持精确阶段',async()=>{
  const {supportEffectPhases}=await import('../domain/catalog.mjs');
  const phases=['EndLesson','EndLessonBeforePresent','StartPresent','EndStepEventSchool'];
  installMaster({tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},
    semantics:{tables:{ProduceTrigger:phases.map(id=>({id,phaseType:`ProducePhaseType_${id}`}))}}});
  assert.deepEqual(supportEffectPhases({beforeTriggers:phases}),['EndLesson','EndLesson','StartPresent','EndStepEventSchool']);
});
