import {plainText} from './semantic-text.mjs';
import {endingBonusReference} from './ending-bonuses.mjs';

export const achievementRewardLabels={ResourceType_JewelTotal:'宝石',ResourceType_UserExp:'制作人经验',ResourceType_Costume:'服装',ResourceType_MeishiBaseAsset:'名片背景',ResourceType_Item:'道具'};


// 顺序只影响展示，不限制成员；新角色从公开关联中进入自己的入口。
const preferredCharacterOrder=['hski','ttmr','fktn','atbm','amao','kllj','kcna','ssmk','shro','jsna','hmsz','hume','hrnm'];
export const achievementOwner=entry=>entry.characterId||'nasr';
// 卡片目标取任务类型对应的目标槽，兼容早期不同编号的成就。
export function achievementCardId(definition){
  const slot={MissionType_AbsoluteIdolCardLevelLimitRank:'targetIds2',MissionType_IncrementProduceIdolCardClearCount:'targetIds3',MissionType_IncrementProduceIdolCardPlayCount:'targetIds3'}[definition.missionType];
  return slot?(definition[slot]??[]).find(id=>id.startsWith('i_card-'))??'':'';
}
export function achievementRewardKind(reward){
  if(reward.resourceType==='ResourceType_UserExp')return 'experience';
  if(reward.resourceType==='ResourceType_JewelTotal')return 'jewel';
  if(reward.resourceType==='ResourceType_Item'&&reward.resourceId==='item-support_card_enhance_point')return 'support';
  return 'other';
}
export const achievementIsComplete=entry=>entry.stages.length>0&&entry.stages.every(stage=>['received','claimable'].includes(stage.status));
// 角色详情范围与页签计数共用，阶段数量不受图标合并或分页影响。
export function achievementDetailScope(entries,view){
  const character=view.achievementCharacter,common=character==='nasr',card=!common&&view.achievementScope==='card';
  const category=common?(view.achievementCategory==='Other'?'Other':'Produce'):'';
  return entries.filter(row=>achievementOwner(row)===character&&!row.isMasterAchievement&&Boolean(row.idolCardId)===card&&(!category||row.category===category));
}
export function achievementSummary(entries){
  const counts={received:0,claimable:0,progress:0,incomplete:0};
  for(const entry of entries)counts[entry.status]++;
  return {...counts,achieved:counts.received+counts.claimable,incompleteTotal:counts.incomplete+counts.progress};
}

export function createAchievementCatalog(tables={},endings={},characters={}){
  const missions=new Map((tables.Mission??[]).map(row=>[row.id,row]));
  const items=new Map((tables.Item??[]).map(row=>[row.id,plainText(row.name)]));
  const stages=new Map();
  for(const row of tables.AchievementProgress??[]){
    if(!stages.has(row.achievementId))stages.set(row.achievementId,[]);
    stages.get(row.achievementId).push({...row,image:row.assetId?row.assetId+'.webp':undefined,rewards:row.rewards.map(reward=>({...reward,name:reward.resourceType==='ResourceType_Item'?items.get(reward.resourceId):undefined}))});
  }
  for(const rows of stages.values())rows.sort((a,b)=>a.index-b.index||a.threshold-b.threshold);
  const definitions=[...(tables.Achievement??[])].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
  const byId=new Map(definitions.map(row=>[row.id,row]));
  // 已核对的三个 True End 成就键；图名只读取目录 assetId，不按编号猜图片。
  const endingSuffix={1:'',2:'-1',3:'-2'};
  function endingReference(characterId,captured){
    const reference=endingBonusReference(endings,characterId,captured);
    return {...reference,rows:reference.rows.map(row=>{
      const id=Object.hasOwn(endingSuffix,row.type)?`achieve-p_idol-${characterId}-000${endingSuffix[row.type]}`:null;
      const achievement=byId.get(id),progress=stages.get(id);
      if(!achievement?.isTrueEndAchievement||achievement.characterId!==characterId||progress?.length!==1||!progress[0].image)return row;
      return {...row,achievementId:id,achievementName:plainText(achievement.name),image:progress[0].image};
    })};
  }
  function entries(snapshot,view={}){
    const query=(view.query??'').trim().toLowerCase();
    if(view.achievementSection!=='achievement'){
      const captured=new Map((snapshot?.characters??[]).map(row=>[row.characterId,row]));
      return (endings.Character??[]).map(character=>({kind:'ending',recordingAvailable:snapshot?.characters!==undefined,characterId:character.id,name:characters[character.id]??character.id,...endingReference(character.id,captured.get(character.id))}))
        .filter(row=>row.rows.length&&(!view.achievementReward||row.stages.some(stage=>stage.rewards.some(reward=>achievementRewardKind(reward)===view.achievementReward)))&&(!query||[row.name,...row.rows.map(value=>({1:'初 First Star',2:'N.I.A NIA',3:'H.I.F HIF'})[value.type])].join(' ').toLowerCase().includes(query)));
    }
    const captured=new Map((snapshot?.achievements??[]).map(row=>[row.achievementId,row]));
    const entries=definitions.map(definition=>{
      const record=captured.get(definition.id),less=missions.get(definition.id)?.isLessThanTargetValue===true;
      const progress=(stages.get(definition.id)??[]).map(stage=>{
        // 通用任务的 isUnlock 不作为成就阶段达标的前提；已领取仍只看领取列表。
        const status=!record?'incomplete':record.receivedThresholds.includes(stage.threshold)?'received':(less?record.progress<=stage.threshold:record.progress>=stage.threshold)?'claimable':'incomplete';
        return {...stage,status,description:plainText(definition.description).replaceAll('{threshold}',String(stage.threshold))};
      });
      const current=progress.find(stage=>stage.status!=='received')??progress.at(-1);
      // 只有当前待推进的阶段为进行中，后续未达标阶段保持未达成。
      if(record&&current?.status==='incomplete')current.status='progress';
      const status=current?.status??'incomplete',index=progress.indexOf(current),previous=progress[index-1]?.threshold??0;
      const span=current?less?previous-current.threshold:current.threshold-previous:0;
      const ratio=record&&current&&span>0?Math.max(0,Math.min(1,(less?previous-record.progress:record.progress-previous)/span)):null;
      return {kind:'achievement',recordingAvailable:snapshot?.achievements!==undefined,id:definition.id,isMasterAchievement:definition.isMasterAchievement===true,idolCardId:achievementCardId(definition),missionType:definition.missionType,name:plainText(definition.name),characterId:definition.characterId,category:definition.category.replace('AchievementCategory_',''),record,less,stages:progress,current,status,ratio,description:current?.description??plainText(definition.description)};
    }).filter(row=>(!view.achievementCategory||row.category===view.achievementCategory)&&(!view.achievementState||(view.achievementState==='achieved'?achievementIsComplete(row):view.achievementState==='unachieved'?!achievementIsComplete(row):row.status===view.achievementState))&&(!view.achievementReward||row.stages.some(stage=>stage.rewards.some(reward=>achievementRewardKind(reward)===view.achievementReward)))&&(!query||[row.name,...row.stages.map(stage=>stage.description),characters[row.characterId]??'',...row.stages.flatMap(stage=>stage.rewards.flatMap(reward=>[reward.name??'',achievementRewardLabels[reward.resourceType]??'',reward.resourceType]))].join(' ').toLowerCase().includes(query)));
    if(view.achievementSort==='near'){
      const priority={claimable:0,progress:1,received:2,incomplete:3};
      entries.sort((a,b)=>priority[a.status]-priority[b.status]||(a.status==='progress'?(b.ratio??-1)-(a.ratio??-1):0));
    }
    if(view.achievementIncompleteFirst===true)entries.sort((a,b)=>Number(achievementIsComplete(a))-Number(achievementIsComplete(b)));
    return entries;
  }
  const ids=new Set(definitions.map(row=>row.characterId).filter(Boolean));
  for(const character of endings.Character??[])if(endingReference(character.id).rows.length)ids.add(character.id);
  ids.delete('nasr');
  const order=id=>{const index=preferredCharacterOrder.indexOf(id);return index<0?preferredCharacterOrder.length:index;};
  const characterIds=[...ids].sort((a,b)=>order(a)-order(b)||(characters[a]??a).localeCompare(characters[b]??b,'ja'));
  characterIds.push('nasr');
  return {entries,characterIds,count:definitions.length};
}

