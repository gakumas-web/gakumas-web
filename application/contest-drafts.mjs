import {contestPlanMatches} from '../domain/contest-simulation.mjs';
import {captureSimulationLoadout,simulationStageKey} from './contest-simulation-history.mjs';
import {contestSlotChoices,contestChoiceOwned,contestCustomizationValid,createContestMemoryDraft} from '../domain/contest-loadout.mjs';
import {cardCustomizations,memoryExclusiveSkill,contestFixedItemIds} from '../domain/catalog.mjs';
import {contestExtraItemLimit} from '../domain/contest-item-rules.mjs';
import {optimizationChoiceCatalog,validateOptimizationExclusiveReference} from './contest-optimization-input.mjs';

const modes=new Set(['selected','recommended','optimization']);
const fields=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
const parameters=['vocal','dance','visual','stamina'];
const reference=value=>value?{id:value.id,upgradeCount:value.upgradeCount,customizes:(value.customizes??[]).map(row=>fields(row,['id','customizeCount']))}:undefined;
export function captureOptimizationDraft(form={}){
  return structuredClone({...fields(form,['characterId','strength','seed']),params:fields(form.params,parameters),roles:(form.roles??[]).map(role=>({...fields(role,['exclusiveId','grade']),...(role.exclusiveReference?{exclusiveReference:reference(role.exclusiveReference)}:{})})),items:[...(form.items??[])],...(form.customBudget?{customBudget:fields(form.customBudget,['population','generations','samples','polishParents','polishNeighbors','polishRounds','polishRuns','reviewCandidates','screenRuns','reviewRuns','finalCandidates','finalRuns','totalRunLimit'])}:{})});
}
// 明确列出配置字段，结果、Worker 状态、候选种群与评分缓存均不进入草稿。
export function createContestDraft({stage,mode='selected',selected=[],drafts=[],editing=[],manual={},manualInputValues={},runs='500',recommendedCharacterId,optimization,contentVersion},now=new Date()){
  mode=modes.has(mode)?mode:'selected';
  return {format:1,id:`${simulationStageKey(stage)}:${mode}`,stage:fields(stage,['id','kind','planType','preset']),mode,updatedAt:now.toISOString(),contentVersion:contentVersion??null,
    configuration:{manualInputValues:fields(manualInputValues,['vocal','dance','visual']),selectedKeys:selected.map(memory=>memory?.key??null),detached:selected.map(memory=>Boolean(memory?.simulationRestored)),loadout:captureSimulationLoadout(drafts,fields(manual,['vocal','dance','visual']),selected),editing:editing.map(Boolean),runs:String(runs),recommendedCharacterId:recommendedCharacterId??null,optimization:captureOptimizationDraft(optimization)}};
}
export function revalidateOptimizationDraft(form,context,issues){
  const next=captureOptimizationDraft(form),catalog=optimizationChoiceCatalog(context),characters=new Set(catalog.exclusive.map(choice=>choice.metadata.ownerCharacterId));
  if(next.characterId&&!characters.has(next.characterId)){delete next.characterId;issues.push('草稿中的偶像当前不可用。');}
  next.roles=next.roles.map(role=>{
    const choice=catalog.exclusive.find(choice=>choice.id===role.exclusiveId);
    if(role.exclusiveId&&(!choice||next.characterId&&choice.metadata.ownerCharacterId!==next.characterId)){issues.push('草稿中的专属技能已不符合当前持有或舞台条件。');return {grade:role.grade};}
    if(role.exclusiveReference)try{validateOptimizationExclusiveReference(context,{...role,grade:Number(role.grade)});}catch{delete role.exclusiveReference;issues.push('草稿中的专属技能附魔已失效，已保留技能并重置附魔。');}
    return role;
  });
  const items=new Set(catalog.items.map(choice=>choice.id));next.items=next.items.map(id=>{if(!id||items.has(id))return id;issues.push('草稿中的 P 道具已不符合当前持有或舞台条件。');return '';});
  return next;
}
// 原始回忆按当前快照重新定位；失效的自定义槽位回退原槽，保留其它可恢复部分。
export function revalidateContestDraft(entry,{stage,memories,catalog,ownership,optimizationContext,contentVersion}){
  const config=entry.configuration,issues=[],byKey=new Map(memories.map(memory=>[memory.key,memory]));
  if(entry.contentVersion!==contentVersion)issues.push('资料版本已变化，草稿已按当前资料重新检查。');
  const selected=[0,1].map(index=>{
    const key=config.selectedKeys[index];if(!key)return null;
    const memory=byKey.get(key)??(config.detached?.[index]?config.loadout.originals?.[index]:null);
    if(!memory||!contestPlanMatches(stage,memory.planType)||!memory.examBattleProduceCards?.length){issues.push('草稿中的回忆已不在当前快照或不符合舞台计划。');return null;}
    if(config.detached?.[index]&&!ownership.idolCardIds.has(memory.idolCardId)){issues.push('草稿中的回忆当前未持有对应偶像卡。');return null;}
    return {...structuredClone(memory),key,...(config.detached?.[index]?{simulationRestored:true}:{})};
  });
  if(selected[1]&&selected[0]&&(selected[1].key===selected[0].key||selected[1].characterId!==selected[0].characterId)){selected[1]=null;issues.push('草稿中的副回忆不符合当前主回忆条件。');}
  const drafts=selected.map((memory,index)=>{
    if(!memory)return null;
    const baseline=createContestMemoryDraft(memory,memoryExclusiveSkill(memory)?.reference.id),stored=config.loadout.memories[index];if(!stored)return baseline;
    let detachedInvalid=false;const next={...baseline};for(const key of parameters){if(Number.isSafeInteger(stored[key])&&stored[key]>=0)next[key]=stored[key];}
    next.examBattleProduceCards=baseline.examBattleProduceCards.map((original,slotIndex)=>{
      const card=stored.examBattleProduceCards?.[slotIndex]??original;
      if(!config.detached?.[index]&&JSON.stringify(original)===JSON.stringify(card))return original;
      const choice=contestSlotChoices(catalog.cards,{memoryIndex:index,slotIndex,planType:memory.planType,characterId:memory.characterId}).find(choice=>choice.id===card.id);
      if(choice&&contestChoiceOwned(choice,ownership,config.detached?.[index]?'':original.id)&&choice.versions.some(version=>version.upgradeCount===card.upgradeCount)&&contestCustomizationValid(cardCustomizations(card),card.customizes??[]))return reference(card);
      issues.push('草稿中的自定义技能或附魔已失效，已还原对应槽位。');if(config.detached?.[index])detachedInvalid=true;return original;
    });
    const fixed=contestFixedItemIds(memory),limit=contestExtraItemLimit(memory.grade)??0,allowed=new Set(contestSlotChoices(catalog.items,{memoryIndex:index,slotIndex:0,planType:memory.planType,characterId:memory.characterId,kind:'item',includeIdolItems:false}).filter(choice=>contestChoiceOwned(choice,ownership,'')).map(choice=>choice.id));
    let extras=0;next.examBattleProduceItemIds=(stored.examBattleProduceItemIds??baseline.examBattleProduceItemIds??[]).filter((id,position,items)=>{
      if(items.indexOf(id)===position&&(fixed.has(id)||allowed.has(id)&&extras++<limit))return true;issues.push('草稿中的 P 道具已失效或超出携带上限，已移除。');return false;
    });
    if(detachedInvalid){selected[index]=null;return null;}return next;
  });
  const manual=fields(config.loadout.manual,['vocal','dance','visual']);for(const key of Object.keys(manual))if(!Number.isFinite(manual[key])||manual[key]<0){delete manual[key];issues.push('草稿中的手动倍率无效，请重新填写。');}
  const manualInputValues=fields(config.manualInputValues,['vocal','dance','visual']);for(const value of Object.values(manualInputValues))if(value!==''&&(!Number.isFinite(Number(value))||Number(value)<0))issues.push('草稿中的手动倍率无效，请重新填写。');
  const optimization=revalidateOptimizationDraft(config.optimization,optimizationContext,issues);
  const recommendations={selectedCharacterId:config.recommendedCharacterId};if(recommendations.selectedCharacterId&&!memories.some(memory=>memory.characterId===recommendations.selectedCharacterId&&contestPlanMatches(stage,memory.planType))){recommendations.selectedCharacterId=null;issues.push('草稿中的搜索偶像当前没有符合条件的回忆。');}
  return {state:{stage,selected,drafts,editing:[0,1].map(index=>Boolean(selected[index]&&config.editing?.[index])),manual,manualInputValues,result:{mode:modes.has(entry.mode)?entry.mode:'selected',runs:config.runs??'500'},recommendations,optimization:{form:optimization}},issues:[...new Set(issues)]};
}
