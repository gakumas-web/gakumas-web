import {el} from './dom.mjs';
import {t} from '../i18n.mjs';
import {skillThumbnail,itemThumbnail} from './illustrations.mjs';
import {skillCardDetails} from './skill-card-details.mjs';
import {semanticContent} from './semantic-view.mjs';
let activeRewardPopover=null,rewardPopoverId=0;
export function closeRewardPopover(){if(activeRewardPopover?.matches(':popover-open'))activeRewardPopover.hidePopover();activeRewardPopover=null;}
document.addEventListener('scroll',event=>{if(activeRewardPopover&&!activeRewardPopover.contains(event.target))closeRewardPopover();},true);
window.addEventListener('resize',closeRewardPopover);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeRewardPopover?.matches(':popover-open')){event.preventDefault();event.stopPropagation();activeRewardPopover.dispatchEvent(new Event('reward-dismiss'));}},true);
// 模态关闭时归还焦点，不把这次程序性聚焦当作再次请求说明。
export function suppressRewardHintFocus(button){button?.dispatchEvent(new Event('reward-suppress-focus'));return button;}
export function supportHint(button,body,{container,followPointer=false,hoverOnly=false}={}){
  const wrapper=container??el('div','','support-reward-hint');
  if(button.localName==='button')button.type='button';
  else if(!hoverOnly){button.setAttribute('role','button');button.setAttribute('tabindex','0');button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();button.dispatchEvent(new MouseEvent('click'));}});}
  const popup=el('div','','support-reward-popover');popup.popover='auto';popup.id=`support-reward-${++rewardPopoverId}`;
  let build=typeof body==='function'?body:null;
  if(!build)popup.append(body);
  button.setAttribute('aria-controls',popup.id);button.setAttribute('aria-expanded','false');
  if(followPointer)popup.classList.add('support-pointer-popover');
  let pinned=false,timer,focusSuppressed=false,focusReturnSuppressed=false;
  button.addEventListener('reward-suppress-focus',()=>{focusSuppressed=true;focusReturnSuppressed=true;if(popup.matches(':popover-open'))popup.hidePopover();});
  popup.addEventListener('reward-dismiss',()=>{focusSuppressed=true;popup.hidePopover();});
  function positionAtPointer(event){
    const bounds=popup.getBoundingClientRect();
    const left=event.clientX+12,top=event.clientY+14;
    popup.style.left=`${Math.max(12,Math.min(left,innerWidth-bounds.width-12))}px`;
    popup.style.top=`${Math.max(12,top+bounds.height<=innerHeight-12?top:event.clientY-bounds.height-14)}px`;
  }
  function positionPopup(pointer,allowOverlap=false){
    if(!popup.matches(':popover-open'))return;
    // 每次按当前内容和整个视口重新量高，不能沿用打开时的内容高度。
    popup.style.maxHeight=`${Math.max(100,innerHeight-24)}px`;
    if(pointer){positionAtPointer(pointer);return;}
    const anchor=button.getBoundingClientRect(),natural=popup.getBoundingClientRect();
    const below=innerHeight-anchor.bottom-20,above=anchor.top-20;
    const under=natural.height<=below||below>=above;
    // 初次悬停不能遮住触发按钮；用户在框内操作后才按整个视口扩展。
    if(!allowOverlap)popup.style.maxHeight=`${Math.max(100,Math.min(innerHeight-24,under?below:above))}px`;
    const bounds=popup.getBoundingClientRect();
    const top=allowOverlap?bounds.top:bounds.height<=below?anchor.bottom+8:bounds.height<=above?anchor.top-bounds.height-8:anchor.bottom+8;
    popup.style.left=`${Math.max(12,Math.min(anchor.left,innerWidth-bounds.width-12))}px`;
    popup.style.top=`${Math.max(12,Math.min(top,innerHeight-bounds.height-12))}px`;
  }
  function queuePosition(){
    positionPopup(undefined,true);
  }
  popup.addEventListener('change',queuePosition);
  popup.addEventListener('click',queuePosition);
  popup.addEventListener('toggle',event=>{if(event.target!==popup)queuePosition();},true);
  function show(pointer){
    clearTimeout(timer);if(popup.matches(':popover-open')){if(pointer&&!pinned)positionAtPointer(pointer);return;}
    if(build){popup.append(build());build=null;}
    closeRewardPopover();popup.showPopover();activeRewardPopover=popup;button.setAttribute('aria-expanded','true');
    positionPopup(pointer);
  }
  function leave(){
    clearTimeout(timer);timer=setTimeout(()=>{
      if(!pinned&&!button.matches(':hover')&&!popup.matches(':hover')&&!wrapper.contains(document.activeElement)&&popup.matches(':popover-open'))popup.hidePopover();
    },150);
  }
  button.onpointerenter=event=>{if(focusReturnSuppressed)return;focusSuppressed=false;if(event.pointerType==='mouse')show(followPointer?event:undefined);};button.onpointerleave=()=>{focusReturnSuppressed=false;leave();};
  // 滚动会关闭浮层；鼠标仍在入口内移动时恢复说明，无需先移出再进入。
  if(followPointer)button.onpointermove=event=>{if(event.pointerType!=='mouse'||pinned)return;if(popup.matches(':popover-open'))positionAtPointer(event);else if(!focusSuppressed&&!focusReturnSuppressed)show(event);};
  popup.onpointerenter=()=>clearTimeout(timer);popup.onpointerleave=leave;
  button.onfocus=()=>{
    // 等浏览器把键盘焦点滚入视口，再显示浮层，避免被这次自动滚动立即关闭。
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(!focusSuppressed&&document.activeElement===button&&button.matches(':focus-visible'))show();
    }));
  };button.addEventListener('blur',()=>{focusSuppressed=false;focusReturnSuppressed=false;});wrapper.addEventListener('focusout',leave);
  if(!hoverOnly)button.onclick=()=>{if(pinned){popup.hidePopover();pinned=false;}else{show();pinned=true;}};
  popup.addEventListener('toggle',()=>{const open=popup.matches(':popover-open');button.setAttribute('aria-expanded',String(open));if(!open){focusSuppressed=focusReturnSuppressed||document.activeElement===button;pinned=false;if(activeRewardPopover===popup)activeRewardPopover=null;}});
  if(!container)wrapper.append(button);wrapper.append(popup);return wrapper;
}
export function itemRewardDetails(reward,{effectContent}={}){
  const body=el('div','','support-reward-body reward-description'),header=el('header','','support-item-header'),identity=el('div');
  const use=t(reward.use==='battle'?'可继承至比赛':reward.use==='training'?'仅用于培养':'用途待确认');
  identity.append(el('h4',reward.name),el('p',use,'small muted'));header.append(itemThumbnail(reward),identity);
  const effect=el('div','','support-item-description');
  if(effectContent)effect.append(effectContent);
  else{const content=semanticContent({entries:[reward.description]});content.querySelector('h4')?.remove();effect.append(content);}
  body.append(header,effect);return body;
}

