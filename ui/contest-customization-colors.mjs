import {contestEngineMap} from '../domain/contest-engine-map.mjs';

// 分类与现有模拟映射使用同一上游版本，未知映射保持中性颜色。
// 来源：https://github.com/gakumas-tools/gakumas-tools/blob/58c7148cb1d097b78f66faa4a9ab6d5212f083b7/packages/gakumas-data/json/customizations.json
const groups={"score":[2,1,47,48,64,65,4,99,79,3,8,84,9,11,10,98,50,51,67,12,6,5,49,66,7],"genki":[25,26,59,75,90,27,28],"buff":[21,56,72,22,103,57,73,23,80,19,55,71,20,13,52,68,14,83,24,58,74,15,53,69,16,17,54,70,18],"cost":[29,34,30,35,33,31,104,32],"effect":[38,39,37,43,92,102,91,108,110,111,96,95,94,109,40,93,107,82,62,78,45,60,76,44,61,77,81,63,106,86,46,105,85,97,87,88,101,100,41,89,42,36]};
const kinds=new Map(Object.entries(groups).flatMap(([kind,ids])=>ids.map(id=>[id,kind])));
export function customizationColorKind(option){
  const id=contestEngineMap.customizations[JSON.stringify([option.id,option.levels[0]?.level])]?.[0];
  return kinds.get(id)??'unknown';
}
