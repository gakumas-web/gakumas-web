import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOptimizationBudget,validateOptimizationBudget,OPTIMIZATION_RUN_LIMIT} from '../domain/contest-optimization-budget.mjs';
import {OPTIMIZATION_BUDGETS,startContestOptimization} from '../application/contest-optimization-client.mjs';

test('预设保留当前搜索参数，计算上界包含父编组、复筛及最终回放',()=>{
  const standard=validateOptimizationBudget(OPTIMIZATION_BUDGETS.standard),deep=validateOptimizationBudget(OPTIMIZATION_BUDGETS.deep);
  assert.equal(standard.estimate.total,77324);assert.equal(deep.estimate.total,212508);
  assert.equal(standard.estimate.final,10000);assert.equal(standard.estimate.details,60);
  assert.ok(deep.estimate.total<=OPTIMIZATION_RUN_LIMIT);
});

test('单项合法仍须通过组合预算校验，拒绝超额与不安全整数',()=>{
  const base=OPTIMIZATION_BUDGETS.standard;
  assert.equal(inspectOptimizationBudget({...base,population:256,generations:128,samples:100}).error.code,'optimization_budget_excessive');
  for(const value of [NaN,Infinity,0,1.5,257])assert.equal(inspectOptimizationBudget({...base,population:value}).error.field,'population');
  assert.equal(inspectOptimizationBudget({...base,totalRunLimit:OPTIMIZATION_RUN_LIMIT+1}).error.field,'totalRunLimit');
});

test('较低总上限先预留必要阶段，原预算对象不被修改',()=>{
  const base={...OPTIMIZATION_BUDGETS.standard};delete base.totalRunLimit;delete base.screenRuns;
  const checked=validateOptimizationBudget(base),minimum=checked.estimate.minimum;
  assert.equal(checked.budget.screenRuns,undefined);assert.equal(base.totalRunLimit,undefined);
  assert.equal(inspectOptimizationBudget({...base,totalRunLimit:minimum-1}).error.code,'optimization_budget_reserve');
  assert.equal(validateOptimizationBudget({...base,totalRunLimit:minimum}).budget.totalRunLimit,minimum);
  assert.equal(inspectOptimizationBudget({...base,finalCandidates:33}).error.code,'optimization_budget_final');
});

test('控制器在创建 Worker 前拒绝无法完成必要复评的预算',async()=>{
  const handle=startContestOptimization({input:{probes:[]}},{seed:1,budget:{...OPTIMIZATION_BUDGETS.standard,totalRunLimit:1}});
  await assert.rejects(handle.promise,{code:'optimization_budget_reserve'});
});
