import {test} from 'node:test';
import assert from 'node:assert/strict';
import {producerLevelFromExp,validProducerLevels,commonCardUnlocked,producerLevelCap} from '../domain/producer-level.mjs';
import {parseSnapshot,prepareSnapshot} from '../domain/model.mjs';
import {restorePrepared} from '../application/history.mjs';
import {contestChoiceOwned} from '../domain/contest-loadout.mjs';
import {inventory} from './fixtures.mjs';
const levels=[{level:1,totalExp:0},{level:2,totalExp:40},{level:3,totalExp:160}];
test('累计经验按门槛换算；零经验、刚好达到、上限与未知不混淆',()=>{
 for(const [exp,want] of [[0,1],[39,1],[40,2],[159,2],[160,3],[999,3],[undefined,null],[null,null],[-1,null],['40',null]])assert.equal(producerLevelFromExp(exp,levels),want);
 for(const table of [undefined,[],[{level:2,totalExp:0}],[levels[0],{level:2,totalExp:0}],[levels[0],{level:3,totalExp:40}]]){assert.equal(validProducerLevels(table),false);assert.equal(producerLevelFromExp(40,table),null);}
});
test('经验可选但提供时严格校验，导入与历史恢复保留字段且不改回忆',async()=>{
 const old=inventory();assert.equal(Object.hasOwn(parseSnapshot(old),'producerExp'),false);
 for(const value of [null,-1,1.5,'40',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>parseSnapshot({...old,producerExp:value}));
 for(const value of [0,40]){
  const next={...old,producerExp:value},before=structuredClone(next),prepared=await prepareSnapshot(next);
  assert.equal(prepared.producerExp,value);assert.equal((await restorePrepared(prepared)).producerExp,value);
  assert.deepEqual(parseSnapshot(next).memories,parseSnapshot(old).memories);assert.deepEqual(next,before);
 }
});
test('通用技能用普通解锁等级，未知不当作已持有；原槽位可以保留',()=>{
 const choice={id:'common',metadata:{source:'common'},unlockProducerLevel:2,rentalUnlockProducerLevel:1};
 for(const [level,want] of [[1,false],[2,true],[3,true],[null,null],[undefined,null]])assert.equal(commonCardUnlocked(choice,level),want);
 const owner={idolCardIds:new Set(),supportCardIds:new Set()};
 assert.equal(contestChoiceOwned(choice,{...owner,producerLevel:1}),false);
 assert.equal(contestChoiceOwned(choice,{...owner,producerLevel:2}),true);
 assert.equal(contestChoiceOwned(choice,owner),false);
 assert.equal(contestChoiceOwned(choice,owner,'common'),true);
 assert.equal(commonCardUnlocked({...choice,unlockProducerLevel:undefined},80),null);
});

test('内容合同接受旧包缺表，但拒绝带有错误门槛的新包',async()=>{
 const {validateContentPart,contentHash}=await import('../domain/content-contract.mjs');
 for(const [table,valid] of [[undefined,true],[levels,true],[[],false],[[{level:1,totalExp:1}],false]]){
  const value={scope:'progression',revision:'a'.repeat(64),progression:{tables:{IdolCard:[],SupportCard:[],...(table===undefined?{}:{ProducerLevel:table})}}};
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  const manifest={files:{'progression.json':{bytes:bytes.length,sha256:await contentHash(bytes),revision:value.revision}}};
  if(valid)await validateContentPart('progression.json',bytes,manifest);else await assert.rejects(validateContentPart('progression.json',bytes,manifest));
 }
});

test('旧 Web 丢弃经验后，重新导入同一时间快照可补回经验而不改回忆',async()=>{
 const {prepareAccountDirectory,combineAccountDirectory}=await import('../domain/account-import.mjs');
 const input=inventory(),old=await prepareSnapshot(input);
 const next=combineAccountDirectory(await prepareAccountDirectory([{...input,producerExp:40}]),{snapshot:old});
 assert.equal(next.snapshot.producerExp,40);assert.deepEqual(next.snapshot.memories,old.memories);
});

test('目录传递普通解锁门槛，按基础版本取值且不依赖强化行顺序',async()=>{
 const {installMaster,contestCustomizationCatalog,accountProducerLevel}=await import('../domain/catalog.mjs');
 const card=(upgradeCount,unlockProducerLevel)=>({id:'common-level',name:'合成技能',upgradeCount,rarity:'ProduceCardRarity_R',definition:{unlockProducerLevel,rentalUnlockProducerLevel:1,planType:'ProducePlanType_Common'}});
 installMaster({progression:{tables:{ProducerLevel:levels}},tables:{ProduceCard:[card(1,0),card(0,2)],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]}});
 assert.equal(contestCustomizationCatalog().cards[0].unlockProducerLevel,2);
 assert.equal(accountProducerLevel(40),2);
 installMaster({tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]}});assert.equal(accountProducerLevel(40),null);
});

test('满级经验跟随公开表上限，拒绝缺失或不连续的等级表',()=>{
 assert.deepEqual(producerLevelCap(levels),{level:3,totalExp:160});
 const newer=[...levels,{level:4,totalExp:320}];assert.deepEqual(producerLevelCap(newer),{level:4,totalExp:320});
 for(const rows of [undefined,[],[levels[0],levels[2]]])assert.equal(producerLevelCap(rows),null);
 const cap=producerLevelCap(levels);cap.totalExp=999;assert.equal(levels.at(-1).totalExp,160);
});
