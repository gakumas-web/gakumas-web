import {inventory} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAchievementCatalog} from '../domain/achievements.mjs';
import {parseSnapshot} from '../domain/model.mjs';
import {createViews} from '../application/view-state.mjs';
const definitions={Achievement:[{id:'a',name:'成就原名',description:'条件{threshold}',category:'AchievementCategory_Idol',characterId:'hski',order:1},{id:'b',name:'第二项',description:'目标{threshold}',category:'AchievementCategory_Produce',characterId:'',order:2}],AchievementProgress:[{achievementId:'a',threshold:3,index:0,rewards:[]},{achievementId:'a',threshold:5,index:1,rewards:[]},{achievementId:'b',threshold:2,index:0,rewards:[]}],Mission:[{id:'a',isLessThanTargetValue:false},{id:'b',isLessThanTargetValue:true}]};
const catalog=createAchievementCatalog(definitions,{},{}),view={achievementSection:'achievement'};

test('缺少对应成就记录时按未达成显示，不伪造进度记录',()=>{
  assert.ok(catalog.entries(undefined,view).every(row=>row.status==='incomplete'&&row.record===undefined));
  assert.ok(catalog.entries({achievements:[]},view).every(row=>row.status==='incomplete'));
});
test('进度、解锁与已领取门槛分开，支持多个阶段及反向比较',()=>{
  const snapshot={achievements:[{achievementId:'a',progress:5,receivedThresholds:[3],isUnlock:true},{achievementId:'b',progress:1,receivedThresholds:[],isUnlock:true}]};
  const result=catalog.entries(snapshot,view);
  assert.equal(result[0].stages[0].status,'received');assert.equal(result[0].current.threshold,5);assert.equal(result[0].status,'claimable');assert.equal(result[0].description,'条件5');assert.equal(result[1].status,'claimable');
  snapshot.achievements[0].isUnlock=false;assert.equal(catalog.entries(snapshot,view)[0].status,'claimable');
  snapshot.achievements[0].progress=4;assert.equal(catalog.entries(snapshot,view)[0].status,'progress');assert.equal(catalog.entries(snapshot,view)[0].ratio,.5);
  snapshot.achievements[0].receivedThresholds=[3,5];assert.equal(catalog.entries(snapshot,view)[0].status,'received');
});
test('成就分类、状态、名称条件搜索与视图偏好保持独立',()=>{
  assert.equal(catalog.entries({}, {...view,achievementCategory:'Produce'}).length,1);
  assert.equal(catalog.entries({}, {...view,query:'原名'}).length,1);
  assert.equal(catalog.entries({}, {...view,achievementState:'received'}).length,0);
  const views=createViews({achievements:{achievementSection:'achievement',achievementCategory:'Idol',query:'原名'}});
  assert.equal(views.achievements.achievementSection,'achievement');assert.equal(views.memories.query,'');
});
test('快照只保留成就进度白名单并明确空集合',()=>{
  const base=inventory();
  assert.deepEqual(parseSnapshot(base).achievements,[]);
  const result=parseSnapshot({...base,achievements:[{achievementId:'a',progress:4,receivedThresholds:[3],isUnlock:true,secret:'discard'}]});
  assert.deepEqual(result.achievements,[{achievementId:'a',progress:4,receivedThresholds:[3],isUnlock:true}]);
});


test('采集可用性保留为数据事实而不影响未达成显示，旧解锁筛选不再遮蔽进度',()=>{
  assert.equal(catalog.entries({},view)[0].recordingAvailable,false);
  assert.equal(catalog.entries({achievements:[]},view)[0].recordingAvailable,true);
  assert.equal(createViews({achievements:{achievementState:'locked'}}).achievements.achievementState,'');
});

test('接近下一门槛按本阶段比例排序，已领取和未达成排后，原始顺序可恢复',()=>{
  const custom=createAchievementCatalog({Achievement:['a','b','c','d'].map((id,order)=>({id,name:id,description:'达到{threshold}',category:'AchievementCategory_Other',order})),AchievementProgress:['a','b','c','d'].flatMap(id=>[{achievementId:id,index:0,threshold:10,rewards:[]},{achievementId:id,index:1,threshold:20,rewards:[]}])});
  const snapshot={achievements:[{achievementId:'a',progress:12,receivedThresholds:[10],isUnlock:false},{achievementId:'b',progress:19,receivedThresholds:[10],isUnlock:false},{achievementId:'c',progress:30,receivedThresholds:[10,20],isUnlock:false}]};
  assert.deepEqual(custom.entries(snapshot,{...view,achievementSort:'near'}).map(e=>e.id),['b','a','c','d']);
  snapshot.achievements[0].progress=20;
  assert.deepEqual(custom.entries(snapshot,{...view,achievementSort:'near'}).map(e=>e.id),['a','b','c','d']);
  assert.deepEqual(custom.entries(snapshot,view).map(e=>e.id),['a','b','c','d']);
});

