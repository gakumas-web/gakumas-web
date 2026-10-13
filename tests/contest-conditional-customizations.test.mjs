import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareContestSimulation,runContestSimulation,validateContestOptimizationOptions} from '../domain/contest-engine-runner.mjs';
import {StageEngine,S,Customizations} from '../domain/upstream-contest-engine.mjs';
const data=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-conditional-customizations.json',import.meta.url)));
const original=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-engine.json',import.meta.url))).requests[0];

test('四项排除问题通过正式预校验和模拟，附魔不降级为旧的元气四点',async()=>{
  const result=await validateContestOptimizationOptions(data.entries.map((entry,index)=>({key:String(index),entry})));
  assert.deepEqual(result.supported,['0','1','2','3']);assert.deepEqual(result.unsupported,[]);
  for(const [index,entry] of data.entries.entries()){
    const request={...structuredClone(original),cards:[entry]},config=await prepareContestSimulation(request),engine=new StageEngine(config),state=engine.getInitialState();
    if(index>=2){const id=index===2?35:597,custom=index===2?28:97;assert.deepEqual(Object.values(state[S.cardMap]).find(card=>card.id===id).c11n,{[custom]:1});}
    const simulated=await runContestSimulation(request,{runs:1,seed:21});assert.ok(Number.isFinite(simulated.mean));assert.equal(simulated.representative.turns.length,original.stage.turn);
  }
  assert.match(JSON.stringify(Customizations.getById(28).actions),/9/);
});

test('四项映射继续校验完整公开定义，不接受篡改后的效果或条件',async()=>{
  for(const entry of data.entries){
    const changed=structuredClone(entry);
    if(changed.customizations.length)changed.customizations[0].grows[0].value+=1;else changed.record.definition.stamina+=1;
    const result=await validateContestOptimizationOptions([{key:'changed',entry:changed}]);assert.deepEqual(result.supported,[]);assert.equal(result.unsupported.length,1);
    if(entry.reference.id==='p_card-01-act-2_061')assert.match(result.unsupported[0].details[0].name,/使用条件変更/);
  }
});

test('条件变更附魔的目标触发文本也参加指纹校验',async()=>{
  const entry=structuredClone(data.entries[3]);entry.customizations[0].triggers[0].playProduceDescriptions[0].text+='changed';
  const result=await validateContestOptimizationOptions([{key:'trigger-change',entry}]);assert.deepEqual(result.supported,[]);assert.equal(result.unsupported.length,1);
});


test('带日文引号的 Pっち两种版本通过统一道具校验和实际模拟',async()=>{
  const items=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-item-punctuation.json',import.meta.url)));
  for(const record of items){const entry={id:record.id,record},result=await validateContestOptimizationOptions([{key:record.id,kind:'item',entry}]);assert.deepEqual(result.supported,[record.id]);assert.deepEqual(result.unsupported,[]);const request={...structuredClone(original),items:[entry]};assert.ok(Number.isFinite((await runContestSimulation(request,{runs:1,seed:9})).mean));const changed=structuredClone(entry);changed.record.text+='changed';assert.equal((await validateContestOptimizationOptions([{key:record.id,kind:'item',entry:changed}])).unsupported.length,1);}
});
