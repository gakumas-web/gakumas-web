import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareContestSimulation,runContestSimulation,validateContestOptimizationOptions} from '../domain/contest-engine-runner.mjs';
import {StageEngine,S,SkillCards,PItems,Customizations} from '../domain/upstream-contest-engine.mjs';
const data=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-reviewed-mappings.json',import.meta.url)));
const requests=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-engine.json',import.meta.url))).requests;

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
