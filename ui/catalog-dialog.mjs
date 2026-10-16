import {$,el,openDialog} from './dom.mjs';
import {t,onLocaleChange} from '../i18n.mjs';
import {characterAccent} from './illustrations.mjs';
let catalogRefresh=null;
export function setCatalogRefresh(callback){
  catalogRefresh=callback;document.querySelector('[data-catalog-navigation]')?.remove();
  const dialog=$('idol-dialog');delete dialog.dataset.artViewer;dialog.style.removeProperty('--art-ratio');dialog.style.removeProperty('--character-color');dialog.classList.remove('character-accent');
  $('idol-content').scrollTop=0;
}
function fitArtwork(dialog,image){
  if(dialog.dataset.artViewer&&image?.matches('.illustration > img')&&image.naturalWidth>0&&!image.src.endsWith('/ui-icons/unavailable.svg'))dialog.style.setProperty('--art-ratio',String(image.naturalWidth/image.naturalHeight));
}
export function openCatalogDialog({artwork,characterId}={}){
  const dialog=$('idol-dialog');
  if(artwork){
    dialog.dataset.artViewer=artwork;dialog.style.setProperty('--art-ratio',artwork==='landscape'?'1.77734375':'0.56263736');characterAccent(dialog,characterId);
    fitArtwork(dialog,dialog.querySelector('.illustration > img'));
    if(!dialog.hasAttribute('data-art-listener')){dialog.dataset.artListener='';dialog.addEventListener('load',event=>fitArtwork(dialog,event.target),true);}
  }
  if(!dialog.open){
    const opener=document.activeElement,anchor=[['data-idol-id','idol-art-open'],['data-support-id','support-art-open'],['data-skin-id','skin-art-open']].find(([,name])=>opener?.classList.contains(name));
    const identity=anchor&&opener.closest(`[${anchor[0]}]`)?.getAttribute(anchor[0]);
    // 目录异步刷新可能替换原按钮，关闭后仍按条目身份恢复焦点。
    const returnFocus=()=>opener?.isConnected?opener:identity?document.querySelector(`[${anchor[0]}="${CSS.escape(identity)}"] .${anchor[1]}`):null;
    openDialog(dialog,{dismissOnBackdrop:true,returnFocus});
  }
  $('idol-content').scrollTop=0;
}
export function catalogNavigation(sections,onJump=()=>{}){
  const content=$('idol-content'),nav=el('nav','','selection-detail-nav');
  nav.dataset.catalogNavigation='';nav.setAttribute('aria-label',t('详情内容导航'));
  function jump(key){
    const section=sections.find(section=>section.key===key);if(!section)return;
    const target=section.element;
    if(target.tagName==='DETAILS')target.open=true;
    const heading=target.querySelector(':scope > h3,:scope > h4,:scope > summary')??target;
    heading.tabIndex=-1;heading.focus({preventScroll:true});
    content.scrollTop+=target.getBoundingClientRect().top-content.getBoundingClientRect().top-12;
    onJump(key);
  }
  for(const section of sections){const button=el('button',section.label);button.onclick=()=>jump(section.key);nav.append(button);}
  $('idol-dialog').querySelector('.dialog-head').append(nav);return jump;
}
onLocaleChange(()=>{
  if(!$('idol-dialog')?.open||!catalogRefresh)return;
  const expanded=[...document.querySelectorAll('#idol-content details')].map(node=>node.open);
  catalogRefresh();
  document.querySelectorAll('#idol-content details').forEach((node,i)=>{node.open=expanded[i]??false;});

});
