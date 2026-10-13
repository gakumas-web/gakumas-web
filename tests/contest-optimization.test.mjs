import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createOptimizationProblem,optimizationPopulation,optimizationRandom,optimizationCustomizations} from '../domain/contest-optimization.mjs';
import {validateContestOptimizationOptions} from '../domain/contest-engine-runner.mjs';

function fixture(){
  const variants=[];
  for(const [id,source,cost] of [['exclusive','idol',0],['cheap','common',30],['medium','common',60],['expensive','common',100],['support','support',80],['cheap-two','common',30],['cheap-three','common',30],['medium-two','common',60],['expensive-two','common',100]])for(const upgradeCount of [0,1])for(const count of [0,1,2])variants.push({source,cost:cost+(source==='idol'?0:upgradeCount*10),reference:{id,upgradeCount,customizes:count?[{id:'custom',customizeCount:count}]:[]}});
  const common=variants.flatMap((v,i)=>v.source==='common'?[i]:[]),support=variants.flatMap((v,i)=>v.source==='support'?[i]:[]),exclusive=variants.flatMap((v,i)=>v.source==='idol'?[i]:[]);
  const roles=[{min:230,max:250},{min:380,max:400}].map((capacity,index)=>({capacity,maxCustomizeCount:index?3:2,maxCustomizedCards:1,allowed:[exclusive,[...common,...support],common,common,common,common],template:{characterId:'synthetic-character',planType:2,grade:10,stamina:40,examBattleProduceItemIds:index?[]:['synthetic-fixed-item']}}));
  return {variants,roles};
}
test('附魔穷举覆盖合法组合，逐项等级及总上限不越界',()=>{
  const data={maximum:3,options:[{id:'a',levels:[{level:1},{level:2}]},{id:'b',levels:[{level:1},{level:2}]}]};
  const variants=optimizationCustomizations(data);assert.equal(variants.length,8);
  assert.ok(variants.some(values=>values.some(value=>value.id==='a'&&value.customizeCount===2)&&values.some(value=>value.id==='b'&&value.customizeCount===1)));
  assert.equal(optimizationCustomizations(data,1).length,3);assert.deepEqual(optimizationCustomizations(data,0),[[]]);
});
test('随机生成、交叉与变异均守住主副容量、专属槽、支援槽及附魔预算',()=>{
  const input=fixture(),original=structuredClone(input),problem=createOptimizationProblem(input),random=optimizationRandom(19);assert.equal(problem.possible,true);
  let population=optimizationPopulation(problem,{size:32,random});
  for(let generation=0;generation<12;generation++){
    assert.equal(population.length,32);
    for(const genome of population){
      assert.equal(problem.valid(genome),true);const memories=problem.materialize(genome);
      for(const memory of memories){assert.equal(memory.examBattleProduceCards.length,6);assert.equal(memory.examBattleProduceCards[0].id,'exclusive');assert.ok(memory.examBattleProduceCards.slice(2).every(card=>card.id!=='support'));}
      assert.deepEqual(memories[1].examBattleProduceItemIds,[]);
    }
    const ranked=population.map(genome=>({genome})),best=problem.key(population[0]);population=optimizationPopulation(problem,{size:32,random,ranked});assert.ok(population.some(genome=>problem.key(genome)===best));
  }
  assert.deepEqual(input,original);
});
test('不可达评级返回无解，不用超容量或不足容量的编组补齐种群',()=>{
  const input=fixture();input.roles[0].capacity={min:1000,max:1001};const problem=createOptimizationProblem(input);assert.equal(problem.possible,false);assert.deepEqual(optimizationPopulation(problem,{size:8,random:optimizationRandom(1)}),[]);
});
test('固定随机种子复现种群，非法父代按当前约束修复',()=>{
  const problem=createOptimizationProblem(fixture()),generate=()=>optimizationPopulation(problem,{size:16,random:optimizationRandom(41)});
  assert.deepEqual(generate(),generate());const genome=[...generate()[0]];genome[2]=-1;
  assert.ok(problem.valid(problem.repair(genome,optimizationRandom(9))));
});
const engine=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-engine.json',import.meta.url)));
test('搜索预校验复用正式引擎指纹，不把未知卡片当作可用候选',async()=>{
  const entry=engine.requests[0].cards[0],unknown=structuredClone(entry);unknown.record.name+='unknown';
  const result=await validateContestOptimizationOptions([{key:'valid',entry},{key:'invalid',entry:unknown}]);assert.deepEqual(result.supported,['valid']);assert.equal(result.unsupported[0].key,'invalid');
});
test('评级来源名额在种群、变异和父代修复后仍有效，通用卡不能借用支援名额',()=>{
  const input=fixture();for(const role of input.roles){role.maxCustomizedCards=4;role.maxCustomizeCount=9;role.customizedCardsBySource={idol:0,support:1,common:1};}
  const problem=createOptimizationProblem(input),random=optimizationRandom(98);
  let population=optimizationPopulation(problem,{size:24,random});
  for(let generation=0;generation<5;generation++){
    for(const genome of population){
      assert.ok(problem.valid(genome));
      for(let role=0;role<2;role++){
        const cards=genome.slice(role*6,role*6+6).map(index=>input.variants[index]);
        assert.ok(cards.filter(card=>card.source==='common'&&card.reference.customizes.length).length<=1);
        assert.equal(cards.filter(card=>card.source==='idol'&&card.reference.customizes.length).length,0);
      }

    }
    population=optimizationPopulation(problem,{size:24,random,ranked:population.map(genome=>({genome}))});
  }
});

