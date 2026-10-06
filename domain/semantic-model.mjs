import {createCardCustomizations} from './card-customizations.mjs';
import {descriptionText, plainText, configurationSignature} from './semantic-text.mjs';

export function createSemantics(tables, catalog = {}) {
  const pair = (id, level) => JSON.stringify([id,level]);
  const index = (rows, secondary) => {
    const result = new Map();
    for (const row of rows ?? []) {
      const key = secondary ? pair(row.id,row[secondary]) : row.id;
      result.set(key,result.has(key)?null:row);
    }
    return result;
  };
  const customizationData=createCardCustomizations(tables,catalog);
  const labels=index(catalog.ProduceDescriptionLabel);
  const triggers=index(catalog.ProduceTrigger);
  const custom=index(catalog.ProduceCardCustomize,'customizeCount');
  const grows=index(catalog.ProduceCardGrowEffect);
  const cards=index(tables.ProduceCard,'upgradeCount');
  const abilities=index(tables.MemoryAbility,'level');
  const skills=index(tables.ProduceSkill,'level');
  const effects=index(tables.ProduceEffect);
  const exam=index(tables.ProduceExamEffect);
  const items=index(tables.ProduceItem);
  // 主数据行在一次目录安装期间不变；只缓存公开说明，不缓存持有记录或培养目标。
  const formats=new WeakMap(),readings=new WeakMap();
  const format=row=>{
    if(!row)return descriptionText([],labels);
    if(!formats.has(row))formats.set(row,descriptionText(row.descriptions??row.produceDescriptions,labels));
    return formats.get(row);
  };
  const reading=row=>{
    if(!readings.has(row))readings.set(row,{cardReferences:(row.descriptions??row.produceDescriptions??[]).filter(part=>part.produceDescriptionType==='ProduceDescriptionType_ProduceCard'&&part.targetId&&part.text).map(part=>({id:part.targetId,name:plainText(part.text)})),sourceText:format(row).text,readingText:descriptionText(row.descriptions??row.produceDescriptions,labels,true).text});
    return readings.get(row);
  };
  const result=(heading,lines,technical)=>({heading,lines,technical,status:'supported'});
  const unknown=(heading,technical)=>({...result(heading,['未解析：主数据缺失或联接歧义'],technical),status:'unresolved'});
  function customize(entry,cardEntry) {
    const definition=custom.get(pair(entry.id,entry.customizeCount));
    if (!definition) return unknown(`自定义 ×${entry.customizeCount}，效果待解析`,{entry});
    const growDefinitions=(definition.produceCardGrowEffectIds??[]).map(id=>({id,definition:grows.get(id)??null}));
    const lines=[],sources=[];
    for (const grow of growDefinitions) {
      const effect=exam.get(grow.definition?.playProduceExamEffectId);
      if (effect) {
        const description=format(effect);
        if (description.text) {lines.push(`关联效果原文：${description.text}`);sources.push(description.text);}
      }
    }
    const description=plainText(definition.description);
    const readableLabel=/Produce\w*Type_|\b(?:p_card_custom|p_trigger|p_effect|g_effect|e_effect|e_trigger|p_card|p_item_effect)[-_][A-Za-z0-9_-]+/.test(description) ? '' : description;
    const customization=cardEntry?customizationData.applied(cardEntry,entry):null;
    const status=customization?(customization.effects.length&&customization.effects.every(effect=>effect.complete)?'partial':'unresolved'):readableLabel||lines.length?'partial':'unresolved';
    lines.push('效果待解析：尚未将自定义增减、目标与条件叠加到基础说明。');
    return {...result(`自定义 ×${entry.customizeCount}${readableLabel ? ` · ${readableLabel}` : ''}`,lines,
      {entry,definition,growDefinitions}),sourceText:sources.join('\n'),customization,status};
  }
  function ability(entry) {
    const mapping=abilities.get(pair(entry.id,entry.level));
    const skill=mapping && skills.get(pair(mapping.skillId,entry.level));
    if (!skill) return unknown(`能力 Lv.${entry.level}`,{entry,mapping:mapping??null});
    const description=format(skill);
    const slots=[1,2,3].filter(i=>skill[`produceEffectId${i}`]).map(i=>({slot:i,
      effectId:skill[`produceEffectId${i}`],effect:effects.get(skill[`produceEffectId${i}`])??null,
      triggerId:skill[`produceTriggerId${i}`],trigger:triggers.get(skill[`produceTriggerId${i}`])??null,
      activationRatePermil:skill.definition?.[`activationRatePermil${i}`]}));
    const lines=[description.text || '未解析能力说明'];
    let partial=description.status!=='supported' || slots.length!==1;
    for (const slot of slots) {
      if (!slot.effect) {lines.push(`效果 ${slot.slot} 未解析`);partial=true;}
      if (slot.effect && slot.effect.effectValueMin!==slot.effect.effectValueMax) {lines.push(`效果 ${slot.slot} 含数值范围，说明未完整解析。`);partial=true;}
      if (slot.activationRatePermil>0 && !description.text.includes('%') && !description.text.includes('％')) {lines.push(`效果 ${slot.slot} 的发动概率未完整解析。`);partial=true;}
      if (!slot.trigger) {lines.push(`触发条件 ${slot.slot} 未解析`);partial=true;continue;}
      const startIds=['p_trigger-produce_start','p_trigger-produce_start-initial','p_trigger-produce_start-no_description'];
      if (slots.length===1 && startIds.includes(slot.triggerId) && slot.trigger.phaseType==='ProducePhaseType_ProduceStart') {
        // 培育开始时的一次性初始化是底层配置，不追加到玩家效果正文。
      } else {lines.push(`触发条件 ${slot.slot} 未完整解析，请结合原文与技术引用核对`);partial=true;}
    }
    if (slots.length>1) lines.push(`关联 ${slots.length} 项效果，逐项条件对应关系未完整解析。`);
    if (!slots.length) lines.push('没有可联接的效果记录，说明未完整解析。');
    if (mapping.definition?.produceGroupIds?.length || mapping.definition?.isUniqueActivation) {
      lines.push('适用模式／独有发动条件未完整解析。');partial=true;
    }
    // 实际条件与次数保留源说明，activationCount 只留在技术对象中。
    return {...result(`能力 Lv.${entry.level}`,lines,{entry,mapping,skill,slots}),...reading(skill),status:description.status==='unresolved'?'unresolved':partial?'partial':'supported'};
  }
  function card(entry) {
    if (entry===undefined) return {...result('继承卡',['未记录'],{recorded:false}),status:'unresolved'};
    if (entry===null) return result('无继承卡',[],{entry:null});
    const definition=cards.get(pair(entry.id,entry.upgradeCount));
    if (!definition) return unknown('未解析技能卡',{entry});
    const description=format(definition);
    const lines=[`强化 +${entry.upgradeCount}`,description.text || '未解析基础说明'];
    const linkedEffects=(definition.playEffects??[]).map((play,i)=>({slot:i+1,play,effect:exam.get(play.produceExamEffectId)??null}));
    let partial=description.status!=='supported';
    for (const linked of linkedEffects) {
      if (!linked.effect) {lines.push(`效果 ${linked.slot} 未解析`);partial=true;}
      const nested=linked.effect?.definition??{};
      if (nested.chainProduceExamEffectId || nested.chainProduceExamEffectIds?.length || nested.produceExamStatusEnchantId
        || nested.produceCardStatusEnchantId || nested.produceCardGrowEffectIds?.length || nested.targetProduceCardId) {
        lines.push(`效果 ${linked.slot} 含联动／持续／目标字段，说明未完整解析。`);partial=true;
      }
      const condition=linked.play.produceExamTriggerId;
      const covered=definition.descriptions?.some(p=>p.originProduceExamTriggerId===condition && p.text);
      if (condition && !covered) {lines.push(`效果 ${linked.slot} 的触发条件未完整解析`);partial=true;}
    }
    const def=definition.definition??{};
    if (def.playProduceExamTriggerId && !definition.descriptions?.some(p=>p.originProduceExamTriggerId===def.playProduceExamTriggerId && p.text)) {
      lines.push('卡牌使用条件未完整解析。');partial=true;
    }
    if (def.isInitial || def.isRestrict || def.isEndTurnLost || def.noDeckDuplication) {
      lines.push('附加使用限制／开始时状态请结合原文核对，说明未完整解析。');partial=true;
    }
    if (def.stamina>0) lines.push(`体力消耗：${def.stamina}（基础值）`);
    if (def.forceStamina || (def.costType && def.costType!=='ExamCostType_Unknown') || def.moveProduceExamEffectIds?.length || def.produceCardStatusEnchantId) {
      lines.push('费用／移出卡组／持续效果等附加字段请结合原文核对，说明未完整解析。');partial=true;
    }
    const customizations=(entry.customizes??[]).map(custom=>customize(custom,entry));
    if (customizations.length) {
      lines.unshift('以下为未叠加自定义的基础卡说明');
      partial=true;
    }
    return {...result(plainText(definition.name)||'未命名技能卡',lines,{entry,definition,linkedEffects}),
      ...reading(definition),customizations,status:description.status==='unresolved'?'unresolved':partial?'partial':'supported'};
  }
  function item(id) {
    const definition=items.get(id);
    if (!definition) return unknown('未解析 P 道具',{id});
    const description=format(definition);
    return {...result(plainText(definition.name),[description.text||'未解析道具说明',
      '道具效果链未完整展开，条件以原文为准。'],{id,definition}),...reading(definition),status:description.status==='unresolved'?'unresolved':'partial'};
  }
  function group(memory, field) {
    const value=memory[field];
    const signature=configurationSignature(value);
    if (value===undefined) return {signature,entries:[unknown('未记录',{field})]};
    if (field==='produceCard') return {signature,entries:[card(value)]};
    const convert={abilities:ability,examBattleProduceCards:card,examBattleProduceItemIds:item}[field];
    return {signature,entries:value.map(convert)};
  }
  return {ability,card,item,customize,group};
}
