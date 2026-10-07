import test from 'node:test';
import assert from 'node:assert/strict';
import {installMaster,progressionInfo} from '../domain/catalog.mjs';
import {supportEffectChoices,supportEffectChoice,matchesSupportChoices,normalizeSupportEffectKey,createSupportEffectAvailability} from '../domain/support-effect-choices.mjs';
import {supportEntries} from '../domain/catalog-selectors.mjs';
const definitions=[['v5','VocalAddition','Vo +5'],['v10','VocalAddition','Vo +10'],['d5','DanceAddition','Da +5']];
const cards=[['a','Plan1','Vocal',['one'],['v5','d5']],['b','Plan2','Dance',['two'],['v10']],['c','Common','Assist',['three'],['v5']]];
installMaster({tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceExamEffect:[],ProduceEffect:definitions.map(([id,type])=>({id,produceEffectType:'ProduceEffectType_'+type})),ProduceSkill:definitions.map(([id,type,text])=>({id,level:1,descriptions:[{produceDescriptionType:'ProduceDescriptionType_PlainText',text:text.replace(/\d+$/,'')},{produceDescriptionType:'ProduceDescriptionType_DiffText',text:text.match(/\d+$/)[0]}],produceTriggerId1:id==='d5'?'rest':'start',produceEffectId1:id}))},
  semantics:{tables:{ProduceTrigger:[{id:'start',phaseType:'ProducePhaseType_ProduceStart'},{id:'rest',phaseType:'ProducePhaseType_StartRefresh'}]}},
  supports:{cards:cards.map(([id,plan,type,characterIds])=>({id,name:id,rarity:'SupportCardRarity_SSR',type:'SupportCardType_'+type,planType:'ProducePlanType_'+plan,characterIds}))},
  progression:{tables:{SupportCard:cards.map(([id])=>({id,supportCardLevelLimitId:'limits'})),SupportCardLevelLimit:[{id:'limits',rank:'Rank_Unknown',levelLimit:40},{id:'limits',rank:'Rank__4',levelLimit:60}],SupportCardProduceSkillLevelAssist:cards.flatMap(([supportCardId,,,,skills])=>skills.map((id,order)=>({supportCardId,supportCardLevel:50,produceSkillId:id,produceSkillLevel:1,order})))}}});
const snapshot={supportCards:[{supportCardId:'a',level:1,levelLimitRank:0}]};
test('候选取真实满级效果，计划和属性限制范围，角色持有条件不改变候选',()=>{
  const all=supportEffectChoices(snapshot);assert.equal(all.length,2);
  assert.deepEqual(supportEffectChoices(snapshot,{supportCharacter:['absent'],ownership:'owned',supportRarity:'R'}),all);
  assert.equal(supportEffectChoices(snapshot,{supportPlan:'Plan2',supportPlanCommon:false}).length,1);
  assert.equal(supportEffectChoices(snapshot,{supportPlan:'Plan2',supportPlanCommon:true}).length,1);
  assert.equal(supportEffectChoices(snapshot,{supportPlan:'Plan1',supportPlanCommon:false,supportType:'Dance'}).length,0);
  assert.equal(supportEffectChoices(snapshot,{supportType:'Assist'}).length,1);
});
test('按作用时机分组，合并效果数值但保留条件门槛，低等级卡仍按满级匹配',()=>{
  const choices=supportEffectChoices(snapshot),key=text=>choices.find(value=>value.text===text).key;
  const a=progressionInfo('supportMaximum',snapshot.supportCards[0]).changes;
  assert.equal(matchesSupportChoices(a,[key('Vo'),key('Vo')]),true);
  assert.equal(matchesSupportChoices(a,[key('Vo')]),true);
  assert.equal(matchesSupportChoices(a,[key('Vo'),key('Da')]),true);
  assert.equal(supportEntries(snapshot,'','original',{ownership:'owned',supportSkills:[key('Da')]}).length,1);
  assert.equal(progressionInfo('support',snapshot.supportCards[0]).changes.length,0);
  assert.equal(choices.find(value=>value.text==='Vo').group,'ProduceStart');
  assert.equal(choices.find(value=>value.text==='Da').group,'StartRefresh');
  const conditional=n=>({...a[0],descriptionParts:[{produceDescriptionType:'ProduceDescriptionType_PlainText',text:`所持カード${n}枚以上の場合、Vo+`},{produceDescriptionType:'ProduceDescriptionType_DiffText',text:'5'}]});
  assert.notEqual(supportEffectChoice(conditional(10)).key,supportEffectChoice(conditional(20)).key);
  assert.ok(supportEffectChoice(conditional(10)).text.includes('10'));
});

