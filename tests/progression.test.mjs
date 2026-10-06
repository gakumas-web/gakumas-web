import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProgression,rankNumber} from '../domain/progression.mjs';
const data=JSON.parse(readFileSync(new URL('./fixtures/public-data/progression.json',import.meta.url))).tables;
const semantics={card:({id,upgradeCount})=>({heading:id,lines:[String(upgradeCount)]}),item:id=>({heading:id,lines:[]})};
const model=createProgression(data,{},semantics);

test('枚举零阶级与数字阶级不会混淆',()=>{
  assert.equal(rankNumber('SupportCardLevelLimitRank_Unknown'),0);
  assert.equal(rankNumber('IdolCardLevelLimitRank__6'),6);
});
test('支援卡解锁、最高等级与所需突破按具体卡片成长表计算',()=>{
  const held={supportCardId:'s_card-1-0001',level:1,levelLimitRank:0};
  const result=model.support(held,40);
  assert.equal(result.maximum,40);assert.equal(result.requiredRank,4);
  assert.ok(result.changes.length>0);assert.ok(result.changes.some(row=>row.added));
  assert.ok(result.changes.some(row=>!row.added));
  const upgraded=model.support({...held,level:35},36);
  assert.ok(upgraded.changes.some(row=>row.changed&&!row.added));
  assert.ok(model.support({...held,level:40},40).changes.every(row=>!row.changed));
});
test('支援快捷等级按各稀有度的实际突破上限生成',()=>{
  for(const [id,levels] of [['s_card-1-0000',[20,25,30,35,40]],['s_card-2-0032',[30,35,40,45,50]],['s_card-3-0050',[40,45,50,55,60]]]){
    const result=model.support({supportCardId:id,level:1,levelLimitRank:0});
    assert.deepEqual(result.levelLimits,levels.map((level,rank)=>({rank,level})));
  }
});
test('支援等级可向下预览，目标未解锁技能保留比较行，越界等级收敛到1或满级',()=>{
  const held=Object.freeze({supportCardId:'s_card-1-0001',level:40,levelLimitRank:4});
  const down=model.support(held,1);
  assert.equal(down.target,1);assert.equal(down.requiredRank,0);
  assert.ok(down.changes.some(row=>row.removed&&row.after==='未解锁'));
  assert.ok(down.changes.every(row=>!row.added));
  assert.equal(model.support(held,-5).target,1);assert.equal(model.support(held,99).target,40);
  assert.equal(held.level,40);
  const sample={supportCardId:'s_card-1-0000',level:40,levelLimitRank:4};
  assert.deepEqual(model.support(sample,1).changes.filter(row=>row.removed).map(row=>row.unlock),['Lv.5','Lv.10','Lv.21','Lv.2']);
  assert.deepEqual(model.support({...sample,level:1},40).changes.filter(row=>row.added).map(row=>row.unlock),['Lv.5','Lv.10','Lv.21','Lv.2']);
});
test('特训属性增量累加，成长率按千分比换算为百分比',()=>{
  const held={idolCardId:'i_card-amao-1-000',levelLimitRank:1,potentialRank:0};
  const result=model.idol(held,6,4);
  const get=label=>result.changes.find(row=>row.label===label);
  assert.deepEqual([get('初始 Vocal').before,get('初始 Vocal').after,get('初始 Vocal').delta],['75','90','+15']);
  assert.deepEqual([get('Vocal 成长率').before,get('Vocal 成长率').after,get('Vocal 成长率').delta],['20%','21%','+1 个百分点']);
  assert.deepEqual([get('体力').before,get('体力').after],['31','37']);
  assert.equal(get('专属技能卡').changed,true);
  assert.equal(get('专属技能卡').beforeCard.upgradeCount,0);
  assert.equal(get('专属技能卡').afterCard.upgradeCount,1);
  assert.notEqual(get('专属 P 道具').beforeItem,get('专属 P 道具').afterItem);
  assert.match(get('专属技能卡').after,/\n1$/);
  assert.equal(get('专属 P 道具').changed,true);
  assert.ok(result.changes.some(row=>row.added&&row.label.startsWith('潜能技能')));
});
test('第二专属技能卡按自己的升级阶级变化',()=>{
  const result=model.idol({idolCardId:'i_card-hrnm-3-017',levelLimitRank:5,potentialRank:0},6,0);
  assert.equal(result.changes.find(row=>row.label==='第二专属技能卡').changed,true);
  assert.equal(result.changes.find(row=>row.label==='专属技能卡').changed,false);
});
test('预览不改写持有记录，不把满级或同等级显示为升级',()=>{
  const held=Object.freeze({idolCardId:'i_card-amao-1-000',levelLimitRank:6,potentialRank:4});
  assert.ok(model.idol(held,6,4).changes.every(row=>!row.changed));
  assert.equal(model.idol({idolCardId:'missing',levelLimitRank:0,potentialRank:0}),null);
  assert.equal(model.support({supportCardId:'missing',level:1,levelLimitRank:0}),null);
  assert.equal(model.idol({...held,levelLimitRank:99}),null);
});

