const types=['vocal','dance','visual'];
const emptyTypes=()=>({vocal:0,dance:0,visual:0});
const addTypes=(target,source,factor=1)=>{for(const type of types)target[type]+=(source[type]??0)*factor;};
const customizationKey=value=>value?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):null;
const cardKey=(id,customizations)=>JSON.stringify([id,customizationKey(customizations)]);
const newTurn=()=>({usage:new Map(),entities:new Map(),turnTypeCounts:emptyTypes(),totalScoreByType:emptyTypes(),totalScore:0,skips:0});

// 使用与得分归属沿用参考实现的统计口径，输入仅为引擎日志，不读取账号资料。
export function createContestStatistics(scoreField){
  const turns=[];let runs=0;
  const ensure=index=>turns[index]??(turns[index]=newTurn());
  function accumulate(logs){
    runs++;let index=-1,type=null,appearances=new Map();const stack=[];
    for(const {logType,data} of logs){
      if(logType==='startTurn'){index++;type=data.type;ensure(index).turnTypeCounts[type]++;appearances=new Map();continue;}
      if(logType==='entityStart'){stack.push({entity:data,score:0,active:false,index,type});continue;}
      if(logType==='entityEnd'){
        const group=stack.pop();if(!group)continue;const parent=stack.at(-1);if(parent&&group.active)parent.active=true;
        if(group.entity.type==='stage'){if(parent)parent.score+=group.score;continue;}
        if(group.index<0)continue;
        const kind=group.entity.type==='skillCardEffect'?'skillCard':group.entity.type,uses=kind==='pItem'&&group.entity.primary&&group.active?1:0;
        if(!uses&&!group.score)continue;
        const turn=ensure(group.index),key=`${kind}:${group.entity.id}`;
        if(!turn.entities.has(key))turn.entities.set(key,{type:kind,id:group.entity.id,uses:0,score:0,scoreByType:emptyTypes()});
        const entry=turn.entities.get(key);entry.uses+=uses;entry.score+=group.score;if(group.type)entry.scoreByType[group.type]+=group.score;continue;
      }
      if(stack.length)stack.at(-1).active=true;
      if(logType==='diff'&&data.field===scoreField){
        const delta=Number(data.next)-Number(data.prev);if(stack.length)stack.at(-1).score+=delta;
        if(index>=0){const turn=ensure(index);turn.totalScore+=delta;turn.totalScoreByType[type]+=delta;}
      }
      if(logType!=='hand'||index<0)continue;
      const turn=ensure(index),hand=data.handCards,counts=new Map();
      for(const card of hand){const key=cardKey(card.id,card.c);const value=counts.get(key)??{card,count:0};value.count++;counts.set(key,value);}
      for(const [key,{card,count}] of counts){
        if(!turn.usage.has(key))turn.usage.set(key,{id:card.id,c:customizationKey(card.c),use:0,draw:0});
        const previous=appearances.get(key)??0;if(count>previous){turn.usage.get(key).draw+=count-previous;appearances.set(key,count);}
      }
      if(data.selectedIndex===null||data.selectedIndex===undefined)turn.skips++;
      else{const card=hand[data.selectedIndex];if(card)turn.usage.get(cardKey(card.id,card.c)).use++;}
    }
  }
  function finish(describe=entry=>entry){
    function merge(turn){
      const rows=new Map();
      function row(type,id,c=null){const key=`${type}:${cardKey(id,c)}`;if(!rows.has(key))rows.set(key,{key,type,id,c,use:0,draw:0,score:0,scoreByType:emptyTypes()});return rows.get(key);}
      for(const usage of turn.usage.values()){const entry=row('skillCard',usage.id,usage.c);entry.use+=usage.use;entry.draw+=usage.draw;}
      for(const entity of turn.entities.values()){
        if(entity.type==='pItem'){const entry=row('pItem',entity.id);entry.use+=entity.uses;entry.score+=entity.score;addTypes(entry.scoreByType,entity.scoreByType);continue;}
        if(entity.type!=='skillCard')continue;
        const variants=[...rows.values()].filter(entry=>entry.type==='skillCard'&&entry.id===entity.id),uses=variants.reduce((sum,entry)=>sum+entry.use,0);
        if(!uses){const entry=row('skillCard',entity.id);entry.score+=entity.score;addTypes(entry.scoreByType,entity.scoreByType);}
        else for(const entry of variants){const fraction=entry.use/uses;entry.score+=entity.score*fraction;addTypes(entry.scoreByType,entity.scoreByType,fraction);}
      }
      return {rows:[...rows.values()],turnTypeCounts:turn.turnTypeCounts,totalScoreByType:turn.totalScoreByType,totalScore:turn.totalScore,skips:turn.skips};
    }
    const perTurn=turns.map(merge),total={rows:[],turnTypeCounts:emptyTypes(),totalScoreByType:emptyTypes(),totalScore:0,skips:0},combined=new Map();
    for(const turn of perTurn){
      addTypes(total.turnTypeCounts,turn.turnTypeCounts);addTypes(total.totalScoreByType,turn.totalScoreByType);total.totalScore+=turn.totalScore;total.skips+=turn.skips;
      for(const entry of turn.rows){if(!combined.has(entry.key))combined.set(entry.key,{...entry,use:0,draw:0,score:0,scoreByType:emptyTypes()});const target=combined.get(entry.key);target.use+=entry.use;target.draw+=entry.draw;target.score+=entry.score;addTypes(target.scoreByType,entry.scoreByType);}
    }
    total.rows=[...combined.values()];
    for(const section of [total,...perTurn])section.rows=section.rows.map(entry=>({...entry,...describe(entry)}));
    return {runs,total,turns:perTurn};
  }
  // 在分配卡牌贡献比例之前导出原始统计，不能把各分块已经分摊的结果直接相加。
  function snapshot(){return {runs,turns:turns.map(turn=>({...turn,usage:[...turn.usage.values()],entities:[...turn.entities.values()]}))};}
  function mergeSnapshot(value){
    runs+=value.runs;
    for(const [index,source] of value.turns.entries()){
      const target=ensure(index);addTypes(target.turnTypeCounts,source.turnTypeCounts);addTypes(target.totalScoreByType,source.totalScoreByType);target.totalScore+=source.totalScore;target.skips+=source.skips;
      for(const row of source.usage){const key=cardKey(row.id,row.c);if(!target.usage.has(key))target.usage.set(key,{...row,use:0,draw:0});const entry=target.usage.get(key);entry.use+=row.use;entry.draw+=row.draw;}
      for(const row of source.entities){const key=`${row.type}:${row.id}`;if(!target.entities.has(key))target.entities.set(key,{...row,uses:0,score:0,scoreByType:emptyTypes()});const entry=target.entities.get(key);entry.uses+=row.uses;entry.score+=row.score;addTypes(entry.scoreByType,row.scoreByType);}
    }
  }
  return {accumulate,finish,snapshot,mergeSnapshot};
}
