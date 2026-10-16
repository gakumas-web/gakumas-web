import {catalogState} from './catalog-state.mjs';
import {producerLevelFromExp,producerLevelCap} from './producer-level.mjs';
import {mergeCollection} from './model.mjs';
import {plainText} from './semantic-text.mjs';
import {t} from '../i18n.mjs';

export function accountProducerLevel(exp){return producerLevelFromExp(exp,catalogState.producerLevels);}
export function accountProducerLevelCap(){return producerLevelCap(catalogState.producerLevels);}
export function progressionInfo(kind, held, target, potential) { return catalogState.progression[kind](held,target,potential); }
// 筛选按用户指定角色顺序；新增角色接在现有可培养角色之后，根緒亜紗里始终最后。
const characterFilterOrder=new Map(['hski','ttmr','fktn','hume','hmsz','jsna','kllj','ssmk','kcna','shro','hrnm','amao','atbm'].map((id,index)=>[id,index]));
export function compareCharacterFilters(a,b){
  const position=id=>id==='nasr'?Number.MAX_SAFE_INTEGER:characterFilterOrder.get(id)??characterFilterOrder.size;
  return position(a)-position(b)||(catalogState.tables?.characters.get(a)??a).localeCompare(catalogState.tables?.characters.get(b)??b,'ja')||a.localeCompare(b);
}
export function characterInfo(id) {
  const name = catalogState.tables?.characters.get(id);
  return name ? {name, color:catalogState.characterColors[id], face: `img_sd_${id}_face-00.webp`, portrait: id==='nasr'?undefined:`img_chr_${id}_00-full.webp`,signature:id==='nasr'?undefined:`img_general_sign_${id}_00.webp`} : {name: t('未解析角色')};
}
export function idolInfo(held) {
  const card = catalogState.tables?.idols.get(held.idolCardId);
  if (!card) return {name: t('未解析偶像卡'), character: t('角色未解析'), cardResolved: false, skinResolved: false, variant: 'unresolved', label: t('公开目录未收录')};
  const info = {name: plainText(card.name), character: characterInfo(card.characterId).name,
    characterResolved: catalogState.tables.characters.has(card.characterId),
    characterId: card.characterId, plan: card.planType?.replace('ProducePlanType_',''), rarity: card.rarity.replace(/^IdolCardRarity_/, '').toUpperCase(),
    sortReleaseTime:catalogState.skinReleaseTimes.get(card.originalIdolCardSkinId)?.time,
    examEffectType:card.examEffectType, rarityEnum: card.rarity, cardResolved: true, skinResolved: true};
  const skin = held.idolCardSkinId ? catalogState.tables.skins.get(held.idolCardSkinId) : null;
  if (held.idolCardSkinId && (!skin || skin.idolCardId !== card.id)) {
    return {...info, skinResolved: false, variant: 'unresolved', label: t('所选卡面未解析或所属偶像卡不匹配')};
  }
  const alternate = skin && skin.assetId !== card.assetId;
  const upgraded = !alternate && held.levelLimitRank >= 3;
  const variant = alternate ? 'alternate' : upgraded ? 'upgraded' : 'base';
  return {...info, variant, image: `img_general_${alternate ? skin.assetId : card.assetId}_${upgraded ? 1 : 0}-full.webp`,
    label: alternate ? t('所选替换卡面') : upgraded ? t('强化后卡面') : t('默认卡面')};
}
export function idolArtVariants(held) {
  const card=catalogState.tables?.idols.get(held.idolCardId);
  if(!card)return [];
  const result=progressionInfo('idol',held);
  const variants=[{id:'base',image:`img_general_${card.assetId}_0-full.webp`,label:t('突破前卡面')}];
  if(result?.illustrationRank!==undefined)variants.push({id:'upgraded',image:`img_general_${card.assetId}_1-full.webp`,
    label:t('突破后卡面'),unlockRank:result.illustrationRank});
  const selected=idolInfo(held);
  if(selected.variant==='alternate')variants.push({id:'alternate',image:selected.image,label:t('所选替换卡面')});
  return variants;
}
// 数值缺失和未持有条目始终置后；比较结果相同时保持当前目录／快照顺序。
export function sortCollectionEntries(entries,mode,kind,{ownedFirst=false}={}){
  const rarity={R:1,SR:2,SSR:3},plans={Plan1:0,Plan2:1,Plan3:2,Common:3};
  const number=(a,b,ascending=false)=>{
    const av=Number.isFinite(a),bv=Number.isFinite(b);
    return av!==bv?(av?-1:1):av?(ascending?a-b:b-a):0;
  };
  const actual=(entry,key)=>isReference(entry.held)?undefined:entry.held[key];
  const characters=entry=>(entry.info.characterIds??[entry.info.characterId]).filter(Boolean).sort(compareCharacterFilters);
  const compareCharacters=(a,b)=>{
    const aa=characters(a),bb=characters(b);
    if(!aa.length||!bb.length)return aa.length?-1:bb.length?1:0;
    for(let i=0;i<Math.min(aa.length,bb.length);i++){const order=compareCharacterFilters(aa[i],bb[i]);if(order)return order;}
    return aa.length-bb.length;
  };
  const gap=new Map();
  // 主题排序与筛选选项共用日期规则，先按主题分组，再比较组内角色。
  const themes=mode==='theme'?new Map(skinThemeNames(entries.map(entry=>entry.info)).map((theme,index)=>[theme,index])):null;
  if(mode==='levelGap')for(const entry of entries){
    if(isReference(entry.held))continue;
    const model=progressionInfo('support',entry.held),limit=model?.levelLimits.find(row=>row.rank===entry.held.levelLimitRank)?.level;
    if(Number.isFinite(limit)&&Number.isFinite(entry.held.level))gap.set(entry,Math.max(0,limit-entry.held.level));
  }
  return [...entries].sort((a,b)=>{
    const ownership=ownedFirst?Number(b.held.ownership==='owned')-Number(a.held.ownership==='owned'):0;
    if(ownership)return ownership;
    let order=0;
    switch(mode){
      case 'rarity':order=number(rarity[a.info.rarity],rarity[b.info.rarity]);break;
      case 'level':case 'levelAsc':order=number(actual(a,kind==='idolCards'?'levelLimitRank':'level'),actual(b,kind==='idolCards'?'levelLimitRank':'level'),mode==='levelAsc');break;
      case 'potential':case 'potentialAsc':order=number(actual(a,'potentialRank'),actual(b,'potentialRank'),mode==='potentialAsc');break;
      case 'rank':case 'rankAsc':order=number(actual(a,'levelLimitRank'),actual(b,'levelLimitRank'),mode==='rankAsc');break;
      case 'levelGap':order=number(gap.get(a),gap.get(b));break;
      case 'character':order=compareCharacters(a,b);break;
      case 'name':order=(a.info.theme||a.info.name).localeCompare(b.info.theme||b.info.name,'ja');break;
      case 'plan':order=number(plans[a.info.plan],plans[b.info.plan],true)||number(rarity[a.info.rarity],rarity[b.info.rarity])||compareCharacters(a,b);break;
      case 'type':{
        const types={Vocal:0,Dance:1,Visual:2,[t('辅助')]:3};
        order=number(types[a.info.type],types[b.info.type],true)||number(rarity[a.info.rarity],rarity[b.info.rarity])||number(actual(a,'level'),actual(b,'level'));break;
      }
      case 'theme':order=number(themes.get(a.info.theme),themes.get(b.info.theme),true)||compareCharacters(a,b);break;
      case 'release':case 'releaseAsc':{
        const aTime=a.info.sortReleaseTime??a.info.viewStartTime,bTime=b.info.sortReleaseTime??b.info.viewStartTime;
        // 游戏发行日按日本时间划分；同日装扮先展示偶像卡面，未知日期不参与此优先级。
        const sameDay=kind==='idolCardSkins'&&Number.isFinite(aTime)&&aTime>0&&Number.isFinite(bTime)&&bTime>0&&
          Math.floor((aTime+9*60*60*1000)/(24*60*60*1000))===Math.floor((bTime+9*60*60*1000)/(24*60*60*1000));
        order=(sameDay?Number(Boolean(b.info.hasIdolArt))-Number(Boolean(a.info.hasIdolArt)):0)||number(aTime,bTime,mode==='releaseAsc');break;
      }
    }
    return order||(a.ordinal??0)-(b.ordinal??0);
  });
}
export function sortIdolEntries(entries,mode,options={}){return sortCollectionEntries(entries,mode,'idolCards',options);}