test('支援技能预览保留当前数值，灰色项目取首次解锁版本而非满级版本',()=>{
  const tables={SupportCard:[{id:'preview',supportCardLevelLimitId:'limits'}],
    SupportCardLevelLimit:[{id:'limits',rank:'Rank_Unknown',levelLimit:20},{id:'limits',rank:'Rank__1',levelLimit:40},{id:'limits',rank:'Rank__4',levelLimit:60}],
    SupportCardProduceSkillLevelVocal:[
      {supportCardId:'preview',produceSkillId:'early',produceSkillLevel:1,supportCardLevel:1,order:1},
      {supportCardId:'preview',produceSkillId:'early',produceSkillLevel:2,supportCardLevel:10,order:1},
      {supportCardId:'preview',produceSkillId:'early',produceSkillLevel:3,supportCardLevel:60,order:1},
      {supportCardId:'preview',produceSkillId:'late',produceSkillLevel:1,supportCardLevel:30,order:2},
      {supportCardId:'preview',produceSkillId:'late',produceSkillLevel:2,supportCardLevel:60,order:2}]};
  const preview=createProgression(tables,{ProduceSkill:[['early',1,'初期+10'],['early',2,'初期+20'],['early',3,'初期+60'],['late',1,'回復+3'],['late',2,'回復+6']]
    .map(([id,level,text])=>({id,level,descriptions:[{produceDescriptionType:'ProduceDescriptionType_PlainText',text}]}))},semantics);
  const held=Object.freeze({supportCardId:'preview',level:15,levelLimitRank:0,ownership:'owned'});
  const rows=preview.supportPreview(held);
  assert.deepEqual(rows.map(row=>[row.id,row.locked,row.unlockLevel,row.requiredRank,row.text]),[
    ['early',false,1,0,'初期+20'],['late',true,30,1,'回復+3']]);
  for(const ownership of ['unowned','unknown']){
    const reference=preview.supportPreview({...held,ownership,level:1});
    assert.ok(reference.every(row=>row.reference));
    assert.deepEqual(reference.map(row=>row.locked),[false,true]);
    assert.deepEqual(reference.map(row=>row.text),['初期+10','回復+3']);
  }
  assert.ok(preview.supportPreview({...held,level:60,levelLimitRank:4}).every(row=>!row.locked));
  assert.equal(preview.supportPreview({...held,supportCardId:'missing'}),null);
  assert.equal(held.level,15);
  const higher=preview.supportPreview(held,60);
  assert.equal(higher[0].text,'初期+60');assert.equal(higher[1].gained,true);assert.equal(higher[1].locked,false);
  assert.equal(higher[1].numberChanges.length,0);
  const lower=preview.supportPreview({...held,level:60,levelLimitRank:4},1);
  assert.equal(lower[0].text,'初期+10');assert.equal(lower[1].lost,true);assert.equal(lower[1].locked,true);
  assert.equal(lower[1].numberChanges.length,0);
});

