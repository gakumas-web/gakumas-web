import {uiIconURL} from '../resources.mjs';
import {favoriteButton} from './personal-library.mjs';
import {$,el} from './dom.mjs';
import {setCatalogRefresh,openCatalogDialog} from './catalog-dialog.mjs';
import {shareLinkButton,collectionState,rankFlowers} from './shared.mjs';
import {t} from '../i18n.mjs';
import {ownershipLabel,isReference,progressionInfo} from '../domain/catalog.mjs';
import {illustration} from './illustrations.mjs';
import {effectReading} from './effect-view.mjs';
import {rewardHint,supportHint,closeRewardPopover} from './card-rewards.mjs';
function compactEvents(held,info,target=held.level){
  const events=el('div','','support-art-events');events.setAttribute('role','group');events.setAttribute('aria-label',t('事件奖励与基础效果'));
  for(const event of info.events??[]){
    const entry=el('div','','support-art-event');
    const locked=target<event.unlockLevel,preview=target!==held.level;
    const lockedLabel=t(preview?'预览等级尚未解锁':'当前等级尚未解锁');entry.classList.toggle('locked',locked);
    entry.classList.toggle('preview-unlocked',preview&&held.level<event.unlockLevel&&!locked);
    if(event.rewards.length){for(const reward of event.rewards)entry.append(rewardHint(reward,event,locked,lockedLabel));}
    else{
      const button=el('button','','support-reward-trigger support-event-symbol');button.setAttribute('aria-label',[t('事件 {0} · Lv.{1} 解锁',[event.number,event.unlockLevel]),event.text,locked?lockedLabel:''].filter(Boolean).join(' · '));
      const body=effectReading(event.text,{descriptionParts:event.descriptions,effectIds:event.effectIds});
      const symbols=[...body.querySelectorAll('.effect-inline-icon')].map(icon=>icon.cloneNode(true));
      if(symbols.length)button.append(...symbols);else button.append(el('span',event.text,'support-event-fallback'));
      const amount=event.text.match(/[+−-]\d+(?:\.\d+)?[%％]?/);if(amount&&symbols.length)button.append(el('strong',amount[0],'support-event-amount'));
      if(locked)body.append(el('p',lockedLabel,'small muted'));
      entry.append(supportHint(button,body));
    }
    entry.append(el('span',`${locked?'🔒 ':''}Lv. ${event.unlockLevel}`,'support-event-level'));events.append(entry);
  }
  return events;
}
function supportFace(held,info,immersive=false){
  const face=el('div','','support-face'),art=el('button','','support-art-open');
  art.setAttribute('aria-label',t('查看卡面：{0}',[info.name]));art.onclick=()=>showSupportArt(info);
  art.append(illustration(info.image,info.name,'support-cover'));face.append(art);
  if(immersive)return face;
  const typeName=({Vocal:'vocal',Dance:'dance',Visual:'visual',[t('辅助')]:'assist'})[info.type];
  if(typeName){const type=el('img','','support-type-icon');type.src=uiIconURL(`${typeName}.webp`);type.alt=info.type;face.append(type);}
  const name=el('span',info.name,'support-name');const heading=el('h3','','support-face-title');heading.append(name);face.append(heading);
  const status=el('div','','support-face-status');
  if(['R','SR','SSR'].includes(info.rarity)){const rarity=el('img','','support-rarity-icon');rarity.src=uiIconURL(`rarity-${info.rarity.toLowerCase()}.webp`);rarity.alt=info.rarity;status.append(rarity);}
  else status.append(el('span',info.rarity));
  const level=el('div','','support-face-level');
  level.append(el('strong',isReference(held)?ownershipLabel(held):t('Lv.{0}',[held.level])));
  if(isReference(held))level.append(el('small',t('参考 Lv.1')));
  status.append(level);
  if(!isReference(held))status.append(rankFlowers(held.levelLimitRank));
  face.append(status,el('div','','support-art-events'));return face;
}
function supportEffects(held,target){
  const effects=progressionInfo('supportPreview',held,target);
  const section=el('section','','support-effects');
  if(effects===null){section.append(el('p',t('当前卡片的成长数据未收录，无法预览。'),'muted small'));return section;}
  if(!effects.length)section.append(el('p',t('当前等级尚未解锁支援效果'),'muted small'));
  const list=el('ul','','support-effect-list');
  for(const effect of effects){
    const item=el('li','','support-skill'+(effect.locked?' support-skill-locked':''));item.dataset.skillId=effect.id;
    item.classList.toggle('support-skill-gained',effect.gained);item.classList.toggle('support-skill-lost',effect.lost);
    if(effect.locked){
      const status=el('div','','support-skill-status');
      status.append(el('span',t(effect.lost?'预览未解锁':'未解锁'),'support-skill-state'),el('span',t('Lv.{0} 解锁',[effect.unlockLevel])));
      if(!effect.reference&&effect.requiredRank>held.levelLimitRank)status.append(el('span',t('需要突破 {0}',[effect.requiredRank])));
      item.append(status);
    }else if(effect.gained)item.append(el('div',t('预览解锁'),'support-skill-status'));
    else if(effect.changed&&!effect.numberChanges.length)item.append(el('div',t('效果变化'),'support-skill-status'));
    item.append(effectReading(effect.text,{descriptionParts:effect.descriptionParts,effectIds:effect.effectIds,cardReferences:effect.cardReferences,numberChanges:effect.numberChanges}));list.append(item);
  }
  section.append(list);return section;
}
function levelControls(held,model,value,onChange){
  const controls=el('div','','support-card-controls'),line=el('div','','support-inline-level'),group=el('div','','support-level-controls');
  group.setAttribute('role','group');group.setAttribute('aria-label',t('预览等级'));
  const input=el('input');input.type='number';input.min='1';input.max=String(model.maximum);input.step='1';input.setAttribute('aria-label',t('预览等级'));
  const field=el('label',t('预览等级'),'support-level-value');field.append(input);
  const steps=[],presets=[];
  for(const delta of [-5,-1,1,5]){
    const button=el('button',delta>0?`+${delta}`:`−${-delta}`);button.type='button';button.dataset.levelDelta=String(delta);
    button.setAttribute('aria-label',t(delta>0?'增加 {0} 级':'减少 {0} 级',[Math.abs(delta)]));button.onclick=()=>setLevel(Number(input.value)+delta);
    if(delta===1)group.append(field);group.append(button);steps.push({button,delta});
  }
  const reset=el('button','↺','support-preview-reset');reset.type='button';reset.setAttribute('aria-label',t('还原预览'));reset.title=t('还原预览');reset.onclick=()=>setLevel(held.level);
  line.append(group,reset);controls.append(line);
  const shortcuts=el('div','','support-level-presets');shortcuts.setAttribute('role','group');shortcuts.setAttribute('aria-label',t('快捷等级'));
  for(const limit of model.levelLimits){
    const button=el('button');button.type='button';button.dataset.levelTarget=String(limit.level);button.setAttribute('aria-label',`${t('突破 {0}',[limit.rank])} · Lv. ${limit.level}`);
    const flowers=rankFlowers(limit.rank);flowers.setAttribute('aria-hidden','true');button.append(flowers,el('strong',`Lv. ${limit.level}`));
    button.onclick=()=>setLevel(limit.level);shortcuts.append(button);presets.push({button,level:limit.level});
  }
  controls.append(shortcuts);
  function setLevel(next,notify=true){
    const number=next===''?held.level:Number(next),level=Math.max(1,Math.min(model.maximum,Math.trunc(Number.isFinite(number)?number:held.level)));
    input.value=String(level);reset.disabled=level===held.level;
    for(const {button,delta} of steps)button.disabled=delta<0?level<=1:level>=model.maximum;
    for(const {button,level:target} of presets)button.setAttribute('aria-pressed',String(level===target));
    if(notify)onChange(level);
  }
  input.onchange=()=>setLevel(input.value);setLevel(value,false);return {element:controls,input};
}
export function supportEntry({held,info},{favorite=false,onFavorite=()=>{},favoriteDisabled=false,immersive=false,targetLevel=held.level,onTarget=()=>{}}={}) {
  const row=el('article','','support-card');row.dataset.ownership=held.ownership;row.dataset.supportId=held.supportCardId;row.classList.toggle('unowned-card',isReference(held));
  const favoriteControl=favoriteButton(favorite,onFavorite,favoriteDisabled);
  const social=el('div','','card-social-actions');social.append(shareLinkButton(held.supportCardId,'support'),favoriteControl);
  if(immersive){
    const heading=el('h3',info.name,'support-name');heading.title=info.name;
    const nameRow=el('div','','immersive-card-caption');nameRow.append(heading,social);
    row.append(supportFace(held,info,true),nameRow);return row;
  }
  const model=progressionInfo('support',held);
  const controls=model?levelControls(held,model,targetLevel,level=>{onTarget(level);draw(level);}):null;
  const preview=el('details','','support-level-preview');preview.append(el('summary',t('等级变动预览')));
  const face=supportFace(held,info);
  const summary=el('div','','support-card-meta');summary.append(el('span',`${t('关联角色')}：${info.characters}`,'support-characters'));
  if(Number.isFinite(info.supportChance))summary.append(el('span',t('支援发生率：{0}%（{1}）',[info.supportChance,info.supportAttribute??'—']),'support-chance'));
  const status=el('p','','support-inline-status'),effects=el('div');status.setAttribute('role','status');
  const ownership=collectionState(held);ownership.append(social);row.append(ownership,face,summary);if(controls){preview.append(controls.element);row.append(preview);}row.append(status,effects);
  function draw(level){
    closeRewardPopover();row.dataset.previewLevel=String(level);
    effects.replaceChildren(supportEffects(held,level));
    face.querySelector('.support-art-events').replaceWith(compactEvents(held,info,level));
    status.hidden=level===held.level;
    status.textContent=t(isReference(held)?'参考 Lv.{0} → 预览 Lv.{1}':'当前 Lv.{0} → 预览 Lv.{1}',[held.level,level]);
    const result=progressionInfo('support',held,level);
    if(result&&result.requiredRank>held.levelLimitRank)status.append(el('span',t('需要突破 {0}',[result.requiredRank]),'support-preview-requirement'));
  }
  draw(controls?Number(controls.input.value):held.level);return row;
}
export function focusSupport(held){
  const row=[...document.querySelectorAll('.support-card')].find(card=>card.dataset.supportId===held.supportCardId);
  const preview=row?.querySelector('.support-level-preview');if(preview)preview.open=true;
  (row?.querySelector('input[type=number]')??row?.querySelector('.support-art-open'))?.focus();
}

function showSupportArt(info){
  setCatalogRefresh(()=>showSupportArt(info));
  $('idol-title').textContent=info.name;
  const body=el('div','','support-art-viewer');
  body.append(illustration(info.image,info.name,'support-full'));
  $('idol-content').replaceChildren(body);openCatalogDialog();
}
