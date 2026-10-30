import {mountResourceImages} from './ui/resource-images.mjs';
import {createAccountSessionManager,AccountSessionError,readLastAccount,rememberAccount,persistAccountSession} from './application/account-session.mjs';
import {features} from './application/features.mjs';
import {createChoiceAvailability} from './domain/choice-availability.mjs';
import {abilityChoiceKey,abilityFilterClauses,accountProducerLevel} from './domain/catalog.mjs';
import {createSupportEffectAvailability} from './domain/support-effect-choices.mjs';
import {syncSupportEffectChoices,renderSupportEffectChoices} from './ui/support-effect-picker.mjs';
import {WEB_VERSION} from './application/version.mjs';
import {markLoading,createViewTiming} from './application/loading-metrics.mjs';
import {contentManager} from './application/content-manager.mjs';
import {beginImageView} from './resources.mjs';
import {showSelectionDetails,closeSelectionDetails} from './ui/selection-details.mjs';
import {renderAchievementBrowser} from './ui/achievement-browser.mjs';
import {matchesTag,favoriteRecords} from './domain/personal-library.mjs';
import {setupLibraryUI,tagControls} from './ui/personal-library.mjs';
import {setupInlineTags} from './ui/inline-tags.mjs';
import {setupCustomTagExport} from './ui/custom-tag-export.mjs';
import {setupAccountCleanup} from './ui/account-cleanup.mjs';
import {setupAccountPackage} from './ui/account-package.mjs';
import {captureAccountBackup} from './application/account-package-store.mjs';
import {readAccountDirectory} from './application/account-directory.mjs';
import {AccountDirectoryError} from './domain/account-import.mjs';
import {resetDeferredContent,releaseDeferredContent,deferredEntry,sizeDeferredEntries} from './ui/deferred-content.mjs';
import {accountProfile,profileAccountId,validPublicUserId,validProfile,snapshotFitsProfile,maskedAccountId} from './domain/account.mjs';
import {accountIdentity} from './ui/shared.mjs';
import {selectionEntries,selectionSkillKey,withoutSecondExclusiveSkills,withoutCommonSelectionItems} from './domain/selection-memories.mjs';
import {setupSelectionOptions,renderSelectionChoices,renderLoadoutChoices,renderInheritanceChoices,selectionCapacity,selectionMemoryEntry} from './ui/selection-memories.mjs';
import {loadMaster,masterReadyFor,masterLoadingFor,masterDependencies} from './application/master-loader.mjs';
import {setupContentControls} from './ui/content-controls.mjs';
import {defaults,createView,createViews,readSavedViews,activeFilterKeys,resetFilters,FILTER_BINDINGS,CHOICE_GROUPS,normalizeProfile} from './application/view-state.mjs';
import {setupFilterOptions,prepareMemoryFilterOptions,syncMemoryFilterOptions,syncFilterControls,renderFilterChoices,renderTabCount,renderActiveFilters} from './ui/filters.mjs';
import {t,locale,setLocale,onLocaleChange,staticTranslations} from './i18n.mjs';
import {title, memoryUse, selectedValues} from './domain/model.mjs';
import {cardInfo, characterInfo, collectionRecords,skinInfo,achievementViewCounts,catalogGeneration} from './domain/catalog.mjs';
import {$,el,openDialog} from './ui/dom.mjs';
import {showDetail,memoryEntry,syncMemoryDetailFocus,restoreMemoryEntryFocus} from './ui/memories.mjs';
import {idolEntry,focusIdol} from './ui/idols.mjs';
import {skinEntry,showSkin} from './ui/skins.mjs';
import {supportEntry,focusSupport} from './ui/supports.mjs';
import {showComparison} from './ui/comparison.mjs';
import {supportEntries,idolEntries,skinEntries} from './domain/catalog-selectors.mjs';
import {filterMemories,canCompareMemory,inheritanceSkillKey} from './domain/memories.mjs';
import {isPreviewAccount} from './domain/account.mjs';
import {profileData,storedProfiles,accountDataSummary,clearAccountData} from './application/storage.mjs';

const disposeResourceImages=mountResourceImages();
window.addEventListener('pagehide',event=>{if(!event.persisted)disposeResourceImages();});

