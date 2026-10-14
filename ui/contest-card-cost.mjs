import {el} from './dom.mjs';
import {t} from '../i18n.mjs';
import {contestSimulationReference} from '../domain/catalog.mjs';
import {contestDeckCost,contestCostRanges,contestCostAliases,contestCardCost,contestCapacityStatus} from '../domain/contest-card-cost.mjs';
import {selectionGrades} from '../domain/selection-memories.mjs';
import {contestCustomizationRules,contestItemRules} from '../domain/community-rules.mjs';
import {contestCustomizationLimits} from '../domain/contest-customization-rules.mjs';

export function contestMemoryCost(memory,role){
  const cost=contestDeckCost((memory.examBattleProduceCards??[]).map(reference=>contestSimulationReference('card',reference))),status=contestCapacityStatus(cost.total,selectionGrades[memory.grade]),label=el('span','','contest-memory-capacity'),total=el('span',String(cost.total??t('未知')),'contest-memory-capacity-total');
  total.classList.toggle('is-overflow',status.overflow);total.classList.toggle('is-underflow',status.underflow);label.append(document.createTextNode(`${t(role)}（${selectionGrades[memory.grade]??t('未知')}, ${t('容量')}`),total,document.createTextNode('）'));
  if(status.range)label.title=`${selectionGrades[memory.grade]} · ${t('卡组容量区间')} ${status.range.min}–${status.range.max}`;
  return label;
}
export function annotateContestCardCost(hint,reference){
  const cost=contestCardCost(contestSimulationReference('card',reference).record),label=el('span',String(cost??t('未知')),'season-card-capacity');
  label.setAttribute('aria-label',t('卡组容量：{0}',[cost??t('未知')]));hint.before(label);return label;
}
export function contestCapacityRanges(){
  const details=el('details','','contest-capacity-ranges'),table=el('table'),head=el('thead'),row=el('tr');details.append(el('summary',t('卡组容量区间')));
  if(!contestCostRanges().length){details.append(el('p',t('当前资料未提供卡组容量规则。'),'small muted'));return details;}
  for(const label of ['评价','最低值','最高值'])row.append(el('th',t(label)));head.append(row);table.append(head);const body=el('tbody');
  const ranges=[...contestCostRanges(),...contestCostAliases().map(rank=>({...contestCapacityStatus(0,rank).range,rank}))].sort((a,b)=>selectionGrades.indexOf(a.rank)-selectionGrades.indexOf(b.rank)||a.min-b.min||a.max-b.max);
  for(const range of ranges){const row=el('tr');for(const value of [range.rank,range.min,range.max])row.append(el('td',String(value)));body.append(row);}table.append(body);details.append(table,el('p',t('容量区间用于编组参考，不是战斗中的手牌或卡组张数上限。'),'small muted'));return details;
}

export function contestCustomizationTable(){
  const section=el('section','','optimization-capacity-customizations'),table=el('table','','contest-customization-table'),head=el('thead'),heading=el('tr'),body=el('tbody');
  const ranks=selectionGrades.filter(rank=>contestCustomizationRules?.ranks?.[rank]);
  if(!ranks.length){section.append(el('p',t('当前资料没有所选评级的附魔规则。'),'small muted'));return section;}
  for(const name of ['回忆评级','专属技能卡','支援技能卡','通用技能卡'])heading.append(el('th',t(name)));head.append(heading);table.append(head,body);
  const sources=['idol','support','common'],groups=[];
  for(const rank of ranks){
    const rule=contestCustomizationLimits(rank,{exclusiveUnlocked:true});
    const minimum={idol:rule.guaranteedCounts.idol>0?rule.cards.idol:0,support:rule.guaranteedCounts.support>0?rule.cards.support:0,common:Number(rule.guaranteedCounts.commonFirst>0)+Number(rule.guaranteedCounts.commonSecond>0)};
    const key=JSON.stringify(sources.map(source=>[minimum[source],rule.cards[source]])),last=groups.at(-1);
    if(last?.key===key){last.end=rank;last.provisional||=rule.provisional;}
    else groups.push({start:rank,end:rank,key,rule,minimum,provisional:rule.provisional});
  }
  for(const group of groups){
    const {rule,minimum,start,end,provisional}=group,row=el('tr');row.dataset.rank=rule.maxCustomizedCards?start:end;
    const label=!rule.maxCustomizedCards?t('{0} 及以下',[end]):provisional?t('{0}～{1} 及以上（暂定）',[start,end]):start===end?start:`${start}～${end}`;
    row.append(el('td',label));
    for(const source of sources){
      const maximum=rule.cards[source],lower=minimum[source],cell=el('td',!maximum?'—':lower===maximum?t('{0} 张',[maximum]):t('{0}～{1} 张',[lower,maximum]));
      row.append(cell);
    }
    body.append(row);
  }
  section.append(table);return section;
}

export function contestItemLimitTable(){
  const section=el('section','','optimization-capacity-items'),table=el('table','','contest-item-limit-table'),head=el('thead'),heading=el('tr'),body=el('tbody');
  for(const name of ['回忆评级','额外 P 道具（不含角色专属）'])heading.append(el('th',t(name)));head.append(heading);table.append(head,body);
  const groups=[];
  for(const rank of selectionGrades){const limit=contestItemRules?.ranks?.[rank];if(limit===undefined)continue;const last=groups.at(-1);if(last?.limit===limit)last.end=rank;else groups.push({start:rank,end:rank,limit});}
  if(!groups.length){section.append(el('p',t('当前资料缺少 P 道具携带规则，请应用资料更新。'),'small muted'));return section;}
  for(const [index,group] of groups.entries()){
    const row=el('tr'),label=index===0?t('{0} 及以下',[group.end]):index===groups.length-1?t('{0} 及以上',[group.start]):`${group.start}～${group.end}`;
    row.append(el('td',label),el('td',t('{0} 种',[group.limit])));body.append(row);
  }
  section.append(table);return section;
}

export function contestRatingRules(){
  const details=contestCapacityRanges();details.querySelector('summary').textContent=t('评级与卡组容量区间、附魔次数和 P 道具个数');
  details.append(contestCustomizationTable(),contestItemLimitTable());return details;
}

export function contestRulesHelp(...sections){
  const help=el('details','','contest-rules-help optimization-help');
  help.append(el('summary',t('规则与算法说明')),...sections);return help;
}
