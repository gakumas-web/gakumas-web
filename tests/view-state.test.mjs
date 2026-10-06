import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createView,createViews,activeFilterKeys,resetFilters,normalizeView,nextChoice,FILTER_BINDINGS,CHOICE_GROUPS} from '../application/view-state.mjs';
test('五页当前偏好独立，只读取当前字段',()=>{
  const views=createViews({memories:{purpose:'inheritance',query:'检索',layout:'list'},idolCards:{idolCharacter:['hski']}});
  normalizeView(views.memories);normalizeView(views.idolCards);
  assert.equal(views.memories.purpose,'inheritance');assert.equal('layout' in views.memories,false);assert.equal(views.memories.query,'检索');
  assert.deepEqual(views.idolCards.idolCharacter,['hski']);
  views.idolCards.idolCharacter.push('ttmr');assert.deepEqual(views.supportCards.idolCharacter,[]);
  assert.equal(views.idolCardSkins.ownership,'owned');
});
test('当前主题直接恢复，单选多选维持原合同',()=>{
  const v=createViews({idolCardSkins:{skinTheme:'夏'}}).idolCardSkins;
  normalizeView(v);assert.equal(v.skinTheme,'夏');
  const selected=['a'];assert.deepEqual(nextChoice(selected,'b'),['a','b']);assert.deepEqual(selected,['a']);
  assert.deepEqual(nextChoice(selected,'a'),[]);assert.deepEqual(nextChoice(selected,''),[]);
  assert.equal(nextChoice('Plan1','Plan2'),'Plan2');
});
test('支援卡每次载入默认全目录，不受保存的持有范围和页码限制',()=>{
  for(const ownership of ['owned','unowned','all']){
    const views=createViews({supportCards:{ownership,page:4,supportTrigger:'StartRefresh',supportEffect:['SpChangeRate']}});
    assert.equal(views.supportCards.ownership,'all');assert.equal(views.supportCards.page,0);
    assert.equal(views.supportCards.supportTrigger,'StartRefresh');assert.deepEqual(views.supportCards.supportEffect,['SpChangeRate']);
    views.supportCards.ownership='owned';assert.equal(views.supportCards.ownership,'owned');
  }
});
test('控件同步和事件绑定共用无重复映射，每个图形筛选都有对应字段',()=>{
  assert.equal(new Set(FILTER_BINDINGS.map(([id])=>id)).size,FILTER_BINDINGS.length);
  assert.equal(new Set(FILTER_BINDINGS.map(([,key])=>key)).size,FILTER_BINDINGS.length);
  for(const [,id,key] of CHOICE_GROUPS)assert.ok(FILTER_BINDINGS.some(([input,field])=>input===id&&field===key));
});

test('活动档案只接受账号身份，空偏好及旧槽位返回未选择状态',async()=>{
  const {normalizeProfile}=await import('../application/view-state.mjs');
  for(const profile of ['account-synthetic-A','account-synthetic-B'])assert.equal(normalizeProfile(profile),profile);
  for(const value of [null,undefined,'','missing','"test"','main','test','other'])assert.equal(normalizeProfile(value),null);
});

test('保存视图只恢复当前字段，退役阅读模式不进入运行状态',()=>{
  const restored=createView({purpose:'battle',layout:'list',supportAttribute:'old',skinImmersive:true,query:'保留',idolCharacter:['hski','hski']});
  assert.equal(restored.purpose,'all');assert.equal(restored.query,'保留');
  assert.equal('layout' in restored,false);assert.equal('supportAttribute' in restored,false);assert.equal('skinImmersive' in restored,false);
  assert.deepEqual(restored.idolCharacter,['hski']);
});
test('筛选标签与清空共用字段，保留范围、稀有度、排序和其它页条件',()=>{
  const view=createView({ownership:'unowned',idolRarity:'SSR',catalogSort:'character',idolCharacter:['hski','ttmr'],idolPlan:'Plan1',supportTrigger:'StartPresent',query:'名称',page:3});
  assert.deepEqual(activeFilterKeys('idolCards',view),['idolCharacter','idolPlan']);
  resetFilters(view,'idolCards');
  assert.deepEqual(activeFilterKeys('idolCards',view),[]);assert.equal(view.page,0);
  assert.deepEqual([view.ownership,view.idolRarity,view.catalogSort,view.supportTrigger,view.query],['unowned','SSR','character','StartPresent','名称']);
  resetFilters(view,'idolCards',{keys:['query']});assert.equal(view.query,'');
  assert.deepEqual(activeFilterKeys('memories',createView()),[]);
  assert.deepEqual(activeFilterKeys('selectionMemories',createView({selectionProtection:'protected'})),[]);
});

