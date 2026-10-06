import {t} from '../i18n.mjs';
import {selectionSkillKey} from './selection-memories.mjs';
import {title,memoryUse,matchesAny,selectedValues} from './model.mjs';
import {cardInfo,characterInfo,semanticGroup,selectionChoiceMetadata,selectionFlowDefinitions,compareCharacterFilters,itemArt,abilityChoiceKey,abilityFilterClauses} from './catalog.mjs';
import {effectSearchText} from './effect-language.mjs';
import {configurationSignature} from './semantic-text.mjs';
// 只排序展示副本，来源分组优先；相同条件保留原始卡组顺序。
export function sortedMemoryBattleCards(cards=[]){
  const rarities=['N','R','SR','SSR','LEGEND'];
  return cards.map(card=>{
    const metadata=selectionChoiceMetadata('card',card),rarity=rarities.indexOf(metadata.rarity);
    return {card,group:metadata.source==='idol'?0:metadata.source==='support'?1:2,rarity:rarity<0?rarities.length:rarity,customizes:(card.customizes??[]).reduce((sum,value)=>sum+value.customizeCount,0)};
  }).sort((a,b)=>a.group-b.group||a.rarity-b.rarity||b.customizes-a.customizes||b.card.upgradeCount-a.card.upgradeCount).map(entry=>entry.card);
}
export const foldTitle = (name, values) => `${name} · ${values === undefined ? t('未记录') : values.length ? values.length : t('0（空）')}`;
export const canCompareMemory=memory=>Boolean(memory.examBattleProduceCards?.length);
// 配置只按原始字段对齐；保留重复数量，能力别名归一，缺失记录独立表示。
export function comparisonFieldEntries(memories,field){
  const rows=memories.map(memory=>{
    const raw=memory[field];if(raw===undefined)return null;
    const values=field==='produceCard'?(raw?[raw]:[]):raw,entries=new Map();
    for(const value of values){
      const identity=field==='abilities'?{...value,id:abilityChoiceKey(value.id)}:field==='produceCard'?{card:value,phase:memory.produceCardPhaseType??null}:value;
      const key=configurationSignature(identity),entry=entries.get(key);
      if(entry)entry.count++;else entries.set(key,{key,value,count:1});
    }
    return entries;
  });
  const keys=new Set(rows.flatMap(row=>row?[...row.keys()]:[]));
  const different=new Set([...keys].filter(key=>new Set(rows.map(row=>row?row.get(key)?.count??0:undefined)).size>1));
  return {rows:rows.map(row=>row?[...row.values()]:null),different,hasDifference:different.size>0||rows.some(row=>row===null)};
}
export function summaryText(m, purpose = 'inheritance') {
  if (purpose !== 'inheritance') {
    if(memoryUse(m)==='training')return t('培养专用，不用于比赛');
    const cards = m.examBattleProduceCards;
    return cards === undefined ? t('考试配置未记录') : cards.length ?
      t("{0} 卡 · {1} 道具 · {2}",[cards.length,m.examBattleProduceItemIds?.length ?? t('未知'),cards.map(c=>cardInfo(c,m.characterId).name).join(' / ')]) :
      t('考试卡组为空 · 不据此判断价值');
  }
  const group = semanticGroup(m,'abilities');
  if (!group.entries.length) return m.abilities === undefined ? t('能力未记录') : t('能力记录为空');
  return group.entries.map(e=>e.lines.filter(Boolean).join(' · ') || e.heading).join(' / ');
}
// 普通回忆按实际记录列出考试卡组，不套用选拔回忆的稀有度或专属卡排除规则。
export function memoryExamChoices(memories){
  const cards=new Map(),items=new Map();
  for(const memory of memories){
    for(const card of memory.examBattleProduceCards??[]){
      const key=selectionSkillKey(card);
      if(!cards.has(key))cards.set(key,{key,reference:{id:card.id,upgradeCount:card.upgradeCount,customizes:[]},characterId:memory.characterId,memoryCharacterIds:[],info:cardInfo(card,memory.characterId),metadata:selectionChoiceMetadata('card',card)});
      cards.get(key).memoryCharacterIds.push(memory.characterId);
    }
    for(const id of memory.examBattleProduceItemIds??[]){
      const metadata=selectionChoiceMetadata('item',{id});
      if(metadata.source==='common'||metadata.source==='support'&&metadata.use==='training')continue;
      if(!items.has(id))items.set(id,{key:id,memoryCharacterIds:[],info:itemArt(id),metadata});
      items.get(id).memoryCharacterIds.push(memory.characterId);
    }
  }
  return {cards:sortExamCardChoices([...cards.values()]),items:sortExamItemChoices([...items.values()])};
}
export function sortExamCardChoices(values){
  const rank=(order,value)=>{const index=order.indexOf(value);return index<0?order.length:index;};
  const flows=selectionFlowDefinitions.map(flow=>flow.id),flowRank=value=>Math.min(flows.length,...value.metadata.flows.map(flow=>rank(flows,flow)));
  return [...values].sort((a,b)=>{
    const source=rank(['idol','support','common','unknown'],a.metadata.source)-rank(['idol','support','common','unknown'],b.metadata.source);
    if(source)return source;
    const character=a.metadata.source==='idol'?compareCharacterFilters(a.metadata.ownerCharacterId??'',b.metadata.ownerCharacterId??''):0;
    return character||rank(['Plan1','Plan2','Plan3','Common'],a.metadata.plan)-rank(['Plan1','Plan2','Plan3','Common'],b.metadata.plan)
      ||(a.metadata.source==='support'?0:flowRank(a)-flowRank(b))
      ||rank(['LEGEND','SSR','SR','R','N'],a.metadata.rarity)-rank(['LEGEND','SSR','SR','R','N'],b.metadata.rarity)
      ||b.reference.upgradeCount-a.reference.upgradeCount||a.key.localeCompare(b.key,'ja');
  });
}
export function sortExamItemChoices(values){
  const rank=(order,value)=>{const index=order.indexOf(value);return index<0?order.length:index;};
  return [...values].sort((a,b)=>rank(['Plan1','Plan2','Plan3','Common'],a.metadata.plan)-rank(['Plan1','Plan2','Plan3','Common'],b.metadata.plan)
    ||rank(['LEGEND','SSR','SR','R','N'],a.metadata.rarity)-rank(['LEGEND','SSR','SR','R','N'],b.metadata.rarity)
    ||Number(b.info.upgraded)-Number(a.info.upgraded)||a.key.localeCompare(b.key,'ja'));
}
export function groupedInheritanceCardChoices(values){
  const flowOrder=selectionFlowDefinitions.map(flow=>flow.id),groups=new Map(),rarities=['LEGEND','SSR','SR','R','N'];
  const rarity=value=>{const index=rarities.indexOf(value.metadata.rarity);return index<0?rarities.length:index;};
  for(const value of values){
    const flows=flowOrder.filter(flow=>value.metadata.flows.includes(flow)),plan=value.metadata.plan;
    const id=flows.join('+')||(['Plan1','Plan2','Plan3','Common'].includes(plan)?'common-'+plan:'unclassified');
    if(!groups.has(id))groups.set(id,{id,flows,plan,values:[]});groups.get(id).values.push(value);
  }
  const order=group=>group.flows.length?group.flows.map(flow=>flowOrder.indexOf(flow)):[({Plan1:1.5,Plan2:3.5,Plan3:5.5,Common:6})[group.plan]??7];
  return [...groups.values()].sort((a,b)=>{const x=order(a),y=order(b);for(let i=0;i<Math.max(x.length,y.length);i++){const difference=(x[i]??-1)-(y[i]??-1);if(difference)return difference;}return 0;})
    .map(group=>({...group,values:group.values.sort((a,b)=>rarity(a)-rarity(b)||b.reference.upgradeCount-a.reference.upgradeCount||a.key.localeCompare(b.key,'ja'))}));
}
function matchesExamChoices(selected,available,all){
  const values=selectedValues(selected);
  return !values.length||(all!==false?values.every(value=>available.includes(value)):values.some(value=>available.includes(value)));
}
export function filterMemories(snapshot,v,groups,tagFor=()=>[]){
  const query=v.query.trim().toLowerCase(),abilityGroups=abilityFilterClauses(v.ability);
  return (snapshot?.memories??[]).filter(m=>{
    const tags=tagFor(m);
    const hasDeck=Boolean(m.examBattleProduceCards?.length);
    if(v.purpose==='inheritance'&&hasDeck||v.purpose==='with-deck'&&!hasDeck)return false;
    if(v.memoryGrade&&String(m.grade)!==v.memoryGrade)return false;
    if(v.plan&&String(m.planType)!==v.plan)return false;
    if(!matchesExamChoices(v.skill,m.produceCard?[m.produceCard.id]:[],false))return false;
    const heldAbilities=new Set((m.abilities??[]).map(ability=>abilityChoiceKey(ability.id)));
    if(!abilityGroups.every(group=>group.some(id=>heldAbilities.has(id))))return false;
    if(!matchesExamChoices(v.memoryExamSkill,(m.examBattleProduceCards??[]).map(selectionSkillKey),v.memoryExamSkillAll)||!matchesExamChoices(v.memoryExamItem,m.examBattleProduceItemIds??[],v.memoryExamItemAll))return false;
    if(!matchesAny(v.character,[m.characterId]))return false;
    if(v.protection==='protected'&&m.isProtected!==true)return false;
    if(!query||m.key===query)return true;
    const summary=summaryText(m);
    return [title(m),characterInfo(m.characterId).name,cardInfo(m.produceCard,m.characterId).name,summary,effectSearchText(summary),...tags].join(' ').toLowerCase().includes(query);
  }).sort((a,b)=>v.sort==='ordinal'?a.ordinal-b.ordinal:(b[v.sort]??-Infinity)-(a[v.sort]??-Infinity)||a.ordinal-b.ordinal);
}
// 使用原始规范化配置对齐；重复数量与未知状态分别保留。
export function compareConfigItems(memories, field) {
  const maps=memories.map(m=>{
    if (m[field]===undefined)return null;
    const entries=semanticGroup(m,field).entries;
    const map=new Map();
    m[field].forEach((value,i)=>{
      const key=configurationSignature(value),found=map.get(key);
      map.set(key,{count:(found?.count??0)+1,entry:entries[i]});
    });
    return map;
  });
  const keys=new Set(maps.flatMap(map=>map?[...map.keys()]:[]));
  return [...keys].map(key=>({key,counts:maps.map(map=>map?map.get(key)?.count??0:undefined),entries:maps.map(map=>map?.get(key)?.entry)}));
}
