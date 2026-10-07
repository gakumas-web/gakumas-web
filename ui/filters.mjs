import {supportEffectClauses} from '../domain/support-effect-choices.mjs';
import {resetSupportEffectChoices} from './support-effect-picker.mjs';
import {$,el} from './dom.mjs';
import {memoryExamChoices} from '../domain/memories.mjs';
import {selectionGrades} from '../domain/selection-memories.mjs';
import {descriptionIconType} from '../domain/effect-icons.mjs';
import {t,locale,localizeSource} from '../i18n.mjs';
import {selectedValues,matchesAny} from '../domain/model.mjs';
import {cardInfo,characterInfo,compareCharacterFilters,idolInfo,abilityInfo,abilitySummaries,collectionRecords,supportInfo,skinInfo,skinThemeNames,planLabel,selectionChoiceMetadata,abilityChoiceKey,abilityChoicesReady,abilityFilterClauses} from '../domain/catalog.mjs';
import {abilityLabel,abilityValue} from '../domain/effect-language.mjs';
import {illustration,characterAccent,filterSymbol} from './illustrations.mjs';
import {FILTER_BINDINGS,CATALOG_SORTS,defaults,normalizeView,nextChoice} from '../application/view-state.mjs';
function summaryAbility(a){
  const item=abilitySummaries({abilities:[a]})[0];
  return item&&!item.fallback?[abilityLabel(item.label),abilityValue(item.value),localizeSource(item.context)].filter(Boolean).join(' · '):abilityInfo(a).split('\n')[1]??t('未解析能力');
}

let memoryOptionCache;
export function setupFilterOptions(snapshot,groups,{controls=true}={}){
  memoryOptionCache=null;resetSupportEffectChoices();
  groups.clear();
  for(const m of snapshot?.memories??[])if(m.config!==null)groups.set(m.config,(groups.get(m.config)??0)+1);
  $('snapshot-meta').textContent=snapshot?t("快照 {0}",[new Date(snapshot.captured_at).toLocaleString(locale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})]):t('尚未载入');
  if(!controls)return;
  const ids=[...new Set((snapshot?.memories??[]).map(m=>m.characterId).filter(Boolean))].sort(compareCharacterFilters);
  $('character').replaceChildren(new Option(t('全部角色'),''),...ids.map(id=>new Option(characterInfo(id).name,id)));
  const idolCharacters=[...new Set(collectionRecords(snapshot,'idolCards','all').map(held=>idolInfo(held).characterId).filter(Boolean))].filter(id=>characterInfo(id).face).sort(compareCharacterFilters);
  $('idol-character').replaceChildren(new Option(t('全部角色'),''),...idolCharacters.map(id=>new Option(characterInfo(id).name,id)));
  const supportCharacters=[...new Set(collectionRecords(snapshot,'supportCards','all').flatMap(held=>supportInfo(held).characterIds??[]))].filter(id=>characterInfo(id).face).sort(compareCharacterFilters);
  $('support-character').replaceChildren(new Option(t('全部角色'),''),...supportCharacters.map(id=>new Option(characterInfo(id).name,id)));
  const skins=collectionRecords(snapshot,'idolCardSkins','all').map(skinInfo);
  const skinCharacters=[...new Set(skins.map(info=>info.characterId).filter(Boolean))].sort(compareCharacterFilters);
  $('skin-character').replaceChildren(new Option(t('全部角色'),''),...skinCharacters.map(id=>new Option(characterInfo(id).name,id)));
  $('skin-theme').replaceChildren(new Option(t('全部主题'),''),...skinThemeNames(skins).map(name=>new Option(name,name)));
  const memories=snapshot?.memories??[];
  $('memory-grade').replaceChildren(new Option(t('全部'),''),...[...new Set(memories.map(memory=>memory.grade).filter(grade=>grade!==undefined))].sort((a,b)=>b-a).map(grade=>new Option(selectionGrades[grade]||t('未知'),String(grade))));
  $('plan').replaceChildren(new Option(t('全部'),''),...[...new Set(memories.map(m=>m.planType).filter(x=>x!==undefined))].sort().map(id=>new Option(planLabel(id),String(id))));
  syncMemoryFilterOptions(snapshot,{character:[]});
}
export function syncMemoryFilterOptions(snapshot,view){
  const characters=JSON.stringify(selectedValues(view.character).sort()),language=locale();
  if(!memoryOptionCache||memoryOptionCache.snapshot!==snapshot||memoryOptionCache.characters!==characters||memoryOptionCache.language!==language){
    const memories=(snapshot?.memories??[]).filter(memory=>matchesAny(view.character,[memory.characterId]));
    const cards=new Map();
    for(const memory of memories)if(memory.produceCard&&!cards.has(memory.produceCard.id)){
      const reference={...memory.produceCard,customizes:[]};cards.set(reference.id,{key:reference.id,reference,characterId:memory.characterId,memoryCharacterIds:[],info:cardInfo(reference,memory.characterId),metadata:selectionChoiceMetadata('card',reference)});
    }
    $('skill').replaceChildren(new Option(t('全部'),''),...[...cards.values()].map(value=>new Option(value.info.name,value.key)));
    const abilities=new Map();
    for(const memory of memories)for(const ability of memory.abilities??[]){
      const key=abilityChoiceKey(ability.id);if(abilities.has(key))continue;
      const summary=abilitySummaries({abilities:[ability]})[0],parts=summary.description.technical?.skill?.descriptions??[];
      const triggerCard=parts.find((part,index)=>part.produceDescriptionType==='ProduceDescriptionType_ProduceCard'&&/^使用後/.test(parts[index+1]?.text??''));
      const metadata=triggerCard?selectionChoiceMetadata('card',{id:triggerCard.targetId,upgradeCount:0}):{};
      const effects=parts.map(descriptionIconType).filter(Boolean);
      if(parts.some(part=>part.targetId==='p_card-00-acc-0_002')&&parts.some(part=>part.targetId==='Label_ProduceCardPositionType_Lost'))effects.push('CardRemoveSleepiness');
      abilities.set(key,{key,summary,name:summaryAbility(ability),text:summary.description.sourceText||summaryAbility(ability),hifSort:{plan:metadata.plan,rarity:metadata.rarity,effects:[...new Set(effects)].sort().join('|')}});
    }
    $('ability').replaceChildren(new Option(t('全部能力'),''),...[...abilities.values()].map(value=>new Option(value.name,value.key)));
    const choices={...memoryExamChoices(memories),inheritanceCards:[...cards.values()],abilities:[...abilities.values()]};
    for(const [id,values,isCard] of [['memory-skill',choices.cards,true],['memory-item',choices.items,false]])$(id).replaceChildren(new Option(t('全部'),''),...values.map(value=>new Option(isCard?`${value.info.name} · ${t('强化')} +${value.reference.upgradeCount}`:value.info.name,value.key)));
    memoryOptionCache={snapshot,characters,language,choices};
  }
  if(view.ability)view.ability=[...new Set(selectedValues(view.ability).map(abilityChoiceKey))];
  // 角色切换后清除已离开候选范围的条件，避免残留条件把列表筛空。
  for(const [key,id] of [['skill','skill'],['ability','ability'],['memoryExamSkill','memory-skill'],['memoryExamItem','memory-item']]){
    if(key==='ability'&&!abilityChoicesReady())continue;
    const valid=new Set([...$(id).options].map(option=>option.value)),value=view[key];
    if(Array.isArray(value))view[key]=value.filter(item=>valid.has(item));
    else if(value&&!valid.has(value))view[key]='';
  }
  return memoryOptionCache.choices;
}

