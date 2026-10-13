import test from 'node:test';
import assert from 'node:assert/strict';
import {createContestMemoryDraft,contestSlotChoices,contestCustomizationValid,contestExtraItemCount,contestCardChanged,contestChoiceOwned} from '../domain/contest-loadout.mjs';
import {installMaster,contestCustomizationCatalog,contestFixedItemIds} from '../domain/catalog.mjs';

const choice=(id,source,plan='Plan1',ownerCharacterId='',use='battle')=>({id,metadata:{source,plan,ownerCharacterId,use}});
const context={memoryIndex:0,slotIndex:2,planType:2,characterId:'hski'};
const choices=[choice('common','common'),choice('free','common','Common'),choice('other-plan','common','Plan2'),choice('support','support'),choice('own-idol','idol','Plan1','hski'),choice('other-idol','idol','Plan1','ttmr')];
test('技能槽位只接受本计划及通用，首槽仅同角色专属，第二槽开放支援',()=>{
  const ids=options=>contestSlotChoices(choices,{...context,...options}).map(value=>value.id);
  assert.deepEqual(ids({}),['common','free']);
  assert.deepEqual(ids({slotIndex:1}),['common','free','support']);
  assert.deepEqual(ids({memoryIndex:0,slotIndex:0}),['own-idol']);
  assert.deepEqual(ids({memoryIndex:1,slotIndex:0}),['own-idol']);
  assert.deepEqual(ids({memoryIndex:1,slotIndex:1}),['common','free','support']);
  assert.deepEqual(ids({memoryIndex:1,slotIndex:3}),['common','free']);
});
test('P 道具仅主回忆可替换，限定比赛用途与对应计划、角色',()=>{
  const items=[...choices,choice('training','support','Plan1','','training')];
  assert.deepEqual(contestSlotChoices(items,{...context,kind:'item'}).map(value=>value.id),['support','own-idol']);
  assert.deepEqual(contestSlotChoices(items,{...context,kind:'item',memoryIndex:1}),[]);
});
test('编组副本将专属放在首槽，独立复制卡片、附魔及道具，不改写原回忆',()=>{
  const memory={key:'original',examBattleProduceCards:[{id:'common',upgradeCount:0,customizes:[]},{id:'exclusive',upgradeCount:1,customizes:[{id:'custom',customizeCount:1}]}],examBattleProduceItemIds:['item']},before=structuredClone(memory);
  const draft=createContestMemoryDraft(memory,'exclusive');assert.deepEqual(draft.examBattleProduceCards.map(card=>card.id),['exclusive','common']);
  draft.examBattleProduceCards[0].customizes[0].customizeCount=2;draft.examBattleProduceCards[1].upgradeCount=1;draft.examBattleProduceItemIds[0]='replacement';
  assert.deepEqual(memory,before);assert.equal(draft.key,memory.key);
});
test('附魔只接受目录等级并遵守累计上限，不能重复提交相同附魔项',()=>{
  const data={maximum:3,options:[{id:'a',levels:[{level:1},{level:2}]},{id:'b',levels:[{level:1},{level:2}]}]};
  assert.equal(contestCustomizationValid(data,[{id:'a',customizeCount:2},{id:'b',customizeCount:1}]),true);
  for(const values of [[{id:'a',customizeCount:3}],[{id:'unknown',customizeCount:1}],[{id:'a',customizeCount:2},{id:'b',customizeCount:2}],[{id:'a',customizeCount:1},{id:'a',customizeCount:1}]])assert.equal(contestCustomizationValid(data,values),false);
  assert.equal(contestCustomizationValid(null,[]),true);
});
test('自定义目录不以持有状态过滤，排除隐藏卡、麻烦卡和培养道具',()=>{
  const card=(id,upgradeCount,definition={},category='ProduceCardCategory_ActiveSkill')=>({id,upgradeCount,name:id,rarity:'ProduceCardRarity_Ssr',category,definition:{planType:'ProducePlanType_Plan1',...definition}});
  installMaster({tables:{ProduceCard:[card('free',0),card('free',1),card('free',2),card('free',3),card('support-unowned',0,{originSupportCardId:'support-not-owned'}),card('exclusive',0,{originIdolCardId:'unowned'}),{...card('legend',0),rarity:'ProduceCardRarity_Legend'},card('hidden',0,{libraryHidden:true}),card('trouble',0,{},'ProduceCardCategory_Trouble')],ProduceItem:[{id:'battle',name:'battle',definition:{isExamEffect:true,planType:'ProducePlanType_Common'}},{id:'training',name:'training',definition:{isExamEffect:false}}],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},idols:{cards:[{id:'unowned',characterId:'hski'}]}});
  const catalog=contestCustomizationCatalog();assert.deepEqual(catalog.cards.map(value=>value.id),['free','support-unowned','exclusive']);assert.deepEqual(catalog.cards[0].versions.map(value=>value.upgradeCount),[0,1]);
  assert.equal(catalog.cards[1].supportCardId,'support-not-owned');assert.equal(catalog.cards[1].metadata.source,'support');assert.equal(catalog.cards[2].metadata.ownerCharacterId,'hski');assert.deepEqual(catalog.items.map(value=>value.id),['battle']);
});

