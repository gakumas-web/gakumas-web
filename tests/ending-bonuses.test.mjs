import {inventory} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAchievementCatalog} from '../domain/achievements.mjs';
import {endingBonusReference} from '../domain/ending-bonuses.mjs';
import {createProgression} from '../domain/progression.mjs';
import {parseSnapshot} from '../domain/model.mjs';
const endings=JSON.parse(readFileSync(new URL('./fixtures/public-data/ending-bonuses.json',import.meta.url))).tables;
const progression=JSON.parse(readFileSync(new URL('./fixtures/public-data/progression.json',import.meta.url))).tables;
const semantics={card:({id})=>({heading:id,lines:[]}),item:id=>({heading:id,lines:[]})};

test('小さな野望的公开奖励与原基础值独立计算，复现既有数值对照',()=>{
  const bonus=endingBonusReference(endings,'jsna').total;
  assert.deepEqual([bonus.produceVocal,bonus.produceDance,bonus.produceVisual],[20,0,10]);
  assert.deepEqual([bonus.produceVocalGrowthRatePermil,bonus.produceDanceGrowthRatePermil,bonus.produceVisualGrowthRatePermil],[50,70,55]);
  const model=createProgression(progression,{},semantics),held={idolCardId:'i_card-jsna-3-000',levelLimitRank:0,potentialRank:0};
  const current=model.idol(held,0,0),max=model.idol(held,current.maximum,0);
  const value=(result,label)=>Number(result.changes.find(row=>row.label===label).after.replace('%',''));
  const base=['Vocal','Dance','Visual'].map(name=>value(current,'初始 '+name));
  assert.deepEqual(base,[130,100,105]);
  assert.equal(base.reduce((a,b)=>a+b,0)+30,365);
  assert.equal(['Vocal','Dance','Visual'].reduce((sum,name)=>sum+value(max,'初始 '+name),0)+30,440);
  assert.deepEqual(['Vocal','Dance','Visual'].map(name=>value(current,name+' 成长率')+bonus['produce'+name+'GrowthRatePermil']/10),[16,13,22.5]);
  assert.equal(value(current,'初始 Vocal'),130);
});

test('未采集与已采集列表分开，列表只标记记录存在，不推断奖励生效',()=>{
  assert.ok(endingBonusReference(endings,'jsna').rows.every(row=>row.recorded===undefined));
  const rows=endingBonusReference(endings,'jsna',{trueEndProduceTypes:[1]}).rows;
  assert.equal(rows.find(row=>row.type===1).recorded,true);
  assert.ok(rows.filter(row=>row.type!==1).every(row=>row.recorded===false));
});

test('升级时间必填，零值与正值分别保留，角色采集只保留白名单',()=>{
  const base=inventory();
  const card={idolCardId:'synthetic',levelLimitRank:0,potentialRank:0,idolCardSkinId:''};
  assert.throws(()=>parseSnapshot({...base,idolCards:[card]}));
  for(const time of [0,1234])assert.equal(parseSnapshot({...base,idolCards:[{...card,primaStellaUpgradedTime:time}]}).idolCards[0].primaStellaUpgradedTime,time);
  assert.deepEqual(parseSnapshot({...base,characters:[{characterId:'jsna',trueEndProduceTypes:[1],fanCount:123}]}).characters,[{characterId:'jsna',trueEndProduceTypes:[1]}]);
});


test('38 个角色与剧本奖励精确关联 True End 徽章，不改变奖励和记录状态',()=>{
  const tables=JSON.parse(readFileSync(new URL('./fixtures/public-data/achievements.json',import.meta.url))).tables;
  const entries=createAchievementCatalog(tables,endings).entries({},{}),rows=entries.flatMap(e=>e.rows);
  assert.equal(rows.length,38);assert.equal(new Set(rows.map(r=>r.image)).size,38);
  for(const entry of entries){
    const original=endingBonusReference(endings,entry.characterId);
    assert.deepEqual(entry.total,original.total);
    for(const [index,row] of entry.rows.entries()){
      const definition=tables.Achievement.find(a=>a.id===row.achievementId);
      assert.equal(definition.characterId,entry.characterId);assert.equal(definition.isTrueEndAchievement,true);
      const script=definition.description.includes('H.I.F')?3:definition.description.includes('N.I.A')?2:1;
      assert.equal(row.type,script);
      assert.ok(row.image.endsWith('.webp'));assert.ok(JSON.parse(readFileSync(new URL('./fixtures/public-data/achievement-images.json',import.meta.url))).images.includes(row.image));
      const {image,achievementId,achievementName,...reward}=row;assert.deepEqual(reward,original.rows[index]);
    }
  }
  assert.deepEqual(entries.find(e=>e.characterId==='atbm').rows.map(r=>r.type),[1,2]);
});

test('缺少对应成就或图标时保留奖励，不拿其它角色或阶段的图标补位',()=>{
  const entry=createAchievementCatalog({Achievement:[{id:'achieve-p_idol-hski-000',characterId:'amao',isTrueEndAchievement:true,name:'wrong',category:'AchievementCategory_Idol'}],AchievementProgress:[{achievementId:'achieve-p_idol-hski-000',index:0,threshold:1,rewards:[],assetId:'wrong'}]},endings).entries({},{}).find(e=>e.characterId==='hski');
  assert.equal(entry.rows.length,3);assert.ok(entry.rows.every(r=>r.image===undefined));
});

test('Ending单卡将已达成和未达成奖励分开，并保留每个剧本贡献',async()=>{
  const {endingRewardStats}=await import('../domain/ending-bonuses.mjs');
  const partial=endingBonusReference(endings,'hski',{trueEndProduceTypes:[1,2]});
  const result=endingRewardStats(partial);
  assert.equal(result.calculations['初始 Vocal'].value,0);assert.equal(result.calculations['初始 Vocal'].remaining,20);
  assert.deepEqual(result.calculations['Vocal 成长率'].contributions,[{type:1,value:3},{type:2,value:1.5}]);
  assert.equal(result.calculations['Visual 成长率'].value,5.5);
  assert.deepEqual(result.calculations['初始 Dance'].remainingContributions,[{type:3,value:25}]);
  assert.equal(result.calculations['体力'].remaining,1);
  const none=endingRewardStats(endingBonusReference(endings,'hski'));
  assert.deepEqual(none.calculations['Vocal 成长率'].remainingContributions,[{type:1,value:3},{type:2,value:1.5}]);
  assert.ok(Object.values(none.calculations).every(row=>row.value===0));
  const all=endingRewardStats(endingBonusReference(endings,'hski',{trueEndProduceTypes:[1,2,3]}));
  assert.ok(Object.values(all.calculations).every(row=>row.remaining===0));
  assert.equal(all.statMaximum,30);assert.equal(all.growthMaximum,5.5);
});