test('课程分为普通、SP 和不限种类，已有选择随分组保留',()=>{
  const key=text=>JSON.stringify(['EndLesson',text,['VocalAddition'],['EndLesson']]);
  assert.equal(JSON.parse(normalizeSupportEffectKey(key('ボーカル通常レッスン終了時、ボーカル上昇')))[0],'EndLessonNormal');
  assert.equal(JSON.parse(normalizeSupportEffectKey(key('ボーカルSPレッスン終了時、ボーカル上昇')))[0],'EndLessonSp');
  assert.equal(normalizeSupportEffectKey(key('ボーカルレッスン終了時、ボーカル上昇')),key('ボーカルレッスン終了時、ボーカル上昇'));
  assert.deepEqual(supportEffectChoices(snapshot).map(value=>value.attributes[0]),['vocal','dance']);
});

test('三种支援事件奖励加成单独分组，保留已有选择且不移动课程支援率',()=>{
  for(const text of ['このサポートカードのイベントによる獲得Pポイントを増加','このサポートカードのイベントによる体力回復量を増加','このサポートカードのイベントによるパラメータ上昇を増加']){
    const key=JSON.stringify(['ProduceStart',text,[],['ProduceStart']]);
    assert.equal(JSON.parse(normalizeSupportEffectKey(key))[0],'SupportEventReward');
  }
  const key=JSON.stringify(['ProduceStart','このサポートカードのレッスンサポート発生率を増加',[],['ProduceStart']]);
  assert.equal(normalizeSupportEffectKey(key),key);
});

test('合并数值保留全力等结构化图标及条件数值',()=>{
  const effect={before:'',beforeEffects:[],beforeTriggers:[],descriptionParts:[
    {produceDescriptionType:'ProduceDescriptionType_PlainText',text:'所持している'},
    {produceDescriptionType:'ProduceDescriptionType_ProduceExamEffectType',examEffectType:'ProduceExamEffectType_ExamFullPower',text:'全力'},
    {produceDescriptionType:'ProduceDescriptionType_PlainText',text:'効果のスキルカードが8枚以上の場合、ボーカル上昇+'},
    {produceDescriptionType:'ProduceDescriptionType_DiffText',text:'11'},
    {produceDescriptionType:'ProduceDescriptionType_PlainText',text:'（プロデュース中4回）'},
  ]};
  const choice=supportEffectChoice(effect);
  assert.equal(choice.descriptionParts[1].examEffectType,'ProduceExamEffectType_ExamFullPower');
  assert.ok(choice.text.includes('8枚'));assert.ok(choice.text.includes('4回'));assert.ok(!choice.text.includes('+11'));
  assert.equal(effect.descriptionParts[3].text,'11');
});

test('联动排除本组 OR 条件，只按其它组禁用候选，计数与正式筛选一致',()=>{
  const effect=(before,triggers=[])=>({before,beforeTriggers:triggers,beforeEffects:[]});
  const a=effect('A'),b=effect('B'),rest=effect('休息时奖励',['rest']);
  const rows=[[a,rest],[b]],key=row=>supportEffectChoice(row).key,evaluate=createSupportEffectAvailability(rows);
  assert.equal(evaluate([key(a)]).count,1);
  assert.ok(evaluate([key(a)]).available.has(key(b)));
  assert.ok(!evaluate([key(a),key(rest)]).available.has(key(b)));
  assert.equal(evaluate([key(a),key(b)]).count,2);
  for(const draft of [[],[key(a)],[key(b)],[key(rest)],[key(a),key(b)],[key(a),key(rest)],[key(b),key(rest)]]){
    assert.equal(evaluate(draft).count,rows.filter(effects=>matchesSupportChoices(effects,draft)).length);
  }
  const limited=createSupportEffectAvailability([rows[0]]);
  assert.ok(!limited([]).available.has(key(b)));
  assert.equal(limited([]).count,1);
});
