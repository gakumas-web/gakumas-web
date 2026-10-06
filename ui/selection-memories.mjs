import {uiIconURL} from '../resources.mjs';
import {abilityIconPreview} from './ability-view.mjs';
import {groupedAbilityChoices} from '../domain/ability-summary.mjs';
import {groupedInheritanceCardChoices} from '../domain/memories.mjs';
import {tagControls,favoriteButton} from './personal-library.mjs';
import {showSelectionDetails} from './selection-details.mjs';
import {deferVisibleContent} from './deferred-content.mjs';
import {nextChoice} from '../application/view-state.mjs';
import {hifStarRules} from '../domain/hif-star-rules.mjs';
import {$,el,openDialog} from './dom.mjs';
import {t,locale} from '../i18n.mjs';
import {characterInfo,compareCharacterFilters,planLabel,cardInfo,itemArt,cardRewardInfo,itemRewardInfo,semanticGroup,selectionChoiceMetadata,selectionFlowDefinitions,customizeItemInfo} from '../domain/catalog.mjs';
import {missingSelectionRewards,selectionGrades,selectionItemTriggerStatus,sortedSelectionCards,sortedSelectionItems,selectionStarPotential,selectionChoiceOptions,filterSelectionChoices,selectionChoicesForCharacters} from '../domain/selection-memories.mjs';
import {illustration,characterAccent,skillThumbnailFor,itemThumbnail,filterSymbol,idolStyleSymbol} from './illustrations.mjs';
import {protectionBadge,memoryTagBadge,shareLinkButton} from './shared.mjs';
import {supportHint,rewardHint,itemRewardDetails} from './card-rewards.mjs';
import {effectReading} from './effect-view.mjs';
import {semanticContent} from './semantic-view.mjs';
const dateFormats=new Map();
const date=value=>{
  if(!value)return t('未记录');
  const language=locale();
  if(!dateFormats.has(language))dateFormats.set(language,new Intl.DateTimeFormat(language,{year:'numeric',month:'2-digit',day:'2-digit'}));
  return dateFormats.get(language).format(new Date(value));
};
let copyNotice,copyNoticeTimer;
function copySelectionKey(target,m,name){
  const label=t('点击复制唯一标识：{0}',[name]);target.title=label;target.setAttribute('aria-label',label);
  if(target.localName!=='button'){
    target.setAttribute('role','button');target.tabIndex=0;
    target.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();target.click();}});
  }else target.type='button';
  target.classList.add('selection-copy-target');
  target.addEventListener('click',async()=>{
    let message;
    try{await navigator.clipboard.writeText(m.key);message=t('唯一标识已复制，可粘贴到搜索框');}
    catch{message=t('复制失败，请允许浏览器访问剪贴板后重试');}
    if(!copyNotice){copyNotice=el('div','','selection-copy-notice');copyNotice.setAttribute('role','status');document.body.append(copyNotice);}
    clearTimeout(copyNoticeTimer);copyNotice.textContent=message;copyNotice.hidden=false;
    copyNoticeTimer=setTimeout(()=>{copyNotice.hidden=true;},3000);
  });
}
let selectionChoices={cards:[],items:[]};
export function setupSelectionOptions(snapshot){
  const rows=snapshot?.selectionMemories??[];
  $('selection-character').replaceChildren(new Option(t('全部角色'),''),...[...new Set(rows.map(m=>m.characterId))].sort(compareCharacterFilters).map(id=>new Option(characterInfo(id).name,id)));
  $('selection-plan').replaceChildren(new Option(t('全部'),''),...[...new Set(rows.map(m=>m.planType))].sort().map(id=>new Option(planLabel(id),String(id))));
  $('selection-grade').replaceChildren(new Option(t('全部'),''),...[...new Set(rows.map(m=>m.grade))].sort((a,b)=>b-a).map(id=>new Option(selectionGrades[id]??t('未知'),String(id))));
  selectionChoices=selectionChoiceOptions(snapshot);
  for(const [id,values,isCard] of [['selection-skill',selectionChoices.cards,true],['selection-item',selectionChoices.items,false]]){
    $(id).replaceChildren(new Option(t('全部'),''),...values.map(value=>new Option(isCard?`${value.info.name} · ${t('强化')} +${value.reference.upgradeCount}`:value.info.name,value.key)));
  }

}
export function appendChoiceVisual(node,value,isCard){
  const name=isCard?`${value.info.name} · ${value.info.rarity} · ${t('强化')} +${value.reference.upgradeCount}`:value.info.name;
  const source=({idol:'角色专属',support:'支援卡',common:'通用',unknown:'未分类'})[value.metadata.source];
  node.title=`${name} · ${t(source)}`;
  node.querySelector('input')?.setAttribute('aria-label',node.title);
  node.dataset.choiceKind=isCard?'cards':'items';node.classList.toggle('support-skill-trigger',isCard);
  node.append(isCard?skillThumbnailFor(value.reference,value.characterId):itemThumbnail(value.info));
  if(isCard){node.dataset.rarity=value.info.rarity;node.dataset.upgrade=String(value.reference.upgradeCount);}
}

