import test from 'node:test';
import assert from 'node:assert/strict';
import {combineImagePlan} from '../domain/image-plan.mjs';
const row=(letter,bytes=10)=>({sha256:letter.repeat(64),bytes});
const base=row('a'),thumb=row('b'),next=row('c');
const plan={version:'base',files:{'images/img_art.webp':base,'images/img_art_thumb.webp':thumb},thumbnails:{'images/img_art.webp':'images/img_art_thumb.webp'},sourcePackages:[],packages:[{url:'./image-files/base.tar.gz',sha256:'d'.repeat(64),bytes:100,objects:{[base.sha256+'.webp']:base,[thumb.sha256+'.webp']:thumb}}]};
const index=(files,cdn=[])=>({format:'gakumas-assets-set',schema_version:1,version:'new',files,cdn_base_url:'https://cdn.example.invalid/',cdn_objects:cdn,baseline:{version:'source-base',packages:[{url:'https://release.example.invalid/base.tar.gz',sha256:'e'.repeat(64),bytes:90,objects:{[base.sha256+'.webp']:base}}]}});

test('索引升级继续复用基础图，新图片直连 CDN，不要求图片版本相同',()=>{
  const input=index({'images/img_art.webp':base,'images/img_new.webp':next},[next.sha256+'.webp']),before=structuredClone(input);
  const result=combineImagePlan(input,plan,'https://pages.example.invalid/site/');
  assert.deepEqual(input,before);assert.equal(result.index.baseline.packages[0].url,'https://pages.example.invalid/site/image-files/base.tar.gz');assert.deepEqual(result.index.cdn_objects,[next.sha256+'.webp']);assert.equal(result.thumbnails['images/img_art.webp'],'images/img_art_thumb.webp');
});
test('同名换图丢弃旧缩略图，使用新 CDN 对象；相同对象改名仍复用本地基础',()=>{
  const changed=combineImagePlan(index({'images/img_art.webp':next},[next.sha256+'.webp']),plan,'https://pages.example.invalid/');
  assert.deepEqual(changed.thumbnails,{});assert.equal(changed.index.files['images/img_art_thumb.webp'],undefined);assert.equal(changed.index.files['images/img_art.webp'].sha256,next.sha256);
  const renamed=combineImagePlan(index({'images/img_renamed.webp':base}),plan,'https://pages.example.invalid/');assert.deepEqual(renamed.index.cdn_objects,[]);
});
test('未镜像且不在 CDN 的新基础对象拒绝安装，不能退回浏览器请求 CNB',()=>{
  const input=index({'images/img_new.webp':next});input.baseline.packages[0].objects[next.sha256+'.webp']=next;
  assert.throws(()=>combineImagePlan(input,plan,'https://pages.example.invalid/'),/image_program_update_required/);
});
