import {uiIconURL} from '../resources.mjs';
import {profileAccountId,maskedAccountId,isPreviewAccount} from '../domain/account.mjs';
import {el} from './dom.mjs';
import {t} from '../i18n.mjs';
import {shown} from '../domain/model.mjs';
import {ownershipLabel,memoryTagName} from '../domain/catalog.mjs';
const statFields = [['vocal', 'Vo'], ['dance', 'Da'], ['visual', 'Vi'], ['stamina', '体力']];
export function accountIdentity(id,suffix=''){
  const label=value=>suffix?`${value} ${suffix}`:value;
  if(isPreviewAccount(id)){const row=el('div','','account-identity');row.append(el('strong',label(t('预览账号'))),el('span',t('演示数据'),'small muted'));return row;}
  const row=el('div','','account-identity'),value=el('code',label(maskedAccountId(id))),toggle=el('button',t('显示账号 ID'),'account-visibility');
  let revealed=false;
  toggle.setAttribute('aria-pressed','false');
  toggle.onclick=()=>{
    revealed=!revealed;value.textContent=label(revealed?id:maskedAccountId(id));
    toggle.textContent=t(revealed?'隐藏账号 ID':'显示账号 ID');toggle.setAttribute('aria-pressed',String(revealed));
  };
  row.append(value,toggle);return row;
}
export function rankFlowers(rank){
  const row=el('span','','rank-flowers');row.setAttribute('role','img');row.setAttribute('aria-label',t('突破 {0}',[rank]));row.title=t('突破 {0}',[rank]);
  for(let index=0;index<4;index++){
    const flower=el('img','','rank-flower'+(index<rank?' is-filled':' is-empty'));
    flower.src=uiIconURL('rank-flower.webp');flower.alt='';flower.setAttribute('aria-hidden','true');row.append(flower);
  }
  return row;
}
export function protectionBadge() {
  const badge=el('span',t('已保护'),'badge protection');badge.title=t('已加锁保护，无法移除');badge.setAttribute('aria-label',t('游戏内已保护'));badge.setAttribute('aria-description',badge.title);
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Z');icon.append(path);badge.append(icon);return badge;
}
export function inUseBadge() {
  const badge=el('span',t('使用中'),'badge in-use');badge.title=t('已编入比赛、偶像之路等卡组');badge.setAttribute('aria-label',t('使用中'));badge.setAttribute('aria-description',badge.title);
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
  const circle=document.createElementNS(icon.namespaceURI,'circle');circle.setAttribute('cx','12');circle.setAttribute('cy','12');circle.setAttribute('r','9');
  const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','m7.5 12 3 3 6-6');icon.append(circle,path);badge.append(icon);return badge;
}
export function stats(m) {
  const group = el('div', '', 'stats');
  for (const [key, label] of statFields) {
    const stat = el('div', '', 'stat'); stat.append(el('span', t(label)), el('strong', shown(m[key]))); group.append(stat);
  }
  return group;
}
export function collectionState(held) {
  const state=held.ownership??'owned';
  return el('div',`${state==='owned'?'✓':state==='unowned'?'○':'?'} ${ownershipLabel(held)}`,'collection-state '+state);
}

export function memoryTagBadge(memory){
  const name=memoryTagName(memory.memoryTagId);
  if(!name)return null;
  const badge=el('span',name,'badge game-memory-tag');badge.title=name;return badge;
}

export function shareLinkButton(key,kind){
  const button=el('button','','share-button');button.type='button';
  const label=t('分享链接');button.title=label;button.setAttribute('aria-label',label);
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
  const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','M8.6 10.5 15.4 6.5M8.6 13.5 15.4 17.5');icon.append(path);
  for(const [x,y] of [[6,12],[18,5],[18,19]]){const circle=document.createElementNS(icon.namespaceURI,'circle');circle.setAttribute('cx',x);circle.setAttribute('cy',y);circle.setAttribute('r','3');icon.append(circle);}
  const feedback=el('span','','sr-only');feedback.setAttribute('role','status');button.append(icon,feedback);
  const account=profileAccountId(document.getElementById('profile').value);
  if(!account){button.disabled=true;button.title=t('请先导入对应账号的数据。');}
  let reset;
  button.onclick=async()=>{
    if(!account)return;
    const url=new URL(location.href);url.hash=new URLSearchParams({[kind]:key,account}).toString();
    let text;try{await navigator.clipboard.writeText(url.href);text=t('链接已复制');}catch{text=t('复制失败');}
    button.title=text;button.setAttribute('aria-label',text);feedback.textContent=text;
    clearTimeout(reset);reset=setTimeout(()=>{button.title=label;button.setAttribute('aria-label',label);feedback.textContent='';},2500);
  };
  return button;
}