test('所有卡片在单张回忆内按 ID 禁重，强化附魔不绕过，主副独立校验',()=>{
  const input=fixture();for(const variant of input.variants)variant.noDeckDuplication=['exclusive','cheap'].includes(variant.reference.id);
  const problem=createOptimizationProblem(input),random=optimizationRandom(7);let population=optimizationPopulation(problem,{size:24,random});
  for(let generation=0;generation<4;generation++){
    assert.equal(population.length,24);
    for(const genome of population){
      assert.ok(problem.valid(genome));const memories=problem.materialize(genome);
      for(const memory of memories){const ids=memory.examBattleProduceCards.map(card=>card.id);assert.equal(ids[0],'exclusive');assert.equal(new Set(ids).size,6);}
    }
    population=optimizationPopulation(problem,{size:24,random,ranked:population.map(genome=>({genome}))});
  }
  const illegal=[...population[0]],cheap=input.variants.flatMap((variant,index)=>variant.reference.id==='medium'?[index]:[]);
  illegal[2]=cheap[0];illegal[3]=cheap.at(-1);assert.equal(problem.valid(illegal),false);assert.throws(()=>problem.materialize(illegal),/invalid_optimization_genome/);
  assert.ok(problem.valid(problem.repair(illegal,random)));
});
test('容量可达但唯一卡不足时返回无解',()=>{
  const input=fixture();for(const role of input.roles)role.allowed=role.allowed.map(indices=>indices.filter(index=>['exclusive','cheap','medium','expensive','support'].includes(input.variants[index].reference.id)));
  const problem=createOptimizationProblem(input);assert.equal(problem.possible,false);assert.equal(problem.random(optimizationRandom(1)),null);assert.equal(problem.mutate(null,optimizationRandom(1)),null);
  assert.deepEqual(optimizationPopulation(problem,{size:8,random:optimizationRandom(1)}),[]);
});
test('唯一性与容量联合回溯，保留固定首槽并跳过会堵死后续槽位的父代卡',()=>{
  const variants=[0,0,1,1,1,1,2].map((cost,index)=>({cost,source:index?'common':'idol',noDeckDuplication:true,reference:{id:`card-${index}`,upgradeCount:0,customizes:[]}}));
  const common=[1,2,3,4,5,6],roles=[0,1].map(()=>({capacity:{min:6,max:6},maxCustomizeCount:0,maxCustomizedCards:0,allowed:[[0],common,common,common,common,common],template:{}}));
  const problem=createOptimizationProblem({variants,roles});assert.equal(problem.possible,true);
  const genome=problem.repair([0,1,2,3,4,5,0,1,2,3,4,5],optimizationRandom(1));assert.ok(problem.valid(genome));
  for(const memory of problem.materialize(genome))assert.deepEqual(memory.examBattleProduceCards.map(card=>card.id),[0,2,3,4,5,6].map(index=>`card-${index}`));
});

