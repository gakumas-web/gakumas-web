// 效果正文所需的公开索引；只保存资料，不创建节点或触发资源加载。
let catalog={icons:{},effects:new Map(),cards:[],labels:new Map()};
export function installEffectCatalog(input){
  catalog={
    icons:input.abilityIcons??{},
    effects:new Map((input.tables.ProduceEffect??[]).map(row=>[row.id,row])),
    cards:input.tables.ProduceCard??[],
    labels:new Map((input.semantics?.tables?.ProduceDescriptionLabel??[]).map(row=>[row.id,row])),
  };
}
export const effectCatalog=()=>catalog;
