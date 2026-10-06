import {showSelectionDetails,closeSelectionDetails} from './ui/selection-details.mjs';
import {renderAchievementBrowser} from './ui/achievement-browser.mjs';
import {PersonalLibrary} from './application/personal-library.mjs';
import {matchesTag,favoriteRecords} from './domain/personal-library.mjs';
import {setupLibraryUI} from './ui/personal-library.mjs';
import {setupAccountCleanup} from './ui/account-cleanup.mjs';
import {setupAccountPackage} from './ui/account-package.mjs';
import {captureAccountBackup,importAccountBackup} from './application/account-package-store.mjs';
import {readAccountDirectory} from './application/account-directory.mjs';
import {AccountDirectoryError,combineAccountDirectory} from './domain/account-import.mjs';
import {resetDeferredContent} from './ui/deferred-content.mjs';
import {accountProfile,profileAccountId,validPublicUserId,validProfile,snapshotFitsProfile,maskedAccountId} from './domain/account.mjs';
import {accountIdentity} from './ui/shared.mjs';
import {restoreSelectionSnapshot,selectionEntries,withoutSecondExclusiveSkills,withoutCommonSelectionItems} from './domain/selection-memories.mjs';
import {setupSelectionOptions,renderSelectionChoices,renderLoadoutChoices,renderInheritanceChoices,selectionCapacity,selectionMemoryEntry} from './ui/selection-memories.mjs';
import {loadMaster,masterReadyFor,masterLoadingFor} from './application/master-loader.mjs';
import {setupContentControls} from './ui/content-controls.mjs';
import {defaults,createView,createViews,activeFilterKeys,resetFilters,FILTER_BINDINGS,CHOICE_GROUPS,PROFILE_PREFERENCE_KEY,normalizeProfile,restoreIdolArt} from './application/view-state.mjs';
import {setupFilterOptions,syncMemoryFilterOptions,syncFilterControls,renderFilterChoices,renderTabCount,renderActiveFilters} from './ui/filters.mjs';
import {t,locale,setLocale,onLocaleChange,staticTranslations} from './i18n.mjs';
import {title, memoryUse, selectedValues} from './domain/model.mjs';
import {cardInfo, characterInfo, collectionRecords,supportInfo,idolInfo,skinInfo,achievementViewCounts} from './domain/catalog.mjs';
import {$,el,openDialog} from './ui/dom.mjs';
import {showDetail,memoryEntry,syncMemoryDetailFocus,restoreMemoryEntryFocus} from './ui/memories.mjs';
import {idolEntry,focusIdol} from './ui/idols.mjs';
import {skinEntry,showSkin} from './ui/skins.mjs';
import {supportEntry,focusSupport} from './ui/supports.mjs';
import {showComparison} from './ui/comparison.mjs';
import {supportEntries,idolEntries,skinEntries} from './domain/catalog-selectors.mjs';
import {filterMemories,canCompareMemory} from './domain/memories.mjs';
import {profileData,storedProfiles,saveAccountDirectory,accountDataSummary,clearAccountData} from './application/storage.mjs';

class AccountImportError extends Error {}
function ensureProfileOption(profile){
  $('profile').querySelector('[data-empty-profile]')?.remove();
  if(![...$('profile').options].some(option=>option.value===profile))$('profile').add(new Option(t('账号{0} {1}',[[...$('profile').options].filter(option=>profileAccountId(option.value)).length+1,maskedAccountId(profileAccountId(profile))]),profile));
}
async function refreshProfileOptions(){
  const stored=await storedProfiles(),profiles=new Set(stored.map(key=>String(key).replace(/^selection:/,'')).filter(validProfile));
  if(!profiles.has(state.profile))state.profile=[...profiles][0]??null;
  let accountNumber=0;
  $('profile').replaceChildren(...[...profiles].map(profile=>new Option(t('账号{0} {1}',[++accountNumber,maskedAccountId(profileAccountId(profile))]),profile)));
  if(!profiles.size){const empty=new Option(t('未导入账号'),'');empty.dataset.emptyProfile='';$('profile').append(empty);}
  $('profile').value=state.profile??'';
}
async function activateSnapshotAccount(snapshot){
  const profile=accountProfile(snapshot.publicUserId);
  if(!profile)throw new AccountImportError(t('采集数据缺少有效的游戏账号 ID。'));
  if(profile===state.profile)return false;
  persist();state.profile=profile;ensureProfileOption(profile);$('profile').value=profile;
  const {ordinary,selection}=await profileData(profile);
  state.snapshot=ordinary?.snapshot??null;state.selectionSnapshot=selection?.snapshot?restoreSelectionSnapshot(selection.snapshot):null;
  if(state.snapshot&&!snapshotFitsProfile(state.snapshot,profile)||state.selectionSnapshot&&!snapshotFitsProfile(state.selectionSnapshot,profile)){
    state.snapshot=null;state.selectionSnapshot=null;throw new AccountImportError(t('档案中的游戏账号 ID 不匹配，已停止载入。'));
  }
  const preferences=JSON.parse(localStorage.getItem(`gakumas-web:view:${profile}`)??'null');
  state.views=createViews(preferences?.views);state.idolArt=restoreIdolArt(preferences?.idolArt);state.selected.clear();state.detail=null;
  loadLibrary();return true;
}
function savedProfile(){try{return normalizeProfile(localStorage.getItem(PROFILE_PREFERENCE_KEY));}catch{return null;}}
const state={profile:savedProfile(),tab:'memories',views:createViews(),snapshot:null,selectionSnapshot:null,library:null,selected:new Set(),detail:null,supportTargets:new Map(),idolTargets:new Map(),idolArt:{}};
const pageSize=40;
const expandedFilters=new Set();
let loading=false,searchTimer,controlsPending=false;
const masterTasks=new Map();
const groups=new Map();
const view=()=>state.views[state.tab];
function message(text,error=false){
  $('message').textContent=text;$('message').hidden=!text;$('message').classList.toggle('error',error);
  if($('data-dialog').open){
    const output=$('data-message');output.textContent=text;output.hidden=!text;output.classList.toggle('error',error);
    output.setAttribute('role',error?'alert':'status');output.setAttribute('aria-live',error?'assertive':'polite');
    if(error&&text){output.focus({preventScroll:true});output.scrollIntoView({block:'nearest'});}
  }
}
function persist(){
  if(!validProfile(state.profile))return;
  try {
    localStorage.setItem(PROFILE_PREFERENCE_KEY,state.profile);
    localStorage.setItem(`gakumas-web:view:${state.profile}`,JSON.stringify({views:state.views,tab:state.tab,idolArt:state.idolArt}));
  } catch { message(t('视图偏好保存失败，刷新后可能需要重新筛选。'),true); }
}