export function syncFilterControls(v,tab){
  normalizeView(v);
  for(const nav of document.querySelectorAll('[data-tab]'))nav.setAttribute('aria-pressed',String(nav.dataset.tab===tab));
  if(tab==='achievements')return;
  const sorts=CATALOG_SORTS[tab];
  if(sorts){
    if(!sorts.some(([value])=>value===v.catalogSort))v.catalogSort='original';
    $('idol-sort').replaceChildren(...sorts.map(([value,label])=>new Option(t(label),value)));
  }
  for(const [id,key] of FILTER_BINDINGS){
    const input=$(id);
    if(input.getAttribute('role')==='switch'&&input.tagName==='BUTTON')input.setAttribute('aria-checked',String(v[key]));
    else if(input.type==='checkbox')input.checked=v[key];
    else input.value=Array.isArray(v[key])?(v[key][0]??''):v[key]??defaults()[key];
  }
}
export function renderFilterChoices(containerId,inputId,key,faces,v,onChange){
  const container=$(containerId),values=selectedValues(v[key]);
  const focused=document.activeElement?.closest(`#${containerId} button`)?.dataset.value;
  container.querySelectorAll('button').forEach(button=>button.remove());
  for(const option of $(inputId).options){
    if(option.hidden)continue;
    const active=option.value?values.includes(option.value):!values.length;
    const button=el('button','',faces?'character-choice':'effect-choice');button.dataset.value=option.value;
    button.setAttribute('aria-label',option.text);button.setAttribute('aria-pressed',String(active));
    if(faces&&option.value){characterAccent(button,option.value);const face=illustration(characterInfo(option.value).face,option.text,'filter-face');face.setAttribute('aria-hidden','true');button.append(face);}
    if(!faces){const symbol=filterSymbol(['plan','selection-plan'].includes(inputId)?({2:'Plan1',3:'Plan2',4:'Plan3'}[option.value]):option.value);if(symbol)button.append(symbol);}
    button.append(el('span',option.text));
    const check=el('span',active?'✓':'','choice-check');check.setAttribute('aria-hidden','true');button.append(check);
    button.onclick=()=>onChange(key,nextChoice(v[key],option.value));
    container.append(button);
    if(focused===option.value)button.focus({preventScroll:true});
  }
}

