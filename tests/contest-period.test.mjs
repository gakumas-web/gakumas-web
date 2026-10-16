import test from 'node:test';
import assert from 'node:assert/strict';
import {createContestCatalog,contestSeasonGroups} from '../domain/contest-simulation.mjs';
import {contestGroupPeriod,contestGroupDateRange,contestGroupUpcoming} from '../domain/contest-period.mjs';

const group=(season={},preset={})=>({kind:'contest',stages:[{season,preset}]});

test('赛期取实际毫秒时间并按日本日期显示，不依赖浏览器所在时区',()=>{
  const season={id:'season-71',startTime:String(Date.parse('2026-09-30T15:00:00Z')),endTime:String(Date.parse('2026-10-15T14:59:59Z')),stages:[{}]};
  const [entry]=contestSeasonGroups(createContestCatalog({PvpRateConfig:[season]}).choices);
  assert.equal(contestGroupDateRange(entry),'261001-261015');
  assert.deepEqual(contestGroupPeriod(entry),{startTime:Number(season.startTime),endTime:Number(season.endTime)});
});

test('缺少完整赛期不推算日期，也不把空值当成1970年时间',()=>{
  for(const season of [{},{startTime:'',endTime:''},{startTime:null,endTime:null},{startTime:'invalid',endTime:'invalid'},{startTime:'1790780400000'}])assert.equal(contestGroupDateRange(group(season)),'');
  assert.deepEqual(contestGroupPeriod(group()),{startTime:null,endTime:null});
});

test('无效日期和换算日本时区后越界的毫秒值按未收录处理，不抛出日期异常',()=>{
  for(const value of [1e20,8640000000000001,8640000000000000,Infinity,NaN,-8640000000000001,'100000000000000000000']){
    assert.deepEqual(contestGroupPeriod(group({startTime:value,endTime:value})),{startTime:null,endTime:null});
    assert.equal(contestGroupDateRange(group({startTime:value,endTime:value})), '');
    assert.equal(contestGroupUpcoming(group({startTime:value},{preview:true})),true);
  }
});

test('历史日历日期保留原精度并优先显示，不据此虚构开赛时刻',()=>{
  const entry=group({startDate:'2024-02-29',endDate:'2024-03-15'});
  assert.equal(contestGroupDateRange(entry),'240229-240315');
  assert.deepEqual(contestGroupPeriod(entry),{startTime:null,endTime:null});
  assert.equal(contestGroupUpcoming(entry,0),false);
  const withTime=group({...entry.stages[0].season,startTime:Date.parse('2026-10-01T02:00:00Z'),endTime:Date.parse('2026-10-15T11:59:59Z')});
  assert.equal(contestGroupDateRange(withTime),'240229-240315');
  assert.equal(contestGroupUpcoming(withTime,0),true);
  assert.equal(contestGroupUpcoming(group(entry.stages[0].season,{preview:true}),0),true);
});

test('非法或不完整日历日期不显示，并可回退到已知的精确赛期',()=>{
  for(const value of ['2026-02-29','2026-02-30','2026-13-01','2026-00-01','2026-10-00','2026-1-01',' 2026-10-01','2026-10-01T00:00:00Z',null,20261001]){
    assert.equal(contestGroupDateRange(group({startDate:value,endDate:'2026-10-15'})),'');
    assert.equal(contestGroupDateRange(group({startDate:'2026-10-01',endDate:value})),'');
  }
  assert.equal(contestGroupDateRange(group({startDate:'2026-10-01'})),'');
  const entry=group({startDate:'2026-02-30',endDate:'2026-10-15',startTime:Date.parse('2026-09-30T15:00:00Z'),endTime:Date.parse('2026-10-15T14:59:59Z')});
  assert.equal(contestGroupDateRange(entry),'261001-261015');
});

test('筹备状态按真实开赛时刻切换，资料预告标记只用于缺少开赛时间时',()=>{
  const startsAt=Date.parse('2026-10-16T02:00:00Z'),entry=group({startTime:String(startsAt)},{preview:true});
  assert.equal(contestGroupUpcoming(entry,startsAt-1),true);
  assert.equal(contestGroupUpcoming(entry,startsAt),false);
  assert.equal(contestGroupUpcoming(entry,startsAt+1),false);
  assert.equal(contestGroupUpcoming(group({},{preview:true}),startsAt),true);
  assert.equal(contestGroupUpcoming(group({},{preview:false}),startsAt),false);
  assert.equal(contestGroupUpcoming(group(),startsAt),false);
});

test('预告状态汇总整个赛季并支持活动舞台，日期优先使用赛季资料',()=>{
  const startTime=Date.parse('2026-10-01T02:00:00Z'),endTime=Date.parse('2026-10-15T11:59:59Z');
  const entry=group({startTime,endTime},{startTime:0,endTime:1});
  assert.equal(contestGroupDateRange(entry),'261001-261015');
  const preview={kind:'event',stages:[{preset:{preview:false}},{preset:{preview:true}}]};
  assert.equal(contestGroupUpcoming(preview),true);
});
