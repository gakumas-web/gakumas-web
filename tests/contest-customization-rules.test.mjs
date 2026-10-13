import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {contestCustomizationLimits} from '../domain/contest-customization-rules.mjs';
import {validateCommunityRules} from '../domain/reference-contract.mjs';
const {communityRules}=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/reference-data.json',import.meta.url))),rules=communityRules.contestCustomizations;
test('Wiki 评级名额、单卡次数与专属解锁分别约束，未知评级不沿用容量别名',()=>{
  for(const [rank,cards,count] of [['A+',0,0],['S',3,6],['S+',3,6],['SS',3,6],['SS+',3,6],['SSS',4,9],['SSS+',4,9],['S4',4,9],['S4+',4,9],['S5',4,9]]){
    const value=contestCustomizationLimits(rank,{exclusiveUnlocked:true},rules);assert.equal(value.maxCustomizedCards,cards);assert.equal(value.maxCustomizeCount,count);
  }
  assert.equal(contestCustomizationLimits('SSS+',{},rules).maxCustomizeCount,8);
  assert.equal(contestCustomizationLimits('SSS',{},rules).guaranteedCounts.commonSecond,0);
  assert.equal(contestCustomizationLimits('SSS+',{},rules).guaranteedCounts.commonSecond,2);
  assert.ok(contestCustomizationLimits('S5',{},rules).provisional);
  assert.equal(contestCustomizationLimits('S5+',{},rules),null);
  assert.equal(contestCustomizationLimits('SSS+',{},null),null);
});
test('附魔来源合同拒绝非法名额与缺失上限',()=>{
  validateCommunityRules(communityRules);
  for(const mutate of [value=>value.ranks.S.cards.common=-1,value=>delete value.perCard.support,value=>value.ranks.S.guaranteedCounts.commonFirst=0.5]){
    const value=structuredClone(communityRules);mutate(value.contestCustomizations);assert.throws(()=>validateCommunityRules(value),/content_reference_invalid/);
  }
});

test('额外道具规则覆盖评级边界并拒绝无效名额',async()=>{
  const {contestExtraItemLimit}=await import('../domain/contest-item-rules.mjs');
  assert.equal(contestExtraItemLimit('SS+',communityRules.contestItems),2);
  assert.equal(contestExtraItemLimit('SSS',communityRules.contestItems),3);
  assert.equal(contestExtraItemLimit('S5+',communityRules.contestItems),3);
  assert.equal(contestExtraItemLimit('SSS',null),null);
  const bad=structuredClone(communityRules);bad.contestItems.ranks.SSS=-1;assert.throws(()=>validateCommunityRules(bad),/content_reference_invalid/);
});
