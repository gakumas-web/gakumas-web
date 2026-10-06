import {inventory,captureHeader} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSelectionSnapshot,prepareSelectionSnapshot,restoreSelectionSnapshot,selectionEntries} from '../domain/selection-memories.mjs';
import {parseSnapshot} from '../domain/model.mjs';
import {createViews} from '../application/view-state.mjs';
function memory(id='selection-example'){
  return {userSelectionMemoryId:id,memoryTagId:'',assetId:'',produceId:'public-produce',characterId:'hski',idolCardId:'public-card',idolCardSkinId:'',researchId:'',grade:13,planType:2,idolCardLevelLimitRank:0,idolCardPotentialRank:0,vocal:100,dance:200,visual:300,vocalGrowthRatePermil:100,danceGrowthRatePermil:200,visualGrowthRatePermil:300,stamina:30,star:810,clearedTime:1700000000000,lastUsedTime:0,isProtected:false,isPrimaStella:false,
    produceCards:[{id:'skill',upgradeCount:1,customizes:[{id:'custom',customizeCount:2}],fromMemory:true}],produceItems:[{id:'item',triggerCount:2,reactionCount:3}],produceCustomizeItems:[{id:'custom-item',triggerCount:1,reactionCount:0}]};
}
const snapshot=(rows=[memory()])=>({...captureHeader(),source:'selection_memory_list',captured_at:'2026-09-30T14:53:27Z',count:rows.length,selectionMemories:rows,eventExpiredSelectionMemoryIds:[]});
test('选拔快照独立合同，空快照可导入而不能冒充普通库存',()=>{
  assert.equal(parseSelectionSnapshot(snapshot([])).count,0);
  assert.throws(()=>parseSnapshot(snapshot()));
  assert.throws(()=>parseSelectionSnapshot({schema_version:1,source:'User.Get',captured_at:'2026-09-30',count:0,memories:[]}));
  assert.throws(()=>parseSelectionSnapshot({...snapshot(),count:0}));
  assert.throws(()=>parseSelectionSnapshot(snapshot([memory(),memory()])));
  assert.throws(()=>parseSelectionSnapshot(snapshot([{...memory(),produceItems:[{id:'item',triggerCount:-1,reactionCount:0}]}])));
  assert.throws(()=>parseSelectionSnapshot(snapshot([{...memory(),produceCards:[{id:'skill',upgradeCount:1,customizes:[],fromMemory:1}]}])));
});
test('工作副本去除照片路径与原始记录ID，嵌套白名单保留强化、来源和次数',async()=>{
  const raw=snapshot([{...memory(),imagePath:'private-photo-example',produceHighScoreId:'private-score-example',unrelated:'drop'}]);
  raw.selectionMemories[0].produceCards[0].unrelated='drop';raw.eventExpiredSelectionMemoryIds=['selection-example'];
  const clean=await prepareSelectionSnapshot(raw),row=clean.selectionMemories[0];
  for(const text of ['private-photo-example','private-score-example','selection-example','unrelated','userSelectionMemoryId','imagePath'])assert.ok(!JSON.stringify(clean).includes(text));
  assert.equal(row.produceCards[0].customizes[0].customizeCount,2);assert.equal(row.produceCards[0].fromMemory,true);
  assert.equal(row.produceItems[0].reactionCount,3);assert.equal(clean.eventExpiredSelectionMemoryIds[0],row.key);
  assert.deepEqual(restoreSelectionSnapshot(clean),clean);
});
test('保护、计划与卡组筛选组合，排序稳定，保留过期标记',async()=>{
  const raw=snapshot([memory('a'),{...memory('b'),isProtected:true,planType:3,vocal:300}]);raw.eventExpiredSelectionMemoryIds=['a','outside'];
  const clean=await prepareSelectionSnapshot(raw);
  assert.equal(selectionEntries(clean,{}).length,2);
  assert.equal(selectionEntries(clean,{}).filter(row=>row.expired).length,1);
  assert.equal(selectionEntries(clean,{selectionProtection:'protected',selectionPlan:'3',selectionSkill:JSON.stringify(['skill',1]),selectionItem:'item'}).length,1);
  assert.equal(selectionEntries(clean,{selectionSort:'vocal'})[0].memory.vocal,300);
  assert.equal(selectionEntries(clean,{selectionSkill:'absent'}).length,0);
  assert.equal(selectionEntries(undefined,{}).length,0);
});
test('六类偏好独立恢复，旧来源名不再归一化',()=>{
 const views=createViews({memories:{query:'普通回忆'}});assert.equal(views.memories.query,'普通回忆');assert.equal(views.selectionMemories.query,'');
 assert.throws(()=>parseSnapshot({...inventory(),source:'User.Get'}));
});

