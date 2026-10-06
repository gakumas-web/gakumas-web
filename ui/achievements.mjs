import {supportHint,closeRewardPopover,suppressRewardHintFocus} from './card-rewards.mjs';
import {endingRewardCard} from './ending-rewards.mjs';
import {el,openDialog} from './dom.mjs';
import {t,onLocaleChange} from '../i18n.mjs';
import {achievementRewardLabels,achievedCardStage,achievementProgressInfo,achievementOwner,achievementIsComplete,achievementRewardKind} from '../domain/achievements.mjs';
import {characterAccent,illustration} from './illustrations.mjs';
const statusLabels={incomplete:'未达成',received:'已领取',claimable:'达到门槛',progress:'进行中'};
function statusBadge(status){return el('span',t(statusLabels[status]),'achievement-status '+status);}
function rewardLine(reward){
  const name=achievementRewardKind(reward)==='support'?t('支援卡强化点'):reward.name??t(achievementRewardLabels[reward.resourceType]??'奖励');
  return el('span',`${name} ×${reward.quantity}`,'achievement-reward');
}
function rewardsFor(stage){
  const rewards=el('div','','achievement-rewards');for(const reward of stage.rewards)rewards.append(rewardLine(reward));return rewards;
}
function progressSummary(entry){
  if(entry.status==='received')return t('全部 {0} 个阶段已领取',[entry.stages.length]);
  if(!entry.record||!entry.current)return '';
  if(entry.status==='claimable')return t('进度 {0} · 已达到当前门槛',[entry.record.progress]);
  const remaining=Math.max(0,entry.less?entry.record.progress-entry.current.threshold:entry.current.threshold-entry.record.progress);
  return t('进度 {0} · 距下一门槛还差 {1}',[entry.record.progress,remaining]);
}
let stageDialog,activeEntry;
function drawStages(){
  const entry=activeEntry,head=el('div','','dialog-head'),title=el('h2',entry.name),close=el('button',t('关闭'));
  const titleGroup=el('div','','achievement-dialog-title'),shown=achievedCardStage(entry)??entry.current??entry.stages[0],icon=achievementArt(shown?.image,entry.name,achievementOwner(entry));
  icon.setAttribute('aria-hidden','true');titleGroup.append(icon,title);
  title.id='achievement-stages-title';close.onclick=()=>stageDialog.close();head.append(titleGroup,close);
  const intro=el('div','','achievement-detail-summary');
  intro.append(el('strong',t('全部阶段 · {0}',[entry.stages.length])));
  if(entry.sourceEntries){const achieved=achievedCardStage(entry);if(achieved)intro.append(el('p',t('已达成特训阶段 {0}',[achieved.threshold])));}
  else if(entry.record)intro.append(el('p',progressSummary(entry)));
  const body=el('div','','achievement-stage-scroll'),list=el('ol','','achievement-stage-list');
  for(const [index,stage] of entry.stages.entries()){
    const current=entry.record&&stage===entry.current&&entry.status!=='received';
    const row=el('li','','achievement-stage'+(current?' is-current':''));row.dataset.stageIndex=String(index);
    if(current)row.setAttribute('aria-current','step');
    const heading=el('div','','achievement-stage-head');if(entry.idolCardId)heading.append(illustration(stage.image,stage.name??entry.name,'achievement-art',{characterId:achievementOwner(entry)}));heading.append(el('strong',t(current?'第 {0} 阶段 · 当前':'第 {0} 阶段',[index+1])));
    heading.append(statusBadge(stage.status));
    row.append(heading,el('p',stage.description),rewardsFor(stage));list.append(row);
  }
  body.append(list);stageDialog.replaceChildren(head,intro,body);
}
function positionCurrentStage(){
  const body=stageDialog.querySelector('.achievement-stage-scroll');
  const index=activeEntry.record?activeEntry.stages.indexOf(activeEntry.current):0;
  const row=body.querySelector(`[data-stage-index="${Math.max(0,index)}"]`);
  if(!row)return;row.tabIndex=-1;
  body.scrollTop+=row.getBoundingClientRect().top-body.getBoundingClientRect().top-12;
  row.focus({preventScroll:true});
}
function showStages(entry,returnFocus){
  if(!stageDialog){
    stageDialog=el('dialog','','achievement-stage-dialog');stageDialog.setAttribute('aria-labelledby','achievement-stages-title');
    document.body.append(stageDialog);stageDialog.addEventListener('close',()=>{activeEntry=null;stageDialog.replaceChildren();});
  }
  activeEntry=entry;drawStages();
  openDialog(stageDialog,{dismissOnBackdrop:true,returnFocus:returnFocus??(()=>document.querySelector(`[data-achievement-id="${CSS.escape(entry.id)}"] .achievement-stages`))});
  positionCurrentStage();
}
onLocaleChange(()=>{if(stageDialog?.open&&activeEntry){drawStages();positionCurrentStage();}});