export function rewardHint(reward,event,locked,lockedLabel,{chooseVersion=true,customization,recorded=false}={}){
  const button=el('button','','support-reward-trigger');button.dataset.rewardKind=reward.kind;
  const art=el('span','','support-reward-art');
  button.append(art);
  const use=reward.kind==='item'?t(reward.use==='battle'?'可继承至比赛':reward.use==='training'?'仅用于培养':'用途待确认'):t('技能卡');
  const eventLabel=event.label??t('事件 {0} · Lv.{1} 解锁',[event.number,event.unlockLevel]);
  button.setAttribute('aria-label',[reward.name,use,eventLabel,locked?lockedLabel:''].filter(Boolean).join(' · '));
  const isCard=reward.kind==='card'&&reward.versions.length;
  let activeVersion=null;
  function updateArt(version){
    if(activeVersion===version)return;
    activeVersion=version;art.replaceChildren(skillThumbnail(version));
    button.setAttribute('aria-label',[version.name,...version.visual.costs.map(cost=>`${cost.label} ${cost.value}`),eventLabel,locked?lockedLabel:''].filter(Boolean).join(' · '));
  }
  if(isCard){button.classList.add('support-skill-trigger');updateArt(recorded?reward.versions.find(entry=>entry.reference.upgradeCount===reward.reference.upgradeCount)??reward.versions[0]:reward.versions.find(entry=>entry.reference.upgradeCount===1)??reward.versions[0]);}
  else art.append(itemThumbnail(reward));
  // 缩略图立即显示；正文与附魔选项只在首次打开浮层时创建。
  function buildBody(){
    const body=isCard?skillCardDetails(reward,{chooseVersion,customization,recorded,onVersionChange:updateArt}):itemRewardDetails(reward);
    if(event.label)body.append(el('p',event.label,'small muted'));
    if(locked)body.append(el('p',lockedLabel,'small muted'));
    return body;
  }
  return supportHint(button,buildBody);
}
