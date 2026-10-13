import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {installMaster,characterInfo} from '../domain/catalog.mjs';
import {selectionStarPotential} from '../domain/selection-memories.mjs';
import {contestCardCost,contestCapacityStatus} from '../domain/contest-card-cost.mjs';
import {validateCatalogMetadata,validateCommunityRules} from '../domain/reference-contract.mjs';
import {validateContentPart,contentHash} from '../domain/content-contract.mjs';
const reference=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/reference-data.json',import.meta.url)));
const tables={MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceCard:[],ProduceItem:[],ProduceExamEffect:[]};
const memory={star:810,produceItems:[{id:'pitem_00-3-265-0',triggerCount:16,reactionCount:16}]};
const card={rarity:'ProduceCardRarity_Ssr',upgradeCount:1,definition:{unlockProducerLevel:3}};

test('公开补充字段通过内容边界校验，非法规则即使哈希正确也拒绝',async()=>{
  validateCatalogMetadata(reference.catalogMetadata);validateCommunityRules(reference.communityRules);
  const check=async rules=>{
    const value={scope:'progression',revision:'a'.repeat(64),progression:{tables:{IdolCard:[],SupportCard:[]}},communityRules:rules},bytes=new TextEncoder().encode(JSON.stringify(value));
    return validateContentPart('progression.json',bytes,{files:{'progression.json':{revision:value.revision,bytes:bytes.length,sha256:await contentHash(bytes)}}});
  };
  await check(reference.communityRules);
  const bad=structuredClone(reference.communityRules);bad.contestCosts.rarities.SSR.upgraded=-1;await assert.rejects(check(bad),/content_part_invalid/);
  const badHif=structuredClone(reference.communityRules);badHif.hifStar.rounding='unknown';assert.throws(()=>validateCommunityRules(badHif));
  const badColor=structuredClone(reference.catalogMetadata);badColor.characterColors.hski='red';assert.throws(()=>validateCatalogMetadata(badColor));
});

test('重新安装内容更新颜色、HIF 和费用，缺失数据不恢复硬编码默认值',()=>{
  const input={tables,characters:{hski:'咲季'},...structuredClone(reference)};installMaster(input);
  assert.equal(characterInfo('hski').color,reference.catalogMetadata.characterColors.hski);
  assert.equal(selectionStarPotential(memory).final,1335);assert.equal(contestCardCost(card),204);
  input.catalogMetadata.characterColors.hski='#123456';input.communityRules.hifStar.finalCap=1000;input.communityRules.contestCosts.rarities.SSR.upgraded=205;
  installMaster(input);assert.equal(characterInfo('hski').color,'#123456');assert.equal(selectionStarPotential(memory).final,1000);assert.equal(contestCardCost(card),205);
  installMaster({tables,characters:{hski:'咲季'}});assert.equal(characterInfo('hski').color,undefined);assert.equal(selectionStarPotential(memory),null);assert.equal(contestCardCost(card),null);assert.equal(contestCapacityStatus(100,'S').range,null);
});