function tagsFor(kind,key){return state.library?.data[kind]?.[key]??[];}
function catalogFilters(tab,filters){return {...filters,favorites:state.library?.data.favorites[tab]??[]};}
function matchesFavorite(kind,key,filters){return filters.ownership!=='favorites'||Boolean(state.library?.data.favorites[kind]?.includes(key));}
function memoryValues(filters){return filterMemories(state.snapshot,filters,groups,m=>tagsFor('memories',m.key)).filter(m=>matchesTag(state.library?.data,'memories',m.key,filters.customTag)&&matchesFavorite('memories',m.key,filters));}
function selectionValues(filters){return selectionEntries(state.selectionSnapshot,filters,m=>tagsFor('selectionMemories',m.key)).filter(entry=>matchesTag(state.library?.data,'selectionMemories',entry.memory.key,filters.customTag)&&matchesFavorite('selectionMemories',entry.memory.key,filters));}
function tagOptions(){
  const names=state.library?.data.tags??[],available={};
  for(const [tab,rows] of [['memories',state.snapshot?.memories??[]],['selectionMemories',state.selectionSnapshot?.selectionMemories??[]]]){
    // 按当前快照统计实际关联，不让未使用或仅关联历史回忆的标签进入筛选。
    const used=new Set(rows.flatMap(row=>tagsFor(tab,row.key)));
    available[tab]=names.filter(name=>used.has(name));
    const filters=state.views[tab];
    if(filters.customTag?.startsWith('tag:')&&!used.has(filters.customTag.slice(4))){filters.customTag='';filters.page=0;}
  }
  $('custom-tag-filter').replaceChildren(new Option(t('全部标签'),''),new Option(t('未添加标签'),'__untagged__'),...(available[state.tab]??[]).map(name=>new Option(name,'tag:'+name)));
  $('custom-tag-filter').value=view().customTag;
}

function editTags(kind,key,inDetail=false){
  tagUI.open({kind,key},()=>{
    const container=inDetail?$('detail-content'):[...$('list').children].find(row=>row.dataset[kind==='memories'?'memoryKey':'selectionKey']===key);
    (container?.querySelector('.edit-custom-tags')??$('manage-tags')).focus();
  });
}
function tagContext(kind,key,inDetail=false){return {tags:tagsFor(kind,key),editTags:()=>editTags(kind,key,inDetail),tagsDisabled:!state.library,removeTag:name=>{
  try{
    state.library.assign(kind,key,tagsFor(kind,key).filter(value=>value!==name));syncControls();render();persist();
    if(state.detail){const memory=state.snapshot?.memories.find(row=>row.key===state.detail);if(memory)showDetail(memory,tagContext('memories',memory.key,true));}
    const container=inDetail?$('detail-content'):[...$('list').children].find(row=>row.dataset[kind==='memories'?'memoryKey':'selectionKey']===key);
    (container?.querySelector('.edit-custom-tags')??$('manage-tags')).focus({preventScroll:true});
  }catch{message(t('标签未能保存，请检查浏览器存储空间。'),true);}
}};}
function favoriteContext(kind,id){return {favorite:state.library?.data.favorites[kind].includes(id)??false,favoriteDisabled:!state.library,onFavorite:enabled=>{
  try{
    state.library.favorite(kind,id,enabled);render();
    const row=[...$('list').children].find(row=>row.dataset[{idolCards:'idolId',supportCards:'supportId',idolCardSkins:'skinId',memories:'memoryKey',selectionMemories:'selectionKey'}[kind]]===id);
    (row?.querySelector('.favorite-button')??$(({idolCards:'idol',supportCards:'support',idolCardSkins:'skin',memories:'memory',selectionMemories:'selection'})[kind]+'-favorites-only')).focus({preventScroll:true});
  }catch{message(t('收藏未能保存，请检查浏览器存储空间。'),true);}
}};}
function savedViews(){if(!validProfile(state.profile))return [];return JSON.parse(localStorage.getItem(`gakumas-web:saved-views:${state.profile}`)??'[]');}
function refreshSavedViews(selected=''){$('saved-view').replaceChildren(new Option(t('常用筛选'),''),...savedViews().map((v,i)=>new Option(v.name,String(i))));$('saved-view').value=selected;$('delete-view').disabled=$('saved-view').value==='';}
function renderPendingCatalogCounts(){
  for(const tab of ['idolCards','supportCards','idolCardSkins','achievements'])if(!masterReadyFor(tab))renderTabCount(tab,null,undefined,t(masterLoadingFor(tab)?'加载中…':'待加载'));
}

