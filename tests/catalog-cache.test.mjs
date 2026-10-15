import test from 'node:test';
import assert from 'node:assert/strict';
import {installMaster,supportInfo} from '../domain/catalog.mjs';
import {setLocale,t} from '../i18n.mjs';
import {createSemantics} from '../domain/semantic-model.mjs';

const tables={ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]};
const master=name=>({tables,supports:{cards:[{id:'card',name,rarity:'SupportCardRarity_SSR',type:'SupportCardType_Assist',characterIds:[]}]}});
test('公开支援说明可跨持有等级复用，语言与重新安装目录不能沿用旧说明',()=>{
  setLocale('zh-CN');installMaster(master('旧目录'));
  const first=supportInfo({supportCardId:'card',level:1});
  assert.equal(supportInfo({supportCardId:'card',level:60}),first);
  setLocale('ja');const japanese=supportInfo({supportCardId:'card'});
  assert.equal(japanese.type,t('辅助'));assert.notEqual(japanese,first);
  installMaster(master('新目录'));
  assert.equal(supportInfo({supportCardId:'card'}).name,'新目录');setLocale('zh-CN');
});
test('共用公开技能说明时，实际附魔和原始记录引用仍逐条生成',()=>{
  const semantics=createSemantics({...tables,ProduceCard:[{id:'skill',upgradeCount:0,name:'技能',descriptions:[{produceDescriptionType:'ProduceDescriptionType_PlainText',text:'集中+2'}]}]});
  const plain={id:'skill',upgradeCount:0,customizes:[]},customized={...plain,customizes:[{id:'unknown',customizeCount:1}]};
  const first=semantics.card(plain),second=semantics.card(customized);
  assert.equal(first.sourceText,second.sourceText);
  assert.equal(first.customizations.length,0);assert.equal(second.customizations.length,1);
  assert.equal(first.technical.entry,plain);assert.equal(second.technical.entry,customized);
  assert.notDeepEqual(first.lines,second.lines);
});


test('支援卡计数不解析事件，展示与奖励检索仍可取得并复用完整事件',async()=>{
  const {supportEntries}=await import('../domain/catalog-selectors.mjs');
  const input=master('支援卡');let reads=0;
  input.supports.cards[0].events=[{get descriptions(){reads++;return [{produceDescriptionType:'ProduceDescriptionType_PlainText',text:'测试事件'}];},effectIds:[]}];
  installMaster(input);
  const entries=supportEntries({supportCards:[{supportCardId:'card'}]},'','original',{});
  assert.equal(entries.length,1);assert.equal(reads,0);
  const events=entries[0].info.events;
  assert.equal(events[0].text,'测试事件');assert.ok(reads>0);
  const parsed=reads;assert.strictEqual(entries[0].info.events,events);assert.equal(reads,parsed);
  assert.equal(supportEntries({supportCards:[{supportCardId:'card'}]},'测试事件','original',{}).length,1);
});

test('目录重装同步更新技能分类、能力分组及成就入口，不沿用上一代缓存',async()=>{
  const {catalogGeneration,selectionChoiceMetadata,abilityFilterClauses,abilitySummaries,achievementCharacterIds,achievementEntries,achievementViewCounts}=await import('../domain/catalog.mjs');
  const input=type=>({tables:{...tables,
    ProduceCard:[{id:'card',upgradeCount:0,definition:{planType:'ProducePlanType_'+(type==='Vocal'?'Plan1':'Plan2')},descriptions:[]}],
    MemoryAbility:[{id:'ability',skillId:'skill',level:1,definition:{}}],
    ProduceSkill:[{id:'skill',level:1,produceEffectId1:'effect',produceTriggerId1:'p_trigger-produce_start',descriptions:[]}],
    ProduceEffect:[{id:'effect',produceEffectType:'ProduceEffectType_'+type+'Addition',effectValueMin:20,effectValueMax:20}]},
    achievements:{Achievement:[{id:type,name:type,description:'目标{threshold}',category:'AchievementCategory_Idol',characterId:type==='Vocal'?'hski':'ttmr'}],AchievementProgress:[{achievementId:type,threshold:1,index:0,rewards:[]}]}});
  installMaster(input('Vocal'));const generation=catalogGeneration(),first=selectionChoiceMetadata('card',{id:'card',upgradeCount:0}),ability=abilitySummaries({abilities:[{id:'ability',level:1}]})[0];
  abilityFilterClauses(['ability']);assert.equal(first.plan,'Plan1');assert.ok(achievementCharacterIds().includes('hski'));
  installMaster(input('Dance'));const second=selectionChoiceMetadata('card',{id:'card',upgradeCount:0}),nextAbility=abilitySummaries({abilities:[{id:'ability',level:1}]})[0];
  assert.equal(catalogGeneration(),generation+1);assert.equal(second.plan,'Plan2');assert.notEqual(second,first);assert.notDeepEqual(nextAbility,ability);
  assert.deepEqual(abilityFilterClauses(['ability']),[['ability']]);assert.ok(achievementCharacterIds().includes('ttmr'));assert.ok(!achievementCharacterIds().includes('hski'));
  assert.equal(achievementEntries(undefined,{achievementSection:'achievement'})[0].name,'Dance');assert.deepEqual(achievementViewCounts(undefined,{}),{count:1,total:1});
});
