import {uiIconURL} from '../resources.mjs';
import {el,openDialog} from './dom.mjs';
import {t,locale} from '../i18n.mjs';
import {supportInfo,idolInfo,selectionPrimarySkill} from '../domain/catalog.mjs';
import {illustration,characterAccent,skillThumbnailFor} from './illustrations.mjs';
import {memoryInheritance} from './memories.mjs';
import {rankFlowers} from './shared.mjs';
import {closeRewardPopover} from './card-rewards.mjs';
import {profileAccountId} from '../domain/account.mjs';
let dialog;
export function closeSelectionDetails(){dialog?.close();}
export function showSelectionDetails(detail,memory){
  closeRewardPopover();
  if(!dialog){dialog=el('dialog','','selection-details-dialog');dialog.setAttribute('aria-labelledby','selection-details-title');document.body.append(dialog);dialog.addEventListener('close',()=>{if(location.hash.startsWith('#selection-loadout='))history.replaceState(null,'',location.pathname+location.search);});}
  const head=el('div','','dialog-head'),title=el('h2','','selection-details-identity');title.id='selection-details-title';
  const skill=memory?selectionPrimarySkill(memory):null;
  if(skill){const icon=skillThumbnailFor(skill.reference,memory.characterId);icon.dataset.primarySkillId=skill.reference.id;title.append(icon);}
  const label=el('span','','selection-details-name');label.append(el('span',memory?idolInfo(memory).name:t('本次培养阵容')));
  if(memory?.clearedTime){const time=el('time',new Intl.DateTimeFormat(locale(),{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(memory.clearedTime)),'selection-details-time');time.dateTime=new Date(memory.clearedTime).toISOString();label.append(time);}
  title.append(label);
  const close=el('button',t('关闭'));close.type='button';close.onclick=()=>dialog.close();head.append(title,close);dialog.replaceChildren(head);
  if(!detail){dialog.append(el('p',t('详情未采集；请在游戏中打开该选拔回忆详情，采集并导入同账号详情快照。'),'small muted'));openDialog(dialog,{dismissOnBackdrop:true});return;}
  const route=new URLSearchParams({'selection-loadout':detail.key,account:detail.publicUserId}),hash='#'+route.toString();if(location.hash!==hash)history.pushState(null,'',hash);
  const ns='http://www.w3.org/2000/svg',shape=document.createElementNS(ns,'svg'),clip=document.createElementNS(ns,'clipPath'),curve=document.createElementNS(ns,'path');
  shape.setAttribute('width','0');shape.setAttribute('height','0');shape.setAttribute('aria-hidden','true');shape.classList.add('selection-rarity-definitions');
  clip.id='selection-rarity-curve';clip.setAttribute('clipPathUnits','objectBoundingBox');curve.setAttribute('d','M0 .4 C .025 .72 .07 .95 .22 .95 H1 V1 H0 Z');clip.append(curve);shape.append(clip);dialog.append(shape);
  const layout=el('div','','selection-loadout-layout'),memories=el('section','','selection-loadout-memories'),memoryList=el('div','','inventory-list compact-grid memory-catalog selection-detail-memory-grid');memories.append(el('h3',t('带入回忆')),memoryList);
  if(!detail.memories.length)memoryList.append(el('p',t('该次详情响应未返回回忆槽位，不推断为空阵容。'),'small muted'));
  for(const slot of [...detail.memories].sort((a,b)=>a.number-b.number)){
    const card=characterAccent(el('article','','memory-card selection-detail-memory-card'),slot.memory?.characterId);card.dataset.slotNumber=String(slot.number);
    if(slot.memory){
      const rental=slot.isRental?el('span',t('租借'),'badge selection-memory-rental'):null;card.append(memoryInheritance(slot.memory,rental,{nameRight:true}));
    }else card.append(el('p',t('嵌套回忆未返回'),'small muted'));
    memoryList.append(card);
  }
  const supports=el('section','','selection-loadout-supports'),supportList=el('div','','selection-detail-support-grid');supports.append(el('h3',t('支援卡')),supportList);
  if(!detail.supportCards.length)supportList.append(el('p',t('该次详情响应未返回支援槽位，不推断为空阵容。'),'small muted'));
  for(const slot of [...detail.supportCards].sort((a,b)=>a.number-b.number)){
    const info=supportInfo(slot),card=el('button','','selection-detail-support-card');card.type='button';card.dataset.slotNumber=String(slot.number);card.dataset.supportId=slot.supportCardId;card.dataset.level=String(slot.level);card.dataset.rank=String(slot.levelLimitRank);card.dataset.rental=String(slot.isRental);card.dataset.rarity=info.rarity??'';
    const label=`${info.name} · ${t('记录等级 {0} · 突破 {1}',[slot.level,slot.levelLimitRank])}${slot.isRental?' · '+t('租借'):''}`;card.title=label;card.setAttribute('aria-label',label);
    card.append(illustration(info.image,info.name,'selection-detail-support-art',{characterId:info.characterIds?.length===1?info.characterIds[0]:undefined,fullResolution:true}));
    const status=el('span','','selection-detail-support-status'),level=el('span','','selection-detail-support-level');level.append(el('small','Lv'),el('strong',String(slot.level)));status.append(level,rankFlowers(slot.levelLimitRank));card.append(status);
    const typeName=({Vocal:'vocal',Dance:'dance',Visual:'visual',[t('辅助')]:'assist'})[info.type];
    if(typeName){const type=el('img','','selection-detail-support-type');type.src=uiIconURL(`${typeName}.webp`);type.alt=info.type;card.append(type);} 
    const rarity=el('span','','selection-detail-support-rarity');rarity.setAttribute('aria-hidden','true');rarity.style.clipPath='url(#selection-rarity-curve)';card.append(rarity);
    if(slot.isRental)card.append(el('span',t('租借'),'selection-detail-rental'));
    card.onclick=()=>{
      const params=new URLSearchParams({support:slot.supportCardId,level:String(slot.level)}),account=profileAccountId(document.getElementById('profile').value);if(account)params.set('account',account);
      closeRewardPopover();dialog.close();const hash='#'+params.toString();if(location.hash===hash)window.dispatchEvent(new Event('hashchange'));else location.hash=hash;
    };
    supportList.append(card);
  }
  layout.append(supports,memories);dialog.append(layout);openDialog(dialog,{dismissOnBackdrop:true});
}
