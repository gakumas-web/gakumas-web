import test from 'node:test';
import assert from 'node:assert/strict';
import zh from '../locales/zh-CN.mjs';
import ja from '../locales/ja.mjs';
import {t,setLocale,localizeSource} from '../i18n.mjs';
import {effectSourceText} from '../domain/effect-language.mjs';

test('中日两种界面词典键及占位符一致，插值不再次解释用户文字',()=>{
  const slots=value=>[...value.matchAll(/\{\d+\}/g)].map(x=>x[0]).sort();
  for(const dictionary of [zh,ja]){
    assert.deepEqual(Object.keys(dictionary),Object.keys(zh));
    for(const key of Object.keys(zh))assert.deepEqual(slots(dictionary[key]),slots(key),key);
  }
  setLocale('ja');assert.equal(t('回忆 {0}',['{1}<script>']), 'メモリー {1}<script>');
  assert.equal(t('missing-key'),'missing-key');
  assert.equal(localizeSource('支援技能 · 2'),'サポートスキル · 2');
  assert.equal(localizeSource('自定义 ×2 · test'),'カスタム ×2 · test');
  setLocale('zh-CN');
});
test('中日界面均保留效果原文',()=>{
  const source='プロデュース開始時、体力回復4';
  setLocale('ja');assert.equal(effectSourceText(source),source);
  setLocale('zh-CN');assert.equal(effectSourceText(source),source);
  assert.equal(effectSourceText('+2.1%'),'+2.1%');
  assert.throws(()=>setLocale('en'),/Unsupported locale/);
});

test('中文领域说明采用润色后的词典值，保留源键与参数',()=>{
  setLocale('zh-CN');
  assert.equal(localizeSource('自定义 ×2 · +1'),'附魔 ×2 · +1');
  assert.equal(localizeSource('初期 Vo'),'初始 Vo');
  assert.equal(t('等级上限阶级 {0} · 潜能阶级 {1}',[3,2]),'特训阶段 3 · 才能开花等级 2');
  assert.equal(t('标签：{0}{1}',['自定义 {0}','']),'标签：自定义 {0}');
});

test('库存数量零与已拥有状态不混用措辞',()=>{
  for(const [locale,expected] of [['zh-CN','库存数量 0'],['ja','在庫数 0']]){
    setLocale(locale);
    assert.ok(t('等级 {0} · 等级上限阶级 {1} · 库存数量 {2}',[55,3,0]).includes(expected));
  }
  setLocale('zh-CN');
});

test('回忆计划枚举2至4与目录Plan1至Plan3使用相同译名',async()=>{
  const {planLabel}=await import('../domain/catalog.mjs');setLocale('zh-CN');
  assert.deepEqual([2,3,4].map(planLabel),['感性','理性','非凡']);
  assert.deepEqual(['Plan1','Plan2','Plan3'].map(planLabel),['感性','理性','非凡']);
});


test('只接受中日语言偏好，未知值使用默认语言且不执行迁移',async()=>{
  const previous=globalThis.localStorage;let saved='unsupported';
  globalThis.localStorage={getItem:()=>saved,setItem:(_key,value)=>{saved=value;}};
  try{
    const fresh=await import('../i18n.mjs?language-default');
    assert.equal(fresh.locale(),'zh-CN');assert.equal(saved,'unsupported');
    assert.deepEqual(Object.keys(fresh.languages),['zh-CN','ja']);
  }finally{globalThis.localStorage=previous;}
});
