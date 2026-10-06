import {tagControls,favoriteButton} from './personal-library.mjs';
import {$,el} from './dom.mjs';
import {stats,protectionBadge,memoryTagBadge,shareLinkButton} from './shared.mjs';
import {foldTitle,sortedMemoryBattleCards,canCompareMemory} from '../domain/memories.mjs';
import {t} from '../i18n.mjs';
import {selectionGrades} from '../domain/selection-memories.mjs';
import {shown,title,shotDate,memoryUse} from '../domain/model.mjs';
import {cardInfo,characterInfo,semanticGroup,abilitySummaries,cardRewardInfo,itemRewardInfo,planLabel,memoryExclusiveSkill} from '../domain/catalog.mjs';
import {characterAccent,characterArt,skillArt,deckArt,skillThumbnailFor,filterSymbol} from './illustrations.mjs';
import {rewardHint} from './card-rewards.mjs';
import {abilityChips} from './ability-view.mjs';
import {semanticSection} from './semantic-view.mjs';
function recordedSkill(card,characterId,phase){
  const reward=cardRewardInfo(card,characterId,{previewVersions:true});
  const hint=reward.versions.length?rewardHint(reward,{label:''},false,'',{recorded:true}):skillThumbnailFor(card,characterId);
  if(reward.versions.length){hint.classList.add('support-art-event','memory-skill-hint');hint.dataset.cardId=card.id;hint.dataset.upgrade=String(card.upgradeCount);}
  const target=hint.querySelector('button')??hint,labels=[];
  const count=(card.customizes??[]).reduce((sum,value)=>sum+value.customizeCount,0);
  if(count){const badge=el('span',String(count),'selection-custom-count');badge.title=t('附魔次数：{0}',[count]);target.append(badge);labels.push(badge.title);}
  if(phase===1){const badge=el('span',t('开局标识'),'memory-start-inherit');badge.title=t('开局继承');badge.setAttribute('role','img');badge.setAttribute('aria-label',badge.title);target.append(badge);labels.push(badge.title);}
  if(labels.length)target.setAttribute('aria-label',`${target.getAttribute('aria-label')??cardInfo(card,characterId).name} · ${labels.join(' · ')}`);
  return hint;
}