test('偶像卡内预览允许双向选择，两条成长线分别计算且不修改持有状态',()=>{
  const held=Object.freeze({idolCardId:'i_card-amao-1-000',levelLimitRank:6,potentialRank:4,ownership:'owned'});
  const down=model.idolPreview(held,0,0);
  assert.equal(down.targetRank,0);assert.equal(down.targetPotential,0);assert.equal(down.changed,true);
  assert.ok(down.stats.some(row=>row.delta<0));assert.ok(down.skills.some(row=>row.lost&&row.locked));
  assert.equal(down.rewards.find(row=>row.card).card.upgradeCount,0);
  assert.equal(down.rewards.find(row=>row.card).changed,true);
  assert.ok(model.idolPreview(held).stats.every(row=>row.delta===0));
  assert.equal(model.idolPreview(held).changed,false);
  assert.equal(model.idolPreview(held,-1,99).targetPotential,4);
  assert.equal(held.levelLimitRank,6);
});
test('偶像预览区分未持有参考与未来解锁，不把上限6的卡显示为可特训7',()=>{
  const held={idolCardId:'i_card-amao-1-000',levelLimitRank:0,potentialRank:0,ownership:'unowned'};
  const base=model.idolPreview(held),target=model.idolPreview(held,7,4);
  assert.ok(base.skills.every(row=>row.locked));assert.equal(target.targetRank,6);
  assert.ok(target.skills.some(row=>row.gained&&!row.locked));
  assert.equal(target.customization,null);
});
test('偶像第二专属卡与附魔按照目标特训联接',()=>{
  const held={idolCardId:'i_card-hrnm-3-017',levelLimitRank:5,potentialRank:0,ownership:'owned'};
  const next=model.idolPreview(held,6,0);
  assert.equal(next.rewards.find(row=>row.label==='第二专属技能卡').changed,true);
  assert.equal(next.rewards.find(row=>row.label==='专属技能卡').changed,false);
  const unlocked=data.IdolCard.find(card=>rankNumber(card.maxIdolCardLevelLimitRank)===7);
  const reference={idolCardId:unlocked.id,levelLimitRank:6,potentialRank:0,ownership:'owned'};
  const unlock=data.IdolCardLevelLimitProduceSkill.find(row=>row.rank==='IdolCardLevelLimitRank__7');
  const withUnlock=createProgression(data,{ProduceSkill:[{id:unlock.produceSkillId,level:unlock.produceSkillLevel,produceEffectId1:'enable'}],ProduceEffect:[{id:'enable',produceEffectType:'ProduceEffectType_IdolCardProduceCardCustomizeEnable'}]},semantics);
  const before=withUnlock.idolPreview(reference),after=withUnlock.idolPreview(reference,7,0);
  assert.equal(before.customization.unlocked,false);assert.equal(after.customization.unlocked,true);
  assert.equal(after.customization.actualUnlocked,false);
});

test('偶像效果图标取唯一数值片段，随阶段更新，不误取条件数字',()=>{
  const card=data.IdolCard.find(row=>row.id==='i_card-amao-1-000');
  const rows=data.IdolCardLevelLimitProduceSkill.filter(row=>row.id===card.idolCardLevelLimitProduceSkillId);
  const first=rows.find(row=>rankNumber(row.rank)===2),last=rows.find(row=>rankNumber(row.rank)===6);
  const define=(row,value)=>({id:row.produceSkillId,level:row.produceSkillLevel,descriptions:[
    {produceDescriptionType:'ProduceDescriptionType_PlainText',text:'20枚の場合、発生率+'},
    {produceDescriptionType:'ProduceDescriptionType_DiffText',text:value}]});
  const base={ProduceSkill:[define(first,'5%'),define(last,'10%')]};
  const held={idolCardId:card.id,levelLimitRank:6,potentialRank:0,ownership:'owned'};
  const get=createProgression(data,base,semantics);
  assert.equal(get.idolPreview(held,2).skills.find(row=>row.kind==='rank').iconValue,'5%');
  assert.equal(get.idolPreview(held,6).skills.find(row=>row.kind==='rank').iconValue,'10%');
  base.ProduceSkill[0].descriptions.push({produceDescriptionType:'ProduceDescriptionType_DiffText',text:'2'});
  assert.equal(createProgression(data,base,semantics).idolPreview(held,2).skills.find(row=>row.kind==='rank').iconValue,'');
});

