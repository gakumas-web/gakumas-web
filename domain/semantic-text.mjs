export function plainText(value = '') {
  return value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

const literalTypes = new Set(['PlainText', 'DiffText', 'ProduceDescription', 'ProduceDescriptionName',
  'ProduceExamEffectType', 'ProduceCardGrowEffectType', 'ProduceCardCategory', 'ProduceCard',
  'ProduceStepBusinessType', 'ProduceDrink', 'ProduceStepType', 'ProduceCardMovePositionType']);
const examTextTypes = new Set(['CustomizeEffectValue1', 'CustomizeEffectValue2', 'CustomizeEffectValuePercent1',
  'CustomizeEffectValuePercent2', 'CustomizeTurn', 'CustomizeCostValue', 'CustomizeEffectCount']);
const baseSlots = new Set(['CustomizeInitialAdd', 'CustomizeEffectAdd', 'CustomizePlayMovePositionLost', 'CustomizeLessonCountAdd']);

export function descriptionText(parts, labels = new Map(), layout = false) {
  const fragments = [];
  const readable = [];
  let unknown = 0;
  for (const part of parts ?? []) {
    if (layout && part.targetId === 'Label_StyleDot') { fragments.push('\n'); continue; }
    const type = (part.produceDescriptionType ?? '').replace('ProduceDescriptionType_', '');
    const exam = (part.examDescriptionType ?? '').replace('ExamDescriptionType_', '');
    const known = literalTypes.has(type) || (type === 'Exam' && (examTextTypes.has(exam) || baseSlots.has(exam)));
    if (!known) { fragments.push('〔未解析说明〕'); unknown++; continue; }
    if (part.text) { fragments.push(part.text); readable.push(part.text); continue; }
    if (type === 'PlainText') continue;
    if (type === 'Exam' && baseSlots.has(exam)) {
      if (part.effectCount > 1 || part.effectValue1 || part.effectValue2 || part.turn || part.costValue) {
        fragments.push('〔未解析动态说明〕'); unknown++;
      }
      continue;
    }
    const label = labels.get(part.targetId);
    if (type === 'ProduceDescriptionName' && label) { fragments.push(label.name); readable.push(label.name); continue; }
    fragments.push('〔未解析说明〕'); unknown++;
  }
  const text = plainText(fragments.join('')).replace(/\n{3,}/g, '\n\n').trim();
  return {text, unknown, status: !plainText(readable.join('')).trim() ? 'unresolved' : unknown ? 'partial' : 'supported'};
}

// 按原始说明节点排版；图标、条件与限制来自节点字段，不从日文句子猜测。
export function descriptionLayout(parts,labels=new Map()){
  const lines=[];let tokens=[],effectId;
  let introduction=parts?.some(part=>part.targetId==='Label_StyleDot');
  const flush=()=>{if(tokens.some(token=>token.text.trim()))lines.push({
    kind:tokens.some(token=>token.restriction)?'restriction':tokens.every(token=>token.cost)?'cost':tokens.some(token=>token.trigger)&&!tokens.some(token=>token.effect)?'condition':tokens.every(token=>token.introduction&&!token.effect)?'context':'effect',effectId,tokens,
  });tokens=[];effectId=undefined;};
  for(const part of parts??[]){
    if(part.targetId==='Label_StyleDot'){flush();introduction=false;effectId=part.originProduceExamEffectId;continue;}
    const restriction=['Label_NoDeckDuplication','Label_ProduceCardMovePositionType_Lost','Label_MemoryAbilityIsUniqueActivation'].includes(part.targetId)||part.targetId?.startsWith('Label_ProduceType_');
    if(restriction&&tokens.some(token=>token.text.trim())&&!tokens.some(token=>token.restriction))flush();
    const text=part.text?plainText(part.text):descriptionText([part],labels).text;
    if(text.trim()&&!part.isCost&&tokens.some(token=>token.cost))flush();
    const pieces=text.split('\n'),firstTextLine=pieces.findIndex(piece=>piece.length>0);
    for(const [index,piece] of pieces.entries()){
      if(index)flush();
      if(piece)tokens.push({text:piece,introduction,examEffectType:index===firstTextLine?part.examEffectType:undefined,produceCardGrowEffectType:index===firstTextLine?part.produceCardGrowEffectType:undefined,
        amount:part.produceDescriptionType==='ProduceDescriptionType_DiffText'||part.produceDescriptionType==='ProduceDescriptionType_Exam'&&/^ExamDescriptionType_Customize/.test(part.examDescriptionType??''),
        cost:Boolean(part.isCost),trigger:Boolean(part.originProduceExamTriggerId),effect:Boolean(part.originProduceExamEffectId),restriction});
    }
  }
  flush();return lines;
}

// 只比较结构一致的 DiffText 数字，不把卡名、条件原文或新增技能当作数值增减。
export function descriptionNumberChanges(before=[],after=[]){
  const numbers=/[+−-]?\d+(?:\.\d+)?[%％]?/g;
  if(before.length!==after.length)return [];
  let count=0;const eligible=new Set();
  for(let index=0;index<after.length;index++){
    const old=before[index],next=after[index];
    if(old.produceDescriptionType!==next.produceDescriptionType)return [];
    const oldText=plainText(old.text??''),text=plainText(next.text??'');
    if(next.produceDescriptionType==='ProduceDescriptionType_DiffText'){
      if(oldText.replace(numbers,'#')!==text.replace(numbers,'#'))return [];
      const oldNumbers=oldText.match(numbers)??[],newNumbers=text.match(numbers)??[];
      if(oldNumbers.length!==newNumbers.length)return [];
      newNumbers.forEach((_,offset)=>eligible.add(count+offset));
    }else if(oldText!==text)return [];
    count+=(text.match(numbers)??[]).length;
  }
  const oldNumbers=descriptionText(before,undefined,true).text.match(numbers)??[];
  const newNumbers=descriptionText(after,undefined,true).text.match(numbers)??[];
  if(oldNumbers.length!==count||newNumbers.length!==count)return [];
  const changes=[];
  for(const index of eligible){
    const old=oldNumbers[index].replace('−','-'),next=newNumbers[index].replace('−','-');
    const value=Number.parseFloat(next)-Number.parseFloat(old);
    const precision=Math.max(old.match(/\.(\d+)/)?.[1].length??0,next.match(/\.(\d+)/)?.[1].length??0);
    const delta=Number(value.toFixed(Math.min(precision,12)));
    if(Number.isFinite(delta)&&delta!==0)changes.push({index,delta,unit:next.match(/[%％]$/)?.[0]??''});
  }
  return changes;
}

function canonical(value) {
  if (value === undefined) return ['missing'];
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonical).map(v=>JSON.stringify(v)).sort();
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export function configurationSignature(value) { return JSON.stringify(canonical(value)); }