const profileExperience=new Map();
let accountLevelTask=null,accountLevelFailed=false;
function producerLevelLabel(profile){
  const level=accountProducerLevel(profileExperience.get(profile));
  return level===null?t('PLv.未知'):`PLv.${level}`;
}
function profileLabel(profile,number){
  const id=profileAccountId(profile);
  return `${isPreviewAccount(id)?t('预览账号'):t('账号{0} {1}',[number,maskedAccountId(id)])} ${producerLevelLabel(profile)}`;
}
function refreshAccountLabels(){
  if(state.snapshot&&snapshotFitsProfile(state.snapshot,state.profile))profileExperience.set(state.profile,state.snapshot.producerExp);
  let number=0;
  for(const option of $('profile').options){
    if(!validProfile(option.value))continue;
    option.textContent=profileLabel(option.value,isPreviewAccount(profileAccountId(option.value))?number:++number);
  }
  // 账号等级独立加载成长分包，不要求先进入赛季模拟；失败时保持未知。
  if(!masterReadyFor('account')&&!accountLevelTask&&!accountLevelFailed&&[...profileExperience.values()].some(Number.isSafeInteger)){
    accountLevelTask=loadMaster('account').then(()=>{
      observeCatalog({incremental:true});refreshAccountLabels();if($('data-dialog').open)renderAccountIdentity();
    }).catch(()=>{accountLevelFailed=true;}).finally(()=>{accountLevelTask=null;});
  }
}
function ensureProfileOption(profile){
  $('profile').querySelector('[data-empty-profile]')?.remove();
  if(![...$('profile').options].some(option=>option.value===profile))$('profile').add(new Option(isPreviewAccount(profileAccountId(profile))?t('预览账号'):t('账号{0} {1}',[[...$('profile').options].filter(option=>profileAccountId(option.value)&&!isPreviewAccount(profileAccountId(option.value))).length+1,maskedAccountId(profileAccountId(profile))]),profile));
}
async function refreshProfileOptions(){
  const stored=await storedProfiles(),profiles=new Set(stored.map(key=>String(key).replace(/^selection:/,'')).filter(profile=>validProfile(profile)&&(features.previewAccount||!isPreviewAccount(profileAccountId(profile)))));
  const records=await Promise.all([...profiles].map(async profile=>[profile,(await profileData(profile)).ordinary?.snapshot?.producerExp]));
  profileExperience.clear();for(const [profile,exp] of records)profileExperience.set(profile,exp);
  const profile=profiles.has(state.profile)?state.profile:[...profiles][0]??null;
  let accountNumber=0;
  $('profile').replaceChildren(...[...profiles].map(profile=>new Option(isPreviewAccount(profileAccountId(profile))?t('预览账号'):t('账号{0} {1}',[++accountNumber,maskedAccountId(profileAccountId(profile))]),profile)));
  if(!profiles.size){const empty=new Option(t('未导入账号'),'');empty.dataset.emptyProfile='';$('profile').append(empty);}
  $('profile').value=profile??'';
  refreshAccountLabels();return profile;
}
const accountSessions=createAccountSessionManager();
const state={profile:readLastAccount(),lifecycleId:null,tab:'memories',views:createViews(),snapshot:null,selectionSnapshot:null,library:null,selected:new Set(),detail:null,supportTargets:new Map(),idolTargets:new Map(),idolArt:{}};
const pageSize=40;
let viewRun=0;
let customTagExport;
const viewTiming=createViewTiming({ready:masterReadyFor,version:()=>contentManager.status().version});
const expandedFilters=new Set();
let loading=false,searchTimer,controlsPending=false;
const masterTasks=new Map(),masterFailures=new Set();
const catalogVersions=new Map(),renderedControls=new Map(),renderedEntries=new WeakMap();
let observedCatalogGeneration=catalogGeneration(),readyCatalogScopes=new Set(Object.keys(masterDependencies).filter(masterReadyFor));
function observeCatalog({incremental=false}={}){
  const generation=catalogGeneration();if(generation===observedCatalogGeneration)return;
  // 按需追加分包只使新就绪的页面失效；其它目录安装仍让所有已有展示重新读取资料。
  const ready=new Set(Object.keys(masterDependencies).filter(masterReadyFor));
  for(const tab of Object.keys(state.views))if(!incremental||!readyCatalogScopes.has(tab))catalogVersions.set(tab,generation);
  observedCatalogGeneration=generation;readyCatalogScopes=ready;
}
function catalogVersion(tab){observeCatalog();return catalogVersions.get(tab)??0;}
function renderCachedControls(key,values,draw){
  const previous=renderedControls.get(key),context={view:view(),snapshot:state.snapshot,selectionSnapshot:state.selectionSnapshot,version:catalogVersion(state.tab),language:locale(),values:JSON.stringify(values)};
  if(previous&&Object.keys(context).every(key=>context[key]===previous[key]))return;
  draw();renderedControls.set(key,context);
}
const groups=new Map();
let inventoryPagination={tab:null,pages:1},renderedCatalogContext=null;
const view=()=>state.views[state.tab];
let messageTimer;
function message(text,error=false,{transient=false}={}){
  clearTimeout(messageTimer);
  $('message').textContent=text;$('message').hidden=!text;$('message').classList.toggle('error',error);
  if($('data-dialog').open){
    const output=$('data-message');output.textContent=text;output.hidden=!text;output.classList.toggle('error',error);
    output.setAttribute('role',error?'alert':'status');output.setAttribute('aria-live',error?'assertive':'polite');
    if(error&&text){output.focus({preventScroll:true});output.scrollIntoView({block:'nearest'});}
  }
  if(text&&!error&&transient)messageTimer=setTimeout(()=>{
    $('message').hidden=true;$('message').textContent='';
    if($('data-message').textContent===text){$('data-message').hidden=true;$('data-message').textContent='';}
  },3000);
}
function persist(){
  if(!validProfile(state.profile))return;
  try {
    persistAccountSession(state);
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

function tagContext(kind,key,inDetail=false){
  const library=state.library;
  const resolve=()=>{
    if(inDetail?state.detail!==key:state.tab!==kind)return null;
    const container=inDetail?$('detail-content'):[...$('list').children].find(row=>row.dataset[kind==='memories'?'memoryKey':'selectionKey']===key);
    return container?.querySelector('.custom-tags');
  };
  return {tags:tagsFor(kind,key),tagsDisabled:!library,
    editTags:()=>{if(!loading&&state.library===library)inlineTags.open({kind,key},resolve);},
    removeTag:name=>{if(!loading&&state.library===library)inlineTags.remove({kind,key},name,resolve);}};
}
function refreshTagControls(container,kind,key,inDetail=false){
  const previous=container?.querySelector('.custom-tags');if(!previous)return;
  const context=tagContext(kind,key,inDetail);
  previous.replaceWith(tagControls(context.tags,context.editTags,context.tagsDisabled,previous.classList.contains('inline-tags'),context.removeTag));
}
function refreshTags(before){
  const changed={};
  const previousFilters=Object.fromEntries(['memories','selectionMemories'].map(kind=>[kind,state.views[kind].customTag]));
  for(const kind of ['memories','selectionMemories']){
    changed[kind]=new Set([...Object.keys(before[kind]),...Object.keys(state.library.data[kind])].filter(key=>{
      const previous=before[kind][key]??[],next=tagsFor(kind,key);
      return previous.length!==next.length||previous.some((name,index)=>name!==next[index]);
    }));
  }
  tagOptions();customTagExport?.sync();
  for(const kind of ['memories','selectionMemories']){
    if(!changed[kind].size&&previousFilters[kind]===state.views[kind].customTag)continue;
    const values=kind==='memories'?memoryValues(state.views[kind]):selectionValues(state.views[kind]);
    updateTabCount(kind,values.length);
    if(state.tab===kind){
      // 保留仍在当前页的卡片和图片；标签进入搜索条件时，仅调整结果成员。
      renderInventoryList(values,{preserve:true});
      for(const row of $('list').children){
        const key=row.dataset[kind==='memories'?'memoryKey':'selectionKey'];
        if(changed[kind].has(key))refreshTagControls(row,kind,key);
      }
      if(previousFilters[kind]!==view().customTag){renderFilterDisclosure();renderCurrentFilters();}
      if(kind==='memories'&&state.detail){
        const index=values.findIndex(memory=>memory.key===state.detail);
        $('detail-prev').disabled=index<=0;$('detail-next').disabled=index<0||index===values.length-1;
      }
    }
  }
  if(state.detail&&changed.memories.has(state.detail))refreshTagControls($('detail-content'),'memories',state.detail,true);
  inlineTags.sync();persist();
}
function favoriteContext(kind,id){
  const library=state.library;
  return {favorite:library?.data.favorites[kind].includes(id)??false,favoriteDisabled:!library,onFavorite:enabled=>{
  if(loading||!library||state.library!==library)return false;
  try{
    library.favorite(kind,id,enabled);
    if(state.tab!==kind||view().ownership!=='favorites')return true;
    refreshCurrentView({controls:false});
    const row=[...$('list').children].find(row=>row.dataset[{idolCards:'idolId',supportCards:'supportId',idolCardSkins:'skinId',memories:'memoryKey',selectionMemories:'selectionKey'}[kind]]===id);
    (row?.querySelector('.favorite-button')??$('filter-toggle')).focus({preventScroll:true});return true;
  }catch{message(t('收藏未能保存，请检查浏览器存储空间。'),true);return false;}
}};}
const savedViewWarnings=new Set();
function savedViews(){
  if(!validProfile(state.profile))return [];
  const result=readSavedViews(state.profile);
  if(result.recovered&&!savedViewWarnings.has(state.profile)){
    savedViewWarnings.add(state.profile);message(t('常用筛选无法读取，已使用默认设置；账号库存保留。'),true);
  }
  return result.values;
}
function refreshSavedViews(selected=''){$('saved-view').replaceChildren(new Option(t('常用筛选'),''),...savedViews().map((v,i)=>new Option(v.name,String(i))));$('saved-view').value=selected;$('delete-view').disabled=$('saved-view').value==='';}
function renderPendingCatalogCounts(){
  for(const tab of ['idolCards','supportCards','idolCardSkins','achievements'])if(!masterReadyFor(tab))updateTabCount(tab,null);
}

function setup(){
  const controls=state.tab!=='achievements'&&masterReadyFor(state.tab);controlsPending=!controls;
  setupFilterOptions(state.snapshot,groups,{controls,tab:state.tab});
  if(controls){if(state.tab==='selectionMemories')setupSelectionOptions(state.selectionSnapshot);refreshSavedViews();}
  if(masterReadyFor('selectionMemories')){state.views.selectionMemories.selectionSkill=withoutSecondExclusiveSkills(state.views.selectionMemories.selectionSkill);state.views.selectionMemories.selectionItem=withoutCommonSelectionItems(state.views.selectionMemories.selectionItem);}
  if(state.tab==='supportCards'&&masterReadyFor('supportCards'))syncSupportEffectChoices(state.snapshot,state.views.supportCards);
  for(const [tab,filters] of Object.entries(state.views)){
    if(tab==='seasonSimulation')continue;
    if(tab==='achievements'){updateTabCount(tab);continue;}
    if(tab==='selectionMemories'){updateTabCount(tab,state.selectionSnapshot?selectionValues(filters).length:undefined);continue;}
    if(!state.snapshot||!masterReadyFor(tab)){updateTabCount(tab,null);continue;}
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
  if(tab==='seasonSimulation')return;
  const hasAccount=Boolean(state.snapshot||state.selectionSnapshot);
  if(!hasAccount){renderTabCount(tab,null,undefined,t('未导入'));return;}
  if(tab!=='achievements'){
    const present=tab==='selectionMemories'?Boolean(state.selectionSnapshot):state.snapshot?.[tab]!==undefined;
    if(!present){renderTabCount(tab,undefined);return;}
  }
  if(!masterReadyFor(tab)){
    renderTabCount(tab,null,undefined,t(masterFailures.has(tab)?'资料失败':masterLoadingFor(tab)?'资料加载中':'资料待加载'));return;
  }
  if(tab==='achievements'){
    const counts=achievementViewCounts(state.snapshot,state.views.achievements);
    renderTabCount(tab,counts.count,counts.total);const output=$('count-'+tab);output.title=t('公共成就资料：{0} / {1} 条',[counts.count,counts.total]);return;
  }
  const s=state.snapshot,filters=state.views[tab];
  if(tab==='selectionMemories'){renderTabCount(tab,count,state.selectionSnapshot?.count);return;}
  const missing=s?.[tab]===undefined;
  renderTabCount(tab,missing?undefined:count,tab==='memories'?s?.memories.length:(['idolCards','supportCards','idolCardSkins'].includes(tab)?favoriteRecords(s,tab,catalogFilters(tab,filters),collectionRecords):collectionRecords(s,tab,filters.ownership??'owned')).length);
}
function syncControls(){
  if(state.tab==='seasonSimulation'){for(const nav of document.querySelectorAll('[data-tab]'))nav.setAttribute('aria-pressed',String(nav.dataset.tab===state.tab));return;}
  if(!masterReadyFor(state.tab)){controlsPending=true;return;}
  if(state.tab!=='achievements'){
    setupFilterOptions(state.snapshot,groups,{tab:state.tab});
    if(state.tab==='selectionMemories')setupSelectionOptions(state.selectionSnapshot);
    if(controlsPending){refreshSavedViews();controlsPending=false;}
    tagOptions();
  }
  if(state.tab==='memories')syncMemoryFilterOptions(state.snapshot,view());
  if(state.tab==='supportCards')syncSupportEffectChoices(state.snapshot,view());
  syncFilterControls(view(),state.tab);
}
function filteredMemories(){return memoryValues(view());}
function supportPickerAvailability(){
  const filters={...view(),supportSkills:[]};
  const entries=supportEntries(state.snapshot,filters.query.trim().toLowerCase(),filters.catalogSort,catalogFilters('supportCards',filters));
  return createSupportEffectAvailability(entries.map(entry=>entry.searchEffects));
}
function pickerAvailability(key){
  const filters={...view(),[key]:[]},memories=state.tab==='memories'?memoryValues(filters):selectionValues(filters).map(entry=>entry.memory);
  const keys=memory=>{
    if(key==='skill')return memory.produceCard?[memory.produceCard.id,inheritanceSkillKey(memory)]:[];
    if(key==='ability')return (memory.abilities??[]).map(ability=>abilityChoiceKey(ability.id));
    if(key==='memoryExamSkill')return (memory.examBattleProduceCards??[]).map(selectionSkillKey);
    if(key==='memoryExamItem')return memory.examBattleProduceItemIds??[];
    if(key==='selectionSkill')return memory.produceCards.map(selectionSkillKey);
    return memory.produceItems.map(item=>item.id);
  };
  const mode=key==='ability'?'grouped':key==='skill'||filters[key+'All']===false?'any':'all';
  return createChoiceAvailability(memories.map(keys),{mode,clauses:abilityFilterClauses});
}
function onFilterChoice(key,value,extra={}){Object.assign(view(),extra,{[key]:value});view().page=0;refreshCurrentView();persist();}
const compactFilters=matchMedia('(max-width: 640px)');
const secondaryControls=['memory-modes','selection-lock-controls','ownership-controls'].map(id=>{
  const control=$(id),anchor=document.createComment('筛选控件原位置');
  control.before(anchor);return {control,anchor};
});
function placeSecondaryControls(){
  for(const {control,anchor} of secondaryControls){
    if(compactFilters.matches)$('mobile-view-controls').append(control);
    else anchor.after(control);
  }
}
compactFilters.addEventListener('change',placeSecondaryControls);
placeSecondaryControls();
function renderFilterDisclosure(){
  const expanded=expandedFilters.has(state.tab),v=view();
  const count=activeFilterKeys(state.tab,v).reduce((total,key)=>total+(v[key]===true?1:selectedValues(v[key]).length),0);
  $('advanced-filters').hidden=!expanded;
  $('filter-toggle').setAttribute('aria-expanded',String(expanded));
  $('filter-toggle').textContent=t('筛选{0}',[count?` · ${count}`:''])+(expanded?' ▴':' ▾');
}
function renderAccountIdentity(){
  const id=profileAccountId(state.profile),hasData=Boolean(state.snapshot||state.selectionSnapshot);
  $('data-account-identity').replaceChildren(id?accountIdentity(id,producerLevelLabel(state.profile)):el('strong',hasData?$('profile').selectedOptions[0]?.textContent:t('未导入账号')));
}
function renderAccountOverview(){
  const id=profileAccountId(state.profile),hasData=Boolean(state.snapshot||state.selectionSnapshot);
  renderAccountIdentity();
  $('preview-account-section').hidden=!features.previewAccount;
  $('enable-preview-account').textContent=t(isPreviewAccount(id)?'已启用预览':'启用预览');$('enable-preview-account').disabled=loading||isPreviewAccount(id);
  $('data-account-counts').replaceChildren();
  if(hasData){
    for(const [label,value] of [['普通回忆',state.snapshot?.memories?.length],['选拔回忆',state.selectionSnapshot?.count],['已关联详情',state.selectionSnapshot?.details?.length]]){
      const item=el('span');item.append(el('b',value===undefined?t('未采集'):String(value)),el('span',t(label)));$('data-account-counts').append(item);
    }
  }else $('data-account-counts').append(el('p',t('导入采集目录或数据包，开始整理收藏。')));
}
let filterUndo=null,filterUndoTimer;
function clearFilterUndo(){filterUndo=null;clearTimeout(filterUndoTimer);$('filter-undo-notice').hidden=true;}
function refreshFilterUndo(){
  if(filterUndo&&(filterUndo.profile!==state.profile||filterUndo.tab!==state.tab||filterUndo.after!==JSON.stringify(view())))clearFilterUndo();
}
function clearFilters(action){
  clearFilterUndo();const before=structuredClone(view()),profile=state.profile,tab=state.tab;
  action();filterUndo={before,profile,tab,after:JSON.stringify(view())};
  $('filter-undo-notice').hidden=false;filterUndoTimer=setTimeout(clearFilterUndo,6000);
}
$('filter-undo').onclick=()=>{
  refreshFilterUndo();if(!filterUndo)return;
  const before=filterUndo.before;clearFilterUndo();Object.assign(view(),before);
  refreshCurrentView();persist();$('filter-toggle').focus({preventScroll:true});
};
function renderMasterReadiness(){
  const content=contentManager.status(),hasAccount=Boolean(state.snapshot||state.selectionSnapshot);
  const missing=!masterReadyFor(state.tab),needed=hasAccount||state.tab==='achievements'||!content.version;
  const failed=Boolean(content.error||masterFailures.has(state.tab));
  $('content-readiness').hidden=!(missing&&needed);
  $('content-readiness').classList.toggle('is-error',failed);
  const text=t(failed?'卡片资料暂不可用，已有账号数据保留。':'正在准备卡片资料，账号导入不受影响。');
  if($('content-readiness-text').textContent!==text)$('content-readiness-text').textContent=text;
  $('content-readiness-retry').hidden=!failed;
  $('content-readiness-retry').disabled=masterTasks.has(state.tab)||['checking','downloading','verifying','saving'].includes(content.phase);
}
let seasonOpening=false,seasonComponent=null,seasonSnapshot=null,seasonProfile=null,seasonGeneration=0,seasonMemoryRequest=null,seasonRestoreState=null;
function resetSeasonPage({preserve=false}={}){
  seasonRestoreState=preserve?seasonComponent?.captureState?.():null;
  seasonGeneration++;seasonComponent?.dispose();seasonComponent=null;seasonSnapshot=null;seasonProfile=null;seasonOpening=false;seasonMemoryRequest=null;$('season-simulation-view').replaceChildren();$('season-picker-controls').replaceChildren();
}
function renderSeasonPage(){
  const host=$('season-simulation-view');
  if(!state.snapshot){host.replaceChildren(el('p',t('请先导入对应账号的数据。'),'empty-result'));return;}
  if(seasonComponent){if(seasonMemoryRequest){seasonComponent.useMemory?.(seasonMemoryRequest);seasonMemoryRequest=null;}return;}
  if(!masterReadyFor('seasonSimulation')){host.replaceChildren(el('p',t('正在准备卡片资料，账号导入不受影响。'),'small muted'));return;}
  if(seasonOpening||loading)return;
  seasonOpening=true;const ticket=++seasonGeneration,profile=state.profile,snapshot=state.snapshot;
  host.replaceChildren(el('p',t('正在准备赛季模拟…'),'small muted'));
  void import('./ui/season-simulation.mjs').then(module=>{
    if(ticket!==seasonGeneration||state.profile!==profile||state.snapshot!==snapshot)return;
    seasonComponent=module.createSeasonSimulation({profile,lifecycleId:state.lifecycleId,memories:snapshot.memories,idolCards:snapshot.idolCards,supportCards:snapshot.supportCards,producerExp:snapshot.producerExp,produceCardConversions:snapshot.produceCardConversions,initialState:seasonRestoreState,onOpenMemory:openSeasonMemory});seasonRestoreState=null;seasonSnapshot=snapshot;seasonProfile=profile;host.replaceChildren(seasonComponent.element);$('season-picker-controls').replaceChildren(...(seasonComponent.controls?[seasonComponent.controls]:[]));
    if(seasonMemoryRequest){seasonComponent.useMemory?.(seasonMemoryRequest);seasonMemoryRequest=null;}
  }).catch(()=>{
    // 模块导入失败会被当前页面缓存；重新加载程序才能真正重试，本地库存仍保留。
    if(ticket!==seasonGeneration)return;const retry=el('button',t('重试'));retry.onclick=()=>location.reload();host.replaceChildren(el('p',t('赛季资料加载失败，请重试。'),'message error'),retry);
  }).finally(()=>{if(ticket===seasonGeneration)seasonOpening=false;});
}
function syncLoadingControls(){
  const hasData=Boolean(state.snapshot||state.selectionSnapshot);
  $('profile').disabled=loading;
  for(const button of document.querySelectorAll('[data-tab]'))button.disabled=loading||!hasData;
  $('export-account-package').disabled=loading||!profileAccountId(state.profile)||!hasData||!state.library;
  $('import-account-package').disabled=loading;$('enable-preview-account').disabled=loading||isPreviewAccount(profileAccountId(state.profile));
  $('clear-account').disabled=loading||!hasData;$('manage-tags').disabled=loading||!state.library||!hasData;
  for(const id of ['empty-import-account','import-account-directory'])$(id).disabled=loading;
  const pages=inventoryPagination.tab===state.tab?inventoryPagination.pages:1;
  $('previous').disabled=loading||view().page===0;$('next').disabled=loading||view().page+1>=pages;
  customTagExport?.sync();
}
function setLoading(value){
  loading=value;syncLoadingControls();
  if(!loading&&state.tab==='seasonSimulation')renderSeasonPage();
}
function render(){
  customTagExport?.sync();
  refreshAccountLabels();
  if(seasonComponent&&(seasonProfile!==state.profile||seasonSnapshot!==state.snapshot))resetSeasonPage();
  renderMasterReadiness();
  for(const tab of Object.keys(state.views))if((!state.snapshot&&!state.selectionSnapshot)||!masterReadyFor(tab))updateTabCount(tab,null);
  const achievementContext=$('achievement-account-context');achievementContext.hidden=state.tab!=='achievements'||(!state.snapshot&&!state.selectionSnapshot);
  achievementContext.textContent=t(!state.snapshot&&!state.selectionSnapshot?'公共成就资料可直接浏览；个人达成状态：未导入账号。':state.snapshot?.achievements===undefined?'公共成就资料可直接浏览；当前账号尚未采集成就记录。':'公共成就资料与个人进度分开显示；达成状态以当前账号采集记录为准。');
  beginImageView(state.tab);
  renderedCatalogContext=currentCatalogContext();
  refreshFilterUndo();
  clearTimeout(searchTimer);resetDeferredContent();
  if($('data-dialog').open)renderAccountOverview();
  const s=state.snapshot??{memories:[]},v=view(),memory=state.tab==='memories',selection=state.tab==='selectionMemories',achievement=state.tab==='achievements',hasData=Boolean(state.snapshot||state.selectionSnapshot);
  $('season-simulation-view').hidden=state.tab!=='seasonSimulation'||!hasData;
  $('season-picker-region').hidden=state.tab!=='seasonSimulation'||!hasData;if(state.tab!=='seasonSimulation')seasonComponent?.hidePicker?.();
  for(const nav of document.querySelectorAll('[data-tab]'))nav.setAttribute('aria-pressed',String(nav.dataset.tab===state.tab));
  const memoryChoices=memory&&masterReadyFor('memories')?syncMemoryFilterOptions(state.snapshot,v):null;
  if(memory)for(const id of ['inheritance-skill-open','inheritance-ability-open','memory-skill-open','memory-item-open'])$(id).disabled=!memoryChoices;
  $('empty').hidden=hasData;$('inventory').hidden=!hasData;$('shared-search').hidden=!hasData;
  $('selection-capacity').hidden=!selection;
  $('achievement-browser').hidden=!achievement||!hasData;
  $('filter-toggle').closest('.filters').hidden=achievement;
  syncLoadingControls();
  if(!hasData){selectionControls();syncMemoryDetailFocus();return;}
  if(state.tab==='seasonSimulation'){$('inventory').hidden=true;$('shared-search').hidden=true;selectionControls();renderSeasonPage();return;}
  if(achievement){$('inventory').hidden=true;$('shared-search').hidden=true;refreshAchievementView();return;}
  if(!masterReadyFor(state.tab)&&!memory&&!selection){$('shared-search').hidden=true;$('filter-toggle').closest('.filters').hidden=true;$('list').replaceChildren();$('previous').disabled=true;$('next').disabled=true;selectionControls();return;}
  $('section-title').textContent={memories:t('回忆'),selectionMemories:t('选拔回忆'),idolCards:t('偶像卡'),supportCards:t('支援卡'),idolCardSkins:t('主题装扮'),achievements:t('成就')}[state.tab];
  $('search-scope').textContent=t('搜索范围：{0}',[$('section-title').textContent]);
  for(const section of document.querySelectorAll('[data-filter-tab]'))section.hidden=section.dataset.filterTab!==state.tab;
  $('skin-filters').hidden=state.tab!=='idolCardSkins';
  $('idol-filters').hidden=state.tab!=='idolCards';
  $('idol-effect-chips').hidden=state.tab!=='idolCards';
  for(const [container,,,,tab] of CHOICE_GROUPS)$(container).hidden=state.tab!==tab;
  if(selection){selectionCapacity(state.selectionSnapshot);$('snapshot-meta').textContent=state.selectionSnapshot?t('快照 {0}',[new Date(state.selectionSnapshot.captured_at).toLocaleString(locale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})]):t('尚未采集');}
  else $('snapshot-meta').textContent=state.snapshot?t('快照 {0}',[new Date(state.snapshot.captured_at).toLocaleString(locale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})]):t('尚未载入');
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
  renderViewChoices(memoryChoices);
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
  renderInventoryList(values);
  renderCurrentFilters();
  const trainingCount=s.memories.filter(m=>memoryUse(m)==='training').length;
  $('group-summary').textContent=memory?t('培养专用 {0} 条',[trainingCount]):'';
  selectionControls();syncMemoryDetailFocus();
}
function renderViewChoices(memoryChoices){
  const v=view();
  for(const [container,input,key,faces,tab] of CHOICE_GROUPS){
    if(state.tab!==tab)continue;
    const options=[...$(input).options].map(option=>[option.value,option.text,option.hidden]);
    renderCachedControls(container,[v[key],options],()=>renderFilterChoices(container,input,key,faces,v,onFilterChoice));
  }
  if(state.tab==='supportCards'){
    const choices=syncSupportEffectChoices(state.snapshot,v);
    renderCachedControls('support-effects',[v.supportPlan,v.supportPlanCommon,v.supportType,v.supportSkills],()=>renderSupportEffectChoices(v,choices,onFilterChoice,supportPickerAvailability));
  }
  if(state.tab==='selectionMemories')renderCachedControls('selection-loadout',[v.selectionSkill,v.selectionItem,v.selectionSkillAll,v.selectionItemAll,v.selectionCharacter],()=>renderSelectionChoices(v,onFilterChoice,pickerAvailability));
  if(memoryChoices){
    renderCachedControls('memory-inheritance',[v.character,v.skill,v.ability,v.inheritanceStartOnly,v.inheritanceCustomizedOnly],()=>renderInheritanceChoices(v,memoryChoices,onFilterChoice,pickerAvailability));
    renderCachedControls('memory-loadout',[v.character,v.memoryExamSkill,v.memoryExamItem,v.memoryExamSkillAll,v.memoryExamItemAll],()=>renderLoadoutChoices(v,onFilterChoice,{prefix:'memory',skillKey:'memoryExamSkill',itemKey:'memoryExamItem',choices:memoryChoices,characters:[],createAvailability:pickerAvailability}));
  }
}
function currentValues(){
  const v=view(),s=state.snapshot??{memories:[]},query=v.query.trim().toLowerCase();
  return state.tab==='selectionMemories'?selectionValues(v):state.tab==='memories'?memoryValues(v):state.tab==='supportCards'?supportEntries(s,query,v.catalogSort,catalogFilters(state.tab,v)):state.tab==='idolCardSkins'?skinEntries(s,query,catalogFilters(state.tab,v)):idolEntries(s,query,v.catalogSort,catalogFilters(state.tab,v));
}
function refreshAchievementView(){
  updateTabCount('achievements');
  renderAchievementBrowser($('achievement-browser'),{snapshot:state.snapshot,view:state.views.achievements,ready:masterReadyFor('achievements'),renderVersion:catalogVersion('achievements'),change:()=>{refreshAchievementView();persist();}});
}
function refreshDetailNavigation(values=memoryValues(state.views.memories)){
  if(!state.detail)return;
  const index=values.findIndex(memory=>memory.key===state.detail);
  $('detail-prev').disabled=index<=0;$('detail-next').disabled=index<0||index===values.length-1;
}
function refreshCurrentView({controls=true}={}){
  clearTimeout(searchTimer);refreshFilterUndo();
  if(state.tab==='achievements'){refreshAchievementView();renderedCatalogContext=currentCatalogContext();return;}
  if(state.tab==='seasonSimulation'){renderSeasonPage();renderedCatalogContext=currentCatalogContext();return;}
  if(!state.snapshot&&!state.selectionSnapshot)return;
  if(!masterReadyFor(state.tab)&&!['memories','selectionMemories'].includes(state.tab))return;
  const v=view(),context=currentCatalogContext(),contentChanged=!renderedCatalogContext||!sameMasterRequest(context,renderedCatalogContext);
  if(controls||contentChanged){
    syncControls();
    if(state.tab==='selectionMemories')$('snapshot-meta').textContent=state.selectionSnapshot?t('快照 {0}',[new Date(state.selectionSnapshot.captured_at).toLocaleString(locale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})]):t('尚未采集');
    const choices=state.tab==='memories'&&masterReadyFor('memories')?syncMemoryFilterOptions(state.snapshot,v):null;
    renderViewChoices(choices);
    if(state.tab==='memories')for(const id of ['inheritance-skill-open','inheritance-ability-open','memory-skill-open','memory-item-open'])$(id).disabled=!choices;
    $('ownership').value=v.ownership==='favorites'&&state.tab!=='idolCardSkins'?'all':v.ownership;
    $('owned-only').setAttribute('aria-checked',String(v.ownership==='owned'));
    for(const kind of ['idol','support','memory','selection','skin'])$(kind+'-favorites-only').checked=v.ownership==='favorites';
    $('memory-locked-only').checked=v.protection==='protected';$('selection-locked-only').checked=v.selectionProtection==='protected';
    $('catalog-owned-first').setAttribute('aria-checked',String(v.ownedFirst));
  }
  $('search-clear').hidden=!v.query;renderFilterDisclosure();
  const values=currentValues();renderInventoryList(values,{preserve:true});renderCurrentFilters();
  if(state.tab==='memories'){refreshDetailNavigation(values);if(contentChanged&&state.detail)refreshMemoryDetail();}
  renderedCatalogContext=currentCatalogContext();syncMemoryDetailFocus();
}
const inventoryKeyFields={memories:'memoryKey',selectionMemories:'selectionKey',idolCards:'idolId',supportCards:'supportId',idolCardSkins:'skinId'};
function inventoryKey(value,tab){return tab==='memories'?value.key:tab==='selectionMemories'?value.memory.key:value.held[{idolCards:'idolCardId',supportCards:'supportCardId',idolCardSkins:'idolCardSkinId'}[tab]];}
function buildInventoryEntry(value,tab){
  const v=state.views[tab],key=inventoryKey(value,tab),targetKey=`${state.profile}:${key}`;
  if(tab==='selectionMemories')return selectionMemoryEntry(value,{...tagContext(tab,key),...favoriteContext(tab,key),collapsed:v.selectionLoadoutCollapsed,detail:state.selectionSnapshot?.details?.find(detail=>detail.key===key)});
  if(tab==='memories')return memoryEntry(value,{...tagContext(tab,key),...favoriteContext(tab,key),selected:state.selected.has(key),active:state.detail===key,purpose:v.purpose,sort:v.sort,open:openDetail,select:selectMemory,simulate:useMemoryForSeason});
  if(tab==='supportCards')return supportEntry(value,{...favoriteContext(tab,key),immersive:v.supportImmersive,targetLevel:state.supportTargets.get(targetKey),onTarget:level=>state.supportTargets.set(targetKey,level)});
  if(tab==='idolCards'){
    const artwork=state.idolArt;
    return idolEntry(value,{...favoriteContext(tab,key),immersive:v.idolImmersive,target:{...state.idolTargets.get(targetKey),art:artwork[key]??state.idolTargets.get(targetKey)?.art},onTarget:target=>state.idolTargets.set(targetKey,target),onArt:art=>{artwork[key]=art;if(state.idolArt===artwork)persist();}});
  }
  return skinEntry(value,skinOptions(value.held));
}
function renderInventoryList(values,{preserve=false}={}){
  const s=state.snapshot??{memories:[]},v=view(),tab=state.tab,memory=tab==='memories',selection=tab==='selectionMemories';
  const currentPageSize=tab==='supportCards'&&!v.supportImmersive?10:pageSize;
  const pages=Math.max(1,Math.ceil(values.length/currentPageSize));v.page=Math.min(v.page,pages-1);
  inventoryPagination={tab,pages};
  const list=$('list'),field=inventoryKeyFields[tab];
  list.className=`inventory-list ${selection?'selection-memory-catalog':memory?'compact-grid':tab==='supportCards'?'support-catalog':tab==='idolCardSkins'?'skin-catalog':'idol-catalog'}`;
  list.classList.toggle('memory-catalog',memory);list.classList.toggle('support-immersive',tab==='supportCards'&&v.supportImmersive);list.classList.toggle('idol-immersive',tab==='idolCards'&&v.idolImmersive);
  const rows=[],previous=preserve?new Map([...list.children].map(row=>[row.dataset[field],row])):new Map();
  const context={tab,profile:state.profile,library:state.library,snapshot:state.snapshot,selectionSnapshot:state.selectionSnapshot,version:catalogVersion(tab),language:locale()};
  const eagerCount=tab==='idolCardSkins'||v.idolImmersive||v.supportImmersive?8:2;
  for(const [index,value] of values.slice(v.page*currentPageSize,(v.page+1)*currentPageSize).entries()){
    const key=inventoryKey(value,tab),existing=previous.get(key),before=renderedEntries.get(existing);
    // 排序和筛选只改变成员或顺序；仅卡片实际展示、账号库存或所属资料变化时替换节点。
    const display=memory?Boolean(v.purpose!=='inheritance'&&(value.examBattleProduceCards?.length||value.examBattleProduceItemIds?.length)):tab==='idolCards'?v.idolImmersive:tab==='supportCards'?v.supportImmersive:false;
    const next={...context,source:value.held?JSON.stringify(value.held):selection?value.memory:value,display};
    let row;
    if(before&&Object.keys(next).every(key=>next[key]===before[key])){
      row=existing;
      if(selection&&before.collapsed!==v.selectionLoadoutCollapsed)for(const section of row.querySelectorAll('.selection-loadout'))section.open=!v.selectionLoadoutCollapsed;
    }else{
      const build=()=>{const node=buildInventoryEntry(value,tab);renderedEntries.set(node,{...next,collapsed:state.views[tab].selectionLoadoutCollapsed});return node;};
      const identity=selection?{className:'selection-memory-card',dataset:{selectionKey:key},label:title(value.memory)}:memory?{className:'memory-row memory-card',dataset:{memoryKey:key,memoryUse:memoryUse(value)},label:title(value)}:tab==='supportCards'?{className:'support-card',dataset:{supportId:key},label:value.info.name}:tab==='idolCards'?{className:'idol-card',dataset:{idolId:key},label:value.info.name}:{className:'skin-card',dataset:{skinId:key},label:value.info.name};
      row=index<eagerCount?build():deferredEntry(build,identity);
    }
    renderedEntries.set(row,{...next,collapsed:v.selectionLoadoutCollapsed});
    if(memory){
      row.classList.toggle('selected',state.selected.has(key));row.classList.toggle('active',state.detail===key);
      const input=row.querySelector('.pick input');if(input)input.checked=state.selected.has(key);
    }
    rows.push(row);
  }
  const missing=selection?!state.selectionSnapshot:(tab==='supportCards'||tab==='idolCardSkins')&&s[tab]===undefined;
  if(!values.length)rows.push(previous.get(undefined)?.classList.contains('empty-result')?previous.get(undefined):el('div',missing?t(selection?'尚未采集选拔回忆，请导入独立快照。':'尚未导入主库存，请导入当前格式的账号目录。'):t('没有匹配条目。试试减少筛选条件或清空搜索。'),'empty-result'));
  if(preserve){
    const retained=new Set(rows);
    for(const row of [...list.children])if(!retained.has(row)){releaseDeferredContent(row);row.remove();}
    for(const [index,row] of rows.entries())if(list.children[index]!==row)list.insertBefore(row,list.children[index]??null);
  }else list.replaceChildren(...rows);
  sizeDeferredEntries(list);
  updateTabCount(tab,values.length);
  $('page-number').textContent=t("{0} / {1} 页",[v.page+1,pages]);$('previous').disabled=loading||v.page===0;$('next').disabled=loading||v.page+1>=pages;
  inlineTags.sync();
}
function renderCurrentFilters(){
  const v=view(),achievement=state.tab==='achievements';
  const conditions=activeFilterKeys(state.tab,v);
  renderCachedControls('active-filters',[v.query,conditions.map(key=>[key,v[key]]),v.memoryExamSkillAll,v.memoryExamItemAll,v.selectionSkillAll,v.selectionItemAll,v.supportCharacterAll,v.supportPlanCommon],()=>{
    const activeCount=renderActiveFilters(conditions,v,(key,value)=>{
      v[key]=Array.isArray(v[key])?v[key].filter(item=>item!==value):defaults()[key];
      v.page=0;refreshCurrentView();persist();$(achievement?'search':'filter-toggle').focus();
    });
    $('active-filters').hidden=!activeCount;
    $('clear-active-filters').hidden=!activeCount;
    $('clear-active-filters').onclick=()=>clearFilters(()=>{
      resetFilters(v,state.tab,{keys:[...conditions,'query']});refreshCurrentView();persist();$(achievement?'search':'filter-toggle').focus();
    });
  });
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
    button.setAttribute('aria-label',t("移除{0}",[title(m)]));button.onclick=()=>{state.selected.delete(m.key);const row=[...$('list').children].find(row=>row.dataset.memoryKey===m.key);if(row){row.classList.remove('selected');const input=row.querySelector('.pick input');if(input)input.checked=false;}selectionControls();};$('selection-items').append(button);
  }
}
function openDetail(m){
  state.detail=m.key;$('use-season-memory').hidden=!m.examBattleProduceCards?.length;
  showDetail(m,{character:characterInfo(m.characterId).name,group:groups.get(m.config)??0,...tagContext('memories',m.key,true)});
  document.querySelector('.workbench').classList.add('inspecting');
  const values=filteredMemories(),index=values.findIndex(x=>x.key===m.key);
  $('detail-prev').disabled=index<=0;$('detail-next').disabled=index<0||index===values.length-1;
  syncDetailActiveRows();syncMemoryDetailFocus();$('detail-title').focus({preventScroll:true});
}
function syncDetailActiveRows(){
  for(const row of $('list').children)row.classList.toggle('active',row.dataset.memoryKey===state.detail);
}
function resetDetail(){
  inlineTags.close();
  state.detail=null;$('detail-dialog').hidden=true;document.querySelector('.workbench').classList.remove('inspecting');
}
function closeDetail(restoreFocus=false){
  const key=state.detail,previousPage=view().page;
  if(restoreFocus&&key){const index=filteredMemories().findIndex(m=>m.key===key);if(index>=0)view().page=Math.floor(index/pageSize);}
  resetDetail();
  if(view().page!==previousPage)refreshCurrentView({controls:false});else{syncDetailActiveRows();syncMemoryDetailFocus();}
  if(restoreFocus&&key)restoreMemoryEntryFocus(key);
}
$('close-detail').onclick=()=>closeDetail(true);
for(const [id,direction] of [['detail-prev',-1],['detail-next',1]])$(id).onclick=()=>{const values=filteredMemories(),index=values.findIndex(m=>m.key===state.detail);if(values[index+direction])openDetail(values[index+direction]);};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]')&&state.detail)closeDetail(true);});
// 所有账号入口共用一次安装；旧任务和页面选择在数据准备成功后统一失效。
function applyAccountSession(session){
  tagUI.close();inlineTags.close();resetSeasonPage();resetDetail();state.selected.clear();clearFilterUndo();viewRun++;
  const {warnings,ignoredDetails,...account}=session;Object.assign(state,account);
  if(state.profile)ensureProfileOption(state.profile);$('profile').value=state.profile??'';
  setup();syncControls();render();
  for(const warning of warnings)message(t(warning),true);
}
for(const id of ['empty-import-account','import-account-directory'])$(id).onclick=()=>$('account-directory-files').click();
$('enable-preview-account').onclick=async()=>{
  if(loading||!features.previewAccount)return;setLoading(true);
  try{
    persist();applyAccountSession(await accountSessions.enablePreview());persist();$('data-dialog').close();void ensureMaster();
    message(t('已启用预览账号，可随时从账号列表切回自己的账号。'),false,{transient:true});
  }catch{message(t('预览账号启用失败，请重试；已有账号数据保留。'),true);}
  finally{setLoading(false);}
};
$('account-directory-files').onchange=async event=>{
  const files=[...event.target.files];event.target.value='';if(!files.length||loading)return;
  setLoading(true);
  try{
    const bundle=await readAccountDirectory(files);
    if(accountProfile(bundle.publicUserId)!==state.profile)persist();
    const next=await accountSessions.importDirectory(bundle,state);applyAccountSession(next);persist();
    $('data-dialog').close();void ensureMaster();
    const count=next.selectionSnapshot?.details?.length??0;
    message(t('账号目录已导入，已关联 {0} 条选拔详情。',[count])+(next.ignoredDetails?t('已略过 {0} 条不在当前选拔列表中的历史详情。',[next.ignoredDetails]):''),false,{transient:true});
  }catch(error){message(error instanceof AccountDirectoryError?t(error.message):t('账号目录导入失败，请检查快照格式和存储空间；原数据保留。'),true);}
  finally{setLoading(false);document.documentElement.classList.remove('profile-restoring');openMemoryLink();}
};
async function restoreProfile(profile=state.profile){
  setLoading(true);
  try{
    applyAccountSession(await accountSessions.restore(profile));
    if(state.snapshot||state.selectionSnapshot||state.tab==='achievements')void ensureMaster();
    return true;
  }catch(error){message(error instanceof AccountSessionError?t(error.message):t('浏览器工作副本无法恢复，请重新载入快照。'),true);return false;}
  finally{$('profile').value=state.profile??'';setLoading(false);document.documentElement.classList.remove('profile-restoring');openMemoryLink();}
}
$('profile').onchange=async()=>{
  const profile=normalizeProfile($('profile').value);$('profile').value=state.profile??'';persist();
  if(await restoreProfile(profile))try{rememberAccount(state.profile);}catch{message(t('视图偏好保存失败，刷新后可能需要重新筛选。'),true);}
};
for(const button of document.querySelectorAll('[data-tab]'))button.onclick=()=>{
  if(loading||(!state.snapshot&&!state.selectionSnapshot))return;
  // 手动导航结束链接定位，避免资料就绪后再次打开旧链接并切回原页签。
  if(location.hash)history.replaceState(null,'',location.pathname+location.search);
  state.tab=button.dataset.tab;viewRun++;resetDetail();syncControls();render();persist();if(state.snapshot||state.selectionSnapshot||state.tab==='achievements')void ensureMaster();
};
for(const [id,key] of FILTER_BINDINGS)$(id).addEventListener($(id).matches('button[role=switch]')?'click':id==='search'?'input':'change',()=>{view()[key]=$(id).matches('button[role=switch]')?!view()[key]:$(id).type==='checkbox'?$(id).checked:$(id).value;
  if(key==='selectionLoadoutCollapsed'){
    for(const section of $('list').querySelectorAll('.selection-loadout'))section.open=!view()[key];
    persist();return;
  }
  view().page=0;
  if(id==='purpose')resetDetail();
  if(id==='search'){
    clearTimeout(searchTimer);
    if(!searchComposing)searchTimer=setTimeout(()=>{refreshCurrentView({controls:false});persist();},120);
    return;
  }
  refreshCurrentView();persist();});
