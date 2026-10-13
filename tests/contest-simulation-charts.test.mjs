import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreDistribution,scoreQuantile,cumulativeTurnSkips} from '../ui/contest-simulation-charts.mjs';

test('分布完整包含最高分、重复分与单局结果，分位数使用线性插值',()=>{
  for(const scores of [[0],[42,42,42],[0,1,2,3,100]]){const bins=scoreDistribution(scores);assert.equal(bins.reduce((sum,bin)=>sum+bin.count,0),scores.length);assert.ok(bins.at(-1).count>0);assert.ok(bins.every(bin=>Number.isFinite(bin.from)&&Number.isFinite(bin.to)));}
  assert.equal(scoreQuantile([10,20,30,40],.25),17.5);assert.equal(scoreQuantile([10],.75),10);
});

test('跳过次数按全部回合累计，保留零起点和没有跳过的回合',()=>{
  assert.deepEqual(cumulativeTurnSkips([{skips:2},{skips:0},{skips:3}]),[{turn:0,skips:0},{turn:1,skips:2},{turn:2,skips:2},{turn:3,skips:5}]);
  assert.deepEqual(cumulativeTurnSkips([{skips:0}]),[{turn:0,skips:0},{turn:1,skips:0}]);
});
