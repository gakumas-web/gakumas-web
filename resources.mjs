import {imageConfig} from './image-config.mjs';
import {createImageManager} from './application/image-manager.mjs';
import {validateContentAssets,contentHash} from './domain/content-contract.mjs';
import {combineImagePlan} from './domain/image-plan.mjs';

// 以模块位置定位应用根目录，同时支持域名根目录与 GitHub Pages 子目录。
const root=new URL('./',import.meta.url);
// 已校验图片来自独立缓存，使用本地对象地址。
export function imageLoading(){return 'eager';}
const downloadURLs=Object.fromEntries(Object.entries(imageConfig.downloadURLs??{}).map(([source,path])=>[source,new URL(path,root).href]));
export const imageManager=createImageManager({
  allowedOrigins:[...(imageConfig.allowedOrigins??[]),...(Object.keys(downloadURLs).length||(imageConfig.loadingPlan||imageConfig.loadingPlanSource)?[root.origin]:[])],downloadURLs,
});
let lastDelivery,totalImageBytes=0,activeThumbnails={};
export const beginImageView=view=>imageManager.prioritizeView(view);
export const completeImageBytes=()=>totalImageBytes;
// 只合并本批就绪的资源名，避免每次通知重建整套图片目录。
const imageNames=new Set(imageConfig.images??[]),iconNames=new Set(imageConfig.icons??[]);
const pendingImageSelector='img[src*="#resource="],image[href*="#resource="]';
function refreshCachedImage(node){
  const attribute=node.tagName.toLowerCase()==='image'?'href':'src';
  const name=decodeURIComponent(new URL(node.getAttribute(attribute),root).hash.slice('#resource='.length));
  const [folder,file]=name.split('/');
  const url=(folder==='images'?imageConfig.imageURLs:imageConfig.iconURLs)?.[file];
  if(!url)return;
  // 克隆节点不会继承原图的加载回调，命中缓存后也要恢复图片可见性。
  if(attribute==='src'&&node.hidden)node.addEventListener('load',()=>{node.hidden=false;},{once:true});
  node.setAttribute(attribute,url);
}
// 资源就绪时尚未挂载的节点会错过通知；只检查新增子树，不重新扫描整页。
if(typeof document!=='undefined'&&typeof MutationObserver!=='undefined'){
  new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes){
      if(node.nodeType!==1)continue;
      if(node.matches(pendingImageSelector))refreshCachedImage(node);
      for(const image of node.querySelectorAll(pendingImageSelector))refreshCachedImage(image);
    }
  }).observe(document.documentElement,{childList:true,subtree:true});
}
function applyCachedImages(changes){
  const imageURLs=imageConfig.imageURLs??={},iconURLs=imageConfig.iconURLs??={};
  for(const [path,url] of Object.entries(changes)){
    const [folder,name]=path.split('/'),names=folder==='images'?imageNames:iconNames,urls=folder==='images'?imageURLs:iconURLs;
    if(url){names.add(name);urls[name]=url;}else{names.delete(name);delete urls[name];}
  }
  imageConfig.images=[...imageNames];imageConfig.icons=[...iconNames];
  if(typeof document!=='undefined')for(const node of document.querySelectorAll(pendingImageSelector))refreshCachedImage(node);
  if(typeof document!=='undefined'&&changes['images/img_general_icon_produce-effect_bg-positive.webp'])document.documentElement.style.setProperty('--effect-positive-bg',`url("${assetURL('img_general_icon_produce-effect_bg-positive.webp')}")`);
}
imageManager.onAvailable(changes=>{if(lastDelivery)applyCachedImages(changes);},{incremental:true});
imageManager.subscribe(state=>{
  if(typeof document==='undefined'||!['error','cancelled'].includes(state.phase))return;
  for(const node of document.querySelectorAll('img[src*="#resource="]'))node.dispatchEvent(new Event('resource-error'));
});
export async function retryContentImages(){
  if(lastDelivery)await imageManager.retry();
}
let loadingPlanTask;
function loadImagePlan(){
  if(imageConfig.loadingPlan||!imageConfig.loadingPlanSource)return Promise.resolve();
  if(!loadingPlanTask){
    const source=imageConfig.loadingPlanSource;
    // 完整计划只在资料安装时读取；先核对字节身份，再交给既有版本与资源合同校验。
    loadingPlanTask=(async()=>{
      const response=await fetch(new URL(source.url,root),{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(45000)});
      if(!response.ok)throw new Error('image_program_update_required');
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength!==source.bytes||await contentHash(bytes)!==source.sha256)throw new Error('image_program_update_required');
      imageConfig.loadingPlan=JSON.parse(new TextDecoder().decode(bytes));
    })().catch(error=>{loadingPlanTask=null;throw error;});
  }
  return loadingPlanTask;
}
export function validateContentResources(index){
  validateContentAssets(index);
  if(imageConfig.mode==='none')return null;
  if(imageConfig.mode!=='managed')throw new Error('image_program_update_required');
  if(!imageConfig.loadingPlan&&imageConfig.loadingPlanSource)return loadImagePlan().then(()=>prepareImageIndex(index));
  return prepareImageIndex(index);
}
function prepareImageIndex(index){
  const prepared=imageConfig.loadingPlan?combineImagePlan(index,imageConfig.loadingPlan,root):{index,thumbnails:{}};
  if(prepared.index.cdn_objects.length&&!imageConfig.allowedOrigins.includes(new URL(index.cdn_base_url).origin))throw new Error('image_program_update_required');
  return prepared;
}
export function installContentResources(index){
  const prepared=validateContentResources(index);
  return prepared?.then?prepared.then(installImageIndex):installImageIndex(prepared);
}
function installImageIndex(prepared){
  if(!prepared)return;
  const {index,thumbnails}=prepared,plan=imageConfig.loadingPlan;activeThumbnails=thumbnails;
  if(lastDelivery!==index){imageNames.clear();iconNames.clear();Object.assign(imageConfig,{images:[],icons:[],imageURLs:{},iconURLs:{}});}
  lastDelivery=index;
  const objects=new Map(Object.entries(index.files).map(([name,row])=>[row.sha256+'.'+name.split('.').at(-1),row.bytes]));
  totalImageBytes=index.baseline.packages.reduce((sum,pack)=>sum+pack.bytes,0)+index.cdn_objects.reduce((sum,key)=>sum+(objects.get(key)??0),0);
  imageManager.configure(index);
  // 资料立即可用；基础界面小包独立准备，完整卡图只在实际展示或用户要求时获取。
  const core=new Set(plan?.packages.filter(pack=>pack.group==='core').flatMap(pack=>Object.keys(pack.objects))??[]);
  const names=Object.keys(index.files).filter(name=>core.has(index.files[name].sha256+'.'+name.split('.').at(-1))||name.startsWith('ui-icons/')&&!name.includes('full.'));
  void imageManager.request(names,{priority:0});
}
export function appURL(path){
  if(typeof path!=='string'||path.startsWith('/')||path.split('/').includes('..')||path.includes(':'))throw new Error('invalid_app_path');
  return new URL(path,root).href;
}
function resourceURL(name, folder, thumbnail=false){
  const logical=folder+'/'+name,target=thumbnail?(activeThumbnails[logical]??logical):logical;
  const [kind,file]=target.split('/'),cached=(kind==='images'?imageConfig.imageURLs:imageConfig.iconURLs)?.[file];
  if(cached)return cached;
  if(imageConfig.mode!=='managed')return appURL('ui-icons/unavailable.svg');
  if(lastDelivery?.files[target])void imageManager.request([target],{priority:1});
  return appURL('ui-icons/unavailable.svg')+'#resource='+encodeURIComponent(target);
}
export function assetURL(name, thumbnail=false){
  if(!/^img_[A-Za-z0-9_-]{1,180}\.webp$/.test(name))return appURL('ui-icons/unavailable.svg');
  return resourceURL(name,'images',thumbnail);
}
export function uiIconURL(name){
  if(!/^[A-Za-z0-9_-]{1,180}\.(?:webp|png)$/.test(name))return appURL('ui-icons/unavailable.svg');
  return resourceURL(name,'ui-icons');
}