// 同一卡片的特训目标归为一项，保留各原始成就的阶段、领取记录和奖励。
export function mergeCardAchievements(entries){
  const output=[],training=new Map();
  for(const entry of entries){
    if(!entry.idolCardId||entry.missionType!=='MissionType_AbsoluteIdolCardLevelLimitRank'){output.push(entry);continue;}
    if(!training.has(entry.idolCardId)){const grouped={...entry,sourceEntries:[]};training.set(entry.idolCardId,grouped);output.push(grouped);}
    training.get(entry.idolCardId).sourceEntries.push(entry);
  }
  for(const grouped of training.values()){
    const stages=grouped.sourceEntries.flatMap(entry=>entry.stages.map(stage=>({...stage,name:entry.name,achievementId:entry.id}))).sort((a,b)=>a.threshold-b.threshold);
    const current=stages.find(stage=>stage.status!=='received')??stages.at(-1);
    for(const stage of stages)if(stage!==current&&stage.status==='progress')stage.status='incomplete';
    const records=grouped.sourceEntries.map(entry=>entry.record).filter(Boolean),record=records.length?{progress:Math.max(...records.map(row=>row.progress)),receivedThresholds:stages.filter(stage=>stage.status==='received').map(stage=>stage.threshold)}:undefined;
    const index=stages.indexOf(current),previous=stages[index-1]?.threshold??0,span=(current?.threshold??0)-previous;
    Object.assign(grouped,{id:stages[0].achievementId,name:stages[0].name,stages,current,record,status:current?.status??'incomplete',description:current?.description??grouped.description,ratio:record&&span>0?Math.max(0,Math.min(1,(record.progress-previous)/span)):null});
  }
  return output;
}
export function achievedCardStage(entry){
  return [...entry.stages].reverse().find(stage=>['received','claimable'].includes(stage.status))??null;
}

export function achievementProgressInfo(entry){
  const progress=entry.record?.progress??(entry.less?null:0);
  const next=entry.stages.find(stage=>!['received','claimable'].includes(stage.status));
  const remaining=next&&progress!==null?Math.max(0,entry.less?progress-next.threshold:next.threshold-progress):null;
  const index=entry.stages.indexOf(next),previous=entry.stages[index-1]?.threshold??0;
  const span=next?(entry.less?previous-next.threshold:next.threshold-previous):0;
  const ratio=!next?1:progress!==null&&span>0?Math.max(0,Math.min(1,(entry.less?previous-progress:progress-previous)/span)):0;
  return {progress,remaining,ratio,next};
}
