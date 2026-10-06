import {descriptionText,descriptionNumberChanges,plainText} from './semantic-text.mjs';

export const rankNumber = value => value?.endsWith('_Unknown') ? 0 : Number(value?.match(/__(\d+)$/)?.[1]);
const hasEffect = (row, suffix) => row.effectTypes.some(type => type.endsWith('_' + suffix));
const stages = (rows, rank) => rows.filter(row => rankNumber(row.rank) <= rank);
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

export function createProgression(data = {}, base = {}, semantics) {
  // 公开目录在安装时固定；按关联键建立索引，预览和筛选不重复扫描整表。
  const indexes=new WeakMap();
  function byId(rows,id,key='id'){
    if(!rows)return [];
    if(!indexes.has(rows)){
      const groups=new Map();
      for(const row of rows){if(!groups.has(row[key]))groups.set(row[key],[]);groups.get(row[key]).push(row);}
      indexes.set(rows,groups);
    }
    return indexes.get(rows).get(id)??[];
  }
  const supportCards=new Map((data.SupportCard??[]).map(row=>[row.id,row]));
  const idolCards=new Map((data.IdolCard??[]).map(row=>[row.id,row]));
  const supportSkillRows=['Vocal','Dance','Visual','Assist'].flatMap(type=>data['SupportCardProduceSkillLevel'+type]??[]);
  const supportRows=id=>byId(supportSkillRows,id,'supportCardId');
  const cards = new Map((base.ProduceCard ?? []).map(row => [JSON.stringify([row.id,row.upgradeCount]),row]));
  // HIF 本战专属卡按公开归属字段联接；独立于特训强化，不推断账号解锁状态。
  const primaStellaCards=(base.ProduceCard??[]).filter(row=>row.upgradeCount===0&&(row.definition??row).originPrimaStellaIdolCardId)
    .map(row=>({idolCardId:(row.definition??row).originPrimaStellaIdolCardId,id:row.id}));
  const items = new Map((base.ProduceItem ?? []).map(row => [row.id,row]));
  const effects=new Map((base.ProduceEffect??[]).map(row=>[row.id,row]));
  const skills = new Map((base.ProduceSkill ?? []).map(row => [JSON.stringify([row.id, row.level]), row]));
  const skillText = row => {
    const skill = skills.get(JSON.stringify([row.produceSkillId, row.produceSkillLevel]));
    return skill ? descriptionText(skill.descriptions,undefined,true).text || '效果说明未解析' : '效果说明未收录';
  };
  const skillIconValue=row=>{
    const definition=skills.get(JSON.stringify([row.produceSkillId,row.produceSkillLevel]));
    // 只显示唯一明确的变动数值片段，不从条件、卡名或整句中猜数字。
    const parts=(definition?.descriptions??[]).filter(part=>part.produceDescriptionType==='ProduceDescriptionType_DiffText');
    if(parts.length!==1)return '';
    const value=plainText(parts[0].text??'').trim();
    return /^[+−-]?\d+(?:\.\d+)?[%％]?$/.test(value)?value:'';
  };
  const skillReferences=row=>{
    const skill=row&&skills.get(JSON.stringify([row.produceSkillId,row.produceSkillLevel]));
    return (skill?.descriptions??[]).filter(part=>part.produceDescriptionType==='ProduceDescriptionType_ProduceCard'&&part.targetId&&part.text).map(part=>({id:part.targetId,name:part.text}));
  };
  const skillEffects = row => {
    const skill=row && skills.get(JSON.stringify([row.produceSkillId,row.produceSkillLevel]));
    return [1,2,3].map(i=>skill?.[`produceEffectId${i}`]).filter(Boolean);
  };
  const customizationSkill=row=>skillEffects(row).some(id=>effects.get(id)?.produceEffectType==='ProduceEffectType_IdolCardProduceCardCustomizeEnable');
  function activeSkills(rows, level, threshold) {
    const selected = new Map();
    for (const row of [...rows].sort((a,b) => threshold(a)-threshold(b))) {
      if (threshold(row) <= level) selected.set(row.produceSkillId, row);
    }
    return [...selected.values()].sort((a,b) => a.order-b.order);
  }
  function skillChanges(rows, before, after, threshold, prefix) {
    const current = new Map(activeSkills(rows, before, threshold).map(row => [row.produceSkillId,row]));
    return activeSkills(rows, after, threshold).map(row => {
      const old = current.get(row.produceSkillId);
      const customizationUnlock=customizationSkill(row);
      return {skillId:row.produceSkillId,label: customizationUnlock?'专属技能卡附魔':`${prefix} · ${row.order}`, before: old ? customizationUnlock?'解锁角色专属技能卡附魔':skillText(old) : '未解锁', after: customizationUnlock?'解锁角色专属技能卡附魔':skillText(row),customizationUnlock,
        changed: !old || old.produceSkillLevel !== row.produceSkillLevel, added: !old,
        beforeEffects:skillEffects(old),afterEffects:skillEffects(row),
        beforeTriggers:[1,2,3].map(i=>skills.get(JSON.stringify([old?.produceSkillId,old?.produceSkillLevel]))?.[`produceTriggerId${i}`]).filter(Boolean),
        afterTriggers:[1,2,3].map(i=>skills.get(JSON.stringify([row.produceSkillId,row.produceSkillLevel]))?.[`produceTriggerId${i}`]).filter(Boolean),
        beforeReferences:skillReferences(old),afterReferences:skillReferences(row),
        unlock: `${prefix === '支援技能' ? 'Lv.' : '阶级 '}${threshold(row)}`};
    });
  }
  function support(held, target = held.level) {
    const card = supportCards.get(held.supportCardId);
    if (!card) return null;
    const limits = [...byId(data.SupportCardLevelLimit,card.supportCardLevelLimitId)].sort((a,b)=>a.levelLimit-b.levelLimit);
    const maximum = Math.max(...limits.map(row=>row.levelLimit));
    if (held.level > maximum || !limits.some(row=>rankNumber(row.rank)===held.levelLimitRank)) return null;
    target = Math.max(1, Math.min(target,maximum));
    const rows = supportRows(held.supportCardId);
    const requiredRank = rankNumber(limits.find(row=>row.levelLimit>=target).rank);
    const nextLevel=Math.min(maximum,...rows.filter(row=>row.supportCardLevel>held.level).map(row=>row.supportCardLevel));
    const changes=target>=held.level?skillChanges(rows,held.level,target,row=>row.supportCardLevel,'支援技能'):
      skillChanges(rows,target,held.level,row=>row.supportCardLevel,'支援技能').map(row=>({...row,
        before:row.after,after:row.before,beforeEffects:row.afterEffects,afterEffects:row.beforeEffects,
        beforeReferences:row.afterReferences,afterReferences:row.beforeReferences,beforeTriggers:row.afterTriggers,afterTriggers:row.beforeTriggers,
        added:false,removed:row.added}));
    for(const row of changes)if(row.added||row.removed){
      const first=Math.min(...rows.filter(skill=>skill.produceSkillId===row.skillId).map(skill=>skill.supportCardLevel));
      row.unlock=`Lv.${first}`;
    }
    return {maximum,target,nextLevel,requiredRank,levelLimits:limits.map(row=>({rank:rankNumber(row.rank),level:row.levelLimit})),changes};
  }
  function supportMaximum(held) {
    const card=supportCards.get(held.supportCardId);
    if(!card)return null;
    const limit=[...byId(data.SupportCardLevelLimit,card.supportCardLevelLimitId)].sort((a,b)=>b.levelLimit-a.levelLimit)[0];
    return support({...held,level:limit.levelLimit,levelLimitRank:rankNumber(limit.rank)});
  }
  function supportPreview(held,target=held.level) {
    const baseline=support(held,target);if(!baseline)return null;
    target=baseline.target;
    const card=supportCards.get(held.supportCardId);
    const limits=[...byId(data.SupportCardLevelLimit,card.supportCardLevelLimitId)].sort((a,b)=>a.levelLimit-b.levelLimit);
    const rows=supportRows(held.supportCardId).filter(row=>row.supportCardLevel<=baseline.maximum);
    const current=new Map(activeSkills(rows,held.level,row=>row.supportCardLevel).map(row=>[row.produceSkillId,row]));
    const preview=new Map(activeSkills(rows,target,row=>row.supportCardLevel).map(row=>[row.produceSkillId,row]));
    const first=new Map();
    for(const row of [...rows].sort((a,b)=>a.supportCardLevel-b.supportCardLevel))if(!first.has(row.produceSkillId))first.set(row.produceSkillId,row);
    const reference=['unowned','unknown'].includes(held.ownership);
    return [...first.values()].sort((a,b)=>a.order-b.order).map(initial=>{
      const old=current.get(initial.produceSkillId),next=preview.get(initial.produceSkillId),active=Boolean(next);
      const locked=!active,shown=next??initial;
      const oldSkill=old&&skills.get(JSON.stringify([old.produceSkillId,old.produceSkillLevel]));
      const nextSkill=next&&skills.get(JSON.stringify([next.produceSkillId,next.produceSkillLevel]));
      const numberChanges=oldSkill&&nextSkill?descriptionNumberChanges(oldSkill.descriptions,nextSkill.descriptions):[];
      return {id:initial.produceSkillId,locked,reference,active,gained:active&&!old,lost:!active&&Boolean(old),
        changed:Boolean(old&&next&&skillText(old)!==skillText(next)),numberChanges,unlockLevel:initial.supportCardLevel,
        requiredRank:rankNumber(limits.find(limit=>limit.levelLimit>=initial.supportCardLevel).rank),
        text:skillText(shown),descriptionParts:skills.get(JSON.stringify([shown.produceSkillId,shown.produceSkillLevel]))?.descriptions,effectIds:skillEffects(shown),cardReferences:skillReferences(shown)};
    });
  }
  function idol(held, targetRank = held.levelLimitRank, targetPotential = held.potentialRank) {
    const card = idolCards.get(held.idolCardId);
    if (!card) return null;
    const ranks = byId(data.IdolCardLevelLimitStatusUp,card.idolCardLevelLimitStatusUpId);
    const potentials = byId(data.IdolCardPotential,card.idolCardPotentialId);
    const maximum = rankNumber(card.maxIdolCardLevelLimitRank);
    const maxPotential = Math.max(0,...potentials.map(row=>rankNumber(row.rank)));
    if (held.levelLimitRank>maximum || held.potentialRank>maxPotential) return null;
    targetRank = Math.max(held.levelLimitRank,Math.min(targetRank,maximum));
    targetPotential = Math.max(held.potentialRank,Math.min(targetPotential,maxPotential));
    const currentR = stages(ranks,held.levelLimitRank), nextR = stages(ranks,targetRank);
    const currentP = stages(potentials,held.potentialRank), nextP = stages(potentials,targetPotential);
    const changes = [];
    const number = (label,before,after,unit='',scale=1) => changes.push({label,before:`${before/scale}${unit}`,after:`${after/scale}${unit}`,
      changed:before!==after,delta:before===after?'':`+${(after-before)/scale}${unit === '%' ? ' 个百分点' : ''}`});
    for (const [key,label] of [['produceVocal','Vocal'],['produceDance','Dance'],['produceVisual','Visual']]) {
      number(`初始 ${label}`,card[key]+sum(currentR,key),card[key]+sum(nextR,key));
      const growth=key+'GrowthRatePermil';
      number(`${label} 成长率`,card[growth]+sum(currentP,growth),card[growth]+sum(nextP,growth),'%',10);
    }
    const stamina = (r,p) => card.produceStamina+sum([...r,...p].filter(row=>hasEffect(row,'ProduceStamina')),'effectValue');
    number('体力',stamina(currentR,currentP),stamina(nextR,nextP));
    changes.push(...skillChanges(byId(data.IdolCardLevelLimitProduceSkill,card.idolCardLevelLimitProduceSkillId),held.levelLimitRank,targetRank,row=>rankNumber(row.rank),'特训技能'),
      ...skillChanges(byId(data.IdolCardPotentialProduceSkill,card.idolCardPotentialProduceSkillId),held.potentialRank,targetPotential,row=>rankNumber(row.rank),'潜能技能'));
    const cardText = (id,upgradeCount) => {
      const description=semantics.card({id,upgradeCount,customizes:[]});
      return [description.heading,...description.lines.map(line=>line===description.sourceText?description.readingText:line)].join('\n');
    };
    for (const [id,type,label] of [[card.produceCardId,'ProduceCardUpgrade','专属技能卡'],[card.secondProduceCardId,'SecondProduceCardUpgrade','第二专属技能卡']]) {
      if (!id) continue;
      const before=currentR.filter(row=>hasEffect(row,type)).length, after=nextR.filter(row=>hasEffect(row,type)).length;
      changes.push({label,before:cardText(id,before),after:cardText(id,after),changed:before!==after,
        beforeCard:{id,upgradeCount:before,customizes:[]},afterCard:{id,upgradeCount:after,customizes:[]},
        beforeReferences:semantics.card({id,upgradeCount:before,customizes:[]}).cardReferences,afterReferences:semantics.card({id,upgradeCount:after,customizes:[]}).cardReferences});
    }
    if (card.beforeProduceItemId) {
      const before=currentP.some(row=>hasEffect(row,'InitialProduceItemChange')) ? card.afterProduceItemId : card.beforeProduceItemId;
      const after=nextP.some(row=>hasEffect(row,'InitialProduceItemChange')) ? card.afterProduceItemId : card.beforeProduceItemId;
      const text=id=>{const value=semantics.item(id);return [value.heading,...value.lines.map(line=>line===value.sourceText?value.readingText:line)].join('\n');};
      changes.push({label:'专属 P 道具',before:text(before),after:text(after),changed:before!==after,beforeItem:before,afterItem:after});
    }
    for (const [label,before,after] of [
      ['强化卡面',currentR.some(row=>row.isIllustrationChange),nextR.some(row=>row.isIllustrationChange)],
      ['追加服装',currentP.some(row=>row.anotherCostumeProvide),nextP.some(row=>row.anotherCostumeProvide)]]) {
      if (after) changes.push({label,before:before?'已解锁':'未解锁',after:'已解锁',changed:!before,added:!before});
    }
    const illustrationRank=ranks.filter(row=>row.isIllustrationChange&&rankNumber(row.rank)<=maximum).map(row=>rankNumber(row.rank)).sort((a,b)=>a-b)[0];
    const unlockRanks=byId(data.IdolCardLevelLimitProduceSkill,card.idolCardLevelLimitProduceSkillId).filter(customizationSkill).map(row=>rankNumber(row.rank)).filter(rank=>rank<=maximum);
    const unlockRank=unlockRanks.length?Math.min(...unlockRanks):undefined;
    const customization=unlockRank===undefined?null:{rank:unlockRank,unlocked:held.levelLimitRank>=unlockRank,targetUnlocked:targetRank>=unlockRank,
      cards:[[card.produceCardId,'ProduceCardUpgrade'],[card.secondProduceCardId,'SecondProduceCardUpgrade']].filter(([id])=>id).map(([id,type])=>({id,upgradeCount:stages(ranks,Math.max(targetRank,unlockRank)).filter(row=>hasEffect(row,type)).length,customizes:[]}))};
    return {maximum,maxPotential,targetRank,targetPotential,illustrationRank,changes,customization};
  }
  function idolPreview(held,targetRank=held.levelLimitRank,targetPotential=held.potentialRank){
    const current=idol(held);if(!current)return null;
    targetRank=Math.max(0,Math.min(current.maximum,Math.trunc(targetRank)));
    targetPotential=Math.max(0,Math.min(current.maxPotential,Math.trunc(targetPotential)));
    const target=idol({...held,levelLimitRank:targetRank,potentialRank:targetPotential});
    const changed=targetRank!==held.levelLimitRank||targetPotential!==held.potentialRank;
    const reference=['unowned','unknown'].includes(held.ownership);
    const previous=new Map(current.changes.map(row=>[row.label,row]));
    const stats=target.changes.filter(row=>['初始 Vocal','初始 Dance','初始 Visual','Vocal 成长率','Dance 成长率','Visual 成长率','体力'].includes(row.label)).map(row=>{
      const before=previous.get(row.label).before,after=row.before;
      return {label:row.label,before,after,delta:Number((parseFloat(after)-parseFloat(before)).toFixed(4)),unit:after.endsWith('%')?'%':''};
    });
    const initialStats=stats.filter(row=>row.label.startsWith('初始 '));
    const totalBefore=initialStats.reduce((total,row)=>total+Number(row.before),0),totalAfter=initialStats.reduce((total,row)=>total+Number(row.after),0);
    stats.push({label:'合计',before:String(totalBefore),after:String(totalAfter),delta:totalAfter-totalBefore,unit:''});
    const card=idolCards.get(held.idolCardId),skillRows=[];
    for(const [kind,rows,before,after,maximum] of [
      ['rank',byId(data.IdolCardLevelLimitProduceSkill,card.idolCardLevelLimitProduceSkillId),held.levelLimitRank,targetRank,current.maximum],
      ['potential',byId(data.IdolCardPotentialProduceSkill,card.idolCardPotentialProduceSkillId),held.potentialRank,targetPotential,current.maxPotential]]){
      const allowed=rows.filter(row=>rankNumber(row.rank)<=maximum&&!customizationSkill(row));
      const initial=new Map();
      for(const row of [...allowed].sort((a,b)=>rankNumber(a.rank)-rankNumber(b.rank)))if(!initial.has(row.produceSkillId))initial.set(row.produceSkillId,row);
      const oldRows=new Map(activeSkills(allowed,before,row=>rankNumber(row.rank)).map(row=>[row.produceSkillId,row]));
      const newRows=new Map(activeSkills(allowed,after,row=>rankNumber(row.rank)).map(row=>[row.produceSkillId,row]));
      for(const first of [...initial.values()].sort((a,b)=>a.order-b.order)){
        const old=oldRows.get(first.produceSkillId),next=newRows.get(first.produceSkillId),shown=next??first;
        const oldDefinition=old&&skills.get(JSON.stringify([old.produceSkillId,old.produceSkillLevel]));
        const nextDefinition=next&&skills.get(JSON.stringify([next.produceSkillId,next.produceSkillLevel]));
        skillRows.push({id:`${kind}:${first.produceSkillId}`,kind,unlockRank:rankNumber(first.rank),
          locked:!next||(reference&&!changed),gained:Boolean(next&&!old),lost:Boolean(old&&!next),
          changed:Boolean(old&&next&&skillText(old)!==skillText(next)),
          numberChanges:oldDefinition&&nextDefinition?descriptionNumberChanges(oldDefinition.descriptions,nextDefinition.descriptions):[],
          text:skillText(shown),descriptionParts:skills.get(JSON.stringify([shown.produceSkillId,shown.produceSkillLevel]))?.descriptions,iconValue:skillIconValue(shown),effectIds:skillEffects(shown),cardReferences:skillReferences(shown)});
      }
    }
    const rewards=target.changes.filter(row=>row.beforeCard||row.beforeItem).map(row=>{
      const old=previous.get(row.label);
      return {label:row.label,card:row.beforeCard,item:row.beforeItem,
        changed:JSON.stringify(row.beforeCard??row.beforeItem)!==JSON.stringify(old?.beforeCard??old?.beforeItem)};
    });
    for(const linked of byId(primaStellaCards,held.idolCardId,'idolCardId')){
      rewards.push({label:'HIF 专属技能卡',scope:'hif-final',unlockState:'unknown',primaStellaUpgradedTime:held.primaStellaUpgradedTime,changed:false,
        card:{id:linked.id,upgradeCount:0,customizes:[]}});
    }
    const calculations={};
    const precision=value=>Number(value.toFixed(4));
    for(const [suffix,label] of [['Vocal','Vocal'],['Dance','Dance'],['Visual','Visual']]){
      for(const [growth,kind,rank,maximum,rows,scale] of [
        [false,'rank',targetRank,current.maximum,byId(data.IdolCardLevelLimitStatusUp,card.idolCardLevelLimitStatusUpId),1],
        [true,'potential',targetPotential,current.maxPotential,byId(data.IdolCardPotential,card.idolCardPotentialId),10],
      ]){
        const key='produce'+suffix+(growth?'GrowthRatePermil':''),base=card[key]/scale;
        const contributions=stages(rows,rank).filter(row=>row[key]!==0).map(row=>({rank:rankNumber(row.rank),value:row[key]/scale}));
        const remainingContributions=stages(rows,maximum).filter(row=>rankNumber(row.rank)>rank&&row[key]!==0).map(row=>({rank:rankNumber(row.rank),value:row[key]/scale}));
        const value=precision(base+contributions.reduce((total,row)=>total+row.value,0));
        const reachable=precision(base+sum(stages(rows,maximum),key)/scale);
        calculations[growth?label+' 成长率':'初始 '+label]={base,contributions,remainingContributions,value,reachable,remaining:precision(reachable-value),kind,rank,maximum};
      }
    }
    const statMaximum=Math.max(1,...['Vocal','Dance','Visual'].map(key=>calculations['初始 '+key].reachable));
    const growthMaximum=Math.max(...['Vocal','Dance','Visual'].map(key=>calculations[key+' 成长率'].reachable));
    const costumeRank=byId(data.IdolCardPotential,card.idolCardPotentialId).filter(row=>row.anotherCostumeProvide).map(row=>rankNumber(row.rank)).sort((a,b)=>a-b)[0];
    return {maximum:current.maximum,maxPotential:current.maxPotential,targetRank,targetPotential,changed,reference,stats,calculations,statMaximum,growthMaximum,skills:skillRows,rewards,
      costume:costumeRank===undefined?null:{rank:costumeRank,unlocked:targetPotential>=costumeRank,actualUnlocked:held.potentialRank>=costumeRank},
      customization:target.customization?{...target.customization,actualUnlocked:current.customization?.unlocked??false}:null};
  }
  return {support,supportMaximum,supportPreview,idol,idolPreview};
}
