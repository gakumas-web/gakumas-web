import test from 'node:test';
import assert from 'node:assert/strict';
import {appURL,assetURL,uiIconURL,imageLoading} from '../resources.mjs';
import {imageConfig} from '../image-config.mjs';

test('缓存图片和占位图立即加载',()=>{
  const original=imageConfig.mode;
  try{
    for(const [mode,expected] of [['managed','eager'],['none','eager']]){
      imageConfig.mode=mode;assert.equal(imageLoading(),expected);
    }
  }finally{imageConfig.mode=original;}
});

test('静态路径相对模块根目录，不允许逃逸或外部协议',()=>{
  const root=new URL('../',import.meta.url).href;
  assert.equal(appURL('data/master/catalog.json'),root+'data/master/catalog.json');
  for(const path of ['../private','/assets/file','https://example.invalid'])assert.throws(()=>appURL(path));
});
test('图片名不能携带账号查询串或自定义 URL',()=>{
  const fallback=appURL('ui-icons/unavailable.svg');
  for(const name of ['../secret','img_card.webp?account=synthetic','https://example.invalid/photo'])assert.equal(assetURL(name),fallback);
  assert.equal(assetURL('img_card.webp'),fallback);
  assert.equal(uiIconURL('rank-flower.webp'),fallback);
});

test('旧图片结构即使编号为1也不能安装',async()=>{
  const {installContentResources}=await import('../resources.mjs');
  assert.throws(()=>installContentResources({format:'gakumas-assets-set',schema_version:1,version:'old',packages:[]}),/content_assets_invalid/);
});
