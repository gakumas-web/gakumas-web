import fs from 'node:fs';
import {installCommunityRules} from '../domain/community-rules.mjs';
const referenceRules=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/reference-data.json',import.meta.url))).communityRules;
installCommunityRules(referenceRules);
import test from 'node:test';
import assert from 'node:assert/strict';
import {createContestStatistics} from '../domain/contest-simulation-stats.mjs';
import {contestCardCost,contestDeckCost,contestCapacityStatus} from '../domain/contest-card-cost.mjs';
import {captureSimulationLoadout} from '../application/contest-simulation-history.mjs';
const log=(logType,data={})=>({logType,data});

test('同回合多次查看手牌不重复计入手，多份同卡和附魔版本分开统计',()=>{
  const stats=createContestStatistics('score'),a={id:1},b={id:1,c:{4:1}};
  stats.accumulate([log('startTurn',{type:'vocal'}),log('hand',{handCards:[a,a,b],selectedIndex:0}),log('hand',{handCards:[a,b],selectedIndex:1}),log('hand',{handCards:[a],selectedIndex:null}),log('startTurn',{type:'dance'}),log('hand',{handCards:[a],selectedIndex:0})]);
  const result=stats.finish(),plain=result.total.rows.find(row=>!row.c),custom=result.total.rows.find(row=>row.c);
  assert.equal(plain.draw,3);assert.equal(plain.use,2);assert.equal(custom.draw,1);assert.equal(custom.use,1);assert.equal(result.total.skips,1);
});
test('嵌套效果归属不重复；舞台透传、延迟归原卡，道具只计主触发',()=>{
  const stats=createContestStatistics('score');stats.accumulate([
    log('startTurn',{type:'visual'}),log('hand',{handCards:[{id:1}],selectedIndex:0}),log('entityStart',{type:'skillCard',id:1}),log('diff',{field:'score',prev:0,next:10}),
    log('entityStart',{type:'pItem',id:2,primary:true}),log('diff',{field:'score',prev:10,next:30}),log('entityEnd'),
    log('entityStart',{type:'stage',id:3}),log('diff',{field:'score',prev:30,next:35}),log('entityEnd'),log('entityEnd'),
    log('entityStart',{type:'skillCardEffect',id:1}),log('diff',{field:'score',prev:35,next:40}),log('entityEnd'),
    log('entityStart',{type:'pItem',id:2,primary:true}),log('entityEnd'),
    log('entityStart',{type:'pItem',id:2}),log('diff',{field:'score',prev:40,next:45}),log('entityEnd'),
  ]);const result=stats.finish();assert.equal(result.total.totalScore,45);
  const card=result.total.rows.find(row=>row.type==='skillCard'),item=result.total.rows.find(row=>row.type==='pItem');
  assert.equal(card.score,20);assert.equal(item.score,25);assert.equal(item.use,1);assert.equal(card.scoreByType.visual,20);
});
test('容量不计专属与附魔；来源、解锁等级及强化改变费用，未知定义不补造',()=>{
  const record=(rarity,upgradeCount,extra={})=>({rarity:'ProduceCardRarity_'+rarity,upgradeCount,definition:{unlockProducerLevel:3,...extra}});
  assert.equal(contestCardCost(record('Ssr',1,{originIdolCardId:'idol'})),0);assert.equal(contestCardCost(record('Ssr',1,{originSupportCardId:'support'})),126);
  assert.equal(contestCardCost(record('Ssr',0)),150);assert.equal(contestCardCost(record('Ssr',1)),204);assert.equal(contestCardCost(record('Sr',1)),141);assert.equal(contestCardCost(record('Sr',1,{unlockProducerLevel:2})),102);
  assert.equal(contestCardCost(record('R',0)),45);assert.equal(contestCardCost(record('R',0,{unlockProducerLevel:2})),30);assert.equal(contestCardCost(null),null);
  const entries=[{reference:{id:'a',customizes:[{id:'x',customizeCount:4}]},record:record('Ssr',1)},{reference:{id:'b'},record:record('Sr',1)}];assert.equal(contestDeckCost(entries).total,345);assert.equal(contestDeckCost([...entries,{reference:{id:'unknown'},record:null}]).total,null);
});
test('历史编组独立拷贝且不保存账号与回忆身份',()=>{
  const input={characterId:'hski',userMemoryId:'private-memory',publicUserId:'private-account',examBattleProduceCards:[{id:'card',upgradeCount:1,customizes:[]}]};const output=captureSimulationLoadout([input,null]);
  assert.equal(JSON.stringify(output).includes('private'),false);output.memories[0].examBattleProduceCards[0].id='other';assert.equal(input.examBattleProduceCards[0].id,'card');
});

test('容量低于下限标蓝、超过上限标红，边界和未收录评级不误报',()=>{
  assert.equal(contestCapacityStatus(642,'S').overflow,false);
  assert.equal(contestCapacityStatus(643,'S').overflow,true);
  assert.equal(contestCapacityStatus(545,'S').overflow,false);
  assert.equal(contestCapacityStatus(545,'S').underflow,true);
  assert.equal(contestCapacityStatus(546,'S').underflow,false);
  assert.equal(contestCapacityStatus(null,'S').underflow,false);
  assert.equal(contestCapacityStatus(0,'unknown').underflow,false);
  assert.equal(contestCapacityStatus(545,'S5+').underflow,true);
  assert.equal(contestCapacityStatus(null,'S').overflow,false);
  for(const rank of ['S4','S4+','S5','S5+']){assert.equal(contestCapacityStatus(858,rank).overflow,false);assert.equal(contestCapacityStatus(859,rank).overflow,true);assert.equal(contestCapacityStatus(859,rank).range.rank,'SSS+');}
  assert.equal(contestCapacityStatus(999,'unknown').range,null);
  assert.equal(contestCapacityStatus(999,'unknown').overflow,false);
});
