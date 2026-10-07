import test from 'node:test';
import assert from 'node:assert/strict';
import {createChoiceAvailability} from '../domain/choice-availability.mjs';
const rows=[['a1','a1','b1'],['a2','b1'],['a2','b2'],[]];
const grouped=keys=>Object.values(keys.reduce((groups,key)=>{(groups[key[0]]??=[]).push(key);return groups;},{}));
for(const mode of ['any','all','grouped'])test(`${mode} 联动与直接条件匹配一致，重复记录不重复计数`,()=>{
  const evaluate=createChoiceAvailability(rows,{mode,clauses:grouped}),keys=['a1','a2','b1','b2','a3'];
  const clauses=values=>mode==='any'?(values.length?[values]:[]):mode==='all'?values.map(value=>[value]):grouped(values);
  const count=values=>rows.filter(row=>clauses(values).every(group=>group.some(key=>row.includes(key)))).length;
  for(let mask=0;mask<1<<keys.length;mask++){
    const selected=keys.filter((_,index)=>mask>>index&1),result=evaluate(selected);assert.equal(result.count,count(selected));
    for(const key of keys){
      const other=selected.filter(value=>mode==='any'?false:mode==='all'?value!==key:value[0]!==key[0]);
      assert.equal(result.available.has(key),count([...other,key])>0,`${selected}: ${key}`);
    }
  }
});
test('空的外部结果不会虚构可选项',()=>{
  const evaluate=createChoiceAvailability([],{mode:'all'});assert.equal(evaluate([]).count,0);assert.equal(evaluate(['x']).available.size,0);
});
