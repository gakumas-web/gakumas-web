import {assetURL,uiIconURL} from '../resources.mjs';
import {el} from './dom.mjs';
import {collectionState} from './shared.mjs';
import {supportHint} from './card-rewards.mjs';
import {t} from '../i18n.mjs';
import {achievementEntries,achievementCharacterIds,characterInfo,idolInfo,collectionRecords} from '../domain/catalog.mjs';
import {characterAccent,characterArt,illustration} from './illustrations.mjs';
import {achievementEntry,cardAchievementIcon,stageHint} from './achievements.mjs';
import {endingBadges} from './ending-rewards.mjs';
import {characterQuotes} from './character-quotes.mjs';
import {watchImage} from './image-loading.mjs';
import {portraitLayout,tallestPortrait} from './character-portrait-layout.mjs';

import {achievementOwner,achievementDetailScope,achievementSummary,mergeCardAchievements,achievedCardStage} from '../domain/achievements.mjs';
const entryName=id=>id==='nasr'?t('共通成就'):characterInfo(id).name;
function entryFace(id){
  const art=characterArt(id);
  const image=art.querySelector('img');if(image)image.loading='eager';
  if(id==='nasr'){art.title=t('共通成就');const image=art.querySelector('img');if(image)image.alt=t('共通成就');}
  return art;
}
function portrait(id,eager=false){
  let frame;
  if(id==='nasr'){
    frame=characterArt(id,true,{fullResolution:true});const img=el('img');img.hidden=true;img.src=uiIconURL('neo-asari-full.png');img.alt=entryName(id);
    watchImage(img,()=>{frame.querySelector('.art-fallback').hidden=true;},()=>{frame.querySelector('.art-fallback').hidden=false;});frame.prepend(img);
  }else frame=characterArt(id,true,{fullResolution:true});
  if(eager){const image=frame.querySelector('img');if(image){image.loading='eager';image.fetchPriority='high';}}
  const layout=portraitLayout(id);
  if(layout){frame.classList.add('normalized-portrait');frame.style.setProperty('--portrait-image-height',`${layout.height*100}%`);frame.style.setProperty('--portrait-image-top',`${layout.top*100}%`);}
  return frame;
}
function profileSignature(id,name){
  const bounds=characterQuotes[id]?.signature,source=characterInfo(id).signature;
  if(!bounds||!source)return null;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.classList.add('character-profile-signature');svg.setAttribute('viewBox',`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);svg.setAttribute('preserveAspectRatio','xMaxYMax meet');svg.setAttribute('role','img');svg.setAttribute('aria-label',t('{0}的签名',[name]));
  const image=document.createElementNS(ns,'image');image.setAttribute('href',assetURL(source));image.setAttribute('width',bounds.w);image.setAttribute('height',bounds.h);svg.append(image);return svg;
}
function masterProgress(entry){
  const value=entry.record?.progress??0,target=(entry.stages.find(stage=>stage.threshold>value)??entry.stages.at(-1))?.threshold??0;
  const group=el('div','','character-master-progress'),row=el('div','','character-master-meter'),star=el('span','★'),track=el('span','','character-master-track'),fill=el('span','','character-master-fill');
  star.setAttribute('aria-hidden','true');track.setAttribute('role','progressbar');track.setAttribute('aria-label',entry.name);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax',String(target));track.setAttribute('aria-valuenow',String(Math.min(value,target)));track.setAttribute('aria-valuetext',`${value}/${target}`);
  const numbers=el('span','','character-master-value');numbers.append(el('span',String(value)),el('span',`/${target}`));
  fill.style.width=`${target>0?Math.min(100,value/target*100):0}%`;track.append(fill);row.append(star,track,numbers);group.append(cardAchievementIcon(entry,group),row);return group;
}
export function renderAchievementBrowser(root,{snapshot,view,ready,change}){
  root.style.setProperty('--portrait-card-ratio',`1280 / ${tallestPortrait+160}`);
  const all=achievementEntries(snapshot,{achievementSection:'achievement'}),endings=achievementEntries(snapshot,{achievementSection:'ending'}),byId=new Map(endings.map(row=>[row.characterId,row]));
  const roster=achievementCharacterIds(),owner=achievementOwner;
  const selected=roster.includes(view.achievementCharacter)?view.achievementCharacter:'',focus=roster.includes(view.achievementFocus)?view.achievementFocus:roster[0];
  const navigate=id=>{view.achievementFocus=id||selected||focus;view.achievementCharacter=id;view.page=0;change();if(id){root.querySelector('.character-detail-title')?.focus({preventScroll:true});root.scrollIntoView({block:'start'});}else{const portal=root.querySelector(`[data-character-portal="${view.achievementFocus}"]`);portal?.focus({preventScroll:true});portal?.scrollIntoView({block:'start',inline:'center'});}};
  const nav=el('nav','','character-quick-nav');nav.setAttribute('aria-label',t('快速切换角色'));
  let alignmentFrame;
  const centerNavigation=()=>{
    cancelAnimationFrame(alignmentFrame);
    alignmentFrame=requestAnimationFrame(()=>{alignmentFrame=requestAnimationFrame(()=>{
      if(!nav.isConnected)return;
      const active=nav.querySelector('[aria-current="true"]');if(active)nav.scrollLeft=active.offsetLeft-nav.offsetLeft-(nav.clientWidth-active.clientWidth)/2;
    });});
  };
  let anchored=false;
  const mark=id=>{view.achievementFocus=id;for(const portal of root.querySelectorAll('[data-character-portal]'))portal.tabIndex=portal.dataset.characterPortal===id?0:-1;for(const button of nav.children)button.setAttribute('aria-current',String(button.dataset.characterTarget===id));centerNavigation();};
  const locate=id=>{anchored=true;mark(id);const tile=root.querySelector(`[data-character-portal="${id}"]`);if(!tile)return;if(matchMedia('(max-width:760px)').matches)tile.scrollIntoView({behavior:'smooth',block:'start'});else{const gallery=tile.parentElement;gallery.scrollTo({left:gallery.scrollLeft+tile.getBoundingClientRect().left-gallery.getBoundingClientRect().left-(gallery.clientWidth-tile.clientWidth)/2,behavior:'smooth'});}};
  for(const id of roster){const button=el('button');button.type='button';button.dataset.characterTarget=id;button.setAttribute('aria-label',entryName(id));button.setAttribute('aria-current',String(id===(selected||focus)));button.title=entryName(id);button.append(entryFace(id));button.onclick=()=>selected?navigate(id):locate(id);nav.append(button);}
  root.replaceChildren(nav);
  centerNavigation();
  if(!ready)return;
  if(!selected){
    const heading=el('div','','character-gallery-heading');
    const controls=el('div','','character-gallery-controls'),previous=el('button','←'),next=el('button','→');previous.setAttribute('aria-label',t('上一位角色'));next.setAttribute('aria-label',t('下一位角色'));controls.append(previous,next);heading.append(el('p',t('选择角色，查看 Ending 奖励与成就。')),controls);root.append(heading);
    const gallery=el('div','','character-gallery');gallery.setAttribute('aria-label',t('角色立绘'));gallery.tabIndex=0;
    for(const id of roster){const info=characterInfo(id),tile=characterAccent(el('button','','character-portal'),id);tile.type='button';tile.dataset.characterPortal=id;tile.tabIndex=id===focus?0:-1;tile.onfocus=()=>mark(id);tile.setAttribute('aria-label',id==='nasr'?t('共通成就'):t('查看 {0} 的成就',[info.name]));const own=all.filter(row=>owner(row)===id);const badgeList=endingBadges(byId.get(id)),master=own.find(row=>row.isMasterAchievement);
      if(master){const achieved=achievedCardStage(master),stage=achieved??master.stages[0],icon=illustration(stage?.image,master.name,'character-master-icon');icon.dataset.achieved=String(Boolean(achieved));icon.removeAttribute('title');badgeList.prepend(icon);supportHint(icon,()=>stageHint(master),{container:badgeList,followPointer:true,hoverOnly:true});}
      tile.append(portrait(id,id===focus),badgeList);const caption=el('span','','character-portal-caption');caption.append(el('strong',entryName(id)));
      const counts=achievementSummary(own),summary=el('span','','character-achievement-summary');summary.append(el('span',t('已达成 {0} 项',[counts.achieved])),el('span',t('未达成 {0} 项',[counts.incompleteTotal])));
      if(info.signature){const signature=el('img','','character-signature');signature.src=assetURL(info.signature);signature.alt=t('{0}的签名',[info.name]);signature.loading='eager';signature.draggable=false;tile.append(signature);}
      caption.append(summary);tile.append(caption);tile.onclick=()=>navigate(id);gallery.append(tile);}
    // 固定角色一览立即加载全部图片，横向切换不再等待原生懒加载调度。
    for(const image of gallery.querySelectorAll('img'))image.loading='eager';
    root.append(gallery);
    // 用户横向滚动时以视口中心的角色更新导航；头像定位期间保留明确选择。
    gallery.addEventListener('scroll',()=>{if(anchored||matchMedia('(max-width: 760px)').matches)return;const center=gallery.getBoundingClientRect().left+gallery.clientWidth/2;const nearest=[...gallery.children].reduce((best,tile)=>Math.abs(tile.getBoundingClientRect().left+tile.clientWidth/2-center)<Math.abs(best.getBoundingClientRect().left+best.clientWidth/2-center)?tile:best);mark(nearest.dataset.characterPortal);});
    gallery.addEventListener('wheel',()=>{anchored=false;},{passive:true});
    const step=direction=>{const current=roster.indexOf(view.achievementFocus||focus);locate(roster[Math.max(0,Math.min(roster.length-1,current+direction))]);};previous.onclick=()=>step(-1);next.onclick=()=>step(1);gallery.onkeydown=event=>{if(event.target!==gallery&&!event.target.matches('.character-portal'))return;if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();step(event.key==='ArrowLeft'?-1:1);gallery.querySelector(`[data-character-portal="${view.achievementFocus}"]`)?.focus({preventScroll:true});}else if(event.target===gallery&&['Enter',' '].includes(event.key)){event.preventDefault();navigate(view.achievementFocus||focus);}};
    // 鼠标横向拖动超过阈值后拦截点击，避免拖动结束误入角色详情。
    let drag;
    gallery.addEventListener('pointerdown',event=>{anchored=false;if(event.pointerType!=='mouse'||event.button!==0||matchMedia('(max-width: 760px)').matches)return;drag={x:event.clientX,left:gallery.scrollLeft,moved:false,id:event.pointerId};});
    gallery.addEventListener('pointermove',event=>{if(!drag)return;const delta=event.clientX-drag.x;if(Math.abs(delta)>7){drag.moved=true;gallery.setPointerCapture(drag.id);gallery.classList.add('is-dragging');}if(drag.moved){event.preventDefault();gallery.scrollLeft=drag.left-delta;}});
    gallery.addEventListener('pointerup',()=>{if(drag?.moved){gallery.dataset.suppressClick='true';setTimeout(()=>delete gallery.dataset.suppressClick,0);}drag=null;gallery.classList.remove('is-dragging');});gallery.addEventListener('pointercancel',()=>{drag=null;gallery.classList.remove('is-dragging');});gallery.addEventListener('click',event=>{if(gallery.dataset.suppressClick){event.preventDefault();event.stopImmediatePropagation();}},true);gallery.addEventListener('dragstart',event=>event.preventDefault());
    if(focus!==roster[0]){anchored=true;requestAnimationFrame(()=>{if(!gallery.isConnected)return;locate(focus);});}
    return;
  }
  const info=characterInfo(selected),ending=byId.get(selected),back=el('button',t('返回角色一览'),'character-back');back.onclick=()=>navigate('');root.append(back);
  const hero=characterAccent(el('header','','character-detail-hero'),selected),intro=el('div','','character-detail-identity'),title=el('h1',entryName(selected),'character-detail-title');title.tabIndex=-1;if(selected!=='nasr')intro.append(el('span',t('角色成就'),'character-eyebrow'));intro.append(title);const signature=profileSignature(selected,info.name);if(signature)hero.append(signature);const quote=characterQuotes[selected];if(quote){const line=el('blockquote',quote.lines.join('\n'),'character-profile-quote');line.cite=quote.source;intro.append(line);}const master=all.find(row=>row.characterId===selected&&row.isMasterAchievement);if(master)intro.append(masterProgress(master));hero.append(intro,portrait(selected,true));const overview=el('div','','character-detail-overview');overview.append(hero);root.append(overview);
  if(ending){const endingSection=el('section','','character-detail-endings');endingSection.append(achievementEntry(ending));overview.append(endingSection);}
  const owned=all.filter(row=>owner(row)===selected),common=owned.filter(row=>!row.idolCardId&&!row.isMasterAchievement),cardEntries=owned.filter(row=>row.idolCardId);
  const commonCategory=selected==='nasr'?(view.achievementCategory==='Other'?'Other':'Produce'):null;
  const cardMode=selected!=='nasr'&&view.achievementScope==='card';
  const countEntries=rows=>rows.reduce((total,row)=>total+row.stages.length,0);
  const filtered=achievementEntries(snapshot,{...view,query:'',achievementCategory:'',achievementSection:'achievement'});
  const scopeCount=(options,total)=>{const count=countEntries(achievementDetailScope(filtered,{...view,...options}));return count===total?String(total):`${count} / ${total}`;};
  const section=el('section','','character-achievements'),headingRow=el('div','','character-achievement-heading'),heading=el('h2',t('成就')),filters=el('div','','character-achievement-filters');heading.tabIndex=-1;headingRow.append(heading);section.append(headingRow);
  if(selected!=='nasr'){
    const modes=el('div','','achievement-scope-switch');modes.setAttribute('role','group');modes.setAttribute('aria-label',t('成就归属'));
    for(const [scope,label,count] of [['common','角色通用',countEntries(common)],['card','卡片专属',countEntries(cardEntries)]]){const button=el('button',`${t(label)} · ${scopeCount({achievementScope:scope},count)}`);button.dataset.achievementScope=scope;button.setAttribute('aria-pressed',String(cardMode===(scope==='card')));button.onclick=()=>{view.achievementScope=scope;view.page=0;change();root.querySelector(`[data-achievement-scope="${scope}"]`)?.focus({preventScroll:true});};modes.append(button);}headingRow.append(modes);
  }
  if(commonCategory){
    const modes=el('div','','achievement-scope-switch');modes.setAttribute('role','group');modes.setAttribute('aria-label',t('类别'));
    for(const [category,label] of [['Produce','培养'],['Other','其他']]){
      const button=el('button',`${t(label)} · ${scopeCount({achievementCategory:category},countEntries(common.filter(row=>row.category===category)))}`);button.dataset.achievementCategory=category;button.setAttribute('aria-pressed',String(commonCategory===category));
      button.onclick=()=>{view.achievementCategory=category;view.page=0;change();root.querySelector(`[data-achievement-category="${category}"]`)?.focus({preventScroll:true});};modes.append(button);
    }
    headingRow.append(modes);
  }
  const priority=el('button','','ownership-toggle achievement-incomplete-first'),check=el('span','','owned-only-check');priority.type='button';priority.id='achievement-incomplete-first';priority.setAttribute('role','switch');priority.setAttribute('aria-checked',String(view.achievementIncompleteFirst!==false));check.setAttribute('aria-hidden','true');priority.append(check,el('span',t('未达成优先')));headingRow.append(priority);
  priority.onclick=()=>{view.achievementIncompleteFirst=priority.getAttribute('aria-checked')!=='true';view.page=0;change();root.querySelector('#achievement-incomplete-first')?.focus({preventScroll:true});};
  headingRow.insertBefore(filters,priority);
  for(const [key,label,choices] of [['achievementReward','奖励',[['','全部'],['experience','制作人经验'],['support','支援卡强化点'],['jewel','宝石'],['other','其他']]],['achievementState','状态',[['','全部'],['achieved','已达成'],['unachieved','未达成']]],['achievementSort','排序',[['original','原始顺序'],['near','接近下一门槛']]]]){const wrapper=el('label',t(label)),select=el('select');wrapper.dataset.achievementControl=key;select.dataset.achievementFilter=key;for(const [value,name] of choices)select.append(new Option(t(name),value));select.value=view[key];select.onchange=()=>{view[key]=select.value;view.page=0;change();root.querySelector(`[data-achievement-filter="${key}"]`)?.focus({preventScroll:true});};wrapper.append(select);filters.append(wrapper);}
  const entries=achievementDetailScope(filtered,view),count=countEntries(cardMode?cardEntries:commonCategory?common.filter(row=>row.category===commonCategory):common),result=el('p',t('成就 {0} / {1} 项',[countEntries(entries),count]),'character-achievement-result');result.setAttribute('role','status');section.append(result);
  const groups=new Map();
  if(cardMode)for(const entry of entries){if(!groups.has(entry.idolCardId))groups.set(entry.idolCardId,[]);groups.get(entry.idolCardId).push(entry);}
  const heldCards=new Map(cardMode?collectionRecords(snapshot,'idolCards','all').map(row=>[row.idolCardId,row]):[]);
  const units=cardMode?[...groups]:entries;
  // 先按持有情况分组，再保留组内未达成优先顺序；必须在整卡分页之前排序。
  if(cardMode&&view.achievementIncompleteFirst!==false)units.sort(([a],[b])=>Number(heldCards.get(b)?.ownership==='owned')-Number(heldCards.get(a)?.ownership==='owned'));
  const capacity=cardMode?8:40,pages=Math.max(1,Math.ceil(units.length/capacity));view.page=Math.max(0,Math.min(view.page,pages-1));
  const list=el('div','',cardMode?'achievement-card-groups':'inventory-list achievement-icon-catalog');
  for(const unit of units.slice(view.page*capacity,(view.page+1)*capacity)){
    if(!cardMode){list.append(achievementEntry(unit));continue;}
    const [id,values]=unit,held=heldCards.get(id)??{idolCardId:id,ownership:'unknown'},info=idolInfo({...held,idolCardSkinId:''}),group=el('article','','achievement-idol-group');group.dataset.achievementIdol=id;group.dataset.ownership=held.ownership;
    group.append(collectionState(held));
    group.append(illustration(info.image,info.name,'achievement-card-art',{characterId:info.characterId}));
    const icons=el('div','','card-achievement-icons'),matching=new Set(values.map(entry=>entry.id));
    const order={MissionType_IncrementProduceIdolCardClearCount:1,MissionType_AbsoluteIdolCardLevelLimitRank:3,MissionType_IncrementProduceIdolCardPlayCount:2};
    for(const entry of mergeCardAchievements(cardEntries.filter(row=>row.idolCardId===id)).sort((a,b)=>(order[a.missionType]??99)-(order[b.missionType]??99))){
      if(!(entry.sourceEntries??[entry]).some(row=>matching.has(row.id)))continue;
      const icon=cardAchievementIcon(entry,group);icon.style.gridRow=order[entry.missionType]??'auto';icons.append(icon);
    }
    group.append(icons,el('h3',info.name,'achievement-idol-name'));list.append(group);
  }
  if(!entries.length)list.append(el('p',t('没有找到符合条件的成就。试试减少筛选条件。')));section.append(list);
  if(pages>1){const pager=el('div','','character-achievement-pager');for(const [label,delta] of [['上一页',-1],['下一页',1]]){const button=el('button',t(label));button.disabled=delta<0?view.page===0:view.page+1>=pages;button.onclick=()=>{view.page+=delta;change();root.querySelector('.character-achievements h2')?.focus({preventScroll:true});root.querySelector('.character-achievements')?.scrollIntoView({block:'start'});};pager.append(button);}pager.append(el('span',`${view.page+1} / ${pages}`));section.append(pager);}root.append(section);
}