test('成长率仪表盘以本卡满培养最高值为统一上限，不随预览阶段改变',()=>{
  const held={idolCardId:'i_card-amao-1-000',levelLimitRank:0,potentialRank:0};
  const start=model.idolPreview(held,0,0),full=model.idolPreview(held,6,4);
  assert.equal(start.growthMaximum,21);assert.equal(full.growthMaximum,21);
  assert.equal(start.stats.find(row=>row.label==='Vocal 成长率').after,'20%');
  assert.equal(full.stats.find(row=>row.label==='Vocal 成长率').after,'21%');
});

test('初始属性固定满培养刻度，灰色剩余不计入当前值，六项计算组成逐项相符',()=>{
  for(const card of data.IdolCard){
    const held={idolCardId:card.id,levelLimitRank:0,potentialRank:0};
    const start=model.idolPreview(held),full=model.idolPreview(held,7,4);
    assert.equal(start.statMaximum,full.statMaximum);
    for(const [label,calculation] of Object.entries(start.calculations)){
      assert.equal(calculation.value,parseFloat(start.stats.find(row=>row.label===label).after));
      assert.ok(Math.abs(calculation.base+calculation.contributions.reduce((total,row)=>total+row.value,0)-calculation.value)<1e-8);
      assert.ok(calculation.remaining>=0);
      assert.ok(Math.abs(calculation.remainingContributions.reduce((total,row)=>total+row.value,0)-calculation.remaining)<1e-8);
      assert.ok(calculation.remainingContributions.every(row=>row.rank>calculation.rank&&row.rank<=calculation.maximum));
      assert.deepEqual(full.calculations[label].remainingContributions,[]);
      assert.ok(Math.abs(calculation.value+calculation.remaining-calculation.reachable)<1e-8);
      assert.equal(full.calculations[label].remaining,0);
    }
  }
  const start=model.idolPreview({idolCardId:'i_card-amao-1-000',levelLimitRank:0,potentialRank:0});
  assert.equal(start.statMaximum,90);
  assert.deepEqual([start.calculations['初始 Vocal'].value,start.calculations['初始 Vocal'].remaining],[65,25]);
  assert.deepEqual([start.calculations['Vocal 成长率'].value,start.calculations['Vocal 成长率'].remaining],[20,1]);
});

test('HIF 专属卡按归属联接，独立于普通强化且解锁状态保持未知',()=>{
  const held={idolCardId:'i_card-ttmr-3-016',levelLimitRank:6,potentialRank:0};
  const cards=[{id:'hif-a',upgradeCount:0,definition:{originPrimaStellaIdolCardId:held.idolCardId}},
    {id:'hif-a',upgradeCount:1,definition:{originPrimaStellaIdolCardId:held.idolCardId}},
    {id:'hif-b',upgradeCount:0,definition:{originPrimaStellaIdolCardId:'i_card-fktn-3-013'}}];
  const subject=createProgression(data,{ProduceCard:cards},semantics);
  for(const rank of [0,6]){
    const hif=subject.idolPreview(held,rank,0).rewards.filter(row=>row.scope==='hif-final');
    assert.equal(hif.length,1);assert.deepEqual(hif[0].card,{id:'hif-a',upgradeCount:0,customizes:[]});
    assert.equal(hif[0].unlockState,'unknown');assert.equal(hif[0].changed,false);
  }
  assert.equal(subject.idolPreview({idolCardId:'i_card-amao-1-000',levelLimitRank:0,potentialRank:0}).rewards.some(row=>row.scope==='hif-final'),false);
});
