import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateContestOptimizationOptions,runContestSimulation} from '../domain/contest-engine-runner.mjs';
const data=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-unmatched-repair.json',import.meta.url)));
const requests=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-engine.json',import.meta.url))).requests;

test('修复的名称和附魔逐项通过正式校验及三个计划的实际模拟',async()=>{
  const result=await validateContestOptimizationOptions(data.entries);assert.deepEqual(result.unsupported,[]);assert.equal(result.supported.length,33);
  for(const option of data.entries){
    const {entry,kind}=option,plan=entry.record.definition.planType,original=requests.find(request=>request.stage.planType===plan)??requests[0];
    const request={...structuredClone(original),[kind==='item'?'items':'cards']:[entry]};
    assert.ok(Number.isFinite((await runContestSimulation(request,{runs:1,seed:31})).mean),option.key);
  }
});
test('已匹配的名称仍受公开指纹约束，附魔条件原文变化会被拒绝',async()=>{
  for(const option of data.entries){
    const changed=structuredClone(option);changed.entry.record.name+='changed';assert.equal((await validateContestOptimizationOptions([changed])).unsupported.length,1);
    for(const material of option.entry.customizations??[])if(material.triggers?.length){
      const changed=structuredClone(option);changed.entry.customizations[0].triggers[0].playProduceDescriptions[0].text+='changed';
      assert.equal((await validateContestOptimizationOptions([changed])).unsupported.length,1);
    }
  }
});
