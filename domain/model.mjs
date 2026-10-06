import {CAPTURE_FORMAT,CAPTURE_SCHEMA} from './snapshot-format.mjs';
import {t,locale} from '../i18n.mjs';
import {validPublicUserId} from './account.mjs';
export class InputError extends Error {
  constructor() { super('文件格式不符合库存或备注契约，请检查文件版本与所选档案。'); }
}
// 使用整数纳秒比较采集时刻，避免微秒快照被 Date.parse 截断为同一毫秒。
export function captureTime(value){
  const match=typeof value==='string'&&value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/);
  if(!match)throw new InputError();
  const seconds=Date.parse(match[1]+match[3]);if(!Number.isFinite(seconds))throw new InputError();
  return BigInt(seconds)*1000000n+BigInt((match[2]??'').padEnd(9,'0'));
}
export function compareCapturedAt(a,b){const left=captureTime(a),right=captureTime(b);return left<right?-1:left>right?1:0;}
export function validCapturedAt(value){try{captureTime(value);return true;}catch{return false;}}
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.length <= 4096;
const integer = x => Number.isSafeInteger(x) && x >= 0;
const boolean = x => typeof x === 'boolean';
const array = validator => x => Array.isArray(x) && x.length <= 20000 && x.every(validator);
function fields(input, schema, required = []) {
  if (!record(input) || required.some(k => !(k in input))) throw new InputError();
  const result = {};
  for (const [key, check] of Object.entries(schema)) {
    if (!(key in input)) continue;
    if (!check(input[key])) throw new InputError();
    result[key] = input[key];
  }
  return result;
}
const customizeSchema = {id: text, customizeCount: integer};
const validObject = schema => x => {
  try { fields(x, schema, Object.keys(schema)); return true; }
  catch (error) { if (error instanceof InputError) return false; throw error; }
};
const cardSchema = {id: text, upgradeCount: integer, customizes: array(validObject(customizeSchema))};
const abilitySchema = {id: text, level: integer};
const unitSchema = {characterId: text, liveCostumeId: text, liveCostumeHeadId: text};
const memorySchema = {
  userMemoryId: x => text(x) && x.length > 0, characterId: text, idolCardId: text,
  memoryTagId: text, researchId: text, shotTime: integer, produceCardPhaseType: integer, isProtected: boolean, grade: integer, power: integer,
  planType: integer, vocal: integer, dance: integer, visual: integer, stamina: integer,
  produceCard: x => x === null || validObject(cardSchema)(x),
  abilities: array(validObject(abilitySchema)), examBattleProduceCards: array(validObject(cardSchema)),
  examBattleProduceItemIds: array(text), unitCharacters: array(x => {
    try { fields(x, unitSchema, Object.keys(unitSchema)); return true; }
    catch (error) { if (error instanceof InputError) return false; throw error; }
  }),
};
function cleanCard(card) {
  if (card === null) return null;
  return {id: card.id, upgradeCount: card.upgradeCount,
    customizes: card.customizes.map(c => fields(c, customizeSchema))};
}
export function parseSnapshot(input) {
  const result = fields(input, {
    publicUserId: validPublicUserId,
    format:x=>x===CAPTURE_FORMAT,schema_version:x=>x===CAPTURE_SCHEMA,source:x=>x==='user_get',
    captured_at: validCapturedAt, count: integer,
    achievements: array(record),characters: array(record),supportCards: array(record), memories: array(record), idolCards: array(record), items: array(record), idolCardSkins: array(record),
  }, ['format','schema_version','source','publicUserId','captured_at','count','memories','idolCards','items','idolCardSkins','supportCards','achievements','characters']);
  if (result.count !== result.memories.length) throw new InputError();
  const seen = new Set();
  result.memories = result.memories.map(inputMemory => {
    const m = fields(inputMemory, memorySchema, Object.keys(memorySchema));
    if (seen.has(m.userMemoryId)) throw new InputError();
    seen.add(m.userMemoryId);
    if (m.produceCard !== undefined) m.produceCard = cleanCard(m.produceCard);
    if (m.abilities) m.abilities = m.abilities.map(a => fields(a, abilitySchema));
    if (m.examBattleProduceCards) m.examBattleProduceCards = m.examBattleProduceCards.map(cleanCard);
    if (m.unitCharacters) m.unitCharacters = m.unitCharacters.map(u => fields(u, unitSchema));
    return m;
  });
  const auxiliary = {
    supportCards: {supportCardId: text, level: integer, levelLimitRank: integer, stockQuantity: integer, createdTime: integer},
    achievements:{achievementId:text,progress:integer,receivedThresholds:array(integer),isUnlock:boolean},
    characters:{characterId:text,trueEndProduceTypes:array(integer)},
    idolCards: {idolCardId: text, levelLimitRank: integer, potentialRank: integer, idolCardSkinId: text,primaStellaUpgradedTime:integer},
    items: {itemId: text, expiryTime: integer, quantity: integer},
    idolCardSkins: {idolCardSkinId: text},
  };
  for (const [key, schema] of Object.entries(auxiliary)) {
    if (result[key]) result[key] = result[key].map(x => fields(x, schema, Object.keys(schema)));
  }
  return result;
}
const multiset = xs => xs.map(x => JSON.stringify(x)).sort();
const normalizedCard = c => c === null ? null : [c.id, c.upgradeCount,
  multiset(c.customizes.map(x => [x.id, x.customizeCount]))];
