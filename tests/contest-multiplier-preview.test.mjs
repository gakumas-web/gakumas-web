import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {suggestContestParameters,previewContestMultipliers,prepareContestSimulation} from '../domain/contest-engine-runner.mjs';
const {requests}=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-engine.json',import.meta.url)));

test('百分比与参考模拟器的舞台 184、属性和支援加成完全一致',async()=>{
  const request={...requests[0],params:{vocal:1954,dance:1116,visual:2385,stamina:42},supportBonus:.116};
  assert.equal(request.stage.preset.id,184);
  assert.deepEqual(await previewContestMultipliers(request),{vocal:12.32,dance:13.78,visual:29.08});
});
test('三计划的预览与正式引擎一致，空值保持未知，手动倍率不重复加支援',async()=>{
  for(const request of requests){
    const expected=await prepareContestSimulation(request);assert.deepEqual(await previewContestMultipliers(request),expected.typeMultipliers);
  }
  const blank={...requests[0],params:{vocal:undefined,dance:0,visual:NaN,stamina:0}};
  const value=await previewContestMultipliers(blank);assert.equal(value.vocal,null);assert.equal(value.visual,null);assert.ok(Number.isFinite(value.dance));
  assert.deepEqual(await previewContestMultipliers({...requests[0],manualMultipliers:{vocal:123.4,dance:150,visual:undefined}}),{vocal:1.234,dance:1.5,visual:null});
  await assert.rejects(previewContestMultipliers({...requests[0],supportBonus:null}),error=>error.code==='missing_support_bonus');
  await assert.rejects(previewContestMultipliers({...requests[0],stage:{...requests[0].stage,custom:true}}),error=>error.code==='unsupported_stage');
});

test('快捷填入按舞台权重反推目标倍率的最小整数，使用实际支援加成且不返回体力',async()=>{
  for(const source of requests){
    const request={...source,supportBonus:.116},before=structuredClone(request),result=await suggestContestParameters(request);
    assert.equal('stamina' in result.params,false);assert.deepEqual(result.limited,[]);
    const order=['vocal','dance','visual'].sort((a,b)=>request.stage.preset.criteria[b]-request.stage.preset.criteria[a]);
    assert.deepEqual(order.map(key=>result.targets[key]),[30,20,12]);
    for(const key of order){
      assert.ok(Number.isSafeInteger(result.params[key]));assert.ok(result.multipliers[key]>=result.targets[key]);
      const lower=await previewContestMultipliers({...request,params:{...result.params,[key]:result.params[key]-1}});assert.ok(lower[key]<result.targets[key]);
    }
    assert.deepEqual(request,before);
  }
  assert.deepEqual((await suggestContestParameters({...requests[0],supportBonus:.116})).params,{vocal:1873,dance:1851,visual:2569});
});

test('目标超过舞台上限时填最早达到上限的值；缺支援、手动倍率与自定义舞台拒绝反推',async()=>{
  const request={...requests[0],supportBonus:0},result=await suggestContestParameters(request);
  assert.ok(result.limited.includes('visual'));
  const maximum=await previewContestMultipliers({...request,params:{vocal:100000,dance:100000,visual:100000}});
  for(const key of result.limited){
    assert.equal(result.multipliers[key],maximum[key]);
    assert.ok((await previewContestMultipliers({...request,params:{...result.params,[key]:result.params[key]-1}}))[key]<maximum[key]);
  }
  for(const invalid of [{...request,supportBonus:null},{...request,manualMultipliers:{vocal:3000,dance:2000,visual:1200}},{...request,stage:{...request.stage,custom:true}}])await assert.rejects(suggestContestParameters(invalid));
});
