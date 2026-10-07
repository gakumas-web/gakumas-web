import {uiIconURL} from '../resources.mjs';
import {el} from './dom.mjs';
import {illustration} from './illustrations.mjs';
import {t} from '../i18n.mjs';
import {endingRewardStats} from '../domain/ending-bonuses.mjs';
import {idolStats} from './progression-view.mjs';
import {supportHint} from './card-rewards.mjs';
const chapters={1:'初',2:'N.I.A',3:'H.I.F'};
function explanation(calculation,growth,remaining=false){
  const body=el('div','','ending-reward-breakdown');
  for(const row of remaining?calculation.remainingContributions:calculation.contributions){
    const line=el('p');line.dataset.endingType=row.type;line.append(el('span',chapters[row.type]),el('strong',`+${row.value}${growth?'%':''}`));body.append(line);
  }
  return body;
}
export function endingBadges(entry,{interactive=false}={}){
  const box=el('div','','character-ending-badges');
  for(const row of entry?.rows??[]){
    const achieved=row.recorded===true,state=t(row.recorded===undefined?'未导入该角色记录，以下为奖励参考。':achieved?'已达成':'未达成');
    const label=`【${chapters[row.type]}】${row.achievementName??chapters[row.type]} · ${state}`;
    const badge=illustration(row.image,label,'ending-icon',{characterId:entry.characterId});
    badge.dataset.endingType=row.type;badge.dataset.achieved=row.recorded===undefined?'unknown':String(achieved);
    badge.dataset.recorded=row.recorded===undefined?'unknown':achieved?'recorded':'not-recorded';
    badge.setAttribute('role','img');badge.setAttribute('aria-label',label);
    if(interactive){
      badge.setAttribute('aria-hidden','true');const button=el('button','','ending-state-trigger');button.setAttribute('aria-label',label);button.append(badge);
      box.append(supportHint(button,()=>el('p',label),{followPointer:false}));
    }else box.append(badge);
  }
  return box;
}
export function endingRewardCard(entry){
  const card=el('article','','ending-reward-card'),head=el('header');card.dataset.characterId=entry.characterId;
  const title=el('h2',t('Ending 奖励'));const mark=el('span','✦','ending-heading-mark');mark.setAttribute('aria-hidden','true');const identity=el('div','','ending-heading-identity');identity.append(mark,title,endingBadges(entry,{interactive:true}));head.append(identity);card.append(head);
  const unknown=entry.rows.some(row=>row.recorded===undefined);
  if(unknown)card.append(el('p',t('未导入该角色记录，以下为奖励参考。'),'muted'));
  const model=endingRewardStats(entry),stats=idolStats(model,{explain:explanation,remainingLabel:t(unknown?'奖励参考':'未达成')});
  for(const [index,key] of ['Vocal','Dance','Visual'].entries()){
    const meter=stats.querySelectorAll('.idol-stat-meter')[index],gauge=stats.querySelectorAll('.idol-growth-gauge')[index];
    meter.dataset.earned=model.calculations['初始 '+key].value;meter.dataset.pending=model.calculations['初始 '+key].remaining;
    gauge.dataset.earned=model.calculations[key+' 成长率'].value;gauge.dataset.pending=model.calculations[key+' 成长率'].remaining;
  }
  const stamina=model.calculations['体力'],summary=stats.querySelector('.idol-stat-summary');summary.replaceChildren(el('small',t('体力')));
  for(const [remaining,amount] of [[false,stamina.value],[true,stamina.remaining]]){
    const button=el('button',`+${amount}`,remaining?'ending-stamina-pending':'ending-stamina-earned');button.setAttribute('aria-label',`${t('体力')} · ${t(unknown?'奖励参考':remaining?'未达成':'已达成')} +${amount}`);
    if(amount>0)summary.append(supportHint(button,()=>explanation(stamina,false,remaining),{followPointer:true}));else if(!remaining)summary.append(el('strong','+0'));
  }
  const meters=[...stats.querySelectorAll('.idol-stat-meter')],gauges=[...stats.querySelectorAll('.idol-growth-gauge')],panels=[];
  for(const [index,label] of ['Vo','Da','Vi'].entries()){
    const panel=el('section','','ending-attribute-card'),heading=el('div','','ending-attribute-heading');panel.dataset.attribute=label;
    const icon=el('img');icon.src=uiIconURL(`${['vocal','dance','visual'][index]}.webp`);icon.alt='';heading.append(icon,el('strong',label));
    meters[index].querySelector(':scope>span:not(.idol-stat-track)')?.remove();gauges[index].querySelector('.gauge-label-zone')?.remove();gauges[index].append(el('small',t('成长率'),'ending-growth-label'));
    panel.append(heading,meters[index],gauges[index]);panels.push(panel);
  }
  summary.classList.add('ending-stamina-summary');head.append(summary);stats.replaceChildren(...panels);stats.classList.add('ending-attributes');card.append(stats);return card;
}
