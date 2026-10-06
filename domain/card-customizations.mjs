import {growEffectIconType} from './effect-icons.mjs';
import {descriptionText,plainText} from './semantic-text.mjs';

// 可选附魔的说明联接，不把变更说明冒充已叠加后的完整卡片效果。
export function createCardCustomizations(base={},catalog={}){
  const cards=new Map((base.ProduceCard??[]).map(row=>[JSON.stringify([row.id,row.upgradeCount]),row]));
  const grows=new Map((catalog.ProduceCardGrowEffect??[]).map(row=>[row.id,row]));
  const names=new Map((catalog.ProduceDescriptionProduceCardGrowEffect??[]).map(row=>[row.type,row]));
  const labels=new Map((catalog.ProduceDescriptionLabel??[]).map(row=>[row.id,row]));
  const effects=new Map((base.ProduceExamEffect??[]).map(row=>[row.id,row]));
  const enchants=new Map((catalog.ProduceCardStatusEnchant??[]).map(row=>[row.id,row]));
  const triggers=new Map((catalog.ProduceExamTrigger??[]).map(row=>[row.id,row]));
  const customs=new Map();
  for(const row of catalog.ProduceCardCustomize??[]){if(!customs.has(row.id))customs.set(row.id,[]);customs.get(row.id).push(row);}
  const read=row=>{
    if(!row)return {text:'',status:'unresolved',parts:[]};
    // 动态回合槽只取同一效果记录的 effectTurn，不跨节点猜测持续时间。
    const parts=(row.descriptions??row.produceDescriptions??[]).map(part=>
      !part.text&&part.examDescriptionType==='ExamDescriptionType_ExamTurn'&&part.originProduceExamEffectId===row.id&&row.effectTurn>0
        ?{...part,produceDescriptionType:'ProduceDescriptionType_PlainText',text:`${row.effectTurn}ターン`}:part);
    return {...descriptionText(parts,labels,true),parts};
  };
  const percentageTypes=new Set(['ProduceCardGrowEffectType_LessonDependBlockAdd','ProduceCardGrowEffectType_LessonDependExamCardPlayAggressiveAdd','ProduceCardGrowEffectType_LessonDependExamReviewAdd']);
  function describe(grow,custom,card){
    if(!grow)return {name:'',text:'',complete:false};
    const name=plainText(names.get(grow.effectType)?.name??'');
    const result={name,type:grow.effectType,text:'',complete:true};
    if(grow.playProduceExamEffectId){
      const source=read(effects.get(grow.playProduceExamEffectId));
      result.text=source.text;result.descriptionParts=source.parts;result.complete=source.status==='supported';
      if(grow.effectType==='ProduceCardGrowEffectType_EffectChange'){
        const previous=(grow.targetPlayProduceExamEffectIds??[]).map(id=>read(effects.get(id)));
        result.replaces=previous.map(row=>row.text);result.replacesParts=previous.map(row=>row.parts);
        if(result.replaces.some(text=>!text))result.complete=false;
      }
    }else if(grow.produceCardStatusEnchantId){
      const source=read(enchants.get(grow.produceCardStatusEnchantId));result.text=source.text;result.descriptionParts=source.parts;result.complete=source.status==='supported';
    }else if(grow.effectType==='ProduceCardGrowEffectType_PlayTriggerChange'){
      const triggerId=grow.playProduceExamTriggerId;
      const trigger=triggers.get(triggerId);
      const parts=(trigger?.playProduceDescriptions??[]).map(part=>({...part,originProduceExamTriggerId:part.originProduceExamTriggerId??triggerId}));
      const replacement=descriptionText(parts,labels,true);
      result.text=replacement.text;result.descriptionParts=parts;
      result.complete=Boolean(triggerId)&&Boolean(replacement.text)&&replacement.status==='supported';
    }else if(grow.effectType==='ProduceCardGrowEffectType_PlayEffectTriggerChange'){
      const targets=new Set(grow.targetPlayEffectProduceExamTriggerIds??[]);
      const parts=(card.descriptions??[]).filter(part=>targets.has(part.originProduceExamTriggerId));
      const source={...descriptionText(parts,labels,true),parts};
      result.removesCondition=!grow.playEffectProduceExamTriggerId&&targets.size>0;
      result.text=source.text;result.descriptionParts=source.parts;result.complete=result.removesCondition&&Boolean(source.text)&&source.status==='supported';
      if(grow.playEffectProduceExamTriggerId){
        const trigger=triggers.get(grow.playEffectProduceExamTriggerId);
        const replacementParts=(trigger?.playEffectProduceDescriptions??[]).map(part=>({...part,originProduceExamTriggerId:part.originProduceExamTriggerId??grow.playEffectProduceExamTriggerId}));
        const replacement=descriptionText(replacementParts,labels,true);
        result.replaces=[source.text];result.replacesParts=[source.parts];result.text=replacement.text;result.descriptionParts=replacementParts;
        result.complete=Boolean(source.text)&&source.status==='supported'&&Boolean(replacement.text)&&replacement.status==='supported';
      }
    }else{
      result.text=plainText(custom.description||names.get(grow.effectType)?.produceCardCustomizeDescription||'').replace(/\\n/g,'\n');
      const icon=growEffectIconType(grow.effectType);
      result.descriptionParts=[{produceDescriptionType:icon?'ProduceDescriptionType_ProduceExamEffectType':'ProduceDescriptionType_PlainText',...(icon?{examEffectType:'ProduceExamEffectType_'+icon}:{}),text:result.text}];
      if(grow.value){
        const value=percentageTypes.has(grow.effectType)?`${grow.value/10}%`:String(grow.value);
        result.increment=(grow.effectType.endsWith('Reduce')?'-':'')+value;
        result.text+=value;result.descriptionParts.push({produceDescriptionType:'ProduceDescriptionType_DiffText',text:value});
      }
      result.complete=Boolean(result.text);
    }
    return result;
  }
  function available(reference){
    const card=cards.get(JSON.stringify([reference.id,reference.upgradeCount]));
    if(!card)return null;
    const definition=card.definition??card;
    const options=(definition.produceCardCustomizeIds??[]).map(id=>({id,levels:[...(customs.get(id)??[])].sort((a,b)=>a.customizeCount-b.customizeCount).map(custom=>({level:custom.customizeCount,producePoint:custom.producePoint,effects:custom.produceCardGrowEffectIds.map(id=>describe(grows.get(id),custom,card))}))}));
    return {id:card.id,name:plainText(card.name),upgradeCount:card.upgradeCount,maximum:definition.maxCustomizeCount??0,options,complete:options.every(option=>option.levels.length&&option.levels.every(level=>level.effects.length&&level.effects.every(effect=>effect.complete)))};
  }
  function applied(reference,entry){
    const card=cards.get(JSON.stringify([reference?.id,reference?.upgradeCount]));
    const definition=customs.get(entry.id)?.find(row=>row.customizeCount===entry.customizeCount);
    if(!card||!definition)return null;
    return {id:entry.id,level:entry.customizeCount,producePoint:definition.producePoint,
      effects:definition.produceCardGrowEffectIds.map(id=>describe(grows.get(id),definition,card))};
  }
  return {available,applied};
}

