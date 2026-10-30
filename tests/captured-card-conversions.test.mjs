import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSnapshot,prepareSnapshot} from '../domain/model.mjs';
import {restorePrepared} from '../application/history.mjs';
import {prepareAccountDirectory,combineAccountDirectory} from '../domain/account-import.mjs';
import {resolveCardConversionPreferences,cardConversionRules} from '../domain/card-conversions.mjs';
import {inventory} from './fixtures.mjs';

const pairs=[{beforeProduceCardId:'before-a',afterProduceCardId:'after-a',unlockProducerLevel:58},{beforeProduceCardId:'before-b',afterProduceCardId:'after-b',unlockProducerLevel:60}];
const captured=enabled=>[{beforeProduceCardId:'before-a',afterProduceCardId:'after-a',enable:enabled}];

test('采集转换状态区分未采集、空列表和明确 false，历史恢复保留原值',async()=>{
  const unknown=parseSnapshot(inventory());assert.equal(Object.hasOwn(unknown,'produceCardConversions'),false);
  for(const rows of [[],captured(false),captured(true)]){
    const input=inventory({produceCardConversions:rows}),before=structuredClone(input),prepared=await prepareSnapshot(input);
    assert.deepEqual(prepared.produceCardConversions,rows);
    assert.deepEqual((await restorePrepared(prepared)).produceCardConversions,rows);
    assert.deepEqual(input,before);
  }
});

test('转换记录拒绝不完整、非布尔、未知键和重复配对',()=>{
  for(const value of [null,{},[null],[{beforeProduceCardId:'a',afterProduceCardId:'b'}],
    [{beforeProduceCardId:'',afterProduceCardId:'b',enable:false}],
    [{beforeProduceCardId:'a',afterProduceCardId:'b',enable:0}],
    [{...captured(false)[0],extra:1}],[...captured(false),...captured(true)]]){
    assert.throws(()=>parseSnapshot(inventory({produceCardConversions:value})));
  }
});

test('新库存更新游戏基准，手动覆盖只作用于本账号指定配对',async()=>{
  const old=await prepareSnapshot(inventory({produceCardConversions:captured(false)}));
  const next=combineAccountDirectory(await prepareAccountDirectory([inventory({produceCardConversions:captured(true),captured_at:'2026-10-18T00:00:00Z'})]),{snapshot:old}).snapshot;
  const original=structuredClone(next),overrides={'before-a':'before'};
  assert.deepEqual(resolveCardConversionPreferences(pairs,old.produceCardConversions),{'before-a':'before','before-b':'before'});
  assert.deepEqual(resolveCardConversionPreferences(pairs,next.produceCardConversions),{'before-a':'after','before-b':'before'});
  assert.deepEqual(resolveCardConversionPreferences(pairs,next.produceCardConversions,overrides),{'before-a':'before','before-b':'before'});
  assert.deepEqual(resolveCardConversionPreferences(pairs,undefined),{});
  assert.deepEqual(resolveCardConversionPreferences(pairs,[]),{'before-a':'before','before-b':'before'});
  assert.deepEqual(resolveCardConversionPreferences(pairs,[{beforeProduceCardId:'before-a',afterProduceCardId:'other-after',enable:true}]),{'before-a':'before','before-b':'before'});
  const effective=resolveCardConversionPreferences(pairs,next.produceCardConversions);
  assert.deepEqual(cardConversionRules(pairs,90,effective),{excludedCardIds:['before-a','after-b']});
  assert.deepEqual(cardConversionRules(pairs,57,effective),{excludedCardIds:['after-a','after-b']});
  assert.deepEqual(next,original);assert.deepEqual(overrides,{'before-a':'before'});
});