test('奖励名与资源类型可检索，保留原始道具名称',()=>{
  const custom=createAchievementCatalog({Achievement:[{id:'x',name:'测试',description:'达到{threshold}',category:'AchievementCategory_Other',order:0}],AchievementProgress:[{achievementId:'x',threshold:1,index:0,rewards:[{resourceType:'ResourceType_Item',resourceId:'item',quantity:10},{resourceType:'ResourceType_JewelTotal',quantity:1}]}],Item:[{id:'item',name:'サポート強化Pt'}]});
  assert.equal(custom.entries({}, {...view,query:'サポート強化Pt'}).length,1);
  assert.equal(custom.entries({}, {...view,query:'宝石'}).length,1);
  assert.equal(custom.entries({},view)[0].current.rewards[0].name,'サポート強化Pt');
});

test('新增角色保留独立归属，只有无角色成就进入共通入口',async()=>{
  const {achievementOwner,achievementSummary}=await import('../domain/achievements.mjs');
  const extra={id:'new',name:'新角色成就',description:'条件',category:'AchievementCategory_Idol',characterId:'new-character',order:3};
  const model=createAchievementCatalog({...definitions,Achievement:[...definitions.Achievement,extra]}, {}, {'new-character':'新角色'});
  assert.deepEqual(model.characterIds,['hski','new-character','nasr']);
  assert.equal(achievementOwner(model.entries({},view).find(row=>row.id==='new')),'new-character');
  assert.deepEqual(model.entries({},view).filter(row=>achievementOwner(row)==='nasr').map(row=>row.id),['b']);
  assert.equal(createViews({achievements:{achievementCharacter:'new-character'}}).achievements.achievementCharacter,'new-character');
  const entries=catalog.entries({achievements:[{achievementId:'a',progress:5,receivedThresholds:[3,5]}]},view);
  assert.deepEqual(achievementSummary(entries),{received:1,progress:0,claimable:0,incomplete:1,achieved:1,incompleteTotal:1});
});

test('固定目录按任务目标关联128张卡，兼容54项早期编号且不误收角色通用',async()=>{
  const {readFileSync}=await import('node:fs');
  const tables=JSON.parse(readFileSync(new URL('./fixtures/public-data/achievements.json',import.meta.url))).tables;
  const cards=new Map(JSON.parse(readFileSync(new URL('./fixtures/public-data/idols.json',import.meta.url))).cards.map(row=>[row.id,row]));
  const entries=createAchievementCatalog(tables).entries({},view),specific=entries.filter(row=>row.idolCardId),common=entries.filter(row=>!row.idolCardId);
  assert.equal(specific.length,768);assert.equal(new Set(specific.map(row=>row.idolCardId)).size,128);
  for(const row of specific)assert.equal(cards.get(row.idolCardId)?.characterId,row.characterId,row.id);
  assert.equal(specific.filter(row=>row.id.startsWith('achieve-p_idol-card-')).length,54);
  assert.equal(common.filter(row=>row.characterId).length,398);assert.equal(common.filter(row=>!row.characterId).length,58);
  assert.equal(specific.filter(row=>row.characterId==='hski').length,72);assert.equal(common.filter(row=>row.characterId==='hski').length,31);
  assert.equal(entries.find(row=>row.id==='achieve-p_idol-card-hski-002-1').idolCardId,'i_card-hski-2-000');
});

test('门户合并已领取与达到门槛，进行中与无记录归未达成',async()=>{
  const {achievementSummary}=await import('../domain/achievements.mjs');
  const summary=achievementSummary(['received','claimable','progress','incomplete'].map(status=>({status})));
  assert.equal(summary.achieved,2);assert.equal(summary.incompleteTotal,2);
});

