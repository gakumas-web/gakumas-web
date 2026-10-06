import {$,el} from './dom.mjs';
import {collectionState,shareLinkButton} from './shared.mjs';
import {favoriteButton} from './personal-library.mjs';
import {profileAccountId} from '../domain/account.mjs';
import {setCatalogRefresh,openCatalogDialog} from './catalog-dialog.mjs';
import {t} from '../i18n.mjs';
import {skinInfo,idolArtVariants} from '../domain/catalog.mjs';
import {illustration,characterAccent} from './illustrations.mjs';

// 只有装扮自身就是偶像卡原始插图时，才允许切换该卡的特训卡面。
function skinArtwork(held,info,options,kind){
  const {idolHeld,getArt=()=>undefined,onArt=()=>{}}=options;
  const variants=info.hasIdolArt?idolArtVariants({...idolHeld,idolCardId:info.idolCardId,idolCardSkinId:''}):[];
  const image=el('div'),label=el('label','','idol-card-art-options'),toggle=el('input');
  let selected=getArt()??((idolHeld?.levelLimitRank??0)>=3?'upgraded':'base');
  toggle.type='checkbox';toggle.setAttribute('role','switch');toggle.setAttribute('aria-label',t('特训后卡面'));
  label.append(toggle,el('span',t('特训后卡面')));
  function draw(){
    const art=variants.find(value=>value.id===selected)??variants[0];
    image.replaceChildren(illustration(art?.image??info.image,`${info.character} · ${info.name}`,kind,{characterId:info.characterId}));toggle.checked=art?.id==='upgraded';
  }
  toggle.onchange=()=>{selected=toggle.checked?'upgraded':'base';draw();onArt(selected);};draw();
  return {image,control:variants.some(art=>art.id==='upgraded')?label:null};
}
export function skinEntry({held,info},options={}){
  const row=characterAccent(el('article','','skin-card'),info.characterId);row.dataset.skinId=held.idolCardSkinId;row.dataset.ownership=held.ownership;
  const button=el('button','','skin-art-open');button.setAttribute('aria-label',t('查看主题装扮：{0}',[info.name]));
  const {image,control}=skinArtwork(held,info,options,'skin-art');button.append(image);button.onclick=()=>showSkin(held,options);
  const name=el('span',info.theme||info.name,'skin-name');name.title=info.theme||info.name;
  const heading=el('h3');heading.append(name);
  const social=el('div','','card-social-actions');social.append(shareLinkButton(held.idolCardSkinId,'skin'),favoriteButton(options.favorite??false,options.onFavorite??(()=>{}),options.favoriteDisabled??false));
  const body=el('div','','skin-body');
  if(options.immersive){
    body.classList.add('immersive-card-caption');body.append(heading,social);row.append(button,body);if(control)row.append(control);
  }else{
    heading.classList.add('skin-heading');
    const status=collectionState(held);if(control){control.title=t('特训后卡面');social.prepend(control);}status.append(social);
    row.append(status,heading,button);
  }
  return row;
}
export function showSkin(held,options={}){
  setCatalogRefresh(()=>showSkin(held,options));const info=skinInfo(held);
  const params=new URLSearchParams({skin:held.idolCardSkinId}),account=profileAccountId($('profile').value);if(account)params.set('account',account);
  const hash='#'+params.toString();if(location.hash!==hash)history.pushState(null,'',hash);
  $('idol-title').textContent=`${info.character} · ${info.theme||info.name}`;
  const content=characterAccent(el('div','','skin-detail'),info.characterId),{image,control}=skinArtwork(held,info,options,'skin-full');content.append(image);if(control)content.append(control);
  $('idol-content').replaceChildren(content);openCatalogDialog();
}
