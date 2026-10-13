const integer=value=>Number.isSafeInteger(value)&&value>=0;
const coefficientKeys=['memoryPowerParameterCoefficientPermil','memoryPowerStaminaCoefficientPermil','memoryPowerProduceResourceEvaluationCoefficientPermil'];

// 原始表成对提供；旧内容缺表可读取，但不能计算综合值。
export function validMemoryPowerTables(tables={}){
  const settings=tables.Setting,customizations=tables.ProduceCardCustomizeRarityEvaluation;
  if(settings===undefined&&customizations===undefined)return true;
  if(!Array.isArray(settings)||settings.length!==1||settings[0]?.id!=='1'||!coefficientKeys.every(key=>integer(settings[0][key]))||!Array.isArray(customizations)||!customizations.length)return false;
  const rarities=new Set();
  for(const row of customizations){
    if(typeof row?.rarity!=='string'||!row.rarity.startsWith('ProduceCardRarity_')||rarities.has(row.rarity)||!integer(row.evaluation))return false;
    rarities.add(row.rarity);
  }
  return ['N','R','Sr','Ssr'].every(rarity=>rarities.has('ProduceCardRarity_'+rarity));
}

export function createMemoryPowerRules(tables={}){
  if(!validMemoryPowerTables(tables)||!tables.Setting)return null;
  return {setting:tables.Setting[0],customizations:new Map(tables.ProduceCardCustomizeRarityEvaluation.map(row=>[row.rarity,row.evaluation]))};
}

// 按每张回忆自己的完整考试配置计算；不应用主副回忆去重或比赛属性倍率。
export function calculateMemoryPower(memory,rules,referenceFor){
  if(!rules||!memory||!['vocal','dance','visual','stamina'].every(key=>integer(memory[key]))||!memory.examBattleProduceCards?.length||!Array.isArray(memory.examBattleProduceItemIds))return null;
  let evaluation=0;
  for(const card of memory.examBattleProduceCards){
    const definition=referenceFor('card',card)?.record?.definition;
    if(!integer(definition?.evaluation)||!Array.isArray(card.customizes))return null;
    evaluation+=definition.evaluation;
    for(const customization of card.customizes){
      const value=rules.customizations.get(definition.rarity);
      if(!integer(value)||!integer(customization.customizeCount))return null;
      evaluation+=value*customization.customizeCount;
    }
  }
  for(const id of memory.examBattleProduceItemIds){
    const value=referenceFor('item',id)?.record?.definition?.evaluation;
    if(!integer(value))return null;
    evaluation+=value;
  }
  const setting=rules.setting,numerator=(memory.vocal+memory.dance+memory.visual)*setting.memoryPowerParameterCoefficientPermil+memory.stamina*setting.memoryPowerStaminaCoefficientPermil+evaluation*setting.memoryPowerProduceResourceEvaluationCoefficientPermil;
  return integer(numerator)?Math.floor(numerator/1000):null;
}

function signature(memory){
  const cards=memory.examBattleProduceCards?.map(card=>JSON.stringify([card.id,card.upgradeCount,card.customizes?.map(value=>[value.id,value.customizeCount]).sort()])).sort();
  return JSON.stringify([memory.vocal,memory.dance,memory.visual,memory.stamina,cards,memory.examBattleProduceItemIds&&[...memory.examBattleProduceItemIds].sort()]);
}

// 原始配置未变时保留采集值；编辑副本或生成编组使用计算值，缺资料时清除过期值。
export function updateMemoryPower(memory,original,calculate){
  if(!memory)return memory;
  const result={...memory};delete result.power;delete result.powerSource;
  if(original&&integer(original.power)&&original.powerSource!=='calculated'&&signature(memory)===signature(original))return {...result,power:original.power};
  const power=calculate(memory);
  return integer(power)?{...result,power,powerSource:'calculated'}:result;
}
