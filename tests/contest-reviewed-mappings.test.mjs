import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readContestFixture,bindContestEntry} from './contest-current-content.mjs';
import {prepareContestSimulation,runContestSimulation,validateContestOptimizationOptions,stableJSON} from '../domain/contest-engine-runner.mjs';
import {StageEngine,S,SkillCards,PItems,Customizations} from '../domain/upstream-contest-engine.mjs';
const data=readContestFixture(new URL('./fixtures/public-data/contest-reviewed-mappings.json',import.meta.url));
const requests=readContestFixture(new URL('./fixtures/public-data/contest-engine.json',import.meta.url)).requests;

test('剩余二十项采用已核对的上游身份，实际模拟不修改上游卡片、道具或附魔定义',async()=>{
  const snapshot=()=>JSON.stringify([data.engineCards.map(row=>SkillCards.getById(row.id)),data.engineItems.map(row=>PItems.getById(row.id)),data.engineCustomizations.map(row=>Customizations.getById(row.id))]),before=snapshot();
  const result=await validateContestOptimizationOptions(data.entries);assert.deepEqual(result.unsupported,[]);assert.equal(result.supported.length,20);
  for(const option of data.entries){
    const {entry,kind}=option,plan=entry.record.definition.planType,original=requests.find(request=>request.stage.planType===plan)??requests[0];
    const request={...structuredClone(original),[kind==='item'?'items':'cards']:[entry]},config=await prepareContestSimulation(request);
    if(kind==='item')assert.deepEqual(config.idol.pItemIds,[option.expectedId]);
    else{const engine=new StageEngine(config),state=engine.getInitialState(),card=Object.values(state[S.cardMap]).find(card=>card.id===option.expectedId);assert.ok(card,option.key);assert.deepEqual(card.c11n??{},option.expectedCustomizations);}
    assert.ok(Number.isFinite((await runContestSimulation(request,{runs:1,seed:39})).mean),option.key);
  }
  assert.equal(snapshot(),before);
});
test('登记过身份的公开定义或附魔被修改后仍拒绝使用',async()=>{
  for(const option of data.entries){
    const changed=structuredClone(option);if(changed.entry.customizations?.length)changed.entry.customizations[0].grows[0].value+=1;else changed.entry.record.name+='changed';
    assert.equal((await validateContestOptimizationOptions([changed])).unsupported.length,1,option.key);
  }
});
test('候选绑定仍拒绝缺失身份、附魔等级和已经过期的固定定义',{skip:!process.env.GAKUMAS_CONTEST_TEST_EFFECTS},async()=>{
  const original=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-reviewed-mappings.json',import.meta.url)));
  for(const option of original.entries){
    const current=data.entries.find(row=>row.key===option.key);
    if(stableJSON(current.entry)!==stableJSON(option.entry))assert.equal((await validateContestOptimizationOptions([option])).unsupported.length,1,option.key);
  }
  const card=data.entries.find(option=>option.kind!=='item').entry;
  assert.throws(()=>bindContestEntry({...card,reference:{...card.reference,id:'synthetic-missing-card'}}),/候选回归缺少原身份或附魔等级/);
  assert.throws(()=>bindContestEntry({...card,reference:{...card.reference,customizes:[{id:'synthetic-missing-customization',customizeCount:1}]}}),/候选回归缺少原身份或附魔等级/);
  const customized=data.entries.find(option=>option.entry.reference?.customizes.length).entry;
  assert.throws(()=>bindContestEntry({...customized,reference:{...customized.reference,customizes:[{...customized.reference.customizes[0],customizeCount:999}]}}),/候选回归缺少原身份或附魔等级/);
});
