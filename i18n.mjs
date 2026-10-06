import zh from './locales/zh-CN.mjs';
import ja from './locales/ja.mjs';

export const languages=Object.freeze({'zh-CN':'简体中文',ja:'日本語'});
const catalogs={'zh-CN':zh,ja};
const listeners=new Set();
const preference='memory-language';
let current='zh-CN';
try{const saved=globalThis.localStorage?.getItem(preference);if(catalogs[saved])current=saved;}catch{}
export const locale=()=>current;
export function setLocale(value){
  if(!catalogs[value])throw new Error('Unsupported locale');
  if(value===current)return;
  current=value;
  try{globalThis.localStorage?.setItem(preference,value);}catch{}
  for(const listener of listeners)listener(value);
}
export function onLocaleChange(listener){listeners.add(listener);return()=>listeners.delete(listener);}
export function t(key,values=[]){
  const template=catalogs[current][key]??catalogs['zh-CN'][key]??key;
  return template.replace(/\{(\d+)\}/g,(match,index)=>values[index]===undefined?match:String(values[index]));
}
// 只登记启动时的静态文案节点，后续动态内容和用户输入不会被遍历替换。
export function staticTranslations(root=document){
  const bindings=[];
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
    const node=walker.currentNode;
    if(node.parentElement?.closest('script,style,[data-language-menu]'))continue;
    const source=node.textContent,key=source.trim();
    if(/[\u3400-\u9fff]/.test(key)||Object.hasOwn(zh,key))bindings.push(()=>{if(node.isConnected)node.textContent=source.replace(key,t(key));});
  }
  for(const element of root.querySelectorAll('[aria-label],[placeholder],[title]')){
    if(element.closest('[data-language-menu]'))continue;
    for(const attribute of ['aria-label','placeholder','title']){
      const key=element.getAttribute(attribute);
      if(key&&(/[\u3400-\u9fff]/.test(key)||Object.hasOwn(zh,key)))bindings.push(()=>element.setAttribute(attribute,t(key)));
    }
  }
  return ()=>{document.documentElement.lang=current;for(const update of bindings)update();};
}

// 仅用于领域模型生成的显示文本；禁止用于用户笔记、标签或公开卡名。
const sourcePatterns=Object.keys(zh).filter(key=>/\{\d+\}/.test(key)).sort((a,b)=>b.replace(/\{\d+\}/g,'').length-a.replace(/\{\d+\}/g,'').length).map(key=>{
  const indices=[];
  const pattern=key.split(/(\{\d+\})/).map(part=>{
    if(/^\{\d+\}$/.test(part)){indices.push(Number(part.slice(1,-1)));return '(.*?)';}
    return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  }).join('');
  return {key,indices,pattern:new RegExp('^'+pattern+'$')};
});
export function localizeSource(value){
  if(typeof value!=='string')return value;
  if(Object.hasOwn(zh,value))return t(value);
  for(const {key,indices,pattern} of sourcePatterns){
    const found=value.match(pattern);
    if(found){const values=[];indices.forEach((index,i)=>{values[index]=found[i+1];});return t(key,values);}
  }
  return value;
}
