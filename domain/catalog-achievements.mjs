import {catalogState} from './catalog-state.mjs';
import {compareCharacterFilters} from './catalog-collections.mjs';
import {achievementDetailScope} from './achievements.mjs';

export const achievementCharacterIds=()=>[...catalogState.achievements.characterIds].sort(compareCharacterFilters);

export const achievementEntries=(snapshot,view)=>catalogState.achievements.entries(snapshot,view);
export function achievementViewCounts(snapshot,view){
  if(!catalogState.achievements.characterIds.includes(view.achievementCharacter))return {count:catalogState.achievements.count,total:catalogState.achievements.count};
  // 顶部汇总两个子页签，保留奖励和状态筛选，不受当前子页签或分页影响。
  const scopes=view.achievementCharacter==='nasr'?['Produce','Other'].map(achievementCategory=>({...view,achievementCategory})):['common','card'].map(achievementScope=>({...view,achievementScope}));
  const options={achievementSection:'achievement'},sum=rows=>scopes.reduce((total,scope)=>total+achievementDetailScope(rows,scope).reduce((count,row)=>count+row.stages.length,0),0);
  return {count:sum(catalogState.achievements.entries(snapshot,{...view,...options,query:'',achievementCategory:''})),total:sum(catalogState.achievements.entries(snapshot,options))};
}
