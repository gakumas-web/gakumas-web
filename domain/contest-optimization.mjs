// 遗传搜索只处理合法候选的索引；公开目录、持有状态与引擎校验由调用方提供。
export const OPTIMIZATION_SLOTS=6;
export const optimizationCardKey=card=>JSON.stringify([card.id,card.upgradeCount,[...(card.customizes??[])].map(value=>[value.id,value.customizeCount]).sort(([a],[b])=>a.localeCompare(b))]);
export function optimizationRandom(seed){
  let state=seed>>>0;
  return ()=>{state=(state+0x6d2b79f5)>>>0;let value=state;value=Math.imul(value^(value>>>15),value|1);value^=value+Math.imul(value^(value>>>7),value|61);return ((value^(value>>>14))>>>0)/4294967296;};
}
export function optimizationCustomizations(data,limit=Infinity){
  const result=[],maximum=Math.min(data?.maximum??0,limit),options=data?.options??[];
  function visit(index,used,values){
    if(index===options.length){result.push(values);return;}
    visit(index+1,used,values);
    for(const level of options[index].levels){if(level.level>0&&used+level.level<=maximum)visit(index+1,used+level.level,[...values,{id:options[index].id,customizeCount:level.level}]);}
  }
  visit(0,0,[]);return result;
}
const pick=(values,random)=>values[Math.floor(random()*values.length)];
const customCount=reference=>(reference.customizes??[]).reduce((sum,value)=>sum+value.customizeCount,0);

// 仅用于抽样的启发式先验，不参与模拟评分；保留普通卡和低等级卡的非零概率。
export function optimizationCardWeight(variant){
  const rarity={N:1,R:1.5,SR:3,SSR:6}[variant.rarity]??1;
  const level=variant.source==='common'?Math.min(100,Math.max(0,variant.unlockProducerLevel??0)):0;
  return rarity*(1+level/100);
}
function costSuffix(groups,maximum){
  const suffix=Array.from({length:OPTIMIZATION_SLOTS+1},()=>new Set());suffix[OPTIMIZATION_SLOTS].add(0);
  for(let slot=OPTIMIZATION_SLOTS-1;slot>=0;slot--)for(const cost of groups[slot].keys())for(const sum of suffix[slot+1])if(cost+sum<=maximum)suffix[slot].add(cost+sum);
  return suffix;
}