function setup(){
  const controls=state.tab!=='achievements'&&masterReadyFor(state.tab);controlsPending=!controls;
  setupFilterOptions(state.snapshot,groups,{controls});
  if(controls){setupSelectionOptions(state.selectionSnapshot);refreshSavedViews();}
  if(masterReadyFor('selectionMemories')){state.views.selectionMemories.selectionSkill=withoutSecondExclusiveSkills(state.views.selectionMemories.selectionSkill);state.views.selectionMemories.selectionItem=withoutCommonSelectionItems(state.views.selectionMemories.selectionItem);}
  for(const [tab,filters] of Object.entries(state.views)){
    if(tab==='achievements'){updateTabCount(tab);continue;}
    if(tab==='selectionMemories'){updateTabCount(tab,state.selectionSnapshot?selectionValues(filters).length:undefined);continue;}
    if(!state.snapshot||!masterReadyFor(tab)){renderTabCount(tab,null);continue;}
    const query=filters.query.trim().toLowerCase();
    const count=tab==='memories'?memoryValues(filters).length:
      tab==='idolCards'?idolEntries(state.snapshot,query,filters.catalogSort,catalogFilters(tab,filters)).length:
      tab==='supportCards'?supportEntries(state.snapshot,query,filters.catalogSort,catalogFilters(tab,filters)).length:
      skinEntries(state.snapshot,query,catalogFilters(tab,filters)).length;
    updateTabCount(tab,count);
  }
  renderPendingCatalogCounts();
}
function updateTabCount(tab,count){
  if(tab==='achievements'){
    if(!masterReadyFor(tab)){renderTabCount(tab,null,undefined,t(masterLoadingFor(tab)?'加载中…':'待加载'));return;}
    const counts=achievementViewCounts(state.snapshot,state.views.achievements);
    renderTabCount(tab,counts.count,counts.total);return;
  }
  const s=state.snapshot,filters=state.views[tab];
  if(tab==='selectionMemories'){renderTabCount(tab,count,state.selectionSnapshot?.count);return;}
  const missing=s?.[tab]===undefined;
  renderTabCount(tab,missing?undefined:count,tab==='memories'?s?.memories.length:(['idolCards','supportCards','idolCardSkins'].includes(tab)?favoriteRecords(s,tab,catalogFilters(tab,filters),collectionRecords):collectionRecords(s,tab,filters.ownership??'owned')).length);
}
function syncControls(){
  if(!masterReadyFor(state.tab)){controlsPending=true;return;}
  if(state.tab!=='achievements'){
    if(controlsPending){setupFilterOptions(state.snapshot,groups);setupSelectionOptions(state.selectionSnapshot);refreshSavedViews();controlsPending=false;}
    tagOptions();
  }
  if(state.tab==='memories')syncMemoryFilterOptions(state.snapshot,view());
  syncFilterControls(view(),state.tab);
}
function filteredMemories(){return memoryValues(view());}
function onFilterChoice(key,value,extra={}){Object.assign(view(),extra,{[key]:value});view().page=0;syncControls();render();persist();}
function renderFilterDisclosure(){
  const expanded=expandedFilters.has(state.tab),v=view();
  const count=activeFilterKeys(state.tab,v).reduce((total,key)=>total+selectedValues(v[key]).length,0);
  $('advanced-filters').hidden=!expanded;
  $('filter-toggle').setAttribute('aria-expanded',String(expanded));
  $('filter-toggle').textContent=t('筛选{0}',[count?` · ${count}`:''])+(expanded?' ▴':' ▾');
}
function renderAccountOverview(){
  const id=profileAccountId(state.profile),hasData=Boolean(state.snapshot||state.selectionSnapshot);
  $('data-account-identity').replaceChildren(id?accountIdentity(id):el('strong',hasData?$('profile').selectedOptions[0]?.textContent:t('未导入账号')));
  $('data-account-counts').replaceChildren();
  if(hasData){
    for(const [label,value] of [['普通回忆',state.snapshot?.memories?.length],['选拔回忆',state.selectionSnapshot?.count],['已关联详情',state.selectionSnapshot?.details?.length]]){
      const item=el('span');item.append(el('b',value===undefined?t('未采集'):String(value)),el('span',t(label)));$('data-account-counts').append(item);
    }
  }else $('data-account-counts').append(el('p',t('导入采集目录或数据包，开始整理收藏。')));
}
let pendingFilterReset=null;
function cancelFilterReset(){
  if(!pendingFilterReset)return;
  pendingFilterReset.textContent=t('清空筛选');pendingFilterReset.classList.remove('filter-reset-confirming');pendingFilterReset=null;
}
function confirmFilterReset(button,action){
  if(pendingFilterReset===button){cancelFilterReset();action();return;}
  cancelFilterReset();pendingFilterReset=button;button.textContent=t('确认清空');button.classList.add('filter-reset-confirming');
}
document.addEventListener('pointerdown',event=>{if(pendingFilterReset&&!pendingFilterReset.contains(event.target))cancelFilterReset();},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&pendingFilterReset){cancelFilterReset();event.preventDefault();}},true);
function render(){
  cancelFilterReset();
  clearTimeout(searchTimer);resetDeferredContent();
  if($('data-dialog').open)renderAccountOverview();
  const s=state.snapshot??{memories:[]},v=view(),memory=state.tab==='memories',selection=state.tab==='selectionMemories',achievement=state.tab==='achievements',hasData=Boolean(state.snapshot||state.selectionSnapshot||achievement);
  const memoryChoices=memory?syncMemoryFilterOptions(state.snapshot,v):null;
  $('empty').hidden=hasData;$('inventory').hidden=!hasData;$('shared-search').hidden=!hasData;
  $('selection-capacity').hidden=!selection;
  $('achievement-browser').hidden=!achievement;
  $('filter-toggle').closest('.filters').hidden=achievement;
  $('export-account-package').disabled=loading||!profileAccountId(state.profile)||!(state.snapshot||state.selectionSnapshot)||!state.library;
  $('import-account-package').disabled=loading;
  $('clear-account').disabled=loading||(!state.snapshot&&!state.selectionSnapshot);
  $('manage-tags').disabled=loading||!state.library||(!state.snapshot&&!state.selectionSnapshot);
  for(const id of ['empty-import-account','import-account-directory'])$(id).disabled=loading;
  if(achievement){$('inventory').hidden=true;$('shared-search').hidden=true;updateTabCount('achievements');renderAchievementBrowser($('achievement-browser'),{snapshot:state.snapshot,view:v,ready:masterReadyFor('achievements'),change:()=>{render();persist();}});return;}
  if(!hasData){selectionControls();syncMemoryDetailFocus();return;}
  if(!masterReadyFor(state.tab)&&!memory&&!selection){$('shared-search').hidden=true;$('filter-toggle').closest('.filters').hidden=true;$('list').replaceChildren(el('p',t('正在读取本地主数据…'),'empty-result'));$('previous').disabled=true;$('next').disabled=true;selectionControls();return;}
  $('section-title').textContent={memories:t('回忆'),selectionMemories:t('选拔回忆'),idolCards:t('偶像卡'),supportCards:t('支援卡'),idolCardSkins:t('主题装扮'),achievements:t('成就')}[state.tab];
  $('search-scope').textContent=t('搜索范围：{0}',[$('section-title').textContent]);
  for(const section of document.querySelectorAll('[data-filter-tab]'))section.hidden=section.dataset.filterTab!==state.tab;
  $('skin-filters').hidden=state.tab!=='idolCardSkins';
  $('idol-filters').hidden=state.tab!=='idolCards';
  $('idol-effect-chips').hidden=state.tab!=='idolCards';
  for(const [container,input,key,faces,tab] of CHOICE_GROUPS){
    $(container).hidden=state.tab!==tab;
    if(state.tab===tab)renderFilterChoices(container,input,key,faces,v,onFilterChoice);
  }
  if(selection){selectionCapacity(state.selectionSnapshot);$('snapshot-meta').textContent=state.selectionSnapshot?t('快照 {0}',[new Date(state.selectionSnapshot.captured_at).toLocaleString(locale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})]):t('尚未采集');}
  else $('snapshot-meta').textContent=state.snapshot?t('快照 {0}',[new Date(state.snapshot.captured_at).toLocaleString(locale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})]):t('尚未载入');
  $('support-effect-pair-hint').hidden=state.tab!=='supportCards'||!v.supportEffect.length||!v.supportEffectAttribute.length;
  $('support-filters').hidden=state.tab!=='supportCards';
  $('ownership-controls').hidden=memory||selection||achievement;
  $('tag-controls').hidden=!memory&&!selection;tagOptions();
  const ownershipOptions=[['all','全部'],['owned','已持有'],['unowned','未持有'],...(state.tab==='idolCardSkins'?[['favorites','仅查看收藏']]:[])];
  $('ownership').replaceChildren(...ownershipOptions.map(([value,label])=>new Option(t(label),value)));
  $('ownership').value=v.ownership==='favorites'&&state.tab!=='idolCardSkins'?'all':v.ownership;
  $('selection-lock-controls').hidden=!selection;
  $('owned-only-control').hidden=!['idolCards','supportCards','idolCardSkins'].includes(state.tab);
  $('owned-only').setAttribute('aria-checked',String(v.ownership==='owned'));
  for(const kind of ['idol','support','memory','selection','skin'])$(kind+'-favorites-only').checked=v.ownership==='favorites';
  $('memory-locked-only').checked=v.protection==='protected';$('selection-locked-only').checked=v.selectionProtection==='protected';
  $('selection-search-basis').hidden=!selection;
  $('selection-search-basis').textContent=t('HIF 剧本的中间回忆，仅用于 HIF 决赛部分的后续养成');
  $('support-search-basis').hidden=state.tab!=='supportCards';
  $('support-search-basis').textContent=t('效果检索按满级计算，卡片仍显示当前等级效果。');
  for(const control of document.querySelectorAll('[data-rarity-tab]'))control.hidden=control.dataset.rarityTab!==state.tab;
  $('memory-modes').hidden=!memory;
  for(const id of ['memory-skill-all','memory-item-all','selection-skill-all','selection-item-all','support-character-all'])$(id).closest('label').title=t('勾选时需满足全部已选项，未勾选时满足任一项即可。');
  if(selection)renderSelectionChoices(v,onFilterChoice);
  if(memory){renderInheritanceChoices(v,memoryChoices,onFilterChoice);renderLoadoutChoices(v,onFilterChoice,{prefix:'memory',skillKey:'memoryExamSkill',itemKey:'memoryExamItem',choices:memoryChoices,characters:[]});}
  renderFilterDisclosure();if(achievement)$('advanced-filters').hidden=true;
  $('sort').closest('label').hidden=!memory;$('idol-sort').closest('label').hidden=memory||selection||achievement;
  $('selection-sort-control').hidden=!selection;
  $('catalog-sort-controls').hidden=memory||selection||achievement;
  $('catalog-owned-first-control').hidden=memory||selection||achievement;
  $('catalog-owned-first').setAttribute('aria-checked',String(v.ownedFirst));
  $('filter-panel').hidden=!memory;
  $('search').placeholder=selection?t('搜索角色、技能卡、P 道具或自定义标签'):state.tab==='idolCardSkins'?t('搜索主题、装扮名、角色或卡名'):memory?t('搜索角色、继承技能卡、培养能力或自定义标签'):state.tab==='idolCards'?t('搜索卡名、角色或技能效果'):t('搜索卡名、角色、事件奖励或支援效果');
  $('search-clear').hidden=!v.query;
  const values=selection?selectionValues(v):memory?filteredMemories():state.tab==='supportCards'?supportEntries(s,v.query.trim().toLowerCase(),v.catalogSort,catalogFilters('supportCards',v)):state.tab==='idolCardSkins'?skinEntries(s,v.query.trim().toLowerCase(),catalogFilters('idolCardSkins',v)):idolEntries(s,v.query.trim().toLowerCase(),v.catalogSort,catalogFilters('idolCards',v));
  const currentPageSize=state.tab==='supportCards'&&!v.supportImmersive?10:pageSize;
  const pages=Math.max(1,Math.ceil(values.length/currentPageSize));v.page=Math.min(v.page,pages-1);
  const list=$('list');list.className=`inventory-list ${selection?'selection-memory-catalog':memory?'compact-grid':state.tab==='supportCards'?'support-catalog':state.tab==='idolCardSkins'?'skin-catalog':'idol-catalog'}`;list.classList.toggle('memory-catalog',memory);list.classList.toggle('skin-immersive',state.tab==='idolCardSkins'&&v.skinImmersive);list.classList.toggle('support-immersive',state.tab==='supportCards'&&v.supportImmersive);list.classList.toggle('idol-immersive',state.tab==='idolCards'&&v.idolImmersive);const fragment=document.createDocumentFragment();
  for(const value of values.slice(v.page*currentPageSize,(v.page+1)*currentPageSize)){
    const targetKey=['supportCards','idolCards'].includes(state.tab)?`${state.profile}:${value.held.supportCardId??value.held.idolCardId}`:'';
    fragment.append(selection?selectionMemoryEntry(value,{...tagContext('selectionMemories',value.memory.key),...favoriteContext('selectionMemories',value.memory.key),collapsed:v.selectionLoadoutCollapsed,detail:state.selectionSnapshot?.details?.find(detail=>detail.key===value.memory.key)}):memory?memoryEntry(value,{...tagContext('memories',value.key),...favoriteContext('memories',value.key),selected:state.selected.has(value.key),active:state.detail===value.key,purpose:v.purpose,sort:v.sort,open:openDetail,select:selectMemory}):state.tab==='supportCards'?supportEntry(value,{...favoriteContext('supportCards',value.held.supportCardId),immersive:v.supportImmersive,targetLevel:state.supportTargets.get(targetKey),onTarget:level=>state.supportTargets.set(targetKey,level)}):state.tab==='idolCards'?idolEntry(value,{...favoriteContext('idolCards',value.held.idolCardId),immersive:v.idolImmersive,target:{...state.idolTargets.get(targetKey),art:state.idolArt[value.held.idolCardId]??state.idolTargets.get(targetKey)?.art},onTarget:target=>state.idolTargets.set(targetKey,target),onArt:art=>{state.idolArt[value.held.idolCardId]=art;persist();}}):skinEntry(value,skinOptions(value.held)));
  }
  const missing=selection?!state.selectionSnapshot:(state.tab==='supportCards'||state.tab==='idolCardSkins')&&s[state.tab]===undefined;
  if(!values.length)fragment.append(el('div',missing?t(selection?'尚未采集选拔回忆，请导入独立快照。':'尚未导入主库存，请导入当前格式的账号目录。'):t(achievement?(v.achievementSection==='achievement'?'没有找到符合条件的成就。试试减少筛选条件，或清空搜索。':'没有找到符合条件的 Ending。试试清空搜索。'):'没有匹配条目。试试减少筛选条件或清空搜索。'),'empty-result'));
  list.replaceChildren(fragment);
  updateTabCount(state.tab,values.length);
  $('page-number').textContent=t("{0} / {1} 页",[v.page+1,pages]);$('previous').disabled=v.page===0;$('next').disabled=v.page+1>=pages;
  const conditions=activeFilterKeys(state.tab,v);
  const activeCount=renderActiveFilters(conditions,v,(key,value)=>{
    v[key]=Array.isArray(v[key])?v[key].filter(item=>item!==value):defaults()[key];
    v.page=0;syncControls();render();persist();$(achievement?'search':'filter-toggle').focus();
  });
  $('active-filters').hidden=!activeCount;
  $('clear-active-filters').hidden=!activeCount;
  $('clear-active-filters').onclick=()=>confirmFilterReset($('clear-active-filters'),()=>{
    resetFilters(v,state.tab,{keys:[...conditions,'query']});syncControls();render();persist();$(achievement?'search':'filter-toggle').focus();
  });
  const trainingCount=s.memories.filter(m=>memoryUse(m)==='training').length;
  $('group-summary').textContent=memory?t('培养专用 {0} 条',[trainingCount]):'';
  selectionControls();syncMemoryDetailFocus();
}
function selectMemory(m,checkbox){
  if(!canCompareMemory(m)){checkbox.checked=false;return;}
  if(checkbox.checked&&state.selected.size>=4){checkbox.checked=false;message(t('最多比较 4 张，请先移除一张。'));return;}
  if(checkbox.checked)state.selected.add(m.key);else state.selected.delete(m.key);
  checkbox.closest('article').classList.toggle('selected',checkbox.checked);selectionControls();
}
function selectionControls(){
  const eligible=new Set((state.snapshot?.memories??[]).filter(canCompareMemory).map(memory=>memory.key));
  for(const key of state.selected)if(!eligible.has(key))state.selected.delete(key);
  document.querySelector('.selection-bar').hidden=state.tab!=='memories'||!state.selected.size;
  $('selection-count').textContent=t("已选 {0} / 4",[state.selected.size]);
  $('compare').disabled=state.selected.size<2;
  $('selection-items').replaceChildren();
  for(const m of state.snapshot?.memories??[])if(state.selected.has(m.key)){
    const button=el('button',`${cardInfo(m.produceCard,m.characterId).name} ×`,'selection-chip');
    button.setAttribute('aria-label',t("移除{0}",[title(m)]));button.onclick=()=>{state.selected.delete(m.key);render();};$('selection-items').append(button);
  }
}
function openDetail(m){
  state.detail=m.key;
  showDetail(m,{character:characterInfo(m.characterId).name,group:groups.get(m.config)??0,...tagContext('memories',m.key,true)});
  document.querySelector('.workbench').classList.add('inspecting');
  const values=filteredMemories(),index=values.findIndex(x=>x.key===m.key);
  $('detail-prev').disabled=index<=0;$('detail-next').disabled=index<0||index===values.length-1;
  render();$('detail-title').focus({preventScroll:true});
}
function resetDetail(){
  state.detail=null;$('detail-dialog').hidden=true;document.querySelector('.workbench').classList.remove('inspecting');
}
function closeDetail(restoreFocus=false){
  const key=state.detail;
  if(restoreFocus&&key){const index=filteredMemories().findIndex(m=>m.key===key);if(index>=0)view().page=Math.floor(index/pageSize);}
  resetDetail();render();
  if(restoreFocus&&key)restoreMemoryEntryFocus(key);
}
$('close-detail').onclick=()=>closeDetail(true);
for(const [id,direction] of [['detail-prev',-1],['detail-next',1]])$(id).onclick=()=>{const values=filteredMemories(),index=values.findIndex(m=>m.key===state.detail);if(values[index+direction])openDetail(values[index+direction]);};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]')&&state.detail)closeDetail(true);});
function loadLibrary(){
  state.library=null;
  if(!validProfile(state.profile))return;
  try{const library=new PersonalLibrary(state.profile);library.load();state.library=library;}
  catch{message(t('标签与收藏读取失败，已保留原数据，请检查账号数据包。'),true);}
}
for(const id of ['empty-import-account','import-account-directory'])$(id).onclick=()=>$('account-directory-files').click();
$('account-directory-files').onchange=async event=>{
  const files=[...event.target.files];event.target.value='';if(!files.length||loading)return;
  loading=true;$('profile').disabled=true;render();
  try{
    const bundle=await readAccountDirectory(files),profile=accountProfile(bundle.publicUserId);
    const {ordinary,selection}=await profileData(profile);
    const next=combineAccountDirectory(bundle,{snapshot:ordinary?.snapshot,selectionSnapshot:selection?.snapshot?restoreSelectionSnapshot(selection.snapshot):null});
    await saveAccountDirectory(profile,next);
    await activateSnapshotAccount({publicUserId:bundle.publicUserId});
    state.snapshot=next.snapshot;state.selectionSnapshot=next.selectionSnapshot;state.tab=next.snapshot?'memories':'selectionMemories';
    state.selected.clear();resetDetail();loadLibrary();setup();syncControls();render();persist();
    $('data-dialog').close();void ensureMaster();
    const count=next.selectionSnapshot?.details?.length??0;
    message(t('账号目录已导入，已关联 {0} 条选拔详情。',[count])+(next.ignoredDetails?t('已略过 {0} 条不在当前选拔列表中的历史详情。',[next.ignoredDetails]):''));
  }catch(error){message(error instanceof AccountDirectoryError?t(error.message):t('账号目录导入失败，请检查快照格式和存储空间；原数据保留。'),true);}
  finally{loading=false;$('profile').disabled=false;render();openMemoryLink();}
};
async function restoreProfile(){
  loading=true;$('profile').disabled=true;render();
  try{
    const {ordinary:saved,selection:selectionSaved}=await profileData(state.profile);
    const preferences=JSON.parse(localStorage.getItem(`gakumas-web:view:${state.profile}`)??'null');
    state.snapshot=saved?.snapshot??null;
    state.selectionSnapshot=selectionSaved?.snapshot?restoreSelectionSnapshot(selectionSaved.snapshot):null;
    if(state.snapshot&&!snapshotFitsProfile(state.snapshot,state.profile)||state.selectionSnapshot&&!snapshotFitsProfile(state.selectionSnapshot,state.profile)){state.snapshot=null;state.selectionSnapshot=null;throw new AccountImportError(t('档案中的游戏账号 ID 不匹配，已停止载入。'));}
    state.views=createViews(preferences?.views);state.tab=preferences?.tab??'memories';state.idolArt=restoreIdolArt(preferences?.idolArt);
    loadLibrary();setup();syncControls();render();if(state.snapshot||state.selectionSnapshot||state.tab==='achievements')void ensureMaster();
  }catch(error){message(error instanceof AccountImportError?error.message:t('浏览器工作副本无法恢复，请重新载入快照。'),true);}
  finally{loading=false;$('profile').disabled=false;render();openMemoryLink();}
}
$('profile').onchange=async()=>{persist();state.profile=normalizeProfile($('profile').value);try{localStorage.setItem(PROFILE_PREFERENCE_KEY,state.profile);}catch{message(t('视图偏好保存失败，刷新后可能需要重新筛选。'),true);}state.snapshot=null;state.selectionSnapshot=null;state.library=null;state.selected.clear();resetDetail();await restoreProfile();};
for(const button of document.querySelectorAll('[data-tab]'))button.onclick=()=>{state.tab=button.dataset.tab;resetDetail();syncControls();render();persist();if(state.snapshot||state.selectionSnapshot||state.tab==='achievements')void ensureMaster();};
for(const [id,key] of FILTER_BINDINGS)$(id).addEventListener($(id).matches('button[role=switch]')?'click':id==='search'?'input':'change',()=>{view()[key]=$(id).matches('button[role=switch]')?!view()[key]:$(id).type==='checkbox'?$(id).checked:$(id).value;view().page=0;
  if(id==='purpose')resetDetail();
  if(id==='search'){
    clearTimeout(searchTimer);
    if(!searchComposing)searchTimer=setTimeout(()=>{render();persist();},120);
    return;
  }
  render();persist();});
