import test from 'node:test';
import assert from 'node:assert/strict';
import {simulationWorkerCount} from '../application/contest-compute-preferences.mjs';

test('多核关闭为单任务，开启按逻辑核心数折半且至少一个任务',()=>{
  for(const [cores,expected] of [[1,1],[2,1],[3,1],[4,2],[7,3],[8,4],[64,32]]){
    assert.equal(simulationWorkerCount(false,cores),1);
    assert.equal(simulationWorkerCount(true,cores),expected);
  }
});
