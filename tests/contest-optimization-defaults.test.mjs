import test from 'node:test';
import assert from 'node:assert/strict';
import {installMaster,idolInfo} from '../domain/catalog.mjs';
import {sortOptimizationExclusives} from '../application/contest-optimization-input.mjs';

test('专属默认顺序先按偶像稀有度、再按原始卡面发行时间，第一专属先于第二专属',()=>{
  const cards=[['r','R',900],['ssr-old','Ssr',100],['ssr-new','Ssr',200],['sr','Sr',999],['ssr-unknown','Ssr',0]].map(([id,rarity,time])=>({id,characterId:'hski',rarity:'IdolCardRarity_'+rarity,originalIdolCardSkinId:id+'-skin',time}));
  installMaster({tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},idols:{cards,skins:[...cards.map(card=>({id:card.originalIdolCardSkinId,idolCardId:card.id,viewStartTime:String(card.time)})),{id:'new-costume',idolCardId:'ssr-old',viewStartTime:'9999'}]}});
  const held=cards.map(card=>({idolCardId:card.id,levelLimitRank:0,potentialRank:0,...(card.id==='ssr-old'?{idolCardSkinId:'new-costume'}:{})}));
  const choices=cards.flatMap(card=>[true,false].map(secondExclusive=>({id:card.id+(secondExclusive?'-second':'-first'),idolCardId:card.id,metadata:{secondExclusive}})));
  assert.equal(idolInfo(held.find(card=>card.idolCardId==='ssr-old')).sortReleaseTime,100);
  const sorted=sortOptimizationExclusives(choices,held);assert.deepEqual(sorted.map(choice=>choice.id),['ssr-new-first','ssr-new-second','ssr-old-first','ssr-old-second','ssr-unknown-first','ssr-unknown-second','sr-first','sr-second','r-first','r-second']);
  assert.equal(choices[0].id,'r-second');
});
