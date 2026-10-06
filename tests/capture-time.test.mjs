import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCapturedAt,validCapturedAt} from '../domain/model.mjs';
test('采集时间保留纳秒精度，统一时区和不同小数位数',()=>{
  assert.equal(compareCapturedAt('2026-10-03T12:00:00.000000001Z','2026-10-03T12:00:00.000000002Z'),-1);
  assert.equal(compareCapturedAt('2026-10-03T20:00:00.123400+08:00','2026-10-03T12:00:00.1234Z'),0);
  assert.equal(compareCapturedAt('2026-10-03T12:00:00Z','2026-10-03T11:59:59.999999999Z'),1);
  for(const value of ['2026-10-03','invalid','2026-10-03T12:00:00.1234567890Z'])assert.equal(validCapturedAt(value),false);
});