test('只有当前未达标阶段进行中，后续未达成，实际达标和领取优先',()=>{
  const make=less=>createAchievementCatalog({Achievement:[{id:'x',name:'多阶段',description:'达到{threshold}',category:'AchievementCategory_Other',order:0}],Mission:[{id:'x',isLessThanTargetValue:less}],AchievementProgress:(less?[40,30,20,10]:[10,20,30,40]).map((threshold,index)=>({achievementId:'x',index,threshold,rewards:[]}))});
  const snapshot=(progress,receivedThresholds)=>({achievements:[{achievementId:'x',progress,receivedThresholds}]});
  let entry=make(false).entries(snapshot(15,[10]),view)[0];
  assert.deepEqual(entry.stages.map(row=>row.status),['received','progress','incomplete','incomplete']);assert.equal(entry.current.threshold,20);assert.equal(entry.ratio,.5);
  entry=make(false).entries(snapshot(35,[10]),view)[0];assert.deepEqual(entry.stages.map(row=>row.status),['received','claimable','claimable','incomplete']);
  assert.ok(make(false).entries(snapshot(40,[10,20,30,40]),view)[0].stages.every(row=>row.status==='received'));
  assert.ok(make(false).entries({},view)[0].stages.every(row=>row.status==='incomplete'));
  entry=make(true).entries(snapshot(35,[40]),view)[0];assert.deepEqual(entry.stages.map(row=>row.status),['received','progress','incomplete','incomplete']);assert.equal(entry.ratio,.5);
});

test('每张卡六项仅合并展示为三个入口，特训选最高已达成图标且不改原始计数',async()=>{
  const {readFileSync}=await import('node:fs');
  const {mergeCardAchievements,achievedCardStage}=await import('../domain/achievements.mjs');
  const tables=JSON.parse(readFileSync(new URL('./fixtures/public-data/achievements.json',import.meta.url))).tables,model=createAchievementCatalog(tables);
  const snapshot={achievements:[{achievementId:'achieve-i_card-ttmr-3-001-02',progress:4,receivedThresholds:[3]},{achievementId:'achieve-i_card-ttmr-3-001-04',progress:4,receivedThresholds:[]},{achievementId:'achieve-i_card-ttmr-3-001-05',progress:4,receivedThresholds:[]},{achievementId:'achieve-i_card-ttmr-3-001-06',progress:4,receivedThresholds:[]}]};
  const all=model.entries(snapshot,view),before=JSON.stringify(all),entries=all.filter(row=>row.idolCardId==='i_card-ttmr-3-001'),merged=mergeCardAchievements(entries);
  assert.equal(entries.length,6);assert.equal(merged.length,3);assert.equal(all.length,1224);assert.equal(JSON.stringify(all),before);
  const training=merged.find(row=>row.sourceEntries);assert.deepEqual(training.stages.map(row=>row.threshold),[3,4,5,6]);assert.deepEqual(training.stages.map(row=>row.status),['received','claimable','incomplete','incomplete']);
  assert.equal(achievedCardStage(training).threshold,4);assert.match(achievedCardStage(training).image,/_004\.webp$/);
  const empty=mergeCardAchievements(model.entries({},view).filter(row=>row.idolCardId==='i_card-ttmr-3-001')).find(row=>row.sourceEntries);assert.equal(achievedCardStage(empty),null);
  const byCard=new Map();for(const entry of all.filter(row=>row.idolCardId)){if(!byCard.has(entry.idolCardId))byCard.set(entry.idolCardId,[]);byCard.get(entry.idolCardId).push(entry);}for(const values of byCard.values())assert.equal(mergeCardAchievements(values).length,3);
});

test('通用图标悬停给出当前进度和下一未达成门槛的差值',async()=>{
  const {achievementProgressInfo}=await import('../domain/achievements.mjs');
  const entry=catalog.entries({achievements:[{achievementId:'a',progress:4,receivedThresholds:[3]}]},view)[0];
  const result=achievementProgressInfo(entry);assert.equal(result.progress,4);assert.equal(result.remaining,1);assert.equal(result.ratio,.5);
  const empty=achievementProgressInfo(catalog.entries({},view)[0]);assert.equal(empty.progress,0);assert.equal(empty.remaining,3);assert.equal(empty.ratio,0);
  const done=achievementProgressInfo(catalog.entries({achievements:[{achievementId:'a',progress:5,receivedThresholds:[3,5]}]},view)[0]);assert.equal(done.next,undefined);assert.equal(done.remaining,null);assert.equal(done.ratio,1);
});

test('跨越多个未领取门槛时色条与下一门槛差值保持一致，反向同理',async()=>{
  const {achievementProgressInfo}=await import('../domain/achievements.mjs');
  for(const less of [false,true]){
    const thresholds=less?[40,30,20,10]:[10,20,30,40];
    const model=createAchievementCatalog({Achievement:[{id:'x',name:'测试',description:'目标{threshold}',category:'AchievementCategory_Other',order:0}],Mission:[{id:'x',isLessThanTargetValue:less}],AchievementProgress:thresholds.map((threshold,index)=>({achievementId:'x',threshold,index,rewards:[]}))});
    const entry=model.entries({achievements:[{achievementId:'x',progress:less?15:35,receivedThresholds:[thresholds[0]]}]},view)[0];
    const info=achievementProgressInfo(entry);assert.equal(info.remaining,5);assert.equal(info.ratio,.5);assert.equal(info.next.threshold,thresholds[3]);
  }
});


