import {imageConfig} from './image-config.mjs';
import {createImageManager} from './application/image-manager.mjs';
import {validateContentAssets} from './domain/content-contract.mjs';

// 以模块位置定位应用根目录，同时支持域名根目录与 GitHub Pages 子目录。
const root=new URL('./',import.meta.url);
// 已校验图片来自独立缓存，使用本地对象地址。
export function imageLoading(){return 'eager';}
const downloadURLs=Object.fromEntries(Object.entries(imageConfig.downloadURLs??{}).map(([source,path])=>[source,new URL(path,root).href]));
export const imageManager=createImageManager({
  allowedOrigins:[...(imageConfig.allowedOrigins??[]),...(Object.keys(downloadURLs).length?[root.origin]:[])],downloadURLs,
});
let lastDelivery;
function applyCachedImages(index,urls){
  const images=[],icons=[],imageURLs={},iconURLs={};
  for(const path of Object.keys(index.files)){const [folder,name]=path.split('/');if(!urls[path])continue;
    if(folder==='images'){images.push(name);imageURLs[name]=urls[path];}else{icons.push(name);iconURLs[name]=urls[path];}}
  Object.assign(imageConfig,{images,icons,imageURLs,iconURLs});
  if(typeof document!=='undefined')document.documentElement.style.setProperty('--effect-positive-bg',`url("${assetURL('img_general_icon_produce-effect_bg-positive.webp')}")`);
}
export async function retryContentImages(){
  if(lastDelivery)applyCachedImages(lastDelivery,await imageManager.prepare(lastDelivery));
}
export function installContentResources(index){
  validateContentAssets(index);
  if(imageConfig.mode==='none')return;
  if(imageConfig.mode!=='managed')throw new Error('image_program_update_required');
  lastDelivery=index;return imageManager.prepare(index).then(urls=>applyCachedImages(index,urls));
}
export function appURL(path){
  if(typeof path!=='string'||path.startsWith('/')||path.split('/').includes('..')||path.includes(':'))throw new Error('invalid_app_path');
  return new URL(path,root).href;
}
function resourceURL(name, names, urls){
  return names.includes(name)&&urls?.[name]?new URL(urls[name],root).href:appURL('ui-icons/unavailable.svg');
}
export function assetURL(name){
  if(!/^img_[A-Za-z0-9_-]{1,180}\.webp$/.test(name))return appURL('ui-icons/unavailable.svg');
  return resourceURL(name,imageConfig.images,imageConfig.imageURLs);
}
export function uiIconURL(name){
  if(!/^[A-Za-z0-9_-]{1,180}\.(?:webp|png)$/.test(name))return appURL('ui-icons/unavailable.svg');
  return resourceURL(name,imageConfig.icons,imageConfig.iconURLs);
}
