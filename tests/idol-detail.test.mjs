import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installMaster,idolInfo,idolArtVariants,progressionInfo} from '../domain/catalog.mjs';
const read=name=>JSON.parse(readFileSync(new URL(`./fixtures/public-data/${name}.json`,import.meta.url)));
installMaster({tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},
  idols:read('idols'),progression:read('progression')});
const held=Object.freeze({idolCardId:'i_card-hmsz-3-016',levelLimitRank:2,potentialRank:0});

test('实际 VEIL 成长表在特训2到3更换卡面，并保留两张图的浏览入口',()=>{
  const change=progressionInfo('idol',held,3,0);
  assert.equal(change.illustrationRank,3);
  assert.equal(change.changes.find(row=>row.label==='强化卡面').changed,true);
  const variants=idolArtVariants(held);
  assert.deepEqual(variants.map(row=>row.image),['img_general_cidol-hmsz-3-016_0-full.webp','img_general_cidol-hmsz-3-016_1-full.webp']);
  assert.equal(variants[1].unlockRank,3);
  assert.equal(idolInfo(held).image,variants[0].image);
  assert.equal(idolInfo({...held,levelLimitRank:3}).image,variants[1].image);
});
test('所选替换卡面作为独立选项保留，未知卡不推测资源',()=>{
  const variants=idolArtVariants({idolCardId:'i_card-amao-3-000',idolCardSkinId:'i_card-skin-amao-3-003',levelLimitRank:6,potentialRank:0});
  assert.deepEqual(variants.map(row=>row.id),['base','upgraded','alternate']);
  assert.equal(variants[2].image,'img_general_cidol-amao-3-003_0-full.webp');
  assert.deepEqual(idolArtVariants({...held,idolCardId:'missing'}),[]);
});
