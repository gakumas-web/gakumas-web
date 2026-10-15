import {imageManager,cachedResourceURL,appURL} from '../resources.mjs';

const pendingImageSelector='img[src*="#resource="],image[href*="#resource="]';
const positiveBackground='images/img_general_icon_produce-effect_bg-positive.webp';

// 页面入口显式安装；资源服务只更新缓存地址，不自行观察或修改 DOM。
export function mountResourceImages(){
  const loadListeners=new Map();let disposed=false;
  function refresh(node){
    const attribute=node.tagName.toLowerCase()==='image'?'href':'src';
    const path=decodeURIComponent(new URL(node.getAttribute(attribute),appURL('')).hash.slice('#resource='.length));
    const url=cachedResourceURL(path);if(!url)return;
    // 克隆节点不会继承原图回调；缓存命中后恢复图片，销毁时移除尚未触发的监听。
    if(attribute==='src'&&node.hidden&&!loadListeners.has(node)){
      const cleanup=()=>{node.removeEventListener('load',loaded);node.removeEventListener('error',cleanup);loadListeners.delete(node);};
      const loaded=()=>{node.hidden=false;cleanup();};
      loadListeners.set(node,cleanup);node.addEventListener('load',loaded,{once:true});node.addEventListener('error',cleanup,{once:true});
    }
    node.setAttribute(attribute,url);
  }
  function refreshPage(){
    for(const node of document.querySelectorAll(pendingImageSelector))refresh(node);
    const background=cachedResourceURL(positiveBackground);
    if(background)document.documentElement.style.setProperty('--effect-positive-bg',`url("${background}")`);
  }
  const observer=new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes){
      if(node.nodeType!==1)continue;
      if(node.matches(pendingImageSelector))refresh(node);
      for(const image of node.querySelectorAll(pendingImageSelector))refresh(image);
    }
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  const unsubscribeAvailable=imageManager.onAvailable(refreshPage,{incremental:true});
  const unsubscribeStatus=imageManager.subscribe(state=>{
    if(!['error','cancelled'].includes(state.phase))return;
    for(const node of document.querySelectorAll('img[src*="#resource="]'))node.dispatchEvent(new Event('resource-error'));
  });
  refreshPage();
  return ()=>{
    if(disposed)return;disposed=true;observer.disconnect();unsubscribeAvailable();unsubscribeStatus();
    for(const cleanup of loadListeners.values())cleanup();
    loadListeners.clear();
  };
}