export function configKey(m) {
  const required = ['characterId', 'idolCardId', 'planType', 'produceCard', 'abilities',
    'examBattleProduceCards', 'examBattleProduceItemIds', 'unitCharacters'];
  if (required.some(k => m[k] === undefined)) return null;
  return JSON.stringify([m.characterId, m.idolCardId, m.planType, normalizedCard(m.produceCard),
    multiset(m.abilities.map(a => [a.id, a.level])),
    multiset(m.examBattleProduceCards.map(normalizedCard)), multiset(m.examBattleProduceItemIds),
    multiset(m.unitCharacters.map(u => [u.characterId, u.liveCostumeId ?? null, u.liveCostumeHeadId ?? null]))]);
}
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function prepareSnapshot(input) {
  const snapshot = parseSnapshot(input);
  const memories = await Promise.all(snapshot.memories.map(async (m, index) => {
    const key = await digest(m.userMemoryId);
    const {userMemoryId, ...safe} = m;
    return {...safe, key, ordinal: index + 1, config: configKey(m)};
  }));
  const fingerprint = await digest(memories.map(m => m.key).sort().join('|'));
  return {...snapshot, memories, fingerprint};
}
export const shown = value => value === undefined ? t('未记录') : String(value);
export const title = m => t('回忆 {0}',[String(m.ordinal).padStart(3, '0')]);
const shotDateFormats=new Map();
export function shotDate(m) {
  if (m.shotTime === undefined || m.shotTime === 0) return t('日期未记录');
  const date = new Date(m.shotTime);
  if(!Number.isFinite(date.getTime()))return t('日期未记录');
  const language=locale();
  if(!shotDateFormats.has(language))shotDateFormats.set(language,new Intl.DateTimeFormat(language,{year:'numeric',month:'2-digit',day:'2-digit'}));
  return shotDateFormats.get(language).format(date);
}

// 目录展示记录独立于快照；未采集不能推断为未拥有，库存数量零也仍是持有记录。
export function mergeCollection(owned,definitions,field,mode='owned') {
  const key={idolCards:'idolCardId',supportCards:'supportCardId',idolCardSkins:'idolCardSkinId'}[field];
  const entries=(owned??[]).map(row=>({...row,ownership:'owned'}));
  const ids=new Set(entries.map(row=>row[key]));
  for(const definition of definitions){
    if(!definition||ids.has(definition.id))continue;
    ids.add(definition.id);
    entries.push({[key]:definition.id,ownership:owned===undefined?'unknown':'unowned',
      ...(field==='idolCards'?{levelLimitRank:0,potentialRank:0}:field==='supportCards'?{level:1,levelLimitRank:0}:{})});
  }
  return mode==='all'?entries:entries.filter(row=>row.ownership===mode);
}

// 用户确认的活动培养回忆具有来源标识且不含比赛配置；空数组本身不证明用途。
export function memoryUse(memory) {
  const cards=memory.examBattleProduceCards,items=memory.examBattleProduceItemIds;
  if(!Array.isArray(cards)||!Array.isArray(items))return 'unknown';
  if(memory.researchId)return cards.length===0&&items.length===0?'training':'unknown';
  return cards.length>0?'battle':'unknown';
}

// 当前单选和多选控件共用集合匹配；同组取并集，空选择不限制结果。
export function selectedValues(value) {
  return [...new Set((Array.isArray(value)?value:value?[value]:[]).filter(item=>typeof item==='string'&&item))];
}
export function matchesAny(selected,available) {
  const values=selectedValues(selected);return !values.length||values.some(value=>available.includes(value));
}

// 类型与作用属性在同一个效果枚举内联接，不借用支援卡属性或其它技能的属性。
export function matchesSupportEffect(kind,types,attributes) {
  const selectedTypes=selectedValues(types),selectedAttributes=selectedValues(attributes);
  let family=kind,targets=[];
  let match=kind.match(/^(Vocal|Dance|Visual)(Addition|GrowthRateAddition)$/);
  if(match){family=match[2]==='Addition'?'AttributeAddition':'GrowthRate';targets=[match[1]];}
  match=kind.match(/^Lesson(Vocal|Dance|Visual)SpChangeRatePermilAddition$/);
  if(match){family='SpChangeRate';targets=[match[1]];}
  if(kind==='LessonSpChangeRatePermilAddition'){family='SpChangeRate';targets=['Vocal','Dance','Visual'];}
  const typeMatch=!selectedTypes.length||selectedTypes.some(type=>family===type||kind.includes(type));
  return typeMatch&&(!selectedAttributes.length||selectedAttributes.some(attribute=>targets.includes(attribute)));
}
