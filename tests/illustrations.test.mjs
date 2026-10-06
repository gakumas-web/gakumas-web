import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installMaster, cardInfo, plainText, characterInfo, itemArt} from '../domain/catalog.mjs';

const card = {id:'skill',upgradeCount:1,customizes:[{id:'custom',customizeCount:2}]};
installMaster({characters:{hski:'花海咲季',kllj:'葛城リーリヤ'},tables:{
  ProduceCard:[{id:'skill',upgradeCount:0,name:'未强化',images:{common:'img_base.webp'}},
    {id:'skill',upgradeCount:1,name:'<nobr>技能+</nobr>',isCharacterAsset:true,
      images:{hski:'img_skill-hski.webp',kllj:'img_skill-kllj.webp'},rarity:'ProduceCardRarity_Ssr',category:'ProduceCardCategory_ActiveSkill'}],
  ProduceItem:[{id:'pitem',name:'P 道具',image:'img_item.webp',isUpgraded:true}],
  MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]}});
test('实际角色决定专属图且未知角色不猜图',()=>{
  assert.equal(cardInfo(card,'hski').image,'img_skill-hski.webp');
  assert.equal(cardInfo(card,'kllj').image,'img_skill-kllj.webp');
  assert.equal(cardInfo(card,'unknown').image,undefined);
});
test('二元组联接与字符串枚举保留强化自定义',()=>{
  const info=cardInfo(card,'hski');
  assert.equal(info.name,'技能+'); assert.equal(info.rarity,'Ssr'); assert.equal(info.category,'Active');
  assert.equal(info.upgrade,1); assert.equal(info.customizes,2);
  assert.equal(cardInfo({...card,upgradeCount:0},'hski').image,'img_base.webp');
});
test('富文本变为纯文本而非保留 Unity 标签',()=>{
  assert.equal(plainText('<nobr><color=#ff0000>效果</color></nobr><br>+3 &amp; 体力'),'效果\n+3 & 体力');
});
test('角色保持原名且普通道具不借用 P 道具映射',()=>{
  assert.equal(characterInfo('hski').name,'花海咲季');
  assert.equal(characterInfo('unknown').portrait,undefined);
  assert.equal(itemArt('pitem').image,'img_item.webp');
  assert.equal(itemArt('ordinary-item').image,undefined);
});
