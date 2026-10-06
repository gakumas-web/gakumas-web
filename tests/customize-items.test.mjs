import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installMaster,customizeItemInfo} from '../domain/catalog.mjs';
const semantics=JSON.parse(readFileSync(new URL('./fixtures/public-data/semantics.json',import.meta.url)));
const imageCatalog=JSON.parse(readFileSync(new URL('./fixtures/public-data/customize-item-images.json',import.meta.url)));
const tables={ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]};
test('公开目录内附魔组合精确匹配，名称原文、次数限制、素材与父关系来自固定目录',()=>{
  installMaster({tables,semantics,customizeItemImages:imageCatalog.items});
  const definitions=new Map(semantics.tables.ProduceCustomizeItem.map(row=>[row.id,row]));
  const ids=new Set(Object.keys(imageCatalog.items));
  assert.ok(ids.size>0);
  for(const id of ids){
    const info=customizeItemInfo(id),raw=definitions.get(id);
    assert.equal(info.resolved,true);assert.ok(info.image);assert.ok(imageCatalog.images[info.image].startsWith('https://img.game8.jp/'));assert.equal(info.name,raw.name);assert.ok(info.text.length>0);
    assert.deepEqual(info.descriptionParts,raw.produceDescriptions);
    assert.equal(info.triggerLimit,raw.produceEffectTriggerCount);assert.equal(info.examLimit,raw.examEffectCount);
    assert.deepEqual(info.images,[1,2,3,4,5].map(i=>raw['assetId'+i]).filter(Boolean).map(a=>a+'.webp'));
    assert.deepEqual(info.parents.map(p=>p.id),semantics.tables.ProduceCustomizeItemRelationship.filter(r=>r.childProduceCustomizeItemId===id).map(r=>r.parentProduceCustomizeItemId));
  }
});
test('未知组合不拆分或回退父项冒充完整说明，缺少目录时保持未解析',()=>{
  const known=semantics.tables.ProduceCustomizeItem[0].id;
  assert.equal(customizeItemInfo(known+'_unknown').resolved,false);
  installMaster({tables});assert.equal(customizeItemInfo(known).resolved,false);
});