test('简化状态按全部阶段达成判断，未达成优先保留组内顺序且可以关闭',()=>{
  const custom=createAchievementCatalog({Achievement:['a','b','c','d'].map((id,order)=>({id,name:id,description:'达到{threshold}',category:'AchievementCategory_Other',order})),AchievementProgress:['a','b','c','d'].flatMap(id=>[{achievementId:id,index:0,threshold:10,rewards:[]},{achievementId:id,index:1,threshold:20,rewards:[]}])});
  const snapshot={achievements:[{achievementId:'a',progress:20,receivedThresholds:[]},{achievementId:'b',progress:10,receivedThresholds:[]},{achievementId:'c',progress:20,receivedThresholds:[10,20]}]};
  assert.deepEqual(custom.entries(snapshot,{...view,achievementState:'achieved'}).map(row=>row.id),['a','c']);
  assert.deepEqual(custom.entries(snapshot,{...view,achievementState:'unachieved'}).map(row=>row.id),['b','d']);
  assert.deepEqual(custom.entries(snapshot,{...view,achievementIncompleteFirst:true}).map(row=>row.id),['b','d','a','c']);
  assert.deepEqual(custom.entries(snapshot,{...view,achievementIncompleteFirst:false}).map(row=>row.id),['a','b','c','d']);
  assert.equal(createViews().achievements.achievementIncompleteFirst,true);
  assert.equal(createViews({achievements:{achievementIncompleteFirst:false}}).achievements.achievementIncompleteFirst,false);
  assert.equal(createViews({achievements:{achievementState:'progress'}}).achievements.achievementState,'');
  assert.equal(createViews({achievements:{achievementState:'received'}}).achievements.achievementState,'');
});


test('奖励按资源类型及固定道具ID分类，任一阶段匹配且与状态筛选组合',()=>{
  const rewards={experience:{resourceType:'ResourceType_UserExp',quantity:10},support:{resourceType:'ResourceType_Item',resourceId:'item-support_card_enhance_point',quantity:10},jewel:{resourceType:'ResourceType_JewelTotal',quantity:10},other:{resourceType:'ResourceType_Item',resourceId:'character-material',quantity:1}};
  const custom=createAchievementCatalog({Achievement:[...Object.keys(rewards),'mixed'].map((id,order)=>({id,name:id,description:'达到{threshold}',category:'AchievementCategory_Other',order})),AchievementProgress:[...Object.entries(rewards).map(([id,reward])=>({achievementId:id,index:0,threshold:1,rewards:[reward]})),{achievementId:'mixed',index:0,threshold:1,rewards:[rewards.jewel]},{achievementId:'mixed',index:1,threshold:2,rewards:[rewards.support]}]});
  for(const kind of Object.keys(rewards))assert.deepEqual(custom.entries({}, {...view,achievementReward:kind}).map(row=>row.id),[kind,...(['support','jewel'].includes(kind)?['mixed']:[])]);
  assert.equal(custom.entries({}, {...view,achievementReward:'support',achievementState:'achieved'}).length,0);
  assert.equal(createViews({achievements:{achievementReward:'support'}}).achievements.achievementReward,'support');
  assert.equal(createViews({achievements:{achievementReward:'invalid'}}).achievements.achievementReward,'');
});

test('未知的新成就保留进度，补充公开目录后无需重新导入快照',()=>{
  const id='achieve-future-synthetic';
  const snapshot=parseSnapshot({...inventory(),achievements:[{achievementId:id,progress:7,receivedThresholds:[3],isUnlock:true}]});
  assert.equal(snapshot.achievements[0].achievementId,id);
  assert.equal(catalog.entries(snapshot,view).some(row=>row.id===id),false);
  const updated=createAchievementCatalog({
    Achievement:[...definitions.Achievement,{id,name:'新成就',description:'达到{threshold}',category:'AchievementCategory_Produce',order:3}],
    AchievementProgress:[...definitions.AchievementProgress,{achievementId:id,threshold:3,index:0,rewards:[]},{achievementId:id,threshold:10,index:1,rewards:[]}],
    Mission:[...definitions.Mission,{id,isLessThanTargetValue:false}],
  },{},{});
  const entry=updated.entries(snapshot,view).find(row=>row.id===id);
  assert.equal(entry.record.progress,7);assert.equal(entry.stages[0].status,'received');assert.equal(entry.status,'progress');
});