export function stageHint(entry){
  const stage=entry.current??entry.stages[0],body=el('div','','achievement-progress-hint');
  const heading=el('div','','achievement-hint-heading');heading.append(el('strong',stage?.name??entry.name));
  if(stage)heading.append(statusBadge(stage.status));body.append(heading);
  if(stage)body.append(el('p',t('第 {0} 阶段',[entry.stages.indexOf(stage)+1])),el('p',stage.description),rewardsFor(stage));
  const progress=achievementProgressInfo(entry);
  body.append(el('p',t('当前进度 {0}',[progress.progress??'—'])));
  body.append(el('p',progress.next?t('距离下一级还差 {0}',[progress.remaining??'—']):t(entry.status==='received'?'全部阶段已领取':'已达到全部阶段门槛')));
  return body;
}
function achievementArt(image,name,characterId){
  const art=illustration(image,name,'achievement-art',{characterId});art.removeAttribute('title');
  // 本页小图标有分页上限，立即加载并提示同步解码，减少正文先绘制、图片随后补上的间隔。
  const img=art.querySelector('img');if(img){img.loading='eager';img.decoding='sync';}return art;
}

export function achievementEntry(entry){
  if(entry.kind==='ending')return endingRewardCard(entry);
  const card=characterAccent(el('article','','achievement-card achievement-icon-card'),achievementOwner(entry));card.dataset.achievementId=entry.id;
  const achieved=achievedCardStage(entry),shown=achieved??entry.current,progress=achievementProgressInfo(entry);
  const button=el('button','','achievement-stages achievement-icon-trigger');button.type='button';button.dataset.achieved=String(Boolean(achieved));button.setAttribute('aria-label',entry.name);button.setAttribute('aria-haspopup','dialog');
  const art=achievementArt(shown?.image,entry.name,achievementOwner(entry));
  const title=el('span',entry.name,'achievement-icon-title'),footer=el('span','','achievement-icon-progress');
  if(achievementIsComplete(entry)){
    footer.append(el('span',`✓ ${t('已达成')}`,'achievement-icon-complete'));
  }else{
    const track=el('span','','achievement-icon-track'),fill=el('span','','achievement-icon-fill');fill.style.width=`${progress.ratio*100}%`;track.append(fill);track.setAttribute('role','progressbar');track.setAttribute('aria-label',t('当前阶段进度'));track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',String(Math.round(progress.ratio*100)));footer.append(track);
    if(progress.next)footer.append(el('span',t('距离下一级还差 {0}',[progress.remaining??'—']),'achievement-icon-remaining'));
  }
  button.append(title,art,footer);
  card.append(button);
  supportHint(button,()=>stageHint(entry),{container:card,followPointer:true});
  button.onclick=()=>{closeRewardPopover();showStages(entry,()=>suppressRewardHintFocus(document.querySelector(`[data-achievement-id="${CSS.escape(entry.id)}"] .achievement-icon-trigger`)));};return card;
}

export function cardAchievementIcon(entry,container){
  const achieved=achievedCardStage(entry),shown=achieved??entry.stages[0],button=el('button','','card-achievement-icon');
  button.type='button';button.dataset.achievementId=entry.id;button.dataset.achieved=String(Boolean(achieved));button.dataset.missionType=entry.missionType;
  const label=shown?.name??entry.name;button.setAttribute('aria-label',`${label} · ${t(achieved?'已达成':'未达成')}`);button.setAttribute('aria-haspopup','dialog');
  button.append(achievementArt(shown?.image,label,achievementOwner(entry)));
  supportHint(button,()=>stageHint(entry),{container,followPointer:true});
  if(entry.sourceEntries&&achieved)button.append(el('span',String(achieved.threshold),'achievement-training-rank'));
  button.onclick=()=>{closeRewardPopover();showStages(entry,()=>suppressRewardHintFocus(document.querySelector(`.card-achievement-icon[data-achievement-id="${CSS.escape(entry.id)}"]`)));};return button;
}