export function createOptimizationProblem({variants,roles}){
  const slots=roles.flatMap(role=>role.allowed),allowed=slots.map(values=>new Set(values));
  const counts=variants.map(value=>customCount(value.reference)),weights=new Map();
  for(const variant of variants)weights.set(variant.reference.id,Math.max(weights.get(variant.reference.id)??0,optimizationCardWeight(variant)));
  const slotFamilies=slots.map(indices=>{
    const families=new Map();for(const index of indices){const id=variants[index].reference.id;if(!families.has(id))families.set(id,[]);families.get(id).push(index);}return [...families];
  });
  function drawVariant(position,random){
    const families=slotFamilies[position],guided=random()<.8,total=families.reduce((sum,[id])=>sum+(guided?weights.get(id):1),0);let choice=random()*total;
    for(const [id,indices] of families){choice-=guided?weights.get(id):1;if(choice<=0)return pick(indices,random);}
    return pick(families.at(-1)[1],random);
  }
  const sameCard=new Map();for(const [index,variant] of variants.entries()){
    const key=JSON.stringify([variant.reference.id,variant.reference.upgradeCount]);if(!sameCard.has(key))sameCard.set(key,[]);sameCard.get(key).push(index);
  }
  const structures=roles.map(role=>{
    const groups=role.allowed.map(values=>{
      const costs=new Map();for(const index of values){const variant=variants[index];if(!costs.has(variant.cost))costs.set(variant.cost,new Map());const families=costs.get(variant.cost);if(!families.has(variant.reference.id))families.set(variant.reference.id,[]);families.get(variant.reference.id).push(index);}return costs;
    });
    const suffix=costSuffix(groups,role.capacity.max);
    return {groups,suffix,possible:[...suffix[0]].some(sum=>sum>=role.capacity.min&&sum<=role.capacity.max)};
  });
  // 单张回忆的六槽必须是不同卡片 ID；强化、附魔与重复不可标记都不改变身份。
  function selectRole(roleIndex,input,random,focus=null,guided=false){
    const role=roles[roleIndex],used=new Set(),result=[],failed=new Set();let {groups,suffix}=structures[roleIndex];
    if(focus?.role===roleIndex){
      groups=[...groups];groups[focus.slot]=new Map([...groups[focus.slot]].filter(([,families])=>families.has(focus.id)).map(([cost,families])=>[cost,new Map([[focus.id,families.get(focus.id)]])]));
      suffix=costSuffix(groups,role.capacity.max);
    }
    function visit(slot,sum){
      if(slot===OPTIMIZATION_SLOTS)return sum>=role.capacity.min&&sum<=role.capacity.max;
      const state=JSON.stringify([slot,sum,[...used].sort()]);if(failed.has(state))return false;
      const preferred=input?.[roleIndex*OPTIMIZATION_SLOTS+slot],options=[];
      for(const [cost,families] of groups[slot]){
        if(![...suffix[slot+1]].some(rest=>sum+cost+rest>=role.capacity.min&&sum+cost+rest<=role.capacity.max))continue;
        for(const [id,indices] of families)if(!used.has(id))options.push({cost,id,indices});
      }
      // 优先保留父代；容量与唯一性冲突时回溯，避免贪心选卡误判无解。
      // 先按卡片身份加权；同一卡片的强化费用档和附魔数量不能额外放大抽样概率。
      const alternatives=new Map();for(const option of options)alternatives.set(option.id,(alternatives.get(option.id)??0)+1);
      for(const option of options)option.order=-Math.log(Math.max(Number.EPSILON,random()))*alternatives.get(option.id)/(guided?weights.get(option.id):1);
      options.sort((a,b)=>a.order-b.order);
      const preferredOption=options.findIndex(value=>value.indices.includes(preferred));
      if(preferredOption>0)options.unshift(options.splice(preferredOption,1)[0]);
      for(const {cost,id,indices} of options){
        result[slot]=indices.includes(preferred)?preferred:pick(indices,random);
        used.add(id);
        if(visit(slot+1,sum+cost))return true;
        used.delete(id);
      }
      failed.add(state);return false;
    }
    return visit(0,0)?result:null;
  }
  const possible=roles.length===2&&roles.every(role=>role.allowed.length===OPTIMIZATION_SLOTS)&&structures.every((value,index)=>value.possible&&selectRole(index,null,optimizationRandom(0))!==null);
  function canonicalize(genome){
    for(let role=0;role<2;role++){
      const first=role*OPTIMIZATION_SLOTS+(variants[genome[role*OPTIMIZATION_SLOTS+1]].source==='support'?2:1),end=(role+1)*OPTIMIZATION_SLOTS;
      genome.splice(first,end-first,...genome.slice(first,end).sort((a,b)=>optimizationCardKey(variants[a].reference).localeCompare(optimizationCardKey(variants[b].reference))));
    }
    return genome;
  }
  function repair(input,random,focus=null){
    if(!possible)return null;
    const genome=[],guided=random()<.8;
    for(const [roleIndex,role] of roles.entries()){
      const selected=selectRole(roleIndex,input,random,focus,guided);if(!selected)return null;
      genome.push(...selected);
      const start=roleIndex*OPTIMIZATION_SLOTS,end=start+OPTIMIZATION_SLOTS;
      // 来源名额彼此独立，普通卡放在第二槽也不能借用支援卡的附魔名额。
      for(const [source,limit] of Object.entries(role.customizedCardsBySource??{})){
        const positions=Array.from({length:OPTIMIZATION_SLOTS},(_,index)=>start+index).filter(position=>variants[genome[position]].source===source&&counts[genome[position]]>0);
        while(positions.length>limit){
          const offset=Math.floor(random()*positions.length),position=positions.splice(offset,1)[0],current=variants[genome[position]];
          const replacements=sameCard.get(JSON.stringify([current.reference.id,current.reference.upgradeCount])).filter(index=>allowed[position].has(index)&&counts[index]===0);
          if(!replacements.length)return null;genome[position]=pick(replacements,random);
        }
      }
      const totals=()=>({count:genome.slice(start,end).reduce((total,index)=>total+counts[index],0),cards:genome.slice(start,end).filter(index=>counts[index]>0).length});
      let total=totals();
      while(total.count>role.maxCustomizeCount||total.cards>role.maxCustomizedCards){
        // 固定槽没有可减配置时保留原引用，只从其余可调整槽回收预算。
        const choices=Array.from({length:OPTIMIZATION_SLOTS},(_,index)=>start+index).flatMap(position=>{
          const current=variants[genome[position]],before=counts[genome[position]];if(!before)return [];
          const limit=total.cards>role.maxCustomizedCards?0:Math.max(0,before-(total.count-role.maxCustomizeCount));
          const replacements=sameCard.get(JSON.stringify([current.reference.id,current.reference.upgradeCount])).filter(index=>allowed[position].has(index)&&counts[index]<=limit);
          return replacements.length?[{position,replacements}]:[];
        });
        if(!choices.length)return null;
        const {position,replacements}=pick(choices,random);
        genome[position]=pick(replacements,random);total=totals();
      }
    }
    return canonicalize(genome);
  }
  function valid(genome){
    if(!genome||genome.length!==2*OPTIMIZATION_SLOTS||genome.some((index,position)=>!allowed[position].has(index)))return false;
    return roles.every((role,roleIndex)=>{
      const indices=genome.slice(roleIndex*OPTIMIZATION_SLOTS,(roleIndex+1)*OPTIMIZATION_SLOTS),cost=indices.reduce((sum,index)=>sum+variants[index].cost,0);
      const unique=indices.map(index=>variants[index].reference.id);
      return new Set(unique).size===unique.length&&cost>=role.capacity.min&&cost<=role.capacity.max&&indices.reduce((sum,index)=>sum+counts[index],0)<=role.maxCustomizeCount&&indices.filter(index=>counts[index]>0).length<=role.maxCustomizedCards&&Object.entries(role.customizedCardsBySource??{}).every(([source,limit])=>indices.filter(index=>variants[index].source===source&&counts[index]>0).length<=limit);
    });
  }
  const diagnostics={mutations:0,unchanged:0,reverted:0,repairChanges:0,failed:0,retainedChanges:0,requestedChanges:0};
  function mutate(genome,random){
    if(!genome)return null;
    const result=[...genome],positions=result.flatMap((_,position)=>slots[position].length>1?[position]:[]),changes=random()<.2?2:1;
    // 多数子代只改一个槽位，保留已经形成的技能配合；少量双槽变化继续跳出局部最优。
    for(let changed=0;changed<changes&&positions.length;changed++){
      const offset=Math.floor(random()*positions.length),position=positions.splice(offset,1)[0],current=variants[result[position]],near=slots[position].filter(index=>index!==result[position]&&variants[index].reference.id===current.reference.id);
      result[position]=near.length&&random()<.5?pick(near,random):drawVariant(position,random);
    }
    const repaired=repair(result,random);diagnostics.mutations++;
    if(!repaired){diagnostics.failed++;return null;}
    const changed=canonicalize([...result]).join(',')!==genome.join(',');
    if(repaired.join(',')===genome.join(',')){diagnostics.unchanged++;if(changed)diagnostics.reverted++;}
    for(let role=0;role<2;role++){const before=new Set(genome.slice(role*6,role*6+6)),after=new Set(repaired.slice(role*6,role*6+6)),intended=new Set(result.slice(role*6,role*6+6));for(const value of after)if(!intended.has(value))diagnostics.repairChanges++;for(const value of new Set(result.slice(role*6,role*6+6)))if(!before.has(value)){diagnostics.requestedChanges++;if(after.has(value))diagnostics.retainedChanges++;}}
    return repaired;
  }
  function crossover(a,b,random){
    // 主副各自继承完整技能组，避免按排序后的槽位逐张混合而拆散配合。
    const cross=random()<.5?[...a.slice(0,OPTIMIZATION_SLOTS),...b.slice(OPTIMIZATION_SLOTS)]:[...b.slice(0,OPTIMIZATION_SLOTS),...a.slice(OPTIMIZATION_SLOTS)];
    return repair(cross,random);
  }
  function neighbors(genome,random,limit,excluded=new Set()){
    const choices=new Map(),original=genome.join(',');
    const add=(candidate,near,weight)=>{
      if(!valid(candidate))return;
      const result=canonicalize(candidate),key=result.join(',');if(key===original||excluded.has(key)||choices.has(key))return;
      choices.set(key,{genome:result,near,order:-Math.log(Math.max(Number.EPSILON,random()))/weight});
    };
    for(let position=0;position<genome.length;position++){
      if(slots[position].length<=1)continue;
      const current=variants[genome[position]],start=Math.floor(position/OPTIMIZATION_SLOTS)*OPTIMIZATION_SLOTS;
      for(const index of slots[position]){
        if(index===genome[position])continue;
        const variant=variants[index],near=variant.reference.id===current.reference.id,weight=near?1:weights.get(variant.reference.id);
        const candidate=[...genome];candidate[position]=index;
        if(valid(candidate)){add(candidate,near,weight);continue;}
        // 附魔名额已满时同时回收另一张卡的附魔，允许搜索把名额移给更合适的技能。
        if(!counts[index])continue;
        for(let other=start;other<start+OPTIMIZATION_SLOTS;other++){
          if(other===position||!counts[genome[other]])continue;
          const previous=variants[genome[other]],plain=sameCard.get(JSON.stringify([previous.reference.id,previous.reference.upgradeCount])).find(value=>counts[value]===0&&allowed[other].has(value));
          if(plain===undefined)continue;
          const moved=[...candidate];moved[other]=plain;add(moved,near,weight);
        }
      }
    }
    // 一半名额优先细调同卡强化和附魔，其余按先验抽样，兼顾单卡替换。
    const ordered=[...choices.values()].sort((a,b)=>a.order-b.order),selected=ordered.filter(value=>value.near).slice(0,Math.floor(limit/2)),seen=new Set(selected);
    for(const value of ordered){if(selected.length>=limit)break;if(!seen.has(value)){selected.push(value);seen.add(value);}}
    return selected.map(value=>value.genome);
  }
  function materialize(genome){
    if(!valid(genome))throw new Error('invalid_optimization_genome');
    return roles.map((role,roleIndex)=>({...structuredClone(role.template),examBattleProduceCards:genome.slice(roleIndex*OPTIMIZATION_SLOTS,(roleIndex+1)*OPTIMIZATION_SLOTS).map(index=>structuredClone(variants[index].reference))}));
  }
  // 初始种群预留四分之一自由探索，其余名额尽量覆盖主副各自尚未尝试的 SSR。
  function* coverage(random){
    const targets=roles.flatMap((role,roleIndex)=>{
      const cards=new Map();for(const slot of [1,2])for(const index of role.allowed[slot]){
        const variant=variants[index];if(variant.rarity!=='SSR')continue;
        cards.set(variant.reference.id,{id:variant.reference.id,role:roleIndex,slot:variant.source==='support'?1:2,priority:weights.get(variant.reference.id),tie:random()});
      }
      return [...cards.values()];
    }).sort((a,b)=>b.priority-a.priority||a.tie-b.tie),seen=[new Set(),new Set()];
    for(const target of targets){
      if(seen[target.role].has(target.id))continue;
      const genome=repair(null,random,target);if(!valid(genome))continue;
      for(let role=0;role<2;role++)for(const index of genome.slice(role*OPTIMIZATION_SLOTS,(role+1)*OPTIMIZATION_SLOTS))seen[role].add(variants[index].reference.id);
      yield genome;
    }
  }
  return {diagnostics,possible,variants,roles,repair,valid,mutate,crossover,neighbors,materialize,coverage,key:genome=>genome.join(','),random:random=>repair(null,random)};
}

// 保留精英、三选一锦标赛、整份回忆交叉与局部变异；随机移民继续探索新组合。
export function optimizationPopulation(problem,{size,random,ranked=[]}){
  if(!problem.possible)return [];
  const population=[],seen=new Set();
  const add=genome=>{if(!genome||!problem.valid(genome))return;const key=problem.key(genome);if(!seen.has(key)){seen.add(key);population.push(genome);}};
  for(const row of ranked.slice(0,Math.max(1,Math.floor(size/8))))add([...row.genome]);
  if(!ranked.length){
    for(const genome of problem.coverage(random)){add(genome);if(population.length>=Math.floor(size*.75))break;}
  }
  const parent=()=>{const candidates=Array.from({length:3},()=>Math.floor(random()*ranked.length));return ranked[Math.min(...candidates)].genome;};
  for(let attempt=0;population.length<size&&attempt<size*50;attempt++){
    if(!ranked.length||random()<.15){add(problem.random(random));continue;}
    if(random()<.7)add(problem.mutate(parent(),random));
    else{const cross=problem.crossover(parent(),parent(),random);add(random()<.5?problem.mutate(cross,random):cross);}
  }
  return population;
}
