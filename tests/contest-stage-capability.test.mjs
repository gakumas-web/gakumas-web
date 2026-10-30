import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {contestStageCapability,verifyContestStageCapability,latestAvailableContestStage} from '../domain/contest-stage-capability.mjs';
import {previewContestMultipliers,suggestContestParameters,prepareContestSimulation} from '../domain/contest-engine-runner.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-engine.json',import.meta.url)));
const fullPresets=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-stage-capabilities.json',import.meta.url)));
const complete=()=>({...structuredClone(fixture.requests[0].stage),id:'contest:pvp_rate_config-53:0'});

test('完整舞台经正式指纹核对可用，日期缺失不降低模拟能力',async()=>{
  const stage=complete();stage.season={};stage.preset.name='展示名称';stage.preset.preview=false;
  assert.equal((await verifyContestStageCapability(stage)).state,'ready');
  delete stage.season;
  assert.equal(contestStageCapability(stage).state,'ready');
});
test('真实53和54完整参考含展示metadata时仍与正式业务指纹一致',async()=>{
  for(const stage of structuredClone(fullPresets.stages))assert.equal((await verifyContestStageCapability(stage)).state,'ready',stage.id);
});
test('只有raw的舞台保留待补原因，计算入口均不能产生结果',async()=>{
  const request=structuredClone(fixture.requests[0]);
  request.stage={...request.stage,id:'contest:pvp_rate_config-999:0',preset:null};
  assert.deepEqual(await verifyContestStageCapability(request.stage),{state:'pending',reasons:['missing_stage_reference','missing_engine_stage']});
  for(const calculate of [previewContestMultipliers,suggestContestParameters,prepareContestSimulation])await assert.rejects(calculate(request),error=>error.code==='unsupported_stage');
});
test('补入真实参考可启用已有engine舞台，首次默认优先最近可用舞台',async()=>{
  const ready=complete(),pending={...complete(),id:'contest:pvp_rate_config-999:0',preset:null};
  const missing={...complete(),preset:null};
  assert.deepEqual(await verifyContestStageCapability(missing),{state:'pending',reasons:['missing_stage_reference']});
  missing.preset=ready.preset;
  assert.equal((await verifyContestStageCapability(missing)).state,'ready');
  await verifyContestStageCapability(ready);
  assert.equal(latestAvailableContestStage([pending,ready]),ready);
});
test('已有定义或规则变化是真实错误，不能降成待补或沿用旧缓存',async()=>{
  const stage=complete();await verifyContestStageCapability(stage);
  stage.preset.criteria.vocal+=0.01;
  assert.equal((await verifyContestStageCapability(stage)).state,'invalid');
  const rules=complete();rules.setting.handLimit=99;
  assert.deepEqual(await verifyContestStageCapability(rules),{state:'invalid',reasons:[],code:'unsupported_stage_rules'});
});

test('轻量索引必须逐项匹配正式registry和map，过期或漏项不能通过',async()=>{
  const {Stages}=await import('../domain/upstream-contest-engine.mjs');
  const {contestEngineMap}=await import('../domain/contest-engine-map.mjs');
  const {contestStageIndex}=await import('../domain/contest-stage-index.mjs');
  const {contestStageIndexMatches,verifyEngineStageCapability}=await import('../domain/contest-stage-engine-capability.mjs');
  assert.equal(contestStageIndexMatches(Stages.getAll(),contestEngineMap,contestStageIndex),true);
  const changed=structuredClone(contestStageIndex),key=Object.keys(changed.stages)[0];changed.stages[key].turn+=1;
  assert.equal(contestStageIndexMatches(Stages.getAll(),contestEngineMap,changed),false);
  delete changed.stages[key];
  assert.equal(contestStageIndexMatches(Stages.getAll(),contestEngineMap,changed),false);
  assert.equal((await verifyEngineStageCapability(complete())).state,'ready');
});
test('界面和请求的静态依赖不提前加载引擎bundle，纯投影不依赖能力索引',()=>{
  const graph=entry=>{
    const seen=new Set();
    const visit=url=>{
      if(seen.has(url.href))return;seen.add(url.href);
      const source=fs.readFileSync(url,'utf8');
      for(const match of source.matchAll(/(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"](\.[^'"]+\.mjs)['"]/g))visit(new URL(match[1],url));
    };
    visit(new URL(entry,import.meta.url));return [...seen];
  };
  for(const entry of ['../ui/season-simulation.mjs','../domain/contest-engine-request.mjs','../domain/contest-stage-capability.mjs'])assert.equal(graph(entry).some(path=>path.endsWith('/upstream-contest-engine.mjs')),false,entry);
  assert.deepEqual(graph('../domain/contest-stage-preset.mjs').map(path=>path.split('/').at(-1)),['contest-stage-preset.mjs']);
});
