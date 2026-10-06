import test from 'node:test';
import assert from 'node:assert/strict';
import {startLoading,finishLoading,loadingMetrics,createViewTiming,publicContentDiagnostics} from '../application/loading-metrics.mjs';

test('任务起止时间成对记录，结算幂等且只保留公开字段',()=>{
  const run=startLoading('images',{view:'idolCards',version:'test',accountId:'excluded'});
  finishLoading(run,'ready',{total:4});const ended=run.endedAt;finishLoading(run,'error');
  assert.equal(run.endedAt,ended);assert.equal(run.outcome,'ready');assert.equal(run.durationMs,run.endedAt-run.startedAt);
  assert.equal('accountId' in run,false);assert.equal(run.total,4);
  const copy=loadingMetrics().runs.at(-1);copy.outcome='changed';assert.equal(run.outcome,'ready');
});

test('切到 B 后，A 的迟到完成只能结束 A，不能提前结束 B 的等待',()=>{
  const ready=new Set(),tracker=createViewTiming({ready:view=>ready.has(view),version:()=> 'test'});
  tracker.begin('A',1);tracker.begin('B',2);ready.add('A');tracker.complete();
  let runs=loadingMetrics().runs.filter(row=>row.name==='view');
  assert.equal(runs.at(-2).outcome,'superseded');assert.equal(runs.at(-1).view,'B');assert.equal(runs.at(-1).endedAt,undefined);
  ready.add('B');tracker.complete();runs=loadingMetrics().runs.filter(row=>row.name==='view');
  assert.equal(runs.at(-1).outcome,'ready');assert.ok(runs.at(-1).durationMs>=0);
  assert.equal(loadingMetrics().events.at(-1).view,'B');
});

test('同一视图失败后重试会开启新的计时，不复用失败完成时间',()=>{
  let available=false;const tracker=createViewTiming({ready:()=>available});
  tracker.begin('retry-view',9);tracker.fail('retry-view');tracker.begin('retry-view',9);available=true;tracker.complete();
  const runs=loadingMetrics().runs.filter(row=>row.view==='retry-view');assert.equal(runs.length,2);assert.equal(runs[0].outcome,'error');assert.equal(runs[1].outcome,'ready');
});

test('公开资料诊断白名单排除账号和原始异常，仅输出正文计数与受控错误码',()=>{
  const state={phase:'unavailable',version:null,availableVersion:null,cached:false,error:'content_hash_mismatch',bytes:123,totalBytes:456,
    accountId:'synthetic-private',url:'https://example.invalid/private',body:'不导出'};
  assert.deepEqual(publicContentDiagnostics(state),{phase:'unavailable',version:null,availableVersion:null,cached:false,error_code:'content_hash_mismatch',bytes:123,totalBytes:456});
  assert.equal(publicContentDiagnostics({...state,error:new Error('不导出的异常正文')}).error_code,'content_unavailable');
  assert.equal(publicContentDiagnostics({...state,error:null}).error_code,null);
});
