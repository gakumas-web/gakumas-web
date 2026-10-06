import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateContentManifest,validateContentAssets,validateContentPart} from '../domain/content-contract.mjs';
const delivery=JSON.parse(readFileSync(new URL('./contracts/image-delivery-v1.json',import.meta.url)));
test('图片交付格式1：基础包和增量必须覆盖所有当前图片',()=>{
  for(const index of Object.values(delivery.versions))assert.doesNotThrow(()=>validateContentAssets(index));
  const missing=structuredClone(delivery.versions.two);missing.cdn_objects=[];assert.throws(()=>validateContentAssets(missing));
  const bad=structuredClone(delivery.versions.one);bad.baseline.packages[0].bytes=true;assert.throws(()=>validateContentAssets(bad));
  bad.baseline.packages[0].bytes=100;bad.cdn_base_url='https://example.invalid/?token=bad';assert.throws(()=>validateContentAssets(bad));
});

const contentV1=JSON.parse(readFileSync(new URL('./contracts/content-v1.json',import.meta.url)));
for(const row of contentV1.cases)test('内容格式 1：'+row.name,()=>{
  const validate=()=>validateContentManifest(row.value,'0.5.0');
  if(row.valid)assert.doesNotThrow(validate);else assert.throws(validate);
});
test('格式 1 显式交接的完整分包在浏览器合同中通过，并拒绝错误的独立身份',async()=>{
  for(const [name,text] of Object.entries(contentV1.files))await validateContentPart(name,new TextEncoder().encode(text),contentV1.manifest);
  const altered=structuredClone(contentV1.manifest);altered.files['catalog.json'].revision='f'.repeat(64);
  await assert.rejects(validateContentPart('catalog.json',new TextEncoder().encode(contentV1.files['catalog.json']),altered),/content_version_mismatch/);
});

test('旧编号不能包裹当前结构继续使用',()=>{
  for(const schema_version of [2,3,true]){
    assert.throws(()=>validateContentManifest({...contentV1.manifest,schema_version},'0.5.0'));
    assert.throws(()=>validateContentAssets({...delivery.versions.one,schema_version}));
  }
});