// 效果使用所选次数的结果；费用按每次操作累加，多个选项共用卡片次数上限。
export function customizationPreview(data,counts={}){
  const selected=data.options.map(option=>{
    const count=counts[option.id]??0;
    return {id:option.id,count,level:option.levels.find(level=>level.level===count),
      producePoint:option.levels.filter(level=>level.level<=count).reduce((sum,level)=>sum+level.producePoint,0)};
  });
  return {selected,count:selected.reduce((sum,option)=>sum+option.count,0),producePoint:selected.reduce((sum,option)=>sum+option.producePoint,0)};
}

// 已记录的附魔不可在预览中撤销；未列入当前可选目录的记录同样占用次数。
export function recordedCustomizationState(data,reference){
  const counts=Object.fromEntries((reference.customizes??[]).map(row=>[row.id,row.customizeCount]));
  const used=Object.values(counts).reduce((sum,count)=>sum+count,0),remaining=Math.max(0,(data?.maximum??0)-used);
  const options=(data?.options??[]).filter(option=>option.levels.some(level=>level.level===(counts[option.id]??0)+1)&&remaining>0);
  const known=new Set((data?.options??[]).map(option=>option.id));
  const outsideCount=Object.entries(counts).filter(([id])=>!known.has(id)).reduce((sum,[,count])=>sum+count,0);
  return {counts,used,remaining,options,outsideCount};
}