let searchComposing=false;
$('search').addEventListener('compositionstart',()=>{searchComposing=true;clearTimeout(searchTimer);});
$('search').addEventListener('compositionend',()=>{searchComposing=false;view().query=$('search').value;view().page=0;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{render();persist();},120);});
$('search-clear').onclick=()=>{view().query='';$('search').value='';view().page=0;render();persist();$('search').focus();};
$('search').addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&!state.detail){e.preventDefault();$('search-clear').click();}});
$('owned-only').onclick=()=>onFilterChoice('ownership',view().ownership==='owned'?'all':'owned');
for(const kind of ['idol','support','memory','selection','skin'])$(kind+'-favorites-only').onchange=event=>onFilterChoice('ownership',event.target.checked?'favorites':'all');
for(const [kind,key] of [['memory','protection'],['selection','selectionProtection']])$(kind+'-locked-only').onchange=event=>onFilterChoice(key,event.target.checked?'protected':'all');
$('filter-toggle').onclick=()=>{if(expandedFilters.has(state.tab))expandedFilters.delete(state.tab);else expandedFilters.add(state.tab);renderFilterDisclosure();};
for(const id of ['reset-selection-filters','reset-idol-filters','reset-support-filters','reset-skin-filters','reset-filters'])$(id).onclick=()=>confirmFilterReset($(id),()=>{resetFilters(view(),state.tab);syncControls();render();persist();});
for(const id of ['reset-selection-filters','reset-idol-filters','reset-support-filters','reset-skin-filters','reset-filters','clear-active-filters'])$(id).addEventListener('blur',()=>{if(pendingFilterReset===$(id))cancelFilterReset();});
function changePage(direction){
  if(state.detail)resetDetail();
  view().page+=direction;render();persist();
  const list=$('list');list.tabIndex=-1;list.setAttribute('aria-label',t('第 {0} 页结果',[view().page+1]));
  list.focus({preventScroll:true});list.scrollIntoView({block:'start',behavior:'instant'});
}
$('previous').onclick=()=>changePage(-1);$('next').onclick=()=>changePage(1);
$('clear-selection').onclick=()=>{state.selected.clear();render();};
$('compare').onclick=()=>showComparison(state.snapshot.memories.filter(m=>state.selected.has(m.key)));
for(const name of ['compare','data','help','idol'])$('close-'+name).onclick=()=>$(name+'-dialog').close();
$('data-open').onclick=()=>{$('data-message').hidden=true;$('data-message').textContent='';renderAccountOverview();openDialog($('data-dialog'),{dismissOnBackdrop:true});};$('help-open').onclick=()=>openDialog($('help-dialog'),{dismissOnBackdrop:true});$('empty-import').onclick=()=>$('import-account-package').click();
function linkedMasterScope(){
  const params=new URLSearchParams(location.hash.slice(1));
  for(const [key,tab] of [['selection-loadout','selectionMemories'],['selection-memory','selectionMemories'],['memory','memories'],['idol','idolCards'],['support','supportCards'],['skin','idolCardSkins']])if(params.has(key))return tab;
  return state.tab;
}
async function ensureMaster(forLink=false){
  const scope=forLink===true||location.hash?linkedMasterScope():state.tab;
  if(masterReadyFor(scope)){$('load-master').hidden=true;$('master-status').textContent=t('主数据已载入 · 公开插图按需缓存');openCatalogLink();return;}
  if(masterTasks.has(scope))return masterTasks.get(scope);
  $('load-master').disabled=true;$('master-status').textContent=t('正在读取本地主数据…');
  const task=loadMaster(scope).then(()=>{
    if(masterReadyFor(state.tab)){$('load-master').hidden=true;$('master-status').textContent=t('主数据已载入 · 公开插图按需缓存');}
    setup();syncControls();render();openCatalogLink();if(masterReadyFor('memories')&&state.detail)openDetail(state.snapshot.memories.find(m=>m.key===state.detail));
  }).catch(()=>{if(!masterReadyFor(state.tab)){$('master-status').textContent=t('主数据暂不可用，仍可查看库存数值。');$('load-master').disabled=false;$('load-master').hidden=false;}}).finally(()=>{masterTasks.delete(scope);renderPendingCatalogCounts();});
  masterTasks.set(scope,task);renderPendingCatalogCounts();return task;
}
$('load-master').onclick=ensureMaster;
setupContentControls({loaded:()=>ensureMaster(),canReload:()=>!loading});
for(const [id,key] of [['find-character','character'],['find-skill','skill']])$(id).onclick=()=>{
  const m=state.snapshot.memories.find(row=>row.key===state.detail);const value=key==='character'?m?.characterId:m?.produceCard?.id;
  if(!value){message(t('该字段未记录，无法寻找比较对象。'));return;}
  Object.assign(state.views.memories,defaults(),{[key]:value});state.selected.clear();state.selected.add(m.key);resetDetail();syncControls();render();persist();message(t('已筛出同类回忆并选中当前条目；相似不代表可删除。'));
};
$('save-view').onclick=()=>{const name=prompt(t('为当前筛选、排序和阅读重点命名：'));if(!name?.trim())return;try{const values=savedViews();values.push({name:name.trim().slice(0,60),view:{...state.views.memories,page:0}});localStorage.setItem(`gakumas-web:saved-views:${state.profile}`,JSON.stringify(values));refreshSavedViews(String(values.length-1));}catch{message(t('常用视图保存失败。'),true);}};
$('saved-view').onchange=()=>{$('delete-view').disabled=$('saved-view').value==='';const item=savedViews()[Number($('saved-view').value)];if($('saved-view').value!==''&&item){state.views.memories=createView(item.view);syncControls();render();persist();}};

