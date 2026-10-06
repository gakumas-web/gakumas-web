// 合成的当前采集格式；业务测试只覆盖自己关心的字段，缺字段拒绝测试在生成后删除字段。
export const captureHeader=()=>({format:'gakumas-capture',schema_version:1,publicUserId:'synthetic-fixture-account',captured_at:'2026-10-04T00:00:00Z'});
export const memoryRecord=(values={})=>({userMemoryId:'synthetic-memory',characterId:'hski',idolCardId:'synthetic-idol',memoryTagId:'',researchId:'',shotTime:0,produceCardPhaseType:0,isProtected:false,grade:0,power:0,planType:2,vocal:0,dance:0,visual:0,stamina:0,produceCard:null,abilities:[],examBattleProduceCards:[],examBattleProduceItemIds:[],unitCharacters:[],...values});
export function inventory(values={}){
  const memories=(values.memories??[]).map(memoryRecord);
  return {...captureHeader(),source:'user_get',count:memories.length,idolCards:[],items:[],idolCardSkins:[],supportCards:[],achievements:[],characters:[],...values,memories};
}