test('スター性按剩余道具与本战满奖励计算，异常计数不猜测',async()=>{
  const {selectionStarPotential}=await import('../domain/selection-memories.mjs');
  const memory={star:810,produceItems:[{id:'pitem_00-3-265-0',triggerCount:16,reactionCount:16}]};
  assert.deepEqual(selectionStarPotential(memory),{current:810,charges:4,itemGain:60,spGain:60,roundGains:[180,225],battleGain:465,remaining:525,final:1335});
  assert.equal(selectionStarPotential({...memory,star:800}).final,1325);
  assert.equal(selectionStarPotential({...memory,produceItems:[]}),null);
  assert.equal(selectionStarPotential({...memory,produceItems:[{...memory.produceItems[0],reactionCount:15}]}),null);
  assert.equal(selectionStarPotential({...memory,produceItems:[{...memory.produceItems[0],triggerCount:21,reactionCount:21}]}),null);
});
test('运营配置变更控制道具、次数、奖励、倍率、取整与上限',async()=>{
  const {selectionStarPotential}=await import('../domain/selection-memories.mjs');
  const rules={enabled:true,finalCap:1600,bonusMultiplier:1.25,rounding:'floor',item:{id:'new-item',limit:30,baseReward:12,countField:'reactionCount',matchingCountField:null},battle:{spLessons:[31],rounds:[101]}};
  const memory={star:800,produceItems:[{id:'new-item',triggerCount:0,reactionCount:25}]};
  assert.deepEqual(selectionStarPotential(memory,rules),{current:800,charges:5,itemGain:75,spGain:38,roundGains:[126],battleGain:164,remaining:239,final:1039});
  assert.equal(selectionStarPotential(memory,{...rules,rounding:'ceil'}).final,1041);
  assert.equal(selectionStarPotential(memory,{...rules,finalCap:1000}).final,1000);
  assert.equal(selectionStarPotential(memory,{...rules,enabled:false}),null);
  assert.equal(selectionStarPotential(memory,{...rules,bonusMultiplier:NaN}),null);
});
test('三围色条统一使用整份快照的最大值，筛选不改变比例',()=>{
  const small={...memory(),key:'small',ordinal:1},large={...memory(),key:'large',ordinal:2,characterId:'ttmr',vocal:900};
  const data={selectionMemories:[small,large],eventExpiredSelectionMemoryIds:[]};
  const all=selectionEntries(data,{}),filtered=selectionEntries(data,{selectionCharacter:['hski']});
  assert.equal(all[0].attributeMaximum,900);assert.equal(filtered[0].attributeMaximum,900);
  assert.equal(filtered[0].memory.vocal,100);assert.equal('attributeMaximum' in small,false);
});
test('技能筛选精确区分强化次数，不把附魔差异或重复卡当作不同版本',()=>{
  const a={...memory(),key:'a',ordinal:1,produceCards:[{id:'skill',upgradeCount:0,customizes:[],fromMemory:false}]};
  const b={...memory(),key:'b',ordinal:2};
  const data={selectionMemories:[a,b],eventExpiredSelectionMemoryIds:[]};
  assert.deepEqual(selectionEntries(data,{selectionSkill:JSON.stringify(['skill',0])}).map(r=>r.memory.key),['a']);
  assert.deepEqual(selectionEntries(data,{selectionSkill:JSON.stringify(['skill',1])}).map(r=>r.memory.key),['b']);
});
test('技能版本与道具组各自支持 OR／AND，跨组始终同时满足',()=>{
  const skill=upgradeCount=>({id:'skill',upgradeCount,customizes:[],fromMemory:false});
  const rows=[{...memory(),key:'a',produceCards:[skill(0)],produceItems:[{id:'x'}]},{...memory(),key:'b',produceCards:[skill(1)],produceItems:[{id:'y'}]},{...memory(),key:'both',produceCards:[skill(0),skill(1)],produceItems:[{id:'x'},{id:'y'}]}];
  const data={selectionMemories:rows,eventExpiredSelectionMemoryIds:[]},filters={selectionSkill:[JSON.stringify(['skill',0]),JSON.stringify(['skill',1])],selectionItem:['x','y']};
  assert.equal(selectionEntries(data,filters).length,3);
  assert.deepEqual(selectionEntries(data,{...filters,selectionSkillAll:true}).map(r=>r.memory.key),['both']);
  assert.deepEqual(selectionEntries(data,{...filters,selectionItemAll:true}).map(r=>r.memory.key),['both']);
  assert.equal(selectionEntries(data,{selectionSkill:[],selectionItem:[],selectionSkillAll:true,selectionItemAll:true}).length,3);
});
test('候选按计划流派稀有度排序，三类条件只收窄候选集合',async()=>{
  const {sortSelectionChoices,filterSelectionChoices}=await import('../domain/selection-memories.mjs');
  const option=(key,plan,flows,rarity,source)=>({key,metadata:{plan,flows,rarity,source}});
  const values=[option('a','Plan2',['review'],'SSR','idol'),option('b','Plan1',['parameter'],'R','common'),option('c','Plan1',['parameter'],'SSR','support'),option('d','Plan1',['lesson'],'SSR','common'),option('e','Plan1',[],'SSR','common')];
  assert.deepEqual(sortSelectionChoices(values).map(v=>v.key),['c','b','d','e','a']);
  assert.deepEqual(filterSelectionChoices(values,{plan:'Plan1',flow:'parameter',rarity:'SSR'}).map(v=>v.key),['c']);
  assert.deepEqual(filterSelectionChoices(values,{flow:'unclassified'}).map(v=>v.key),['e']);
});
test('候选来源使用专属与支援归属，流派读取结构化枚举而非名称',async()=>{
  const {installMaster,selectionChoiceMetadata}=await import('../domain/catalog.mjs');
  installMaster({tables:{ProduceCard:[{id:'idol',upgradeCount:0,name:'集中',definition:{originIdolCardId:'i',planType:'ProducePlanType_Plan1',rarity:'ProduceCardRarity_Ssr'},descriptions:[{examEffectType:'ProduceExamEffectType_ExamParameterBuff'}]},{id:'support',upgradeCount:0,definition:{originSupportCardId:'s'}}],ProduceItem:[{id:'common',definition:{planType:'ProducePlanType_Common'}}],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]}});
  const idol=selectionChoiceMetadata('card',{id:'idol',upgradeCount:0});
  assert.equal(idol.source,'idol');assert.deepEqual(idol.flows,['parameter']);assert.equal(idol.rarity,'SSR');
  assert.equal(selectionChoiceMetadata('card',{id:'support',upgradeCount:0}).source,'support');
  assert.equal(selectionChoiceMetadata('item',{id:'common'}).source,'common');
  assert.equal(selectionChoiceMetadata('item',{id:'absent'}).source,'unknown');
});
test('第二专属按成长目录标记排除所有强化版本，已选条件同步移除且卡组不变',async()=>{
  const {installMaster}=await import('../domain/catalog.mjs');
  const {selectionChoiceOptions,withoutSecondExclusiveSkills}=await import('../domain/selection-memories.mjs');
  const cards=[0,1].map(upgradeCount=>({id:'second',upgradeCount,name:'第二专属',rarity:'ProduceCardRarity_Ssr',descriptions:[]}));
  installMaster({tables:{ProduceCard:cards,ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},progression:{tables:{IdolCard:[{id:'idol',secondProduceCardId:'second'}]}}});
  const snapshot={selectionMemories:[{...memory(),produceCards:cards.map(c=>({id:c.id,upgradeCount:c.upgradeCount,customizes:[],fromMemory:false})),produceItems:[]}]},before=JSON.stringify(snapshot);
  assert.deepEqual(selectionChoiceOptions(snapshot).cards,[]);
  assert.deepEqual(withoutSecondExclusiveSkills([JSON.stringify(['second',0]),JSON.stringify(['second',1]),JSON.stringify(['other',0])]),[JSON.stringify(['other',0])]);
  assert.equal(JSON.stringify(snapshot),before);
});
test('专属技能与道具优先采用所属偶像卡流派，普通项仍按效果归类',async()=>{
  const {installMaster,selectionChoiceMetadata}=await import('../domain/catalog.mjs');
  const descriptions=[{examEffectType:'ProduceExamEffectType_ExamBlock'}];
  installMaster({tables:{ProduceCard:[{id:'rice',upgradeCount:1,definition:{originIdolCardId:'hume'},descriptions},{id:'answer',upgradeCount:1,definition:{originIdolCardId:'amao'},descriptions:[{examEffectType:'ProduceExamEffectType_ExamReview'}]},{id:'ordinary',upgradeCount:0,definition:{},descriptions}],ProduceItem:[{id:'exclusive',definition:{originIdolCardId:'hume'},descriptions},{id:'hif',definition:{originPrimaStellaIdolCardId:'amao'},descriptions},{id:'support',definition:{originSupportCardId:'s'},descriptions:[{examEffectType:'ProduceExamEffectType_ExamReview'}]}],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},idols:{cards:[{id:'hume',examEffectType:'ProduceExamEffectType_ExamCardPlayAggressive'},{id:'amao',examEffectType:'ProduceExamEffectType_ExamConcentration'}]}});
  assert.deepEqual(selectionChoiceMetadata('card',{id:'rice',upgradeCount:1}).flows,['aggressive']);
  assert.deepEqual(selectionChoiceMetadata('card',{id:'answer',upgradeCount:1}).flows,['concentration']);
  assert.deepEqual(selectionChoiceMetadata('item',{id:'exclusive'}).flows,['aggressive']);
  assert.deepEqual(selectionChoiceMetadata('item',{id:'hif'}).flows,['concentration']);
  assert.deepEqual(selectionChoiceMetadata('card',{id:'ordinary',upgradeCount:0}).flows,[]);
  assert.deepEqual(selectionChoiceMetadata('item',{id:'support'}).flows,['review']);
});
test('计划与效果分类补齐元气及温存，多涉及流派保留，通用元气不误判',async()=>{
  const {installMaster,selectionChoiceMetadata}=await import('../domain/catalog.mjs');
  const row=(id,plan,groups,types=[])=>({id,upgradeCount:0,definition:{planType:'ProducePlanType_'+plan,effectGroupIds:groups.map(g=>'effect_group-visible-'+g+'-000')},descriptions:types.map(type=>({examEffectType:'ProduceExamEffectType_'+type}))});
  installMaster({tables:{ProduceCard:[row('logic','Plan2',['exam_lesson_depend_block']),row('common','Common',['exam_block']),row('sense','Plan1',['exam_block']),row('preservation','Plan3',['exam_preservation']),row('both','Plan2',['exam_block','exam_review'])],ProduceItem:[row('item','Plan3',[],['ExamPreservation'])],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]}});
  const flows=id=>selectionChoiceMetadata('card',{id,upgradeCount:0}).flows;
  assert.deepEqual(flows('logic'),['aggressive']);assert.deepEqual(flows('common'),[]);assert.deepEqual(flows('sense'),[]);
  assert.deepEqual(flows('preservation'),['concentration']);assert.deepEqual(flows('both'),['aggressive','review']);
  assert.deepEqual(selectionChoiceMetadata('item',{id:'item'}).flows,['concentration']);
});
test('P 道具排除通用候选，支援用途按 isExamEffect 判定，完整记录保留',async()=>{
  const {installMaster}=await import('../domain/catalog.mjs');
  const {selectionChoiceOptions,withoutCommonSelectionItems}=await import('../domain/selection-memories.mjs');
  const items=[{id:'battle',name:'比赛',definition:{originSupportCardId:'s',isExamEffect:true}},{id:'training',name:'培养',definition:{originSupportCardId:'s',isExamEffect:false}},{id:'unknown',name:'未知',definition:{originSupportCardId:'s'}},{id:'common',name:'通用',definition:{isExamEffect:false}}];
  installMaster({tables:{ProduceCard:[],ProduceItem:items,MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]}});
  const snapshot={selectionMemories:[{...memory(),produceCards:[],produceItems:items.map(i=>({id:i.id,triggerCount:0,reactionCount:0}))}]},before=JSON.stringify(snapshot);
  const options=selectionChoiceOptions(snapshot).items;
  assert.equal(options.length,3);assert.equal(options.find(i=>i.key==='battle').metadata.use,'battle');assert.equal(options.find(i=>i.key==='training').metadata.use,'training');assert.equal(options.find(i=>i.key==='unknown').metadata.use,'unknown');
  assert.deepEqual(withoutCommonSelectionItems(['battle','common']),['battle']);assert.equal(JSON.stringify(snapshot),before);
});
test('角色条件收窄全部技能与 P 道具，多角色取并集',async()=>{
  const {selectionChoicesForCharacters}=await import('../domain/selection-memories.mjs');
  const values=[{key:'idolA',metadata:{source:'idol',ownerCharacterId:'a'},memoryCharacterIds:['a']},{key:'idolB',metadata:{source:'idol',ownerCharacterId:'b'},memoryCharacterIds:['b']},{key:'supportB',metadata:{source:'support'},memoryCharacterIds:['b']},{key:'shared',metadata:{source:'support'},memoryCharacterIds:['a','b']}];
  assert.deepEqual(selectionChoicesForCharacters(values,['a']).map(v=>v.key),['idolA','shared']);
  assert.deepEqual(selectionChoicesForCharacters(values,['a']).map(v=>v.key),['idolA','shared']);
  assert.equal(selectionChoicesForCharacters(values,['a','b']).length,4);
  assert.equal(selectionChoicesForCharacters(values,[]).length,4);
});


test('选拔回忆可按稳定唯一标识精确搜索，忽略首尾空白与大小写',async()=>{
  const data=await prepareSelectionSnapshot(snapshot([memory('first'),memory('second')]));
  const target=data.selectionMemories[1].key;
  const entries=selectionEntries(data,{query:` ${target.toUpperCase()} `});
  assert.equal(entries.length,1);assert.equal(entries[0].memory.key,target);
});