$('delete-view').onclick=()=>{
  const selected=$('saved-view').value;if(selected==='')return;
  try{const values=savedViews();values.splice(Number(selected),1);localStorage.setItem(`gakumas-web:saved-views:${state.profile}`,JSON.stringify(values));refreshSavedViews();}
  catch{message(t('常用筛选删除失败。'),true);}
};

const tagUI=setupLibraryUI({current:()=>state.library,changed:()=>{
  tagOptions();syncControls();render();persist();
  if(state.detail){const memory=state.snapshot?.memories.find(row=>row.key===state.detail);if(memory)showDetail(memory,{...tagContext('memories',memory.key,true)});}
}});
const updateStatic=staticTranslations();
updateStatic();$('language').value=locale();
$('language').onchange=()=>setLocale($('language').value);
onLocaleChange(()=>{
  $('language').value=locale();
  const expanded=[...document.querySelectorAll('#detail-content details')].map(node=>node.open);
  const savedView=$('saved-view').value;
  updateStatic();void refreshProfileOptions();setup();syncControls();$('saved-view').value=savedView;$('delete-view').disabled=$('saved-view').value==='';render();
  if(state.detail){
    openDetail(state.snapshot.memories.find(m=>m.key===state.detail));
    document.querySelectorAll('#detail-content details').forEach((node,i)=>{node.open=expanded[i]??node.open;});
  }
  $('master-status').textContent=masterReadyFor(state.tab)?t('主数据已载入 · 公开插图按需缓存'):t('正在准备本地主数据');
  $('message').hidden=true;
});
setupAccountPackage({
  capture:()=>captureAccountBackup(state.profile,{views:state.views,tab:state.tab,idolArt:state.idolArt},state.library.data),
  restore:async payload=>{
    if(accountProfile(payload.publicUserId)!==state.profile)persist();
    const next=await importAccountBackup(payload);
    state.profile=next.profile;ensureProfileOption(next.profile);$('profile').value=next.profile;
    state.snapshot=next.snapshot;state.selectionSnapshot=next.selectionSnapshot;
    state.views=createViews(next.preferences.views);state.idolArt=restoreIdolArt(next.preferences.idolArt);state.tab=next.preferences.tab;
    state.selected.clear();resetDetail();loadLibrary();setup();syncControls();render();persist();
    $('data-dialog').close();void ensureMaster();
  },
  lock:value=>{loading=value;$('profile').disabled=value;render();},report:message,
});
const cleanupChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('gakumas-web:account-cleanup'):null;
cleanupChannel?.addEventListener('message',event=>{
  if(event.data?.profile===state.profile){history.replaceState(null,'',location.pathname+location.search);location.reload();}
});
setupAccountCleanup({
  target:()=>({profile:state.profile,label:$('profile').selectedOptions[0]?.textContent??state.profile}),
  summary:accountDataSummary,
  remove:clearAccountData,
  complete:async profile=>{
    history.replaceState(null,'',location.pathname+location.search);
    for(const dialog of document.querySelectorAll('dialog[open]'))if(dialog.id!=='account-cleanup-dialog')dialog.close();
    state.snapshot=null;state.selectionSnapshot=null;state.library=null;state.selected.clear();state.idolArt={};state.views=createViews();state.tab='memories';
    resetDetail();groups.clear();expandedFilters.clear();
    for(const map of [state.supportTargets,state.idolTargets])for(const key of map.keys())if(key.startsWith(profile+':'))map.delete(key);
    for(const id of ['list','detail-content','comparison','idol-content'])$(id).replaceChildren();
    for(const dialog of document.querySelectorAll('.selection-details-dialog'))dialog.replaceChildren();
    const remaining=[...new Set((await storedProfiles()).map(key=>String(key).replace(/^selection:/,'')))].filter(key=>key!==profile&&validProfile(key));
    state.profile=remaining[0]??null;
    localStorage.setItem(PROFILE_PREFERENCE_KEY,state.profile);await refreshProfileOptions();await restoreProfile();
    cleanupChannel?.postMessage({profile});
  },
  lock:value=>{loading=value;$('profile').disabled=value;render();},report:message,
});
await refreshProfileOptions();
$('profile').value=state.profile??'';
await restoreProfile();

