import {uiIconURL} from '../resources.mjs';
import {favoriteButton} from './personal-library.mjs';
import {$,el} from './dom.mjs';
import {shareLinkButton,collectionState} from './shared.mjs';
import {setCatalogRefresh,openCatalogDialog} from './catalog-dialog.mjs';
import {t} from '../i18n.mjs';
import {idolInfo,idolArtVariants,isReference,progressionInfo,planLabel,cardRewardInfo,itemRewardInfo} from '../domain/catalog.mjs';
import {illustration,characterAccent,filterSymbol,idolStyleSymbol} from './illustrations.mjs';
import {idolStats,idolSkills} from './progression-view.mjs';
import {rewardHint,closeRewardPopover} from './card-rewards.mjs';

function targetControls(held,initial,onChange){
  const panel=el('div','','idol-preview-controls'),controls=el('div','','idol-stage-controls');panel.hidden=true;panel.append(controls);
  const fields=[],selected={rank:initial.targetRank,potential:initial.targetPotential};
  for(const [kind,label,max] of [['rank',t('预览特训'),initial.maximum],['potential',t('预览开花'),initial.maxPotential]]){
    const group=el('div','','idol-stage-stepper');group.setAttribute('role','group');group.setAttribute('aria-label',label);
    const symbol=el('span','','idol-stage-symbol'),icon=el('img');symbol.title=label;symbol.setAttribute('role','img');symbol.setAttribute('aria-label',label);icon.src=uiIconURL(`idol-${kind==='rank'?'training':'potential'}.webp`);icon.alt='';symbol.append(icon);group.append(symbol);
    const input=el('input');input.type='number';input.min='0';input.max=String(max);input.step='1';input.dataset.stageInput=kind;input.setAttribute('aria-label',label);
    const buttons=[];
    for(const [action,text] of [['min','Min'],['minus','−'],['plus','+'],['max','Max']]){
      const button=el('button',text);button.type='button';button.dataset.stageKind=kind;button.dataset.stageAction=action;button.setAttribute('aria-label',`${label} ${text}`);
      button.onclick=()=>set({...selected,[kind]:action==='min'?0:action==='max'?max:selected[kind]+(action==='plus'?1:-1)});
      if(action==='plus')group.append(input);group.append(button);buttons.push({button,action});
    }
    input.onchange=()=>set({...selected,[kind]:input.value===''?selected[kind]:Math.max(0,Math.min(max,Math.trunc(Number(input.value))))});
    fields.push({input,buttons,kind,max});controls.append(group);
  }
  const reset=el('button',t('还原预览'),'idol-preview-reset');reset.type='button';reset.onclick=()=>set({rank:held.levelLimitRank,potential:held.potentialRank});controls.append(reset);
  function set(next,notify=true){
    Object.assign(selected,next);
    for(const {input,buttons,kind,max} of fields){input.value=String(selected[kind]);for(const {button,action} of buttons)button.disabled=['min','minus'].includes(action)?selected[kind]===0:selected[kind]===max;}
    reset.disabled=selected.rank===held.levelLimitRank&&selected.potential===held.potentialRank;
    if(notify)onChange({...selected});
  }
  set(selected,false);return panel;
}
function idolRewards(held,info,result){
  const dock=el('div','','idol-exclusive-rewards');dock.setAttribute('role','group');dock.setAttribute('aria-label',t('专属奖励'));
  for(const row of result.rewards){
    const reward=row.card?cardRewardInfo(row.card,info.characterId):itemRewardInfo(row.item);
    const cell=el('div','','idol-exclusive-reward support-art-event');cell.classList.toggle('preview-unlocked',row.changed);
    let customization=null;
    if(row.card&&result.customization){
      const reference=result.customization.cards.find(card=>card.id===row.card.id);
      if(reference)customization={...result.customization,cards:[reference]};
    }
    const context=row.scope==='hif-final'?`${t('HIF 本战专用')} · ${row.primaStellaUpgradedTime===undefined?t('解锁状态未采集'):t('升级时间字段：{0}；解锁状态待核对',[row.primaStellaUpgradedTime])}`:row.changed?t('预览变化'):'';
    if(row.scope)cell.dataset.rewardScope=row.scope;
    cell.append(rewardHint(reward,{label:context},false,'',{chooseVersion:false,customization}));
    if(row.scope==='hif-final')cell.append(el('span',t('HIF 本战'),'idol-reward-scope'));
    dock.append(cell);
  }
  return dock;
}
export function idolEntry({held,info},{favorite=false,onFavorite=()=>{},favoriteDisabled=false,immersive=false,target={},onTarget=()=>{},onArt=()=>{}}={}){
  const row=characterAccent(el('article','','idol-card'),info.characterId);row.dataset.idolId=held.idolCardId;row.dataset.ownership=held.ownership;
  const favoriteControl=favoriteButton(favorite,onFavorite,favoriteDisabled);
  const social=el('div','','card-social-actions');social.append(shareLinkButton(held.idolCardId,'idol'),favoriteControl);
  row.classList.toggle('unowned-card',isReference(held));
  const actual={...held,idolCardSkinId:''},variants=idolArtVariants(actual);
  let selectedArt=target.art??idolInfo(actual).variant;
  if(!variants.some(art=>art.id===selectedArt))selectedArt=variants[0]?.id;
  let result=progressionInfo('idolPreview',held,target.rank??held.levelLimitRank,target.potential??held.potentialRank);
  const hero=el('div','','idol-hero'),artwork=el('div','','idol-card-artwork'),artButton=el('button','','idol-art-open');artButton.type='button';
  const artChoices=el('label','','idol-card-art-options'),artToggle=el('input');artToggle.type='checkbox';artToggle.setAttribute('role','switch');artToggle.setAttribute('aria-label',t('特训后卡面'));
  artChoices.append(artToggle,el('span',t('特训后卡面')));
  const caption=el('p','','idol-card-art-caption');
  const persist=()=>onTarget({rank:result?.targetRank??held.levelLimitRank,potential:result?.targetPotential??held.potentialRank,art:selectedArt});
  artToggle.onchange=()=>{selectedArt=artToggle.checked?'upgraded':'base';drawArt();persist();onArt(selectedArt);};
  function drawArt(){
    const art=variants.find(art=>art.id===selectedArt)??{image:info.image,label:info.label};
    artButton.replaceChildren(illustration(art.image,`${info.character} · ${info.name} · ${art.label}`,'idol-art'));
    artButton.setAttribute('aria-label',t('查看卡面：{0}',[info.name]));
    artToggle.checked=selectedArt==='upgraded';
    const locked=art.unlockRank!==undefined&&(isReference(held)||held.levelLimitRank<art.unlockRank);
    caption.textContent=locked?t('特训 {0} 解锁 · 仅预览',[art.unlockRank]):'';caption.hidden=!locked;
  }
  artButton.onclick=()=>showIdolArt(actual,selectedArt,art=>{
    // 语言切换会重建列表，始终通过当前卡片控件同步偏好和图片。
    const current=[...document.querySelectorAll('.idol-card')].find(card=>card.dataset.idolId===held.idolCardId)?.querySelector('.idol-card-art-options input')??artToggle;
    current.checked=art==='upgraded';current.dispatchEvent(new Event('change'));
  });drawArt();
  const imageArea=el('div','','idol-card-image'),overlay=el('div','','idol-card-overlay');imageArea.append(artButton,overlay);artwork.append(imageArea);
  if(variants.length>1)artwork.append(artChoices);artwork.append(caption);
  if(immersive){
    overlay.remove();caption.remove();
    const heading=el('h3',info.name,'idol-name');heading.title=info.name;
    const nameRow=el('div','','immersive-card-caption');nameRow.append(heading,social);
    artwork.insertBefore(nameRow,artChoices.parentElement===artwork?artChoices:null);hero.append(artwork);row.append(hero);return row;
  }
  const identity=el('div','','idol-identity');
  const rarity=el(['R','SR','SSR'].includes(info.rarity)?'img':'span','','idol-rarity');
  if(rarity.tagName==='IMG'){rarity.src=uiIconURL(`rarity-${info.rarity.toLowerCase()}.webp`);rarity.alt=info.rarity;}else rarity.textContent=t('未知');
  const plan=el('div','','idol-plan'),planKind=el('span','','idol-plan-kind'),symbol=filterSymbol(info.plan);planKind.append(el('span',info.plan?planLabel(info.plan):t('未知'),'idol-plan-label'));if(symbol)planKind.prepend(symbol);plan.append(planKind);
  const styles=el('div','','idol-styles');
  // 卡面与筛选都使用卡片主流派，不把技能说明提及的效果当作流派。
  for(const [type,label] of [['ExamParameterBuff','好调'],['ExamLessonBuff','集中'],['ExamReview','好印象'],['ExamCardPlayAggressive','干劲'],['ExamConcentration','强气'],['ExamFullPower','全力']]){
    const value=`ProduceExamEffectType_${type}`;if(info.examEffectType!==value)continue;
    const style=el('span','','idol-style'),icon=idolStyleSymbol(value);style.append(el('span',t(label),'idol-plan-label'));style.dataset.effectType=value;if(icon)style.prepend(icon);styles.append(style);
  }
  if(styles.childElementCount)plan.append(styles);
  const ranks=el('div','','idol-card-ranks');
  for(const [kind,level,label] of [['training',held.levelLimitRank,t('特训')],['potential',held.potentialRank,t('开花')]]){
    const value=held.ownership==='unowned'?'0':held.ownership==='unknown'?'—':String(level),rank=el('span','','idol-art-rank');rank.dataset.rankKind=kind;rank.setAttribute('role','img');rank.setAttribute('aria-label',`${label} ${value}`);rank.title=`${label} ${value}`;
    const icon=el('img');icon.src=uiIconURL(`idol-${kind}.webp`);icon.alt='';rank.append(icon,el('strong',value));ranks.append(rank);
  }
  overlay.append(plan,rarity,ranks);
  const titleRow=el('header','','idol-title-row'),heading=el('h3'),name=el('span',info.name,'idol-name'),previewButton=el('button',t('培养预览'),'idol-preview-toggle');heading.append(name);titleRow.append(heading);previewButton.type='button';previewButton.setAttribute('aria-label',t('培养变动预览'));previewButton.setAttribute('aria-expanded','false');
  const baseline=el('p',isReference(held)?t('参考效果：特训 0 · 开花 0'):t('特训 {0} · 开花 {1}',[held.levelLimitRank,held.potentialRank]),'idol-held-baseline sr-only');
  identity.append(titleRow,baseline);hero.append(artwork,identity);
  const stageContent=el('div','','idol-stage-content'),status=el('p','','idol-inline-status sr-only');status.setAttribute('role','status');
  const controls=result?targetControls(held,result,next=>{result=progressionInfo('idolPreview',held,next.rank,next.potential);persist();draw();}):null;
  const expand=(open,focus=false)=>{if(!controls)return;controls.hidden=!open;previewButton.setAttribute('aria-expanded',String(open));if(open&&focus)controls.querySelector('input')?.focus();};
  previewButton.onclick=()=>expand(controls.hidden);
  if(controls){controls.id=`idol-preview-${held.idolCardId}`;previewButton.setAttribute('aria-controls',controls.id);titleRow.append(previewButton);}
  const ownership=collectionState(held);ownership.append(social);row.append(ownership,hero);
  const upper=el('div','','idol-upper-content'),rewardEffects=el('div','','idol-reward-effects');rewardEffects.append(stageContent);upper.append(rewardEffects);if(controls)upper.append(controls);identity.append(upper);row.append(status);
  function draw(){
    closeRewardPopover();row.dataset.previewRank=String(result?.targetRank??held.levelLimitRank);row.dataset.previewPotential=String(result?.targetPotential??held.potentialRank);
    identity.querySelector('.idol-exclusive-rewards')?.remove();identity.querySelector('.idol-current-stats')?.remove();
    if(!result){stageContent.replaceChildren(el('p',t('当前卡片的成长数据未收录，无法预览。'),'small muted'));status.hidden=true;return;}
    rewardEffects.replaceChildren(idolRewards(held,info,result),stageContent);identity.append(idolStats(result));
    status.hidden=!result.changed;status.textContent=t('当前特训 {0} · 开花 {1} → 预览特训 {2} · 开花 {3}',[held.levelLimitRank,held.potentialRank,result.targetRank,result.targetPotential]);
    if(isReference(held)&&result.changed)status.textContent=t('参考特训 {0} · 开花 {1} → 预览特训 {2} · 开花 {3}',[held.levelLimitRank,held.potentialRank,result.targetRank,result.targetPotential]);
    stageContent.replaceChildren(idolSkills(result));

  }
  draw();return row;
}
export function focusIdol(held){
  const row=[...document.querySelectorAll('.idol-card')].find(card=>card.dataset.idolId===held.idolCardId),controls=row?.querySelector('.idol-preview-controls');
  if(controls){controls.hidden=false;row.querySelector('.idol-preview-toggle')?.setAttribute('aria-expanded','true');controls.querySelector('input')?.focus();}else row?.querySelector('.idol-art-open')?.focus();
}
function showIdolArt(held,selected,onArt){
  setCatalogRefresh(()=>showIdolArt(held,selected,onArt));const info=idolInfo(held),variants=idolArtVariants(held);
  $('idol-title').textContent=info.name;
  const body=el('div','','idol-art-viewer'),image=el('div'),label=el('label','','idol-art-control idol-card-art-options'),toggle=el('input');toggle.type='checkbox';toggle.setAttribute('role','switch');toggle.setAttribute('aria-label',t('特训后卡面'));toggle.checked=selected==='upgraded';
  const caption=el('p','','small muted');label.append(toggle,el('span',t('特训后卡面')));body.append(image);if(variants.length>1)body.append(label);body.append(caption);
  const render=()=>{const art=variants.find(art=>art.id===selected)??{image:info.image,label:info.label};image.replaceChildren(illustration(art.image,`${info.character} · ${info.name} · ${art.label}`,'idol-full'));caption.textContent=art.unlockRank!==undefined&&(isReference(held)||held.levelLimitRank<art.unlockRank)?t('特训 {0} 解锁 · 仅预览',[art.unlockRank]):'';caption.hidden=!caption.textContent;};
  toggle.onchange=()=>{selected=toggle.checked?'upgraded':'base';render();onArt(selected);};render();$('idol-content').replaceChildren(body);openCatalogDialog();
}
