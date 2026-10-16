import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createContestComputeGate} from '../application/contest-compute-gate.mjs';

test('页面计算许可按 FIFO 交接，重复释放旧许可不影响新持有者',async()=>{
  const gate=createContestComputeGate(),first=gate.acquire(),second=gate.acquire(),third=gate.acquire(),order=[];
  second.ready.then(()=>order.push('second'));third.ready.then(()=>order.push('third'));
  assert.equal(first.granted,true);assert.equal(gate.pending,2);assert.equal(second.waiting,true);
  first.release();await second.ready;assert.deepEqual(order,['second']);assert.equal(second.granted,true);
  first.release();first.cancel();assert.equal(gate.busy,true);assert.equal(third.waiting,true);
  second.release();await third.ready;assert.deepEqual(order,['second','third']);
  third.release();assert.equal(gate.busy,false);assert.equal(gate.pending,0);
});

test('取消队列中间的任务只移除自身，等待者不能释放正在运行的许可',async()=>{
  const gate=createContestComputeGate(),first=gate.acquire(),cancelled=gate.acquire(),last=gate.acquire();
  const rejection=assert.rejects(cancelled.ready,{name:'AbortError'});
  cancelled.release();assert.equal(gate.pending,2);assert.equal(first.granted,true);
  cancelled.cancel();cancelled.cancel();await rejection;
  assert.equal(gate.pending,1);assert.equal(first.granted,true);assert.equal(last.waiting,true);
  first.release();await last.ready;last.cancel();assert.equal(gate.busy,false);
});
