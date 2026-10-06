import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installMaster, idolInfo} from '../domain/catalog.mjs';

installMaster({characters:{amao:'有村麻央'}, tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},
  idols:{cards:[{id:'card',characterId:'amao',assetId:'cidol-base',originalIdolCardSkinId:'base',name:'具体卡名',rarity:'IdolCardRarity_Ssr'}],
    skins:[{id:'base',idolCardId:'card',assetId:'cidol-base'}, {id:'alternate',idolCardId:'card',assetId:'cidol-alternate'},
      {id:'other-parent',idolCardId:'other',assetId:'cidol-other'}]}});
const held = {idolCardId:'card',idolCardSkinId:'',levelLimitRank:2,potentialRank:1};
test('无所选卡面且阶级低于3使用默认0图',()=>{
  const result=idolInfo(held);
  assert.equal(result.image,'img_general_cidol-base_0-full.webp');
  assert.equal(result.name,'具体卡名'); assert.equal(result.rarity,'SSR');
  assert.equal(result.rarityEnum,'IdolCardRarity_Ssr');
});
test('阶级3及以上使用默认1图',()=>{
  assert.equal(idolInfo({...held,levelLimitRank:3}).image,'img_general_cidol-base_1-full.webp');
});
test('显式默认卡面资源相同仍遵从持有阶级',()=>{
  assert.equal(idolInfo({...held,idolCardSkinId:'base',levelLimitRank:6}).image,'img_general_cidol-base_1-full.webp');
});
test('非默认卡面忽略阶级使用确切资源0图',()=>{
  const result=idolInfo({...held,idolCardSkinId:'alternate',levelLimitRank:6});
  assert.equal(result.image,'img_general_cidol-alternate_0-full.webp'); assert.equal(result.variant,'alternate');
});
test('错配父卡和未知所选卡面不冒充默认图',()=>{
  for (const idolCardSkinId of ['other-parent','unknown']) {
    const result=idolInfo({...held,idolCardSkinId});
    assert.equal(result.image,undefined); assert.equal(result.skinResolved,false); assert.equal(result.cardResolved,true);
  }
});
test('未知偶像卡不猜图',()=>{
  const result=idolInfo({...held,idolCardId:'unknown'});
  assert.equal(result.image,undefined); assert.equal(result.cardResolved,false);
});
