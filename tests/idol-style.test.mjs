import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {installMaster,idolInfo} from '../domain/catalog.mjs';
import {idolEntries} from '../domain/catalog-selectors.mjs';
const idols=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/idols.json',import.meta.url)));
installMaster({tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},idols});
const snapshot={idolCards:[{idolCardId:'i_card-amao-3-000',levelLimitRank:0,potentialRank:0}]};
const type=name=>'ProduceExamEffectType_'+name;
test('Fluorite 主流派为好调，集中筛选不命中，培养阶段不改主流派',()=>{
  for(const rank of [0,6,7]){
    const held={...snapshot.idolCards[0],levelLimitRank:rank};
    assert.equal(idolInfo(held).examEffectType,type('ExamParameterBuff'));
    assert.equal(idolEntries({idolCards:[held]},'','original',{idolEffect:[type('ExamLessonBuff')]}).length,0);
    assert.equal(idolEntries({idolCards:[held]},'','original',{idolEffect:[type('ExamParameterBuff')]}).length,1);
  }
});
test('六种主流派互斥且覆盖目录，多选仍取并集，未知卡不猜流派',()=>{
  const types=[...new Set(idols.cards.map(c=>c.examEffectType))];assert.equal(types.length,6);
  const seen=new Set();
  for(const value of types){
    const entries=idolEntries(snapshot,'','original',{ownership:'all',idolEffect:[value]});
    assert.equal(entries.length,idols.cards.filter(c=>c.examEffectType===value).length);
    for(const e of entries){assert.ok(!seen.has(e.held.idolCardId));seen.add(e.held.idolCardId);}
  }
  assert.equal(seen.size,idols.cards.length);
  const union=idolEntries(snapshot,'','original',{ownership:'all',idolEffect:types.slice(0,2)});
  assert.equal(union.length,idols.cards.filter(c=>types.slice(0,2).includes(c.examEffectType)).length);
  assert.equal(idolInfo({idolCardId:'unresolved'}).examEffectType,undefined);
});