export function collectionRecords(snapshot,field,mode='owned') {
  const catalog=field==='idolCards'?catalogState.tables?.idols:field==='idolCardSkins'?catalogState.tables?.skins:catalogState.tables?.supports;
  const rows=mergeCollection(snapshot?.[field],catalog?[...catalog.values()]:[],field,mode);
  return field==='idolCardSkins'?rows.filter(row=>{
    const skin=catalog?.get(row.idolCardSkinId);
    return !skin||Boolean(skin.theme||skin.name);
  }):rows;
}
export function ownershipLabel(row){return t(row.ownership==='unowned'?'未持有':row.ownership==='unknown'?'持有情况未采集':'已拥有');}
export function isReference(row){return row.ownership==='unowned'||row.ownership==='unknown';}

export function skinInfo(held){
  const skin=catalogState.tables?.skins.get(held.idolCardSkinId),card=catalogState.tables?.idols.get(skin?.idolCardId);
  return {name:plainText(skin?.name)||(skin?.theme?plainText(card?.name):t('基础装扮')),theme:skin?.theme||skin?.name||'',themeAliases:skin?.themeAliases??[],themeStartTime:skin?.themeStartTime,viewStartTime:skin?.viewStartTime&&Number(skin.viewStartTime)>0?Number(skin.viewStartTime):undefined,
    characterId:card?.characterId,character:characterInfo(card?.characterId).name,
    cardName:plainText(card?.name)||t('未解析偶像卡'),idolCardId:skin?.idolCardId,
    image:skin?`img_general_${skin.assetId}_0-full.webp`:undefined,
    sortReleaseTime:catalogState.skinReleaseTimes.get(skin?.id)?.time??catalogState.themeCardReleaseTimes.get(skin?.theme),releaseTimeSource:catalogState.skinReleaseTimes.get(skin?.id),
    themeCardStartTime:catalogState.themeCardReleaseTimes.get(skin?.theme),
    hasIdolArt:Boolean(skin&&card&&skin.assetId===card.assetId),
    resolved:Boolean(skin)};
}

export function skinThemeNames(skins){
  const themes=new Map(),known=value=>Number.isFinite(value)&&value>0;
  for(const info of skins){
    if(!info.theme)continue;
    if(!themes.has(info.theme))themes.set(info.theme,{theme:info.theme,time:Infinity,cardTime:Infinity});
    const theme=themes.get(info.theme);
    if(known(info.themeStartTime))theme.time=Math.min(theme.time,info.themeStartTime);
    if(known(info.themeCardStartTime))theme.cardTime=Math.min(theme.cardTime,info.themeCardStartTime);
  }
  // 旧主题在前；零值不是发行时间，缺失时使用同主题偶像卡最早可确认的日期。
  const time=theme=>Number.isFinite(theme.time)?theme.time:theme.cardTime;
  return [...themes.values()].sort((a,b)=>time(a)-time(b)||a.theme.localeCompare(b.theme,'ja')).map(info=>info.theme);
}

export function planLabel(value){
  const names={2:'Sense',3:'Logic',4:'Anomaly',Plan1:'Sense',Plan2:'Logic',Plan3:'Anomaly'};
  return t(names[value]??'计划 {0}',[value]);
}