test('关联角色默认同时满足，开关独立保存且清空恢复默认，不单独计入筛选标签',()=>{
  assert.equal(createView().supportCharacterAll,true);
  const view=createViews({supportCards:{supportCharacter:['a','b'],supportCharacterAll:false}}).supportCards;
  assert.equal(view.supportCharacterAll,false);
  assert.deepEqual(activeFilterKeys('supportCards',view),['supportCharacter']);
  resetFilters(view,'supportCards');
  assert.equal(view.supportCharacterAll,true);assert.deepEqual(view.supportCharacter,[]);
});

test('通用计划开关默认勾选，取消后保存，清空支援筛选恢复默认',()=>{
  assert.equal(createView().supportPlanCommon,true);
  const view=createViews({supportCards:{supportPlan:'Plan1',supportPlanCommon:false}}).supportCards;
  assert.equal(view.supportPlanCommon,false);assert.deepEqual(activeFilterKeys('supportCards',view),['supportPlan']);
  resetFilters(view,'supportCards');assert.equal(view.supportPlanCommon,true);assert.equal(view.supportPlan,'');
});

test('卡面偏好只保留有效图片版本，不恢复培养预览阶段',async()=>{
  const {restoreIdolArt}=await import('../application/view-state.mjs');
  assert.deepEqual(restoreIdolArt(),{});assert.deepEqual(restoreIdolArt(null),{});
  const saved={a:'base',b:'upgraded',c:'alternate',rank:7,potential:4};
  assert.deepEqual(restoreIdolArt(saved),{a:'base',b:'upgraded'});
  assert.equal(saved.rank,7);
});
test('选拔技能和道具多选模式恢复，清空详细筛选保留右上角锁定范围',()=>{
  const view=createView({selectionSkill:[JSON.stringify(['a',1])],selectionItem:['x','y'],selectionSkillAll:true,selectionItemAll:true,selectionProtection:'protected',selectionExpired:'expired'});
  assert.equal('selectionExpired' in view,false);
  assert.equal(view.selectionSkillAll,true);assert.equal(view.selectionItemAll,true);
  resetFilters(view,'selectionMemories');
  assert.deepEqual(view.selectionSkill,[]);assert.deepEqual(view.selectionItem,[]);
  assert.equal(view.selectionSkillAll,true);assert.equal(view.selectionItemAll,true);
  assert.equal(view.selectionProtection,'protected');
});

test('选拔两组默认同时满足，保存的任一匹配仍保留',()=>{
  assert.equal(createView().selectionSkillAll,true);assert.equal(createView().selectionItemAll,true);
  const view=createView({selectionSkillAll:false,selectionItemAll:false});
  assert.equal(view.selectionSkillAll,false);assert.equal(view.selectionItemAll,false);
});


test('损坏的本地偏好单独降级，不再把非法字段带入页面',async()=>{
  const {parsePreferences}=await import('../application/view-state.mjs');
  for(const raw of ['{','null','[]',JSON.stringify({tab:'retired',views:null}),JSON.stringify({views:{achievements:{query:[],page:'bad-page'}}})]){
    const restored=parsePreferences(raw);assert.equal(restored.recovered,true);assert.equal(restored.tab,'memories');assert.equal(restored.views.achievements.query,'');assert.equal(restored.views.achievements.page,0);
  }
  for(const page of [NaN,Infinity,-1,'2'])assert.equal(createView({page}).page,0);
  assert.equal(createViews(null).achievements.query,'');assert.equal(createView(null).page,0);
  const restored=parsePreferences(JSON.stringify({tab:'achievements',views:{achievements:{query:'保留',page:2}}}));
  assert.equal(restored.recovered,false);assert.equal(restored.tab,'achievements');assert.equal(restored.views.achievements.query,'保留');assert.equal(restored.views.achievements.page,2);
});

test('常用筛选读取隔离损坏结构与存储异常，保留有效条件',async()=>{
  const {parseSavedViews,readSavedViews}=await import('../application/view-state.mjs');
  for(const raw of ['{','null','{}','[null]','[{"name":"x","view":null}]'])assert.deepEqual(parseSavedViews(raw),{values:[],recovered:true});
  assert.deepEqual(readSavedViews('account-test',{getItem(){throw new Error('storage unavailable');}}),{values:[],recovered:true});
  const result=parseSavedViews(JSON.stringify([{name:'收藏',view:{query:'关键词',page:-1}}]));
  assert.equal(result.recovered,false);assert.equal(result.values[0].view.query,'关键词');assert.equal(result.values[0].view.page,0);
  assert.deepEqual(parseSavedViews(null),{values:[],recovered:false});
});
