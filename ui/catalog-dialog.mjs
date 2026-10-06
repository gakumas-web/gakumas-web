import {$,el,openDialog} from './dom.mjs';
import {t,onLocaleChange} from '../i18n.mjs';
let catalogRefresh=null;
export function setCatalogRefresh(callback){
  catalogRefresh=callback;document.querySelector('[data-catalog-navigation]')?.remove();
  $('idol-content').scrollTop=0;
}
export function openCatalogDialog(){
  const dialog=$('idol-dialog');if(!dialog.open)openDialog(dialog,{dismissOnBackdrop:true});
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