let searchComposing=false;
$('search').addEventListener('compositionstart',()=>{searchComposing=true;clearTimeout(searchTimer);});
$('search').addEventListener('compositionend',()=>{searchComposing=false;view().query=$('search').value;view().page=0;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{refreshCurrentView({controls:false});persist();},120);});
$('search-clear').onclick=()=>{view().query='';$('search').value='';view().page=0;refreshCurrentView({controls:false});persist();$('search').focus();};
$('search').addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&!state.detail){e.preventDefault();$('search-clear').click();}});
$('owned-only').onclick=()=>onFilterChoice('ownership',view().ownership==='owned'?'all':'owned');
for(const kind of ['idol','support','memory','selection','skin'])$(kind+'-favorites-only').onchange=event=>onFilterChoice('ownership',event.target.checked?'favorites':'all');
for(const [kind,key] of [['memory','protection'],['selection','selectionProtection']])$(kind+'-locked-only').onchange=event=>onFilterChoice(key,event.target.checked?'protected':'all');
$('filter-toggle').onclick=()=>{if(expandedFilters.has(state.tab))expandedFilters.delete(state.tab);else expandedFilters.add(state.tab);renderFilterDisclosure();};
for(const id of ['reset-selection-filters','reset-idol-filters','reset-support-filters','reset-skin-filters','reset-filters'])$(id).onclick=()=>clearFilters(()=>{resetFilters(view(),state.tab);refreshCurrentView();persist();});
function changePage(direction){
  if(state.detail)resetDetail();
  view().page+=direction;refreshCurrentView({controls:false});persist();
  const list=$('list');list.tabIndex=-1;list.setAttribute('aria-label',t('第 {0} 页结果',[view().page+1]));
  list.focus({preventScroll:true});list.scrollIntoView({block:'start',behavior:'instant'});
}
$('previous').onclick=()=>changePage(-1);$('next').onclick=()=>changePage(1);
$('clear-selection').onclick=()=>{state.selected.clear();for(const row of $('list').querySelectorAll('.selected')){row.classList.remove('selected');const input=row.querySelector('.pick input');if(input)input.checked=false;}selectionControls();};
$('compare').onclick=()=>showComparison(state.snapshot.memories.filter(m=>state.selected.has(m.key)));
function openSeasonMemory(key){
  state.tab='memories';resetDetail();state.views.memories={...defaults(),query:key,page:0};syncControls();persist();render();
  const card=$('list').querySelector(`[data-memory-key="${key}"]`);
  if(card){card.classList.add('memory-link-target');card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({block:'center'});}
}
function useMemoryForSeason(memory){if(!memory?.examBattleProduceCards?.length)return;seasonMemoryRequest=memory;$('season-simulation-open').click();}
$('use-season-memory').onclick=()=>useMemoryForSeason(state.snapshot?.memories.find(row=>row.key===state.detail));

