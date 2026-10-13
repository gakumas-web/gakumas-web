import {el} from './dom.mjs';
import {t,locale} from '../i18n.mjs';
import {skillThumbnailFor,itemThumbnail} from './illustrations.mjs';
import {itemRewardInfo} from '../domain/catalog.mjs';
import {simulationCardReference} from '../domain/contest-engine-display.mjs';

const attributes={vocal:'Vo',dance:'Da',visual:'Vi'};
const fields={score:'分数',stamina:'体力',genki:'元气',motivation:'干劲',concentration:'集中',goodConditionTurns:'好调',perfectConditionTurns:'绝好调',goodImpressionTurns:'好印象',enthusiasm:'热意',fullPowerCharge:'全力值'};
const actions={drawCard:'抽牌',addCardToHand:'生成至手牌',addCardToTopOfDeck:'生成至牌库顶部',addCardToDeckAtRandom:'生成至牌库',upgradeRandomCardInHand:'强化手牌',holdCard:'保留卡片',discardCard:'弃牌',moveCardToHand:'移至手牌',moveCardToTopOfDeck:'移至牌库顶部',moveCardToDeckAtRandom:'移至牌库',removeCard:'移除卡片'};
export function simulationRecords(run,{characterId}={}){
  const list=el('div','','contest-simulation-turns'),format=value=>new Intl.NumberFormat(locale(),{maximumFractionDigits:0}).format(value);let previous=0;
  function cardArt(card){
    const reference=simulationCardReference(card);if(!reference)return null;
    const art=skillThumbnailFor(reference,characterId,{compact:true,showValues:card.customizationsKnown===true});art.setAttribute('aria-hidden','true');return art;
  }
  function changeLine(change){
    const line=el('div','','simulation-event-change'),value=el('strong',`${format(change.previous)} → ${format(change.next)}`);value.classList.toggle('is-loss',change.next<change.previous);line.append(el('span',t(fields[change.field]??change.field)),value);return line;
  }
  function eventNode(event){
    if(event.type==='change')return changeLine(event);
    if(event.type==='hand'){
      const hand=el('section','','simulation-hand'),state=el('details','','simulation-hand-state'),values=el('div','','simulation-hand-state-values');state.append(el('summary',t('手牌状态')));for(const value of event.state??[])values.append(el('span',`${t(fields[value.field]??value.field)} ${format(value.value)}`));state.append(values);hand.append(state);
      const cards=el('ol','','simulation-hand-cards');
      for(const card of event.cards){const tile=el('li','','simulation-hand-card');tile.classList.toggle('is-selected',card.selected);tile.classList.toggle('is-unusable',card.estimate===null);const art=cardArt(card);if(art)tile.append(art);tile.append(el('span',card.name,'simulation-hand-name'));const estimate=el('small',card.estimate===null?t('不可使用'):t('评估值 {0}',[format(card.estimate)]));estimate.title=t('自动出牌评估值，并非本次实际得分。');tile.append(estimate);if(card.selected)tile.append(el('strong',t('已选择'),'simulation-hand-selected'));cards.append(tile);}
      hand.append(cards);return hand;
    }
    if(event.type==='entity'){
      const group=el('section','','simulation-event-entity'),title=el('div','','simulation-event-title');group.dataset.kind=event.kind;
      if(event.card){const art=cardArt(event.card);if(art)title.append(art);}
      else if(event.itemId)title.append(itemThumbnail(itemRewardInfo(event.itemId)));
      const label=event.kind==='pItem'?'P 道具':event.kind==='stage'?'舞台效果':event.kind==='skillCard'?'技能卡':'效果';title.append(el('small',t(label)));if(event.name&&(event.card||event.itemId))title.append(el('strong',event.name));group.append(title);
      if(event.events.length){const children=el('div','','simulation-event-children');for(const child of event.events)children.append(eventNode(child));group.append(children);}return group;
    }
    const line=el('div','','simulation-event-card');line.append(el('small',t(actions[event.action]??'技能卡')));const art=cardArt(event.card);if(art)line.append(art);line.append(el('span',event.card.name));return line;
  }
  for(const turn of run.turns){
    const row=el('details','','simulation-turn');row.dataset.attribute=turn.attribute;
    const heading=el('summary','','simulation-turn-heading'),identity=el('div','','simulation-turn-identity'),total=el('div','','simulation-turn-total');identity.append(el('strong',`${t('回合')} ${turn.turn}`),el('span',`${attributes[turn.attribute]} · ${format(turn.multiplier*100)}%`));total.append(el('strong',format(turn.score)),el('span',`+${format(turn.score-previous)}`));heading.append(identity,total);previous=turn.score;
    row.append(heading);
    const timeline=el('div','','simulation-turn-timeline');for(const event of turn.events)timeline.append(eventNode(event));row.append(timeline);
    list.append(row);
  }
  return list;
}