function battleLoadout(memory){
  const exclusive=memoryExclusiveSkill(memory);
  const cards=memory.examBattleProduceCards?.filter(card=>card.id!==exclusive?.reference.id),items=memory.examBattleProduceItemIds;
  const section=el('section','','memory-battle');section.setAttribute('aria-label',t('考试配置'));
  const content=el('div','','memory-battle-contents');
  if(items?.length){
    const strip=el('div','','memory-item-strip');strip.setAttribute('aria-label',t('P 道具'));
    for(const id of items){const hint=rewardHint(itemRewardInfo(id),{label:''},false,'');hint.classList.add('support-art-event');strip.append(hint);}
    content.append(strip);
  }
  if(cards?.length){
    const strip=el('div','','memory-skill-strip');strip.setAttribute('aria-label',t('技能卡'));
    for(const card of sortedMemoryBattleCards(cards))strip.append(recordedSkill(card,memory.characterId));content.append(strip);
  }
  section.append(content);return section;
}
// 普通回忆与培养阵容共用继承卡、名称和培养能力布局。
export function memoryInheritance(m,status,{nameRight=false}={}){
  const info=cardInfo(m.produceCard,m.characterId),hero=el('div','','memory-inheritance'),heading=el('div','','memory-inheritance-heading'),name=el('h3',info.name);name.title=info.name;
  const visual=el('div','','memory-inheritance-visual');visual.append(m.produceCard?recordedSkill(m.produceCard,m.characterId,m.produceCardPhaseType):skillThumbnailFor(m.produceCard,m.characterId));if(!nameRight)visual.append(name);hero.append(visual);
  const titleLine=el('div','','memory-inheritance-title');if(nameRight)titleLine.append(name);if(status)titleLine.append(status);heading.append(titleLine);hero.append(heading);
  const abilities=el('section','','memory-abilities');abilities.setAttribute('aria-label',t('培养能力'));
  if(m.abilities===undefined)abilities.append(el('p',t('能力未记录'),'small muted'));else abilities.append(abilityChips(abilitySummaries(m)));
  heading.append(abilities);return hero;
}
export function memoryEntry(m, context) {
  const use=memoryUse(m),hasDeck=canCompareMemory(m);
  const row=characterAccent(el('article','',`memory-row memory-card${context.selected?' selected':''}${context.active?' active':''}`),m.characterId);row.dataset.memoryKey=m.key;row.dataset.memoryUse=use;
  const top=el('div','','memory-card-topline'),identity=el('div','','memory-card-character');
  const exclusive=memoryExclusiveSkill(m),subject=el('div','','memory-card-subject');
  if(exclusive){
    subject.append(recordedSkill(exclusive.reference,m.characterId));
  }else{
    const subjectName=el('span',characterInfo(m.characterId).name,'memory-subject-name');subjectName.title=subjectName.textContent;
    subject.append(characterArt(m.characterId),subjectName);
  }
  identity.append(subject);subject.dataset.subjectKind=exclusive?'skill':'character';
  const plan=el('span','','memory-card-plan'),symbol=filterSymbol(({2:'Plan1',3:'Plan2',4:'Plan3'})[m.planType]);if(symbol)plan.append(symbol);plan.append(el('span',planLabel(m.planType)));const planStats=el('span','','memory-plan-stats');planStats.append(plan);identity.append(planStats);
  if(selectionGrades[m.grade])planStats.append(el('strong',selectionGrades[m.grade],'memory-card-grade'));
  if(hasDeck&&m.power!==undefined){
    const power=el('span','','memory-card-power');
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.classList.add('memory-score-icon');
    const bars=document.createElementNS('http://www.w3.org/2000/svg','path');bars.setAttribute('d','M4 20V13H8V20M10 20V8H14V20M16 20V3H20V20M3 20H21');icon.append(bars);
    power.append(icon,el('span',t('综合 {0}',['']).trim(),'memory-power-label'),el('strong',shown(m.power)));planStats.append(power);
  }
  const check=el('input');check.type='checkbox';check.checked=context.selected;check.setAttribute('aria-label',t('选择{0}进行比较',[title(m)]));check.onchange=()=>context.select(m,check);
  const pick=el('label','','pick');pick.append(check,el('span',t('比较')));
  const date=el('time',shotDate(m),'entry-date');date.title=t('回忆拍摄日期');
  const tools=el('div','','memory-card-tools'),social=el('div','','card-social-actions');social.append(shareLinkButton(m.key,'memory'),favoriteButton(context.favorite??false,context.onFavorite??(()=>{}),context.favoriteDisabled??false));tools.append(date,social);top.append(identity,tools);
  const status=el('div','','memory-card-status');if(m.isProtected)status.append(protectionBadge());
  const gameTag=memoryTagBadge(m);if(gameTag)status.append(gameTag);
  status.append(tagControls(context.tags,context.editTags,context.tagsDisabled,true,context.removeTag));
  const hero=memoryInheritance(m,status);
  const attributes=stats(m);attributes.classList.add('memory-card-stats');attributes.setAttribute('aria-label',t('属性'));
  const values=[m.vocal??0,m.dance??0,m.visual??0],total=values.reduce((sum,value)=>sum+value,0);
  if(total>0){
    const ratio=el('div','','memory-attribute-ratio');ratio.setAttribute('role','img');
    const labels=[];
    for(const [index,value] of values.entries()){
      const percent=value/total*100,label=`${['Vo','Da','Vi'][index]} ${percent.toFixed(1)}%`;
      const segment=el('span','','memory-attribute-segment');segment.style.width=`${percent}%`;segment.title=label;ratio.append(segment);labels.push(label);
    }
    ratio.setAttribute('aria-label',labels.join(' · '));attributes.append(ratio);
  }

  const footer=el('footer','','memory-card-footer');
  if(hasDeck)footer.append(pick);
  row.append(top,hero);if(hasDeck)row.append(attributes);
  if(context.purpose!=='inheritance'&&(m.examBattleProduceCards?.length||m.examBattleProduceItemIds?.length))row.append(battleLoadout(m));
  if(hasDeck)row.append(footer);return row;
}
export function showDetail(m, context) {
  const content = characterAccent($('detail-content'),m.characterId); content.replaceChildren(); $('detail-title').textContent = title(m);
  const hero = el('div', '', 'detail-hero'); hero.append(characterArt(m.characterId),el('span',characterInfo(m.characterId).name,'memory-character'), skillArt(m.produceCard, m.characterId));
  const use=memoryUse(m),hasDeck=Boolean(m.examBattleProduceCards?.length);
  const overview=el('div','','memory-detail-summary');
  if(use!=='unknown')overview.append(el('span',t(use==='training'?'培养专用':'含比赛配置'),'memory-use '+use));
  overview.append(el('span',hasDeck?t('{0} · 综合 {1} · 等级 {2}',[shotDate(m),shown(m.power),shown(m.grade)]):`${shotDate(m)} · ${t('等级')} ${shown(m.grade)}`,'small muted'));
  if(m.isProtected)overview.append(protectionBadge());
  const gameTag=memoryTagBadge(m);if(gameTag)overview.append(gameTag);
  content.append(hero,...(hasDeck?[stats(m)]:[]),overview,
    semanticSection(t('继承卡'),semanticGroup(m,'produceCard'),true),
    semanticSection(foldTitle(t('能力'),m.abilities),semanticGroup(m,'abilities'),true));
  if(use==='training')content.append(el('p',t('活动培养专用回忆，可用于后续培养，不用于 Contest / Tower。'),'memory-use-note'));
  else if(m.examBattleProduceCards?.length||m.examBattleProduceItemIds?.length){
    const battleMemory={...m,examBattleProduceCards:m.examBattleProduceCards===undefined?undefined:sortedMemoryBattleCards(m.examBattleProduceCards)};
    const gallery=el('section','','deck-gallery');gallery.append(el('h3',t('考试配置')),deckArt(battleMemory));content.append(gallery,
      semanticSection(foldTitle(t('考试卡组'),m.examBattleProduceCards),semanticGroup(battleMemory,'examBattleProduceCards')),
      semanticSection(foldTitle(t('考试P道具'),m.examBattleProduceItemIds),semanticGroup(m,'examBattleProduceItemIds')));
  }
  content.append(tagControls(context.tags,context.editTags,context.tagsDisabled,false,context.removeTag)); $('detail-dialog').hidden=false;
}