for(const name of ['compare','data','resources','help','idol'])$('close-'+name).onclick=()=>$(name+'-dialog').close();
$('resources-open').onclick=()=>openDialog($('resources-dialog'),{dismissOnBackdrop:true});
$('data-open').onclick=()=>{$('data-message').hidden=true;$('data-message').textContent='';renderAccountOverview();openDialog($('data-dialog'),{dismissOnBackdrop:true});};$('help-open').onclick=()=>openDialog($('help-dialog'),{dismissOnBackdrop:true});$('empty-import').onclick=()=>$('import-account-package').click();
function linkedMasterScope(){
  const params=new URLSearchParams(location.hash.slice(1));
  for(const [key,tab] of [['selection-loadout','selectionMemories'],['selection-memory','selectionMemories'],['memory','memories'],['idol','idolCards'],['support','supportCards'],['skin','idolCardSkins']])if(params.has(key))return tab;
  return state.tab;
}
function currentCatalogContext(){
  return {profile:state.profile,snapshot:state.snapshot,selectionSnapshot:state.selectionSnapshot,tab:state.tab,version:catalogVersion(state.tab),language:locale(),ready:masterReadyFor(state.tab)};
}
function masterRequest(){return {profile:state.profile,lifecycleId:state.lifecycleId,snapshot:state.snapshot,selectionSnapshot:state.selectionSnapshot,tab:state.tab,run:viewRun,hash:location.hash,language:locale()};}
function sameMasterRequest(first,second){return Object.keys(first).every(key=>first[key]===second[key]);}
function refreshMemoryDetail(){
  const memory=state.snapshot?.memories.find(memory=>memory.key===state.detail);if(!memory)return;
  const expanded=[...$('detail-content').querySelectorAll('details')].map(node=>node.open),scroll=$('detail-content').scrollTop;
  showDetail(memory,{character:characterInfo(memory.characterId).name,group:groups.get(memory.config)??0,...tagContext('memories',memory.key,true)});
  $('detail-content').querySelectorAll('details').forEach((node,index)=>{node.open=expanded[index]??node.open;});$('detail-content').scrollTop=scroll;
  refreshDetailNavigation();syncMemoryDetailFocus();
}
async function completeMasterRequest(request,scope){
  if(!sameMasterRequest(request,masterRequest())||!masterReadyFor(scope))return;
  if(state.tab===scope){
    const context=currentCatalogContext(),changed=!renderedCatalogContext||!sameMasterRequest(context,renderedCatalogContext);
    if(changed||(controlsPending&&!['achievements','seasonSimulation'].includes(scope))){
      if(scope==='memories')await prepareMemoryFilterOptions(request.snapshot,state.views.memories);
      if(!sameMasterRequest(request,masterRequest()))return;
      const firstCatalog=!renderedCatalogContext?.ready&&!['memories','selectionMemories','achievements','seasonSimulation'].includes(scope);
      setup();
      if(firstCatalog){syncControls();render();}else refreshCurrentView();
    }
    $('load-master').hidden=true;$('master-status').textContent=t('当前页面所需资料已载入。');
  }
  if(request.hash&&request.hash===location.hash)openCatalogLink();
  viewTiming.complete();
}
async function ensureMaster(forLink=false){
  const scope=forLink===true||location.hash?linkedMasterScope():state.tab,request=masterRequest();
  viewTiming.begin(state.tab,viewRun);
  // 同一公共任务可以复用，但每个账号与页面仍独立接收完成结果，不能放行尚在准备的候选。
  const pending=masterTasks.get(scope);
  if(pending){
    if(sameMasterRequest(request,pending.request))return pending.promise;
    const next={request,promise:null};
    next.promise=pending.promise.then(()=>completeMasterRequest(request,scope)).finally(()=>{
      if(masterTasks.get(scope)===next)masterTasks.delete(scope);
      renderPendingCatalogCounts();renderMasterReadiness();
    });
    masterTasks.set(scope,next);return next.promise;
  }
  const ready=masterReadyFor(scope);
  if(!ready){
    masterFailures.delete(scope);
    $('load-master').disabled=true;$('master-status').textContent=t('正在读取本地主数据…');
  }
  const task={request,promise:null};
  const load=ready?Promise.resolve():loadMaster(scope).then(()=>{observeCatalog({incremental:true});markLoading('package-ready',{scope});});
  task.promise=load.then(()=>completeMasterRequest(request,scope)).catch(()=>{
    masterFailures.add(scope);viewTiming.fail(scope);
    if(state.tab===scope&&!masterReadyFor(scope)){$('master-status').textContent=t('主数据暂不可用，仍可查看库存数值。');$('load-master').disabled=false;$('load-master').hidden=false;}
  }).finally(()=>{
    if(masterTasks.get(scope)===task)masterTasks.delete(scope);
    renderPendingCatalogCounts();renderMasterReadiness();
  });
  masterTasks.set(scope,task);renderPendingCatalogCounts();renderMasterReadiness();return task.promise;
}
$('load-master').onclick=ensureMaster;
$('content-readiness-retry').onclick=()=>ensureMaster();
contentManager.subscribe(renderMasterReadiness);
if(!$('web-version').textContent)$('web-version').textContent=WEB_VERSION;
for(const [id,key] of [['find-character','character'],['find-skill','skill']])$(id).onclick=()=>{
  const m=state.snapshot.memories.find(row=>row.key===state.detail);const value=key==='character'?m?.characterId:m?.produceCard?.id;
  if(!value){message(t('该字段未记录，无法寻找比较对象。'));return;}
  Object.assign(state.views.memories,defaults(),{[key]:value});state.selected.clear();state.selected.add(m.key);resetDetail();refreshCurrentView();selectionControls();persist();message(t('已筛出同类回忆并选中当前条目；相似不代表可删除。'));
};
$('save-view').onclick=()=>{const name=prompt(t('为当前筛选、排序和阅读重点命名：'));if(!name?.trim())return;try{const values=savedViews();values.push({name:name.trim().slice(0,60),view:{...state.views.memories,page:0}});localStorage.setItem(`gakumas-web:saved-views:${state.profile}`,JSON.stringify(values));refreshSavedViews(String(values.length-1));}catch{message(t('常用视图保存失败。'),true);}};
$('saved-view').onchange=()=>{$('delete-view').disabled=$('saved-view').value==='';const item=savedViews()[Number($('saved-view').value)];if($('saved-view').value!==''&&item){Object.assign(state.views.memories,createView(item.view));refreshCurrentView();persist();}};