export function openSelectionPicker(view,key,values,isCard,onChange){
  const dialog=$('selection-picker'),list=$('selection-picker-list');
  dialog.classList.remove('ability-picker');dialog.querySelector('.selection-picker-filters').hidden=false;
  for(const id of ['selection-picker-plan','selection-picker-flow'])$(id).closest('label').hidden=key==='skill';
  let draft=[...view[key]];
  $('selection-picker-title').textContent=t(key==='skill'?'选择继承技能卡':key==='memoryExamSkill'?'选择考试技能卡':key==='memoryExamItem'?'选择考试 P 道具':isCard?'筛选回忆包含的技能卡':'筛选回忆包含的 P 道具');
  const plans=['Plan1','Plan2','Plan3','Common'].filter(plan=>values.some(value=>value.metadata.plan===plan));
  $('selection-picker-plan').replaceChildren(new Option(t('全部'),''),...plans.map(plan=>new Option(plan==='Common'?t('通用'):planLabel(plan),plan)));
  const flows=selectionFlowDefinitions.filter(flow=>values.some(value=>value.metadata.flows.includes(flow.id)));
  $('selection-picker-flow').replaceChildren(new Option(t('全部'),''),...flows.map(flow=>new Option(t(flow.label),flow.id)));
  if(values.some(value=>!value.metadata.flows.length))$('selection-picker-flow').append(new Option(t('未分类'),'unclassified'));
  $('selection-picker-rarity').replaceChildren(new Option(t('全部'),''),...['LEGEND','SSR','SR','R','N'].filter(rarity=>values.some(value=>value.metadata.rarity===rarity)).map(rarity=>new Option(rarity,rarity)));
  function draw(){
    list.replaceChildren();
    const filtered=filterSelectionChoices(values,{plan:$('selection-picker-plan').value,flow:$('selection-picker-flow').value,rarity:$('selection-picker-rarity').value});
    const groups=isCard?{idol:'角色专属',support:'支援卡',common:'通用',unknown:'未分类'}:{idol:'角色专属','support-battle':'支援卡 · 比赛继承','support-training':'支援卡 · 仅培养','support-unknown':'支援卡 · 用途待确认',common:'通用',unknown:'未分类'};
    if(key==='memoryExamItem'){delete groups['support-training'];delete groups.common;}
    const sections=key==='skill'?groupedInheritanceCardChoices(filtered).map(group=>({source:group.id,title:group.flows.length?group.id==='concentration+fullPower'?t('全力／温存'):group.flows.map(id=>t(selectionFlowDefinitions.find(flow=>flow.id===id).label)).join('／'):group.plan==='Common'?t('通用'):['Plan1','Plan2','Plan3'].includes(group.plan)?t('{0} 通用',[planLabel(group.plan)]):t('未分类'),matches:group.values})):
      Object.entries(groups).map(([source,title])=>({source,title:t(title),matches:filtered.filter(value=>(!isCard&&value.metadata.source==='support'?`support-${value.metadata.use}`:value.metadata.source)===source)}));
    for(const {source,title,matches} of sections){
      if(source.includes('unknown')&&!matches.length)continue;
      const column=el('section','','selection-source-column'),heading=el('h3',title),options=el('div','','selection-source-options');column.dataset.source=source;
      heading.append(el('span',String(matches.length),'selection-source-count'));column.append(heading,options);
      for(const value of matches){
        const label=el('label','','selection-filter-choice'),input=el('input');input.type='checkbox';input.checked=draft.includes(value.key);input.value=value.key;
        label.dataset.value=value.key;appendChoiceVisual(label,value,isCard);input.setAttribute('aria-label',label.title);label.append(input);
        input.onchange=()=>{draft=nextChoice(draft,value.key);};options.append(label);
      }
      if(!matches.length)options.append(el('p',t('没有匹配选项'),'selection-picker-empty'));
      list.append(column);
    }
    if(!sections.length)list.append(el('p',t('没有匹配选项'),'selection-picker-empty'));
    list.scrollTop=0;
  }
  for(const id of ['selection-picker-plan','selection-picker-flow','selection-picker-rarity'])$(id).onchange=draw;
  draw();
  $('selection-picker-clear').onclick=()=>{draft=[];for(const input of list.querySelectorAll('input'))input.checked=false;};
  $('selection-picker-cancel').onclick=()=>dialog.close();
  $('selection-picker-confirm').onclick=()=>{
    // 确认应用项目多选；继承技能卡固定匹配任一项，其它分组由外部开关控制。
    dialog.close();onChange(key,draft);
  };
  openDialog(dialog);list.scrollTop=0;
}
export function renderSelectionChoices(view,onChange){renderLoadoutChoices(view,onChange);}
export function renderLoadoutChoices(view,onChange,{prefix='selection',skillKey='selectionSkill',itemKey='selectionItem',choices=selectionChoices,characters=view.selectionCharacter}={}){
  const both=view[skillKey].length>0&&view[itemKey].length>0;
  $(prefix+'-loadout-and').hidden=!both;$(prefix+'-loadout-expression').classList.toggle('has-both-groups',both);
  for(const [containerId,key,values,isCard,openId] of [[prefix+'-skill-list',skillKey,choices.cards,true,prefix+'-skill-open'],[prefix+'-item-list',itemKey,choices.items,false,prefix+'-item-open']]){
    const container=$(containerId),focused=document.activeElement?.closest(`#${containerId} button`)?.dataset.value;
    $(openId).onclick=()=>openSelectionPicker(view,key,selectionChoicesForCharacters(values,characters),isCard,onChange);
    container.replaceChildren();container.hidden=!view[key].length;
    const selected=values.filter(value=>view[key].includes(value.key));
    if(selected.length>1)container.append(el('span','(','filter-logic-bracket'));
    for(const [index,value] of selected.entries()){
      if(index)container.append(el('span',key!=='skill'&&view[key+'All']?'AND':'OR','filter-logic-operator'));
      const button=el('button','','selection-filter-choice');button.type='button';button.dataset.value=value.key;
      appendChoiceVisual(button,value,isCard);button.append(el('span','×','choice-check'));
      const name=isCard?`${value.info.name} · ${t('强化')} +${value.reference.upgradeCount}`:value.info.name;
      button.setAttribute('aria-label',t('移除筛选：{0}',[name]));
      button.onclick=()=>{onChange(key,nextChoice(view[key],value.key));$(openId).focus({preventScroll:true});};container.append(button);
      if(focused===value.key)button.focus({preventScroll:true});
    }
    if(selected.length>1)container.append(el('span',')','filter-logic-bracket'));
  }
}
export function selectionCapacity(snapshot){
  const box=$('selection-capacity');box.replaceChildren();
  if(!snapshot){box.append(el('p',t('尚未采集选拔回忆，请导入独立快照。')));return;}
  if(snapshot.eventExpiredSelectionMemoryIds.length)box.append(el('p',t('快照标记已过期 {0} 条；仍在列表中的条目会显示过期标记。',[snapshot.eventExpiredSelectionMemoryIds.length]),'small muted'));
}
function starPotential(memory){
  const block=el('section','','selection-star'),estimate=selectionStarPotential(memory);
  const track=el('div','','selection-star-track'),current=el('button','','selection-star-current');
  const maximum=Number.isFinite(hifStarRules.finalCap)&&hifStarRules.finalCap>0?hifStarRules.finalCap:Math.max(1,memory.star);
  const currentWidth=Math.min(100,memory.star/maximum*100);
  current.type='button';current.style.width=`${currentWidth}%`;current.setAttribute('aria-label',`${t('スター性')} ${memory.star}`);
  supportHint(current,()=>el('p',`${t('スター性')} ${memory.star}`),{container:block,followPointer:true});
  track.append(current);
  const conditions=(remainingOnly=false)=>{
    const body=el('div','','selection-star-estimate'),headline=el('div','','star-estimate-head');
    const headlineValues=remainingOnly?[[t('剩余可增加上限'),`+${estimate.remaining}`]]:[[t('当前'),estimate.current],[t('预计上限'),estimate.final]];
    headline.classList.toggle('remaining-only',remainingOnly);
    for(const [label,value] of headlineValues){
      const cell=el('div');cell.append(el('small',label),el('strong',String(value)));headline.append(cell);
    }
    const item=el('section','','star-estimate-group'),itemTitle=el('div','','star-estimate-total');
    itemTitle.append(el('span',t('道具余量')),el('strong',`+${estimate.itemGain}`));
    item.append(itemTitle,el('p',t('{0} · 剩余 {1} 次',[hifStarRules.item.name,estimate.charges]),'star-estimate-note'));
    const battle=el('section','','star-estimate-group'),battleTitle=el('div','','star-estimate-total'),breakdown=el('div','','selection-star-breakdown');
    battleTitle.append(el('span',t('本战奖励')),el('strong',`+${estimate.battleGain}`));
    for(const [label,gain] of [[t('SP 课程'),estimate.spGain],...estimate.roundGains.map((gain,index)=>[t('第 {0} 轮试验',[index+1]),gain])]){
      const row=el('div');row.append(el('span',label),el('span',`+${gain}`));breakdown.append(row);
    }
    battle.append(battleTitle,breakdown);body.append(headline,item,battle);
    if(estimate.current+estimate.itemGain+estimate.battleGain>hifStarRules.finalCap)body.append(el('p',t('受上限限制，最多再增加 {0}',[estimate.remaining]),'star-estimate-cap'));
    body.append(el('p',t('已计入亲爱度加成 ×{0} · 理论上限 {1}',[hifStarRules.bonusMultiplier,hifStarRules.finalCap]),'star-estimate-note star-estimate-footnote'));return body;
  };
  if(estimate&&estimate.remaining>0){
    const remaining=el('button','','selection-star-remaining');remaining.type='button';remaining.style.left=`${currentWidth}%`;remaining.style.width=`${estimate.remaining/maximum*100}%`;
    remaining.setAttribute('aria-label',`${t('剩余最多')} +${estimate.remaining} · ${t('估算条件')}`);
    supportHint(remaining,()=>conditions(true),{container:block,followPointer:true});track.append(remaining);
  }
  const value=el(estimate?'button':'strong',String(estimate?.final??'—'),'selection-star-final');value.title=estimate?t('预计最终上限'):t('规则停用、配置无效或道具计数无法核对，暂不估算剩余量。');
  if(estimate){value.type='button';value.setAttribute('aria-label',`${t('预计最终上限')} ${estimate.final} · ${t('估算条件')}`);supportHint(value,conditions,{container:block});}
  block.append(el('span',t('スター性'),'selection-star-label'),track,value);return block;
}
function selectionAttributes(entry){
  const m=entry.memory,maximum=entry.attributeMaximum??Math.max(1,m.vocal,m.dance,m.visual);
  const block=el('section','','selection-attributes');block.setAttribute('aria-label',t('属性'));
  const heading=el('div','','selection-attribute-heading');heading.append(el('span',t('属性')),el('span',t('成长率')));heading.firstElementChild.title=t('色条按当前快照的三围最大值统一缩放，不代表培养上限。');block.append(heading);
  for(const [label,key,growth] of [['Vo','vocal','vocalGrowthRatePermil'],['Da','dance','danceGrowthRatePermil'],['Vi','visual','visualGrowthRatePermil']]){
    const row=el('div','','selection-attribute');row.dataset.attribute=label;
    const track=el('span','','selection-attribute-track'),fill=el('span','','selection-attribute-fill');fill.style.width=`${m[key]/maximum*100}%`;track.append(fill);track.setAttribute('aria-hidden','true');
    const rate=el('span',`${(m[growth]/10).toFixed(1)}%`,'selection-attribute-growth');rate.setAttribute('aria-label',`${label} ${t('成长率')} ${(m[growth]/10).toFixed(1)}%`);
    row.append(el('span',label),track,el('strong',String(m[key])),rate);block.append(row);
  }
  const totals=el('div','','selection-attribute-totals');
  totals.append(el('span',t('合计'),'selection-total-label'),el('strong',String(m.vocal+m.dance+m.visual),'selection-total-value'),el('span',`${t('体力')} ${m.stamina}`,'selection-stamina'));
  block.append(totals);return block;
}
function selectionHero(entry,collapsed,{detail,favorite=false,onFavorite=()=>{},favoriteDisabled=false,tags=[],editTags,removeTag,tagsDisabled=false}={}){
  const {memory:m,info,expired}=entry,hero=el('div','','selection-hero');
  const artwork=el('div','','selection-artwork'),art=el('div','','selection-memory-portrait');
  art.append(illustration(info.image,info.name,'selection-memory-art',{characterId:m.characterId}));artwork.append(art);copySelectionKey(artwork,m,info.name);
  const overlay=el('div','','selection-art-overlay'),plan=el('span','','selection-art-plan'),symbol=filterSymbol(({2:'Plan1',3:'Plan2',4:'Plan3'})[m.planType]);
  const planKind=el('span','','idol-plan-kind');if(symbol)planKind.append(symbol);planKind.append(el('span',planLabel(m.planType)));plan.append(planKind);
  for(const [type,label] of [['ExamParameterBuff','好调'],['ExamLessonBuff','集中'],['ExamReview','好印象'],['ExamCardPlayAggressive','干劲'],['ExamConcentration','强气'],['ExamFullPower','全力']]){
    const value=`ProduceExamEffectType_${type}`;if(info.examEffectType!==value)continue;
    const style=el('span','','idol-style'),icon=idolStyleSymbol(value);style.dataset.effectType=value;if(icon)style.append(icon);style.append(el('span',t(label)));plan.append(style);
  }
  overlay.append(plan,el('strong',selectionGrades[m.grade]??t('未知'),'selection-art-grade'));
  const ranks=el('div','','selection-art-ranks');
  for(const [kind,label,value] of [['training','特训',m.idolCardLevelLimitRank],['potential','开花',m.idolCardPotentialRank]]){
    const rank=el('span'),icon=el('img');icon.src=uiIconURL(`idol-${kind}.webp`);icon.alt='';rank.title=`${t(label)} ${value}`;rank.setAttribute('aria-label',rank.title);icon.setAttribute('aria-hidden','true');rank.append(icon,el('b',String(value)));ranks.append(rank);
  }
  overlay.append(ranks);artwork.append(overlay);
  const identity=el('div','','selection-identity'),heading=el('h3','','selection-card-name'),nameButton=el('button',info.name,'selection-name-copy');
  heading.append(nameButton,tagControls(tags,editTags,tagsDisabled,true,removeTag));copySelectionKey(nameButton,m,info.name);
  const eyebrow=el('div','','selection-card-eyebrow');const time=el('time',date(m.clearedTime),'selection-cleared-time');time.title=t('培养完成：{0}',[date(m.clearedTime)]);if(m.clearedTime)time.dateTime=new Date(m.clearedTime).toISOString();const tools=el('div','','memory-card-tools'),social=el('div','','card-social-actions');social.append(shareLinkButton(m.key,'selection-memory'),favoriteButton(favorite,onFavorite,favoriteDisabled));tools.append(time,social);eyebrow.append(tools);
  const badges=el('div','','selection-memory-badges');if(m.isProtected)badges.append(protectionBadge());const gameTag=memoryTagBadge(m);if(gameTag)badges.append(gameTag);if(expired)badges.append(el('span',t('已过期'),'badge'));if(m.isPrimaStella)badges.append(el('span','Prima Stella','badge'));eyebrow.prepend(heading,badges);identity.append(eyebrow,starPotential(m));
  hero.append(artwork,identity,selectionAttributes(entry),selectionLoadout(entry,collapsed,detail));return hero;
}
function customizeItemContent(item){
  const info=customizeItemInfo(item.id),effect=el('div');
  if(info.resolved)effect.append(effectReading(info.text,{descriptionParts:info.descriptionParts,effectIds:info.effectIds}));
  else effect.append(el('p',t('附魔道具组合暂未接入名称与效果目录，以下保留采集记录。'),'small muted'),el('code',item.id));
  const block=itemRewardDetails(info,{effectContent:effect});block.classList.add('selection-customize-item');block.dataset.customizeItemId=item.id;
  if(info.resolved&&!info.image&&info.images.length){
    const parts=el('details','','selection-customize-parts'),strip=el('div','','selection-customize-images');parts.append(el('summary',t('外观部件')));
    for(const [index,image] of info.images.entries())strip.append(illustration(image,t('外观部件 {0}',[index+1]),'customize-item-part'));
    parts.append(strip);block.append(parts);
  }
  return block;
}
function selectionLoadout(entry,collapsed,detail){
  const section=el('details','','selection-loadout'),memory=entry.memory;
  section.append(el('summary',t('P 道具 {0} · 技能卡合计 {1}',[memory.produceItems.length+memory.produceCustomizeItems.length,memory.produceCards.length])));
  let rendered=false,initialToggle=!collapsed;
  let placeholder;
  const render=()=>{
    if(!section.open||rendered)return;
    placeholder?.remove();section.append(selectionPreview(entry));rendered=true;section.removeAttribute('aria-busy');
  };
  section.addEventListener('toggle',()=>{if(initialToggle){initialToggle=false;return;}render();});
  section.open=!collapsed;
  if(!collapsed){
    // 按真实卡组数量占位，滚入附近后逐卡创建缩略图与浮层；默认展开偏好保持不变。
    placeholder=el('div','','selection-preview-dock selection-preview-placeholder');placeholder.setAttribute('aria-hidden','true');
    for(const [key,count] of [['items',memory.produceItems.length+memory.produceCustomizeItems.length],['cards',memory.produceCards.length]]){
      const group=el('section','','selection-preview-section'),strip=el('div','','selection-preview-strip');group.dataset.selectionGroup=key;
      for(let i=0;i<Math.max(1,count);i++)strip.append(el('span','','selection-preview-skeleton'));
      group.append(strip);placeholder.append(group);
    }
    section.append(placeholder);section.setAttribute('aria-busy','true');deferVisibleContent(section,render);
  }
  const group=el('div','','selection-loadouts');group.append(section,missingRewardsPreview(memory,detail,collapsed));return group;
}
function missingRewardsPreview(memory,detail,collapsed){
  const block=el('details','','selection-loadout selection-missing-rewards'),missing=missingSelectionRewards(memory,detail);
  block.open=!collapsed;
  if(missing===null){block.append(el('summary',t('未取得 · 阵容未采集')),el('p',t('未采集培养阵容，暂无法计算未取得项。'),'small muted'));return block;}
  block.append(el('summary',t('未取得 · P 道具 {0} · 支援技能卡 {1}',[missing.filter(row=>row.kind==='items').length,missing.filter(row=>row.kind==='cards').length]),'selection-missing-title'));
  const dock=el('div','','selection-preview-dock');
  for(const kind of ['items','cards']){
    const section=el('section','','selection-preview-section'),strip=el('div','','selection-preview-strip');section.dataset.selectionGroup=kind;
    section.setAttribute('aria-label',t(kind==='items'?'未取得 P 道具':'未取得支援技能卡'));
    for(const {value} of missing.filter(row=>row.kind===kind)){
      const reward=kind==='cards'?cardRewardInfo(value,memory.characterId,{previewVersions:true}):itemRewardInfo(value.id);
      const hint=rewardHint(reward,{label:''},false,'',{chooseVersion:kind==='cards',recorded:kind==='cards',customization:null});
      hint.classList.add('support-art-event');const button=hint.querySelector('button');button.classList.add('selection-preview-trigger');button.dataset.entryId=value.id;button.dataset.entryKind=kind;
      button.setAttribute('aria-label',`${t('未取得')} · ${reward.name}`);strip.append(hint);
    }
    section.append(strip);dock.append(section);
  }
  block.append(dock);return block;
}
function selectionPreview(entry){
  const m=entry.memory,dock=el('div','','selection-preview-dock');
  const entries=(values,kind)=>values.map(value=>({value,kind}));
  for(const [key,label,values] of [['items','P 道具',sortedSelectionItems(m)],['cards','技能卡',entries(sortedSelectionCards(m.produceCards),'cards')]]){
    const section=el('section','','selection-preview-section');section.dataset.selectionGroup=key;
    section.setAttribute('aria-label',t(label));
    const strip=el('div','','selection-preview-strip');
    for(const {value,kind} of values){
      const isCard=kind==='cards',isCustom=kind==='customs',info=isCard?cardInfo(value,m.characterId):isCustom?customizeItemInfo(value.id):itemArt(value.id);
      const hint=isCustom?supportHint(el('button','','selection-preview-trigger'),()=>customizeItemContent(value)):rewardHint(isCard?cardRewardInfo(value,m.characterId,{previewVersions:true}):itemRewardInfo(value.id),{label:''},false,'',{chooseVersion:isCard,recorded:isCard,customization:null});
      hint.classList.add('support-art-event');
      const button=hint.querySelector('button');button.classList.add('selection-preview-trigger');
      button.dataset.entryId=value.id;button.dataset.entryKind=kind;
      if(isCard)button.dataset.upgrade=String(value.upgradeCount);
      button.setAttribute('aria-label',[info.name,isCard?`${t('强化')} +${value.upgradeCount}`:'',value.fromMemory?t('来自回忆'):''].filter(Boolean).join(' · '));
      if(isCustom){button.classList.add('support-reward-trigger');button.dataset.rewardKind='item';const art=el('span','','support-reward-art');art.append(itemThumbnail(info));button.append(art);}
      const metadata=isCard?selectionChoiceMetadata('card',value):isCustom?null:selectionChoiceMetadata('item',value);
      if(metadata?.ownerCharacterId){characterAccent(hint,metadata.ownerCharacterId);hint.style.setProperty('--reward-border-color','var(--character-color)');}
      if(isCard){const count=value.customizes.reduce((sum,c)=>sum+c.customizeCount,0);if(count){const badge=el('span',String(count),'selection-custom-count');badge.title=t('附魔次数：{0}',[count]);button.append(badge);button.setAttribute('aria-label',`${button.getAttribute('aria-label')} · ${badge.title}`);}if(value.fromMemory){const badge=el('span','M','selection-from-memory');badge.title=t('来自回忆');button.append(badge);}}
      if(!isCard&&(isCustom?info.use:selectionChoiceMetadata('item',value).use)==='training'){
        const triggered=el('span',String(value.triggerCount),'selection-item-triggered');triggered.title=t('已触发 {0} 次',[value.triggerCount]);button.append(triggered);
        button.setAttribute('aria-label',`${button.getAttribute('aria-label')} · ${triggered.title}`);
        const description=isCustom?info.text??'':semanticGroup({examBattleProduceItemIds:[value.id]},'examBattleProduceItemIds').entries.map(entry=>entry.sourceText??'').join('\n');
        const {remaining}=selectionItemTriggerStatus(value,description);
        if(remaining!==null){
          button.classList.toggle('selection-item-exhausted',remaining===0);
          const badge=el('span',String(remaining),'selection-item-remaining');badge.title=t('剩余可触发 {0} 次',[remaining]);button.append(badge);
          button.setAttribute('aria-label',`${button.getAttribute('aria-label')} · ${badge.title}`);
        }
      }
      strip.append(hint);
    }
    if(!values.length)strip.append(el('span',t('无'),'small muted'));
    section.append(strip);dock.append(section);
  }
  return dock;
}
export function selectionMemoryEntry(entry,{collapsed=true,detail,tags=[],editTags,removeTag,tagsDisabled=false,favorite=false,onFavorite=()=>{},favoriteDisabled=false}={}){
  const {memory:m}=entry,row=characterAccent(el('article','','selection-memory-card'),m.characterId);row.dataset.selectionKey=m.key;
  const hero=selectionHero(entry,collapsed,{detail,favorite,onFavorite,favoriteDisabled,tags,editTags,removeTag,tagsDisabled}),artwork=hero.querySelector('.selection-artwork'),column=el('div','','selection-artwork-column');
  const actions=el('div','','selection-link-actions'),details=el('button',t('培养阵容'),'selection-details-button');details.type='button';details.onclick=()=>showSelectionDetails(detail,m);actions.append(details);
  artwork.replaceWith(column);column.append(artwork,actions);row.append(hero);
  return row;
}

