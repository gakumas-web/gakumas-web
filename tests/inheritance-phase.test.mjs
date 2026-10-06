import {inventory,captureHeader} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSnapshot} from '../domain/model.mjs';
import {restorePrepared} from '../application/history.mjs';
import {prepareSelectionDetail,restoreSelectionDetail} from '../domain/selection-details.mjs';

test('普通回忆保留继承阶段并拒绝缺失字段',async()=>{
  for(const phase of [0,1,2]){
    const memory={userMemoryId:'synthetic-phase',...(phase===undefined?{}:{produceCardPhaseType:phase})};
    const snapshot=await prepareSnapshot(inventory({memories:[memory]}));
    assert.equal(snapshot.memories[0].produceCardPhaseType,phase);
    assert.equal((await restorePrepared(snapshot)).memories[0].produceCardPhaseType,phase);
  }
});
test('带入回忆保留继承阶段，拒绝旧详情、缺字段及错误类型',async()=>{
  const memory={characterId:'hski',idolCardId:'synthetic-card',grade:0,power:0,planType:2,vocal:0,dance:0,visual:0,stamina:0,produceCard:null,abilities:[]};
  const raw={...captureHeader(),source:'selection_memory_get',captured_at:'2026-10-03T00:00:00Z',publicUserId:'synthetic-phase',userSelectionMemoryId:'synthetic-selection',memories:[{number:1,isRental:true,userMemoryId:'synthetic-memory',memory,memoryAbilities:[]}],supportCards:[]};
  for(const phase of [0,1,2]){
    if(phase===undefined)delete memory.produceCardPhaseType;else memory.produceCardPhaseType=phase;
    const prepared=await prepareSelectionDetail(raw);assert.equal(restoreSelectionDetail(prepared).memories[0].memory.produceCardPhaseType,phase);
  }
  delete memory.produceCardPhaseType;await assert.rejects(prepareSelectionDetail(raw));
  memory.produceCardPhaseType=1;await assert.rejects(prepareSelectionDetail({...raw,schema_version:2}));
  memory.produceCardPhaseType='1';await assert.rejects(prepareSelectionDetail(raw));
});
