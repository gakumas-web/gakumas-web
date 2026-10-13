import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {contestSimulationBatches} from '../domain/contest-simulation-batches.mjs';
import {runContestSimulationBatch,finishContestSimulationBatches,createContestSimulationSession} from '../domain/contest-engine-runner.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/public-data/contest-engine.json',import.meta.url)));

test('三种计划分块保留完整统计和展示对局，完成顺序不改变结果',async()=>{
  for(const request of [...fixture.requests,fixture.customized]){
    const batches=[];
    for(const range of contestSimulationBatches(101))batches.push(await runContestSimulationBatch(request,{...range,seed:42}));
    const result=await finishContestSimulationBatches(request,batches,{seed:42});
    assert.deepEqual(await finishContestSimulationBatches(request,[...batches].reverse(),{seed:42}),result);
    const session=await createContestSimulationSession(request,{seed:42});await session.advance(101);
    assert.deepEqual(result,await session.finish());
    await assert.rejects(finishContestSimulationBatches(request,batches.slice(1),{seed:42}),{code:'invalid_options'});
  }
});
