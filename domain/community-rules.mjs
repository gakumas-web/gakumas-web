// 玩家推导且已核对的规则来自 progression 内容分包；缺失时保持未知。
export let hifStarRules=null;
export let contestCostRules=null;
export let contestCustomizationRules=null;
export let contestItemRules=null;
export function installCommunityRules(rules){
  hifStarRules=rules?.hifStar??null;
  contestCostRules=rules?.contestCosts??null;
  contestCustomizationRules=rules?.contestCustomizations??null;
  contestItemRules=rules?.contestItems??null;
}
