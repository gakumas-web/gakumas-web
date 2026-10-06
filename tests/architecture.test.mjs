import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const paths=['app.mjs','i18n.mjs','resources.mjs','image-config.mjs','content-config.mjs',...['domain','application','ui','locales'].flatMap(dir=>readdirSync(resolve(root,dir)).filter(name=>name.endsWith('.mjs')).map(name=>`${dir}/${name}`))];
const modules=new Set(paths.map(name=>resolve(root,name)));
const graph=new Map(paths.map(name=>{
  const file=resolve(root,name),source=readFileSync(file,'utf8');
  return [file,[...source.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.{1,2}\/[^'"]+\.mjs)['"]/g)].map(match=>resolve(dirname(file),match[1]))];
}));
test('活动模块依赖闭合，不导入归档、旧聚合视图或测试',()=>{
  for(const [file,dependencies] of graph)for(const dependency of dependencies)assert.ok(modules.has(dependency),`${file} -> ${dependency}`);
});
test('领域模块不依赖界面或应用装配，模块图无循环',()=>{
  const visiting=new Set(),visited=new Set();
  function walk(file){
    assert.ok(!visiting.has(file),`循环依赖：${file}`);if(visited.has(file))return;
    visiting.add(file);
    for(const dependency of graph.get(file)){
      if(file.startsWith(resolve(root,'domain')+'/'))assert.ok(!dependency.startsWith(resolve(root,'ui')+'/')&&!dependency.startsWith(resolve(root,'application')+'/'));
      walk(dependency);
    }
    visiting.delete(file);visited.add(file);
  }
  for(const file of graph.keys())walk(file);
});