$('delete-view').onclick=()=>{
  const selected=$('saved-view').value;if(selected==='')return;
  try{const values=savedViews();values.splice(Number(selected),1);localStorage.setItem(`gakumas-web:saved-views:${state.profile}`,JSON.stringify(values));refreshSavedViews();}
  catch{message(t('常用筛选删除失败。'),true);}
};

const inlineTags=setupInlineTags({current:()=>loading?null:state.library,changed:refreshTags});
const tagUI=setupLibraryUI({current:()=>loading?null:state.library,changed:refreshTags});
customTagExport=setupCustomTagExport({current:()=>({profile:state.profile,snapshot:state.snapshot,selectionSnapshot:state.selectionSnapshot,library:state.library?.data,loading})});
const updateStatic=staticTranslations();
updateStatic();$('language').value=locale();
$('language').onchange=()=>setLocale($('language').value);
onLocaleChange(()=>{
  if(seasonComponent)resetSeasonPage({preserve:true});
  $('language').value=locale();
  const expanded=[...document.querySelectorAll('#detail-content details')].map(node=>node.open);
  const savedView=$('saved-view').value;
  updateStatic();void refreshProfileOptions();setup();syncControls();$('saved-view').value=savedView;$('delete-view').disabled=$('saved-view').value==='';render();
  if(state.detail){
    openDetail(state.snapshot.memories.find(m=>m.key===state.detail));
    document.querySelectorAll('#detail-content details').forEach((node,i)=>{node.open=expanded[i]??node.open;});
  }
  $('master-status').textContent=masterReadyFor(state.tab)?t('当前页面所需资料已载入。'):t('正在准备本地主数据');
  $('message').hidden=true;
  if(state.snapshot||state.selectionSnapshot||state.tab==='achievements')void ensureMaster();
});
setupContentControls({loaded:()=>ensureMaster(),canReload:()=>!loading});

