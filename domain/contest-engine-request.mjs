import {contestStagePreset} from './contest-stage-preset.mjs';
import {contestMemoryCards,contestMemoryTotals,contestSupportBonus} from './contest-simulation.mjs';
import {contestSimulationReference,contestCardNoDeckDuplication} from './catalog.mjs';

// 投影到模拟所需的最小输入，移除回忆键、账号 ID 和无关持有记录。
export function createContestSimulationRequest(memories,stage,supportCards,manual={},conversionRules={}){
  const totals=contestMemoryTotals(memories,stage,manual),main=memories[0],bonus=contestSupportBonus(supportCards);
  const defaultCards=stage.decks.filter(deck=>deck.planType===({2:'ProducePlanType_Plan1',3:'ProducePlanType_Plan2',4:'ProducePlanType_Plan3'})[main?.planType]).flatMap(deck=>deck.produceCards);
  return {
    plan:({2:'sense',3:'logic',4:'anomaly'})[main?.planType],params:Object.fromEntries(['vocal','dance','visual','stamina'].map(key=>[key,totals[key]])),supportBonus:bonus===null?null:bonus/100,
    manualMultipliers:stage.manualMultipliers?Object.fromEntries(['vocal','dance','visual'].map(key=>[key,manual[key]])):null,
    stage:{preset:contestStagePreset(stage.preset),kind:stage.kind,turn:stage.turn,setting:stage.setting??null,custom:Boolean(stage.custom)},
    cards:contestMemoryCards(memories,contestCardNoDeckDuplication,conversionRules).filter(entry=>entry.retained).map(entry=>contestSimulationReference('card',entry.card)),
    items:(main?.examBattleProduceItemIds??[]).map(id=>contestSimulationReference('item',id)),
    defaultCards:defaultCards.filter(card=>!conversionRules.excludedCardIds?.includes(card.id)).map(card=>contestSimulationReference('card',card)),
  };
}
