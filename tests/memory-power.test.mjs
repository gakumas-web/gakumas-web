import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validMemoryPowerTables,createMemoryPowerRules,calculateMemoryPower,updateMemoryPower} from '../domain/memory-power.mjs';
import {captureSimulationLoadout} from '../application/contest-simulation-history.mjs';
import {contestMemoryTotals} from '../domain/contest-simulation.mjs';

const tables={Setting:[{id:'1',memoryPowerParameterCoefficientPermil:3000,memoryPowerStaminaCoefficientPermil:24000,memoryPowerProduceResourceEvaluationCoefficientPermil:3000}],ProduceCardCustomizeRarityEvaluation:['N','R','Sr','Ssr'].map(rarity=>({rarity:'ProduceCardRarity_'+rarity,evaluation:12}))};
const rules=createMemoryPowerRules(tables);
const card=(id,upgradeCount=0,count=0)=>({id,upgradeCount,customizes:count?[{id:'custom',customizeCount:count}]:[]});
const definitions={'idol:0':{evaluation:100,rarity:'ProduceCardRarity_Ssr'},'card:0':{evaluation:50,rarity:'ProduceCardRarity_Sr'},'card:1':{evaluation:70,rarity:'ProduceCardRarity_Sr'},'normal:0':{evaluation:10,rarity:'ProduceCardRarity_N'}};
const referenceFor=(kind,reference)=>({record:{definition:kind==='item'?(reference==='item'?{evaluation:60}:null):definitions[reference.id+':'+reference.upgradeCount]}});
const memory=()=>({vocal:100,dance:200,visual:300,stamina:40,examBattleProduceCards:[card('idol'),card('card',1,2),card('normal',0,1)],examBattleProduceItemIds:['item']});
const calculate=memory=>calculateMemoryPower(memory,rules,referenceFor);

test('原表规则按属性、版本评价、道具与附魔次数计算，不以容量费用替代',()=>{
  assert.equal(calculate(memory()),3588);
  const downgraded=memory();downgraded.examBattleProduceCards[1].upgradeCount=0;
  assert.equal(calculate(downgraded),3528);
  const noItem=memory();noItem.examBattleProduceItemIds=[];assert.equal(calculate(noItem),3408);
  const noCustom=memory();noCustom.examBattleProduceCards=noCustom.examBattleProduceCards.map(card=>({...card,customizes:[]}));assert.equal(calculate(noCustom),3480);
});

test('缺规则、属性、技能、道具和附魔稀有度时不补造综合值',()=>{
  assert.equal(createMemoryPowerRules({}),null);
  assert.equal(calculateMemoryPower(memory(),null,referenceFor),null);
  assert.equal(calculate({...memory(),stamina:undefined}),null);
  assert.equal(calculate({...memory(),examBattleProduceCards:[]}),null);
  assert.equal(calculate({...memory(),examBattleProduceItemIds:undefined}),null);
  assert.equal(calculate({...memory(),examBattleProduceItemIds:['missing']}),null);
  assert.equal(calculate({...memory(),examBattleProduceCards:[card('missing')]}),null);
  const missingRarity={...rules,customizations:new Map()};assert.equal(calculateMemoryPower(memory(),missingRarity,referenceFor),null);
});

test('原表允许整体缺失，拒绝半套、缺系数、重复与缺失稀有度',()=>{
  assert.equal(validMemoryPowerTables({}),true);
  assert.equal(validMemoryPowerTables(tables),true);
  for(const bad of [{Setting:tables.Setting},{...tables,Setting:[]},{...tables,Setting:[{id:'1'}]},{...tables,ProduceCardCustomizeRarityEvaluation:tables.ProduceCardCustomizeRarityEvaluation.slice(1)},{...tables,ProduceCardCustomizeRarityEvaluation:[...tables.ProduceCardCustomizeRarityEvaluation,tables.ProduceCardCustomizeRarityEvaluation[0]]}])assert.equal(validMemoryPowerTables(bad),false);
});

test('未改配置保留采集值，修改后计算，还原后恢复采集值且不修改原对象',()=>{
  const original={...memory(),power:9000},reordered={...original,examBattleProduceCards:[...original.examBattleProduceCards].reverse()},before=structuredClone(original);
  assert.equal(updateMemoryPower(reordered,original,calculate).power,9000);
  const edited=updateMemoryPower({...original,vocal:200},original,calculate);assert.equal(edited.power,3888);assert.equal(edited.powerSource,'calculated');
  const restored=updateMemoryPower({...edited,vocal:100},original,calculate);assert.equal(restored.power,9000);assert.equal(restored.powerSource,undefined);
  const unknown=updateMemoryPower({...edited,examBattleProduceItemIds:['missing']},original,calculate);assert.equal(unknown.power,undefined);assert.equal(unknown.powerSource,undefined);
  assert.deepEqual(original,before);
});

test('生成编组计算值及标记参与主副合计，并随保存和载入副本保留',()=>{
  const calculated=updateMemoryPower(memory(),null,calculate),captured=captureSimulationLoadout([calculated,calculated]);
  assert.equal(captured.memories[0].power,3588);assert.equal(captured.memories[0].powerSource,'calculated');
  const total=contestMemoryTotals(captured.memories,{manualMultipliers:true});assert.equal(total.power,4305);assert.equal(total.powerSource,'calculated');
  assert.equal(updateMemoryPower({...calculated,power:1},calculated,calculate).power,3588);
});