test('角色自带道具不占额外三槽容量，外加项按槽位计数',()=>{
  const fixed=new Set(['own']);
  assert.equal(contestExtraItemCount(['own'],fixed),0);
  assert.equal(contestExtraItemCount(['own','a','b'],fixed),2);
  assert.equal(contestExtraItemCount(['own','a','b','c'],fixed),3);
  assert.equal(contestExtraItemCount(['a','b','c'],new Set()),3);
  const items=[choice('self','idol','Plan1','hski'),choice('support','support'),choice('common','common')];
  assert.deepEqual(contestSlotChoices(items,{...context,kind:'item',includeIdolItems:false}).map(value=>value.id),['support']);
});
test('替换对照区分技能、强化与附魔修改，不把附魔记录顺序误判为替换',()=>{
  const base={id:'card',upgradeCount:1,customizes:[{id:'a',customizeCount:1},{id:'b',customizeCount:2}]};
  assert.equal(contestCardChanged(base,{...base,customizes:[...base.customizes].reverse()}),false);
  assert.equal(contestCardChanged(base,{...base,id:'other'}),true);
  assert.equal(contestCardChanged(base,{...base,upgradeCount:0}),true);
  assert.equal(contestCardChanged(base,{...base,customizes:[]}),true);
});
test('只有原回忆对应偶像卡自带的道具被固定，同角色其它卡的道具仍占容量',()=>{
  const item=(id,owner)=>({id,definition:{originIdolCardId:owner}});
  installMaster({tables:{ProduceCard:[],ProduceItem:[item('self','idol-a'),item('other','idol-b'),item('support','')],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]}});
  assert.deepEqual([...contestFixedItemIds({idolCardId:'idol-a',examBattleProduceItemIds:['self','other','support']})],['self']);
});

test('比赛排除剧本通用道具，但保留通用计划的支援道具',()=>{
  const items=[choice('scenario-common','common','Common'),choice('scenario-plan','common'),choice('support-common','support','Common'),choice('support-plan','support'),choice('support-other-plan','support','Plan2')];
  for(const slotIndex of [0,2,3])assert.deepEqual(contestSlotChoices(items,{...context,slotIndex,kind:'item',includeIdolItems:false}).map(value=>value.id),['support-common','support-plan']);
});

test('比赛候选排除 LEGEND，保留 N；持有筛选按来源卡判断并保留原槽位',()=>{
  const normal={...choice('normal','common'),unlockProducerLevel:2,metadata:{...choice('normal','common').metadata,rarity:'N'}},legend={...normal,id:'legend',metadata:{...normal.metadata,rarity:'LEGEND'}};
  assert.deepEqual(contestSlotChoices([normal,legend],context).map(value=>value.id),['normal']);
  const ownership={idolCardIds:new Set(['idol-owned']),supportCardIds:new Set(['support-owned']),producerLevel:2};
  assert.equal(contestChoiceOwned(normal,ownership),true);
  for(const [source,field,id] of [['idol','idolCardId','idol-owned'],['support','supportCardId','support-owned']]){
    const owned={...choice('owned',source),[field]:id},unowned={...owned,id:'unowned',[field]:'missing'};
    assert.equal(contestChoiceOwned(owned,ownership),true);assert.equal(contestChoiceOwned(unowned,ownership),false);assert.equal(contestChoiceOwned(unowned,ownership,'unowned'),true);
  }
});