export function renderTabCount(tab,count,total,pending='—'){
  const output=$('count-'+tab);
  output.textContent=count===null?pending:count===undefined?t('未采集'):count===total?String(count):`${count} / ${total}`;
  output.title=count===null?(pending===t('未导入')?t('未导入账号'):pending):count===undefined?t('当前账号尚未采集此项'):t('当前筛选结果：{0} / {1} 条',[count,total]);
}


// 折叠面板外只呈现已选条件；使用字段名和图标区分相同文案的不同条件。
export function renderActiveFilters(keys,filters,onRemove,{logic=true}={}){
  const container=$('active-filters');container.replaceChildren();
  const labels={achievementCategory:'类别',achievementState:'状态',selectionCharacter:'角色',selectionPlan:'计划',selectionGrade:'评级',selectionProtection:'游戏保护',selectionSkill:'技能卡',selectionItem:'P 道具',memoryExamSkill:'考试技能卡',memoryExamItem:'考试 P 道具',character:'角色',idolCharacter:'角色',supportCharacter:'角色',skinCharacter:'角色',
    idolPlan:'计划',supportPlan:'可编入计划',plan:'计划',idolRarity:'稀有度',supportRarity:'稀有度',
    idolEffect:'效果涉及',supportType:'支援卡属性',supportEffect:'效果增益类型',supportEffectAttribute:'效果作用属性',
    supportSkills:'满级支援效果',supportReward:'事件奖励',skinTheme:'装扮主题',memoryGrade:'评级',
    customTag:'自定义标签',skill:'继承技能卡',ability:'培养能力',query:'搜索'};
  let count=0;
  for(const key of [...(filters.query?['query']:[]),...keys]){
    const id=FILTER_BINDINGS.find(([,field])=>field===key)?.[0],input=id?$(id):null;
    const values=selectedValues(filters[key]);if(!values.length)continue;
    const includeCommon=key==='supportPlan'&&filters.supportPlanCommon!==false;
    const grouped=!['ability','supportSkills'].includes(key)&&(values.length>1||includeCommon);
    const group=logic?el('span','','filter-logic-group'):container;
    if(logic){
      group.dataset.logicKey=key;
      if(container.childElementCount)container.append(el('span','AND','filter-logic-operator'));
      container.append(group);if(grouped)group.append(el('span','(','filter-logic-bracket'));
    }
    const operator=key==='skill'||key==='ability'||key==='supportSkills'?'OR':['selectionSkill','selectionItem','memoryExamSkill','memoryExamItem'].includes(key)?(filters[key+'All']?'AND':'OR'):key==='supportCharacter'?(filters.supportCharacterAll!==false?'AND':'OR'):'OR';
    const clauses=key==='ability'?abilityFilterClauses(values):key==='supportSkills'?supportEffectClauses(values):[values];
    for(const [clauseIndex,clause] of clauses.entries()){
      if(logic&&clauseIndex)group.append(el('span','AND','filter-logic-operator'));
      if(logic&&['ability','supportSkills'].includes(key)&&clause.length>1)group.append(el('span','(','filter-logic-bracket'));
      for(const [index,value] of clause.entries()){
        if(logic&&index)group.append(el('span',operator,'filter-logic-operator'));
        let text=[...(input?.options??[])].find(option=>option.value===value)?.text??value;
        const full=`${t(labels[key]??key)}：${text}`;
        const button=el('button','','filter-chip');button.title=full;button.dataset.filterKey=key;button.dataset.filterValue=value;
        button.setAttribute('aria-label',t('移除筛选：{0}',[full]));
        if(['character','idolCharacter','supportCharacter','skinCharacter','selectionCharacter'].includes(key)){
          characterAccent(button,value);const face=illustration(characterInfo(value).face,text,'filter-tag-face');face.setAttribute('aria-hidden','true');button.append(face);
        }else{
          const symbol=filterSymbol(['plan','selectionPlan'].includes(key)?({2:'Plan1',3:'Plan2',4:'Plan3'}[value]):value);if(symbol)button.append(symbol);
        }
        button.append(el('span',full,'filter-tag-label'),el('span','×','filter-tag-remove'));
        button.onclick=()=>onRemove(key,value);group.append(button);count++;
      }
      if(logic&&['ability','supportSkills'].includes(key)&&clause.length>1)group.append(el('span',')','filter-logic-bracket'));
    }
    if(logic&&includeCommon)group.append(el('span','OR','filter-logic-operator'),el('span',t('通用'),'filter-chip filter-implicit-condition'));
    if(logic&&grouped)group.append(el('span',')','filter-logic-bracket'));
  }
  return count;
}
