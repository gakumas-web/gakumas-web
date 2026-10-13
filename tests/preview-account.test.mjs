import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareAccountDirectory,combineAccountDirectory} from '../domain/account-import.mjs';
import {PREVIEW_ACCOUNT,accountProfile} from '../domain/account.mjs';
import {previewLibrary,installPreviewAccount} from '../application/preview-account.mjs';
const text=fs.readFileSync(new URL('../resources/preview-account.json',import.meta.url),'utf8'),data=JSON.parse(text);

test('内置预览通过全部快照与详情关联合同，直接标识及照片引用已替换',async()=>{
  assert.equal(data.accountId,PREVIEW_ACCOUNT);const next=combineAccountDirectory(await prepareAccountDirectory(data.documents));assert.ok(next.snapshot.memories.length>0);assert.ok(Number.isSafeInteger(next.snapshot.producerExp)&&next.snapshot.producerExp>=0);assert.equal(next.selectionSnapshot.details.length,next.selectionSnapshot.count);
  function inspect(value){
    if(Array.isArray(value)){value.forEach(inspect);return;}if(!value||typeof value!=='object')return;
    for(const [key,entry] of Object.entries(value)){
      assert.ok(!['token','cookie','authorization','imagePath','produceHighScoreId','nickname','userName'].includes(key));
      if(key==='publicUserId')assert.equal(entry,PREVIEW_ACCOUNT);
      if(key==='userMemoryId'&&entry)assert.match(entry,/^preview-memory-\d{5}$/);
      if(key==='userSelectionMemoryId'&&entry)assert.match(entry,/^preview-selection-\d{5}$/);
      if(key==='researchId'&&entry)assert.match(entry,/^preview-researchId-\d{5}$/);
      if(key==='assetId')assert.equal(entry,'');
      if(key==='captured_at')assert.equal(entry,'2025-02-01T00:00:00.000Z');inspect(entry);
    }
  }inspect(data);assert.equal(/simulation-realistic|demo-memory|demo-selection/.test(text),false);
});
test('预览标签覆盖多标签、未标记和空标签，关联均在预览库存内',async()=>{
  const next=combineAccountDirectory(await prepareAccountDirectory(data.documents)),profile=accountProfile(PREVIEW_ACCOUNT),library=previewLibrary(profile,next.snapshot,next.selectionSnapshot);
  assert.equal(library.profile,profile);assert.equal(library.tags.length,7);assert.ok(Object.values(library.memories).some(tags=>tags.length>1));assert.ok(library.tags.includes('未使用标签'));
  for(const kind of ['memories','selectionMemories']){const rows=kind==='memories'?next.snapshot.memories:next.selectionSnapshot.selectionMemories,keys=new Set(rows.map(row=>row.key));assert.ok(Object.keys(library[kind]).every(key=>keys.has(key)));assert.ok(rows.some(row=>!library[kind][row.key]));assert.ok(!Object.values(library[kind]).flat().includes('未使用标签'));}
});

test('默认关闭时不能通过安装入口读取预览数据',async()=>{await assert.rejects(installPreviewAccount(),/未启用预览账号/);});

test('生成预览始终使用公开表最新满级经验，旧来源缺经验也不会再次漏字段',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'preview-level-'));
 try{
  const source=path.join(temporary,'source'),publicDir=path.join(temporary,'public'),output=path.join(temporary,'preview.json');fs.mkdirSync(source);fs.mkdirSync(publicDir);
  data.documents.forEach((document,index)=>{const value=JSON.parse(JSON.stringify(document).replaceAll('synthetic-preview-account','synthetic-source-account').replaceAll('preview-','fixture-source-'));delete value.producerExp;const folder=path.join(source,String(index));fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'snapshot.json'),JSON.stringify(value));});
  const levels=[{level:1,totalExp:0},{level:2,totalExp:40}];
  for(const totalExp of [40,100]){
   if(totalExp===100)levels.push({level:3,totalExp:100});fs.writeFileSync(path.join(publicDir,'progression.json'),JSON.stringify({progression:{tables:{ProducerLevel:levels}}}));
   const result=spawnSync(process.execPath,['tools/build_preview_account.mjs','--source',source,'--public',publicDir,'--output',output],{cwd:new URL('..',import.meta.url),encoding:'utf8'});assert.equal(result.status,0,result.stderr);
   const generated=JSON.parse(fs.readFileSync(output,'utf8'));assert.equal(generated.documents.find(row=>row.source==='user_get').producerExp,totalExp);
  }
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
