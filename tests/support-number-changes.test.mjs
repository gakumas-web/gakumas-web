import test from 'node:test';
import assert from 'node:assert/strict';
import {descriptionNumberChanges} from '../domain/semantic-text.mjs';

const plain=text=>({produceDescriptionType:'ProduceDescriptionType_PlainText',text});
const diff=text=>({produceDescriptionType:'ProduceDescriptionType_DiffText',text});
test('只给源DiffText数字计算增减，保留条件里的普通数字位置',()=>{
  const before=[plain('カード3枚以上、初期ダンス上昇+'),diff('26')];
  const after=[plain('カード3枚以上、初期ダンス上昇+'),diff('29')];
  assert.deepEqual(descriptionNumberChanges(before,after),[{index:1,delta:3,unit:''}]);
  assert.deepEqual(descriptionNumberChanges(after,before),[{index:1,delta:-3,unit:''}]);
  assert.deepEqual(descriptionNumberChanges(before,before),[]);
});
test('百分比小数和次数逐项对齐，不产生浮点尾数或串位',()=>{
  assert.deepEqual(descriptionNumberChanges(
    [plain('確率+'),diff('0.1%'),plain('（'),diff('2'),plain('回）')],
    [plain('確率+'),diff('0.3%'),plain('（'),diff('3'),plain('回）')]
  ),[{index:0,delta:0.2,unit:'%'},{index:1,delta:1,unit:''}]);
});
test('分段之前的负号属于显示数值，不能反转差值方向',()=>{
  assert.deepEqual(descriptionNumberChanges([plain('消費-'),diff('10')],[plain('消費-'),diff('20')]),[{index:0,delta:-10,unit:''}]);
});
test('新增、条件或名称改写不猜测数值对应关系',()=>{
  assert.deepEqual(descriptionNumberChanges([],[plain('回復'),diff('5')]),[]);
  assert.deepEqual(descriptionNumberChanges([plain('カード1を獲得'),diff('5')],[plain('カード2を獲得'),diff('8')]),[]);
  assert.deepEqual(descriptionNumberChanges([plain('体力回復'),diff('5')],[plain('最大体力上昇'),diff('8')]),[]);
});
