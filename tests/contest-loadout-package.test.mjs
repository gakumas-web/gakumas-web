import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {installMaster} from '../domain/catalog.mjs';
import {createLoadoutPackage,parseLoadoutPackage,readLoadoutPackage,inspectLoadoutPackage,materializeLoadoutImport,LOADOUT_PACKAGE_FILE_LIMIT,LOADOUT_PACKAGE_ENTRY_LIMIT} from '../application/contest-loadout-package.mjs';
const reference={id:'exclusive',upgradeCount:0,customizes:[]};
const memory={characterId:'hski',idolCardId:'idol',planType:2,vocal:1200,dance:1100,visual:1000,stamina:40,grade:10,produceCard:reference,examBattleProduceCards:[reference],examBattleProduceItemIds:[]};
const source=()=>({id:'old-id',profile:'secret-profile',lifecycleId:'secret-lifecycle',name:'合成编组',createdAt:'2025-01-01T00:00:00Z',stage:{id:'contest:season:0',kind:'contest',seasonNumber:1,stageNumber:1,planType:'ProducePlanType_Plan1',preset:{id:1,name:'stage',profile:'secret-preset'}},loadout:{memories:[0,1].map(()=>({...structuredClone(memory),key:'secret-memory',publicUserId:'secret-account'})),originals:[memory,memory],manual:{vocal:123.4}},result:{log:'secret-log'}});
function install(){installMaster({communityRules:JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/reference-data.json',import.meta.url))).communityRules,tables:{ProduceCard:[{...reference,name:'exclusive',rarity:'ProduceCardRarity_Ssr',definition:{originIdolCardId:'idol',planType:'ProducePlanType_Plan1',maxCustomizeCount:1}},...Array.from({length:5},(_,index)=>({id:'common-'+index,upgradeCount:0,name:'common',rarity:'ProduceCardRarity_Ssr',definition:{planType:'ProducePlanType_Plan1',unlockProducerLevel:5}}))],ProduceItem:[],ProduceEffect:[],ProduceExamEffect:[],ProduceSkill:[],MemoryAbility:[]},idols:{cards:[{id:'idol',characterId:'hski',planType:'ProducePlanType_Plan1',rarity:'IdolCardRarity_Ssr'}]},contests:{tables:{PvpRateConfig:[{id:'season',stages:[{planType:'ProducePlanType_Plan1'}]}]},stagePresets:[]}});}
test('编组文件逐层白名单去除账号回忆身份和日志，版本只属于导出元数据',()=>{
  const input=source(),data=createLoadoutPackage([input],{contentVersion:'current-release',exportedAt:'2026-10-16T00:00:00Z'}),text=JSON.stringify(data);
  assert.equal(text.includes('secret'),false);assert.equal(text.includes('old-id'),false);assert.equal(text.includes('2025-01-01'),false);
  assert.deepEqual(data.exportMetadata,{exportedAt:'2026-10-16T00:00:00Z',contentVersion:'current-release'});
  assert.equal(data.entries[0].loadout.manual.vocal,123.4);assert.deepEqual(Object.keys(data.entries[0]),['name','stage','loadout']);
  data.entries[0].loadout.memories[0].vocal=0;assert.equal(input.loadout.memories[0].vocal,1200);
});
test('合法导入每次生成新身份且不复制文件来源时间或模拟结果',()=>{
  install();const data=createLoadoutPackage([source()]),preview=inspectLoadoutPackage(data,{idolCards:[],supportCards:[]}),first=materializeLoadoutImport(preview),second=materializeLoadoutImport(preview);
  assert.notEqual(first[0].id,second[0].id);assert.notEqual(first[0].id,'old-id');assert.equal(first[0].profile,undefined);assert.equal(first[0].result,undefined);
  assert.equal(preview[0].status,'check');assert.ok(preview[0].reasons.includes('ownership'));
});
test('外部文件拒绝未知字段、坏舞台、缺字段、越界和非安全整数，不补默认值',()=>{
  const cases=[data=>data.profile='bad',data=>data.entries[0].loadout.originals=null,data=>data.entries[0].loadout.memories[0].key='bad',data=>data.entries[0].stage.preset.private='bad',data=>data.version=2,data=>data.entries[0].stage.kind='bad',data=>delete data.entries[0].loadout.manual,data=>data.entries[0].loadout.memories[0].vocal=Number.MAX_SAFE_INTEGER+1,data=>data.entries[0].loadout.memories[0].grade=999,data=>data.entries[0].loadout.memories[0].examBattleProduceCards[0].upgradeCount=-1,data=>data.entries[0].loadout.memories[0].examBattleProduceCards[0].customizes=[{id:'a',customizeCount:0}],data=>data.entries=Array(LOADOUT_PACKAGE_ENTRY_LIMIT+1).fill(data.entries[0])];
  for(const mutate of cases){const data=createLoadoutPackage([source()]);mutate(data);assert.throws(()=>parseLoadoutPackage(data),{code:'loadout_package_invalid'});}
});
test('文件大小在读取之前限制，损坏JSON拒绝整份导入',async()=>{
  let read=false;await assert.rejects(readLoadoutPackage({size:LOADOUT_PACKAGE_FILE_LIMIT+1,text(){read=true;}}),{code:'loadout_package_too_large'});assert.equal(read,false);
  await assert.rejects(readLoadoutPackage(new Blob(['{broken'])),{code:'loadout_package_invalid'});
  assert.equal((await readLoadoutPackage(new Blob([JSON.stringify(createLoadoutPackage([source()]))]))).entries.length,1);
});
test('当前目录检查未知舞台、卡片和失效附魔，包括还原依据',()=>{
  install();const missing=createLoadoutPackage([source()]);missing.entries[0].stage.id='missing';delete missing.entries[0].stage.preset;missing.entries[0].loadout.memories[0].examBattleProduceCards[0].id='unknown';
  const [row]=inspectLoadoutPackage(missing);assert.ok(row.reasons.includes('stage'));assert.ok(row.reasons.includes('catalog'));
  for(const key of ['memories','originals']){const data=createLoadoutPackage([source()]);data.entries[0].loadout[key][0].examBattleProduceCards[0].customizes=[{id:'invalid',customizeCount:1}];assert.ok(inspectLoadoutPackage(data)[0].reasons.includes('catalog'));}
});

// 使用正式舞台构造器验证三类公开舞台摘要，而非在文件测试中伪造恢复逻辑。
test('实际舞台合同中的空轮次与活动字母舞台可往返',async()=>{
  const {createContestCatalog}=await import('../domain/contest-simulation.mjs');
  const presets=[{id:184,type:'contest',season:53,stage:1,round:'',name:'',plan:'sense',turnCounts:{vocal:3,dance:4,visual:3}},{id:34,type:'event',stage:'A',round:1,name:'event',plan:'sense',turnCounts:{vocal:3,dance:4,visual:3}},{id:99,type:'linkContest',stage:'A',round:'',name:'link',plan:'sense',turnCounts:{vocal:3,dance:4,visual:3}}];
  const choices=createContestCatalog({PvpRateConfig:[{id:'pvp_rate_config-53',stages:[{planType:'ProducePlanType_Plan1'}]}]},presets).choices;
  for(const stage of choices){const value=source();value.stage=stage;const parsed=createLoadoutPackage([value]);assert.equal(parsed.entries[0].stage.kind,stage.kind);assert.equal(parsed.entries[0].stage.preset.id,stage.preset.id);}
});

test('可载入状态要求实际目录和当前账号持有、评级容量全部可核验',()=>{
  install();const data=createLoadoutPackage([source()]);
  for(const memory of data.entries[0].loadout.memories){memory.grade=15;memory.examBattleProduceCards=[structuredClone(reference),...Array.from({length:5},(_,index)=>({id:'common-'+index,upgradeCount:0,customizes:[]}))];}
  const context={idolCards:[{idolCardId:'idol',levelLimitRank:0,potentialRank:0}],supportCards:[],producerLevel:60};
  const [ready]=inspectLoadoutPackage(data,context);assert.equal(ready.status,'loadable');assert.deepEqual(ready.reasons,[]);
  assert.ok(inspectLoadoutPackage(data,{...context,producerLevel:null})[0].reasons.includes('ownership'));
  const mismatched=structuredClone(data);mismatched.entries[0].loadout.originals[0].idolCardId='unknown-and-unowned';mismatched.entries[0].loadout.originals[0].characterId='different-character';
  const [review]=inspectLoadoutPackage(mismatched,context);assert.equal(review.status,'check');assert.ok(review.reasons.includes('catalog'));assert.ok(review.reasons.includes('ownership'));
});