function skinOptions(held){
  const info=skinInfo(held),id=info.idolCardId;
  return {...favoriteContext('idolCardSkins',held.idolCardSkinId),immersive:state.views.idolCardSkins.skinImmersive,
    idolHeld:state.snapshot?.idolCards?.find(card=>card.idolCardId===id),
    getArt:()=>state.idolArt[id],onArt:art=>{state.idolArt[id]=art;persist();render();}};
}

// 分享链接使用公开账号与条目标识；旧卡片链接仍按当前档案定位。
function openMemoryLink(){
  const match=location.hash.match(/^#(selection-memory|memory)=(.*)$/);
  if(!match)return false;
  const params=new URLSearchParams(location.hash.slice(1)),selection=match[1]==='selection-memory',key=(params.get(match[1])??'').toLowerCase();
  const account=params.get('account');
  if(!validPublicUserId(account)){message(t('回忆链接缺少有效的游戏账号 ID，请重新复制链接。'),true);return true;}
  const profile=accountProfile(account);
  if(loading)return true;
  if(profile!==state.profile){ensureProfileOption(profile);$('profile').value=profile;void $('profile').onchange();return true;}
  state.tab=selection?'selectionMemories':'memories';resetDetail();
  state.views[state.tab]={...defaults(),query:/^[a-f0-9]{64}$/.test(key)?key:'',page:0};
  syncControls();render();
  if(loading)return true;
  if(!/^[a-f0-9]{64}$/.test(key)){message(t('回忆链接中的唯一标识无效。'),true);return true;}
  const rows=selection?state.selectionSnapshot?.selectionMemories:state.snapshot?.memories;
  if(!rows?.some(row=>row.key===key)){message(t('该游戏账号下未找到这条回忆，请导入同账号且包含它的快照。'),true);return true;}
  message('');persist();
  const card=$('list').querySelector(selection?`[data-selection-key="${key}"]`:`[data-memory-key="${key}"]`);
  if(card){card.classList.add('memory-link-target');card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({block:'center'});}
  return true;
}
function openSelectionLoadoutLink(){
  const params=new URLSearchParams(location.hash.slice(1));if(!params.has('selection-loadout'))return false;
  const account=params.get('account'),key=params.get('selection-loadout');
  if(!validPublicUserId(account)||!/^[a-f0-9]{64}$/.test(key)){message(t('培养阵容链接无效，请重新打开对应选拔回忆。'),true);return true;}
  if(loading)return true;
  const profile=accountProfile(account);
  if(profile!==state.profile){ensureProfileOption(profile);$('profile').value=profile;void $('profile').onchange().then(openCatalogLink);return true;}
  if(!masterReadyFor('selectionMemories')&&(state.snapshot||state.selectionSnapshot)){void ensureMaster(true);return true;}
  const detail=state.selectionSnapshot?.details?.find(row=>row.key===key);
  if(!detail){message(t('该账号未导入这份培养阵容详情。'),true);return true;}
  const memory=state.selectionSnapshot.selectionMemories.find(row=>row.key===key);
  state.tab='selectionMemories';resetDetail();syncControls();render();persist();message('');showSelectionDetails(detail,memory);return true;
}
function openCatalogLink(){
  if(openSelectionLoadoutLink())return;
  closeSelectionDetails();
  const match=location.hash.match(/^#(idol|support|skin)=/),params=new URLSearchParams(location.hash.slice(1));
  if(match&&params.has('account')){
    const account=params.get('account');
    if(!validPublicUserId(account)){message(t('分享链接中的游戏账号 ID 无效。'),true);return;}
    if(loading)return;
    const profile=accountProfile(account);
    if(profile!==state.profile){ensureProfileOption(profile);$('profile').value=profile;void $('profile').onchange().then(openCatalogLink);return;}
    if(!state.snapshot&&!state.selectionSnapshot){message(t('该游戏账号下没有库存数据，请先导入对应账号的快照。'),true);return;}
  }
  if(!masterReadyFor(linkedMasterScope())&&(state.snapshot||state.selectionSnapshot)&&location.hash){void ensureMaster(true);return;}
  if(openMemoryLink())return;
  if(!masterReadyFor(linkedMasterScope())||(!state.snapshot&&!state.selectionSnapshot))return;
  if(!match){if($('idol-dialog').open)$('idol-dialog').close();return;}
  const support=match[1]==='support',skin=match[1]==='skin',field=skin?'idolCardSkins':support?'supportCards':'idolCards',key=skin?'idolCardSkinId':support?'supportCardId':'idolCardId';
  const held=collectionRecords(state.snapshot??{},field,'all').find(row=>row[key]===params.get(match[1]));
  if(!held){message(t('本地目录中没有这张卡片。'),true);if($('idol-dialog').open)$('idol-dialog').close();return;}
  message('');state.tab=field;
  if(!skin){
    resetDetail();
    if($('idol-dialog').open)$('idol-dialog').close();
    state.views[field]={...defaults(),ownership:'all',query:held[key]};
    if(support&&params.has('level')){const level=Number(params.get('level'));if(Number.isSafeInteger(level)&&level>=1)state.supportTargets.set(`${state.profile}:${held.supportCardId}`,level);}
  }
  syncControls();render();(skin?()=>showSkin(held,skinOptions(held)):support?()=>focusSupport(held):()=>focusIdol(held))();
}
window.addEventListener('hashchange',openCatalogLink);
$('idol-dialog').addEventListener('close',()=>{if(/^#skin=/.test(location.hash))history.replaceState(null,'',location.pathname+location.search);});
openCatalogLink();

// 异步观察首尾分类的可见性，不在 DOM 更新后同步读取整页布局。
const navigation=$('navigation'),navigationFirst=navigation.querySelector('[data-tab]'),navigationLast=navigation.querySelector('[data-tab]:last-of-type');
let navigationWidth=0;
new ResizeObserver(([entry])=>{navigationWidth=entry.borderBoxSize?.[0]?.inlineSize??entry.contentRect.width;}).observe(navigation);
const navigationEdges=new IntersectionObserver(entries=>{
  for(const entry of entries){
    const control=$(entry.target===navigationFirst?'navigation-prev':'navigation-next');
    control.hidden=entry.isIntersecting&&entry.intersectionRatio>=.999;
  }
},{root:navigation,rootMargin:'2px 0px',threshold:[0,1]});
navigationEdges.observe(navigationFirst);navigationEdges.observe(navigationLast);
$('navigation-prev').onclick=()=>navigation.scrollBy({left:-navigationWidth*.7});
$('navigation-next').onclick=()=>navigation.scrollBy({left:navigationWidth*.7});
