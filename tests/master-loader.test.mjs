import {contentManager} from '../application/content-manager.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {cardInfo,characterInfo} from '../domain/catalog.mjs';

const input=scope=>({scope,revision:'same-version',characters:{hski:'花海咲季'},...(scope==='effects'?{tables:{ProduceCard:[{id:'test-card',upgradeCount:0,name:'测试技能',descriptions:[],definition:{}}]}}:{})});
test('分包并发只取一次；成就晚返回不清空技能目录，装扮只依赖基础目录',async()=>{
  const original=contentManager.take,calls=[];let release;
  contentManager.take=async scope=>{calls.push(scope);return scope==='achievements'?new Promise(resolve=>{release=()=>resolve(input(scope));}):input(scope);};
  try{
    const loader=await import('../application/master-loader.mjs?ordering');
    await loader.loadMaster('idolCardSkins');assert.deepEqual(calls,['catalog']);
    const achievements=loader.loadMaster('achievements');
    await Promise.all([loader.loadMaster('memories'),loader.loadMaster('memories')]);
    assert.equal(cardInfo({id:'test-card',upgradeCount:0,customizes:[]}).name,'测试技能');
    release();await achievements;
    assert.equal(cardInfo({id:'test-card',upgradeCount:0,customizes:[]}).name,'测试技能');assert.equal(characterInfo('hski').name,'花海咲季');
    assert.deepEqual(calls.sort(),['abilities','achievements','catalog','effects']);assert.ok(loader.masterReadyFor('achievements'));assert.ok(loader.masterReadyFor('memories'));assert.ok(!loader.masterReadyFor('supportCards'));
  }finally{contentManager.take=original;}
});
test('跨版本分包拒绝安装，已安装目录保持可用',async()=>{
  const original=contentManager.take;
  contentManager.take=async scope=>({...input(scope),revision:scope==='catalog'?'old-version':'new-version'});
  try{
    const loader=await import('../application/master-loader.mjs?version');await loader.loadMaster('catalog');
    await assert.rejects(loader.loadMaster('achievements'),/master_version_mismatch/);
    assert.ok(loader.masterReadyFor('catalog'));assert.ok(!loader.masterReadyFor('achievements'));assert.equal(characterInfo('hski').name,'花海咲季');
  }finally{contentManager.take=original;}
});
test('失败分包可重试，成功的其它分包无需再次请求',async()=>{
  const original=contentManager.take,calls=[];let fail=true;
  contentManager.take=async scope=>{calls.push(scope);if(scope==='achievements'&&fail)throw new Error('master_unavailable');return input(scope);};
  try{
    const loader=await import('../application/master-loader.mjs?retry');await loader.loadMaster('catalog');await assert.rejects(loader.loadMaster('achievements'));
    fail=false;await loader.loadMaster('achievements');assert.ok(loader.masterReadyFor('achievements'));assert.deepEqual(calls,['catalog','achievements','achievements']);
  }finally{contentManager.take=original;}
});
test('独立分包业务版本可不同，仍拒绝混用不同发布清单',async()=>{
  const original=contentManager.take;
  contentManager.take=async scope=>({...input(scope),revision:scope,releaseRevision:scope==='achievements'?'other-release':'same-release'});
  try{
    const loader=await import('../application/master-loader.mjs?independent');
    await loader.loadMaster('memories');assert.ok(loader.masterReadyFor('memories'));
    await assert.rejects(loader.loadMaster('achievements'),/master_version_mismatch/);
    assert.ok(!loader.masterReadyFor('achievements'));
  }finally{contentManager.take=original;}
});