setupAccountPackage({
  currentAccount:()=>profileAccountId(state.profile),
  capture:()=>captureAccountBackup(state.profile,{views:state.views,tab:state.tab,idolArt:state.idolArt},state.library.data),
  restore:async payload=>{
    if(accountProfile(payload.publicUserId)!==state.profile)persist();
    applyAccountSession(await accountSessions.restoreBackup(payload));persist();
    $('data-dialog').close();void ensureMaster();
  },
  lock:setLoading,report:message,
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
    cleanupChannel?.postMessage({profile});
    history.replaceState(null,'',location.pathname+location.search);
    for(const dialog of document.querySelectorAll('dialog[open]'))if(dialog.id!=='account-cleanup-dialog')dialog.close();
    applyAccountSession(accountSessions.empty());groups.clear();expandedFilters.clear();
    for(const map of [state.supportTargets,state.idolTargets])for(const key of map.keys())if(key.startsWith(profile+':'))map.delete(key);
    for(const id of ['list','detail-content','comparison','idol-content'])$(id).replaceChildren();
    for(const dialog of document.querySelectorAll('.selection-details-dialog'))dialog.replaceChildren();
    if(!await restoreProfile(await refreshProfileOptions()))throw new Error('account_restore_failed');
    rememberAccount(state.profile);
  },
  lock:setLoading,report:message,
});
await restoreProfile(await refreshProfileOptions());
if(state.snapshot||state.selectionSnapshot)markLoading('account-restored');

function skinOptions(held){
  const info=skinInfo(held),id=info.idolCardId;
  return {...favoriteContext('idolCardSkins',held.idolCardSkinId),
    idolHeld:state.snapshot?.idolCards?.find(card=>card.idolCardId===id),
    getArt:()=>state.idolArt[id],onArt:art=>{state.idolArt[id]=art;persist();}};
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
  if(masterTasks.has(state.tab)||!masterReadyFor(state.tab))void ensureMaster(true);
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
window.dispatchEvent(new Event('gakumas-ready'));
