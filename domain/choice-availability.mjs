// 所有选择窗口共用倒排索引；窗口外条件由调用方先过滤，索引只建立一次。
export function createChoiceAvailability(rows,{mode='any',clauses}={}){
  const all=new Set(rows.map((_,index)=>index)),cardsByChoice=new Map(),groupByChoice=new Map();
  for(const [index,keys] of rows.entries())for(const key of keys){
    if(!cardsByChoice.has(key))cardsByChoice.set(key,new Set());cardsByChoice.get(key).add(index);
  }
  if(mode==='grouped')for(const [group,keys] of clauses([...cardsByChoice.keys()]).entries())for(const key of keys)groupByChoice.set(key,group);
  const groupOf=key=>{
    if(mode==='any')return 'any';if(mode==='all')return key;
    if(!groupByChoice.has(key)){
      const group=clauses([...groupByChoice.keys(),key]).find(values=>values.includes(key))??[key];
      const known=group.find(value=>groupByChoice.has(value));groupByChoice.set(key,known===undefined?key:groupByChoice.get(known));
    }
    return groupByChoice.get(key);
  };
  const intersect=(left,right)=>{
    if(left.size>right.size)[left,right]=[right,left];
    return new Set([...left].filter(value=>right.has(value)));
  };
  const overlaps=(left,right)=>{
    if(left.size>right.size)[left,right]=[right,left];
    for(const value of left)if(right.has(value))return true;return false;
  };
  return draft=>{
    const groups=new Map();
    for(const key of new Set(draft)){
      const group=groupOf(key);if(!groups.has(group))groups.set(group,new Set());
      for(const index of cardsByChoice.get(key)??[])groups.get(group).add(index);
    }
    const selected=[...groups],remaining=selected.reduce((cards,[,matches])=>intersect(cards,matches),all),withoutGroup=new Map(),available=new Set();
    for(const [key,cards] of cardsByChoice){
      const group=groupOf(key);
      // OR 组不以自身当前选择约束候选；AND 的每个选项独立成组。
      if(!withoutGroup.has(group))withoutGroup.set(group,selected.filter(([id])=>id!==group).reduce((result,[,matches])=>intersect(result,matches),all));
      if(overlaps(cards,withoutGroup.get(group)))available.add(key);
    }
    return {count:remaining.size,available};
  };
}
