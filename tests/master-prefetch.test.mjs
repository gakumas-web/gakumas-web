import {contentManager} from '../application/content-manager.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('提前请求与正式载入共用一次请求，交付后释放预取引用',async()=>{
  const original=contentManager.take;let count=0,finish;
  contentManager.take=async scope=>{count++;assert.equal(scope,'catalog');return new Promise(resolve=>{finish=resolve;});};
  try{
    const {prefetchMaster,takeMaster}=await import('../application/master-prefetch.mjs?shared');
    const early=prefetchMaster(),first=takeMaster('catalog'),second=takeMaster('catalog');await Promise.resolve();assert.equal(count,1);
    const input={characters:{hski:'咲季'}};finish(input);assert.equal(await early,input);assert.equal(await first,input);assert.equal(await second,input);
    contentManager.take=async()=>{count++;return input;};assert.equal(await takeMaster('catalog'),input);assert.equal(count,2);
  }finally{contentManager.take=original;}
});

test('预取失败不留下失败缓存，正式载入可重新请求',async()=>{
  const original=contentManager.take;let count=0;
  contentManager.take=async()=>{count++;if(count===1)throw new Error('master_unavailable');return {ready:true};};
  try{
    const {prefetchMaster,takeMaster}=await import('../application/master-prefetch.mjs?retry');
    await assert.rejects(prefetchMaster(),/master_unavailable/);assert.deepEqual(await takeMaster('catalog'),{ready:true});assert.equal(count,2);
  }finally{contentManager.take=original;}
});


test('基础目录与效果目录分别复用请求，不混用响应',async()=>{
  const original=contentManager.take,urls=[];
  contentManager.take=async scope=>{urls.push(scope);return {url:scope};};
  try{
    const {prefetchMaster,takeMaster}=await import('../application/master-prefetch.mjs?scopes');
    prefetchMaster();prefetchMaster('effects');
    assert.deepEqual(await takeMaster('catalog'),{url:'catalog'});
    assert.deepEqual(await takeMaster('effects'),{url:'effects'});
    assert.deepEqual(urls,['catalog','effects']);
  }finally{contentManager.take=original;}
});