// 手机全屏详情限制焦点；桌面并排详情保持非模态交互。
const detailMedia=matchMedia('(max-width:599px)');
const detailInertNodes=new Set();
function modalMemoryDetail(){return !$('detail-dialog').hidden&&detailMedia.matches;}
export function syncMemoryDetailFocus(){
  const detail=$('detail-dialog'),modal=modalMemoryDetail();
  detail.setAttribute('role',modal?'dialog':'complementary');
  if(modal)detail.setAttribute('aria-modal','true');else detail.removeAttribute('aria-modal');
  if(modal){
    for(let branch=detail;branch.parentElement&&branch!==document.body;branch=branch.parentElement){
      for(const sibling of branch.parentElement.children){
        if(sibling===branch||['DIALOG','SCRIPT','STYLE'].includes(sibling.tagName)||sibling.inert)continue;
        sibling.inert=true;detailInertNodes.add(sibling);
      }
    }
    if(!detail.contains(document.activeElement)&&!document.querySelector('dialog[open]'))$('detail-title').focus({preventScroll:true});
  }else{
    for(const node of detailInertNodes)node.inert=false;
    detailInertNodes.clear();
  }
}
export function restoreMemoryEntryFocus(key){
  const row=[...document.querySelectorAll('.memory-row')].find(row=>row.dataset.memoryKey===key);
  (row?.querySelector('.entry-main')??$('filter-toggle')).focus();
}
detailMedia.addEventListener('change',syncMemoryDetailFocus);
document.addEventListener('keydown',event=>{
  if(event.key!=='Tab'||!modalMemoryDetail()||document.querySelector('dialog[open]'))return;
  const detail=$('detail-dialog');
  const targets=[...detail.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex]')]
    .filter(node=>node.tabIndex>=0&&!node.matches(':disabled')&&node.getClientRects().length);
  const index=targets.indexOf(document.activeElement);
  if(index<0||(event.shiftKey&&index===0)||(!event.shiftKey&&index===targets.length-1)){
    event.preventDefault();(event.shiftKey?targets.at(-1):targets[0])?.focus();
  }
});
document.addEventListener('focusin',event=>{
  if(modalMemoryDetail()&&!$('detail-dialog').contains(event.target)&&!document.querySelector('dialog[open]'))$('detail-title').focus({preventScroll:true});
});
