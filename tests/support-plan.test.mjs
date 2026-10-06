import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installMaster} from '../domain/catalog.mjs';
import {supportEntries} from '../domain/catalog-selectors.mjs';
import {setLocale} from '../i18n.mjs';
const supports=JSON.parse(readFileSync(new URL('./fixtures/public-data/supports.json',import.meta.url)));
installMaster({tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},supports,characters:{nasr:'根緒亜紗里'}});
test('通用计划按Common分类，老师由角色条件匹配，稀有度仍独立生效',()=>{
  const common=supportEntries({supportCards:[]},'','original',{ownership:'all',supportPlan:'Common'});
  assert.equal(common.length,74);
  const teachers=supportEntries({supportCards:[]},'','original',{ownership:'all',supportPlan:'Common',supportCharacter:['nasr']});
  assert.deepEqual(teachers.map(r=>r.held.supportCardId),['s_card-2-0014','s_card-3-0019','s_card-3-0020','s_card-3-0099']);
  assert.equal(supportEntries({supportCards:[]},'','original',{ownership:'all',supportPlan:'Common',supportCharacter:['nasr'],supportRarity:'SSR'}).length,3);
});

test('アシスト按支援类型匹配，独立于老师角色和通用计划，切换语言不改变结果',()=>{
  for(const language of ['zh-CN','ja']){
    setLocale(language);
    const filters={ownership:'all',supportType:'Assist'};
    const assist=supportEntries({supportCards:[]},'','original',filters);
    assert.deepEqual(assist.map(r=>r.held.supportCardId),['s_card-2-0014','s_card-3-0019','s_card-3-0020','s_card-3-0100']);
    assert.equal(supportEntries({supportCards:[]},'','original',{...filters,supportCharacter:['nasr']}).length,3);
    assert.equal(supportEntries({supportCards:[]},'','original',{...filters,supportRarity:'SSR'}).length,3);
    assert.equal(supportEntries({supportCards:[]},'','original',{...filters,supportPlan:'Common'}).length,4);
  }
  setLocale('zh-CN');
});

test('可编入计划包含对应计划和通用卡，辅助卡不被排除，也不混入其它限定计划',()=>{
  const common=supportEntries({supportCards:[]},'','original',{ownership:'all',supportPlan:'Common'}).map(row=>row.held.supportCardId);
  for(const plan of ['Plan1','Plan2','Plan3']){
    const entries=supportEntries({supportCards:[]},'','original',{ownership:'all',supportPlan:plan});
    const ids=new Set(entries.map(row=>row.held.supportCardId));
    assert.ok(common.every(id=>ids.has(id)));
    assert.ok(entries.every(row=>row.info.plan===plan||row.info.plan==='Common'));
    const assist=supportEntries({supportCards:[]},'','original',{ownership:'all',supportPlan:plan,supportType:'Assist'});
    assert.deepEqual(assist.map(row=>row.held.supportCardId),['s_card-2-0014','s_card-3-0019','s_card-3-0020','s_card-3-0100']);
  }
});

test('通用卡开关默认开启，关闭后仅保留指定计划，未指定计划仍不限制',()=>{
  for(const supportPlan of ['Plan1','Plan2','Plan3']){
    const specific=supportEntries({supportCards:[]},'','original',{ownership:'all',supportPlan,supportPlanCommon:false});
    assert.ok(specific.length>0);assert.ok(specific.every(row=>row.info.plan===supportPlan));
    assert.equal(supportEntries({supportCards:[]},'','original',{ownership:'all',supportPlan,supportPlanCommon:false,supportType:'Assist'}).length,0);
  }
  assert.equal(supportEntries({supportCards:[]},'','original',{ownership:'all',supportPlanCommon:false}).length,supports.cards.length);
});
