import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const paths=['app.mjs','i18n.mjs','resources.mjs','image-config.mjs','content-config.mjs',...['domain','application','ui','locales'].flatMap(dir=>readdirSync(resolve(root,dir)).filter(name=>name.endsWith('.mjs')).map(name=>`${dir}/${name}`))];
const modules=new Set(paths.map(name=>resolve(root,name)));
function moduleReferences(source){
  const imports=[...source.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.{1,2}\/[^'"]+\.mjs)['"]/g)].map(match=>match[1]);
  // Worker 及其它显式模块 URL 同样参与依赖闭合和分层检查。
  const urls=[...source.matchAll(/new\s+URL\(\s*['"](\.{1,2}\/[^'"]+\.mjs)['"]\s*,\s*import\.meta\.url\s*\)/g)].map(match=>match[1]);
  return [...new Set([...imports,...urls])];
}
const graph=new Map(paths.map(name=>{
  const file=resolve(root,name),source=readFileSync(file,'utf8');
  return [file,moduleReferences(source).map(value=>resolve(dirname(file),value))];
}));
test('依赖解析覆盖导入、转导出和 Worker 模块 URL',()=>{
  assert.deepEqual(moduleReferences(`import {x} from './one.mjs';export {y} from './two.mjs';import('./three.mjs');new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});`),['./one.mjs','./two.mjs','./three.mjs','./worker.mjs']);
});
test('移除模拟 Worker 时，依赖闭合检查必须发现缺失入口',()=>{
  const worker=resolve(root,'application/contest-simulation-worker.mjs'),available=new Set([...modules].filter(file=>file!==worker));
  const missing=[...graph].flatMap(([file,dependencies])=>dependencies.filter(dependency=>!available.has(dependency)).map(dependency=>[file,dependency]));
  for(const client of ['contest-worker-client.mjs','contest-simulation-client.mjs','contest-multiplier-preview.mjs'])assert.ok(missing.some(([file,dependency])=>file===resolve(root,'application',client)&&dependency===worker));
});
test('活动模块依赖闭合，不导入归档、旧聚合视图或测试',()=>{
  for(const [file,dependencies] of graph)for(const dependency of dependencies)assert.ok(modules.has(dependency),`${file} -> ${dependency}`);
});
test('模块图无循环',()=>{
  const visiting=new Set(),visited=new Set();
  function walk(file){
    assert.ok(!visiting.has(file),`循环依赖：${file}`);if(visited.has(file))return;
    visiting.add(file);
    for(const dependency of graph.get(file)){
      walk(dependency);
    }
    visiting.delete(file);visited.add(file);
  }
  for(const file of graph.keys())walk(file);
});

const within=(file,directory)=>file.startsWith(resolve(root,directory)+'/');
function checkDependencies(start,allowed){
  const visited=new Set();
  function walk(file,chain){
    if(visited.has(file))return;visited.add(file);
    for(const dependency of graph.get(file)){
      const next=[...chain,relative(root,dependency)];assert.ok(allowed(dependency),next.join(' -> '));walk(dependency,next);
    }
  }
  walk(start,[relative(root,start)]);
}
test('应用模块的传递依赖限于应用、领域及明确的共享模块',()=>{
  const shared=new Set(['resources.mjs','image-config.mjs','content-config.mjs','i18n.mjs'].map(name=>resolve(root,name)));
  for(const file of graph.keys())if(within(file,'application'))checkDependencies(file,dependency=>within(dependency,'application')||within(dependency,'domain')||within(dependency,'locales')||shared.has(dependency));
});
test('资源服务与构建配置不依赖 DOM，页面适配由 UI 显式安装',()=>{
  for(const name of ['resources.mjs','image-config.mjs','content-config.mjs'])assert.doesNotMatch(readFileSync(resolve(root,name),'utf8'),/\b(?:document|window|MutationObserver|ResizeObserver|IntersectionObserver)\b/,name);
});
test('领域模块的传递依赖只包含领域模块及共享语言模块',()=>{
  // 共享语言入口保留为明确例外；资源运行时和其它根目录模块不能绕过分层约束。
  for(const file of graph.keys())if(within(file,'domain'))checkDependencies(file,dependency=>within(dependency,'domain')||within(dependency,'locales')||dependency===resolve(root,'i18n.mjs'));
});