function priorityFixture(){
  const variants=[{source:'idol',rarity:'SSR',cost:0,reference:{id:'exclusive',upgradeCount:1,customizes:[]}}];
  for(let index=0;index<20;index++)variants.push({source:'common',rarity:index<6?'SSR':index<12?'SR':'R',unlockProducerLevel:index<6?index*15:20,cost:60,reference:{id:`common-${index}`,upgradeCount:1,customizes:[]}});
  for(let index=0;index<2;index++)variants.push({source:'support',rarity:'SSR',cost:60,reference:{id:`support-${index}`,upgradeCount:1,customizes:[]}});
  const common=variants.flatMap((value,index)=>value.source==='common'?[index]:[]),support=variants.flatMap((value,index)=>value.source==='support'?[index]:[]);
  const roles=[0,1].map(()=>({capacity:{min:300,max:300},maxCustomizeCount:0,maxCustomizedCards:0,allowed:[[0],[...common,...support],common,common,common,common],template:{}}));
  return {variants,roles};
}
test('初始种群主动覆盖主副各自可行的通用及支援 SSR，超容量 SSR 不阻塞生成',()=>{
  const input=priorityFixture(),blocked=input.variants.length;input.variants.push({source:'common',rarity:'SSR',unlockProducerLevel:100,cost:500,reference:{id:'too-expensive',upgradeCount:1,customizes:[]}});
  for(const role of input.roles)for(const slot of role.allowed.slice(1))slot.push(blocked);
  const problem=createOptimizationProblem(input),population=optimizationPopulation(problem,{size:24,random:optimizationRandom(5)});assert.equal(population.length,24);
  for(let role=0;role<2;role++){
    const ids=new Set(population.flatMap(genome=>genome.slice(role*6,role*6+6).map(index=>input.variants[index].reference.id)));
    for(const variant of input.variants.filter(value=>value.rarity==='SSR'&&value.cost<=300))assert.ok(ids.has(variant.reference.id),`${role}: ${variant.reference.id}`);
    assert.ok(!ids.has('too-expensive'));
  }
  for(const genome of population)assert.ok(problem.valid(genome));
});
test('随机候选优先高稀有度及后期通用卡，低稀有度保留机会，附魔变体数量不放大身份权重',()=>{
  const input=priorityFixture(),original=input.variants[1];
  for(let i=1;i<=40;i++){const index=input.variants.length;input.variants.push({...original,reference:{...original.reference,customizes:[{id:'custom',customizeCount:i}]}});for(const role of input.roles)for(const slot of role.allowed.slice(1))slot.push(index);}
  const problem=createOptimizationProblem(input),random=optimizationRandom(79),counts=new Map();
  for(let sample=0;sample<600;sample++){
    const genome=problem.random(random);assert.ok(problem.valid(genome));
    for(const index of genome){const id=input.variants[index].reference.id;counts.set(id,(counts.get(id)??0)+1);}
  }
  assert.ok(counts.get('common-5')>counts.get('common-0')*1.15);
  assert.ok(counts.get('common-0')>counts.get('common-19')*1.5);
  assert.ok(counts.get('common-19')>0);
  assert.ok(counts.get('common-0')<counts.get('common-1')*1.25);
  let population=optimizationPopulation(problem,{size:24,random});
  for(let generation=0;generation<3;generation++){population=optimizationPopulation(problem,{size:24,random,ranked:population.map(genome=>({genome}))});assert.equal(population.length,24);population.forEach(genome=>assert.ok(problem.valid(genome)));}
});

test('整份回忆交叉保留父代内部配合，局部邻居能转移附魔名额且不修改原配置',()=>{
  const input=priorityFixture(),plain=input.variants.map((variant,index)=>({variant,index}));
  for(const {variant,index} of plain){
    if(variant.source!=='common')continue;
    const custom=input.variants.length;input.variants.push({...variant,reference:{...variant.reference,customizes:[{id:'custom',customizeCount:2}]}});
    for(const role of input.roles)for(const slot of role.allowed.slice(1))if(slot.includes(index))slot.push(custom);
  }
  for(const role of input.roles){role.maxCustomizeCount=2;role.maxCustomizedCards=1;role.customizedCardsBySource={common:1,support:0,idol:0};}
  const problem=createOptimizationProblem(input),random=optimizationRandom(317),a=problem.random(random),b=problem.random(random);
  for(let attempt=0;attempt<20;attempt++){
    const child=problem.crossover(a,b,random);assert.ok(problem.valid(child));
    for(let role=0;role<2;role++)assert.ok([a,b].some(parent=>JSON.stringify(parent.slice(role*6,role*6+6))===JSON.stringify(child.slice(role*6,role*6+6))));
  }
  const customA=input.variants.findIndex(variant=>variant.reference.id==='common-0'&&variant.reference.customizes.length),genome=[0,21,customA,2,3,4,0,22,5,6,7,8],before=structuredClone(genome);
  assert.ok(problem.valid(genome));
  const neighbors=problem.neighbors(genome,optimizationRandom(1),10000);assert.ok(neighbors.length);neighbors.forEach(value=>assert.ok(problem.valid(value)));
  assert.ok(neighbors.some(value=>{
    const cards=value.slice(0,6).map(index=>input.variants[index].reference);
    return cards.some(card=>card.id==='common-0'&&!card.customizes.length)&&cards.some(card=>card.id==='common-1'&&card.customizes[0]?.customizeCount===2)&&cards.map(card=>card.id).sort().join(',')===genome.slice(0,6).map(index=>input.variants[index].reference.id).sort().join(',');
  }));
  assert.deepEqual(genome,before);assert.deepEqual(problem.neighbors(genome,optimizationRandom(1),12),problem.neighbors(genome,optimizationRandom(1),12));
  const excluded=new Set(neighbors.map(problem.key));assert.deepEqual(problem.neighbors(genome,optimizationRandom(1),12,excluded),[]);
});