function abilityVisual(target,value){
  const image=el('span','','ability-choice-preview');image.append(abilityIconPreview(value.summary));target.append(image);target.title=value.text;
}
function openAbilityPicker(view,values,onChange){
  const dialog=$('selection-picker'),list=$('selection-picker-list');let draft=[...view.ability];
  dialog.classList.add('ability-picker');dialog.querySelector('.selection-picker-filters').hidden=true;
  $('selection-picker-title').textContent=t('选择培养能力');$('selection-picker-title').append(el('small',t('同组任一满足，不同组同时满足'),'ability-matching-rule'));list.replaceChildren();
  for(const group of groupedAbilityChoices(values,locale())){
    const section=el('section','','selection-source-column ability-picker-group'),heading=el('h3',t(group.label)),options=el('div','','ability-picker-options');section.dataset.abilityGroup=group.id;
    heading.append(el('span',String(group.values.length),'selection-source-count'));section.append(heading,options);
    for(const value of group.values){
      const label=el('label','','ability-picker-choice'),input=el('input');input.type='checkbox';input.value=value.key;input.checked=draft.includes(value.key);input.setAttribute('aria-label',value.text);
      abilityVisual(label,value);label.append(input);input.onchange=()=>{draft=nextChoice(draft,value.key);};options.append(label);
    }
    list.append(section);
  }
  if(!values.length)list.append(el('p',t('没有匹配选项'),'selection-picker-empty'));
  $('selection-picker-clear').onclick=()=>{draft=[];for(const input of list.querySelectorAll('input'))input.checked=false;};
  $('selection-picker-cancel').onclick=()=>dialog.close();
  $('selection-picker-confirm').onclick=()=>{dialog.close();onChange('ability',draft);};
  openDialog(dialog);list.scrollTop=0;
}
export function renderInheritanceChoices(view,choices,onChange){
  const both=view.skill.length>0&&view.ability.length>0;$('inheritance-and').hidden=!both;$('inheritance-expression').classList.toggle('has-both-groups',both);
  for(const [key,values] of [['skill',choices.inheritanceCards],['ability',choices.abilities]]){
    const opener=$('inheritance-'+key+'-open'),list=$('inheritance-'+key+'-list');
    opener.onclick=()=>key==='skill'?openSelectionPicker(view,key,values,true,onChange):openAbilityPicker(view,values,onChange);
    list.replaceChildren();list.hidden=!view[key].length;
    const selected=values.filter(value=>view[key].includes(value.key));
    const clauses=key==='ability'?groupedAbilityChoices(selected,locale()).map(group=>group.values):[selected];
    for(const [groupIndex,clause] of clauses.entries()){
      if(groupIndex)list.append(el('span','AND','filter-logic-operator'));
      if(clause.length>1)list.append(el('span','(','filter-logic-bracket'));
      for(const [index,value] of clause.entries()){
        if(index)list.append(el('span','OR','filter-logic-operator'));
        const button=el('button','','selection-filter-choice');button.type='button';button.dataset.value=value.key;
        if(key==='skill')appendChoiceVisual(button,value,true);else abilityVisual(button,value);
        button.append(el('span','×','choice-check'));button.setAttribute('aria-label',t('移除筛选：{0}',[key==='skill'?value.info.name:value.text]));
        button.onclick=()=>{onChange(key,nextChoice(view[key],value.key));opener.focus({preventScroll:true});};list.append(button);
      }
      if(clause.length>1)list.append(el('span',')','filter-logic-bracket'));
    }
  }
}
