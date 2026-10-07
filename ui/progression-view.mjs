import {uiIconURL} from '../resources.mjs';
import {el} from './dom.mjs';
import {t} from '../i18n.mjs';
import {effectReading} from './effect-view.mjs';
import {supportHint} from './card-rewards.mjs';
import {customizationPanel} from './card-customizations.mjs';

function difference(row){
  if(!row?.delta)return null;
  const sign=row.delta>0?'+':'';
  return el('span',` (${sign}${row.delta}${row.unit})`,'effect-number-change '+(row.delta>0?'increase':'decrease'));
}
function growthGauge(label,row,maximum,calculation,explain,remainingLabel){
  const gauge=el('div','','idol-growth-gauge');gauge.dataset.attribute=label;gauge.dataset.maximum=String(maximum);gauge.dataset.value=String(parseFloat(row.after));
  const make=(tag,attributes)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));return node;};
  const svg=make('svg',{viewBox:'0 0 120 66'}),path='M 12 58 A 48 48 0 0 1 108 58';
  svg.append(make('path',{d:path,class:'gauge-track','aria-hidden':'true'}));
  const arc=(start,end,className)=>{
    const point=ratio=>[60-48*Math.cos(Math.PI*ratio),58-48*Math.sin(Math.PI*ratio)];
    return make('path',{d:`M ${point(start).join(' ')} A 48 48 0 0 1 ${point(end).join(' ')}`,class:className});
  };
  const current=arc(0,calculation.value/maximum,'gauge-fill');
  const remaining=arc(calculation.value/maximum,calculation.reachable/maximum,'gauge-reachable');
  if(calculation.remaining>0)svg.append(remaining);
  if(calculation.value>0)svg.append(current);
  const point=(ratio,radius)=>({x:60-radius*Math.cos(Math.PI*ratio),y:58-radius*Math.sin(Math.PI*ratio)});
  for(const ratio of [0,.25,.5,.75,1]){
    const a=point(ratio,43),b=point(ratio,ratio===.5?37:39);svg.append(make('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'gauge-tick','aria-hidden':'true'}));
  }
  const hit=make('rect',{x:0,y:0,width:120,height:66,class:'gauge-hit-area','aria-label':`${label} · ${t('成长率')} ${row.after}`});
  svg.append(hit);
  supportHint(hit,()=>{
    const body=el('div');body.append(explain(calculation,true));
    if(calculation.remaining>0)body.append(el('strong',`${remainingLabel} +${calculation.remaining}%`),explain(calculation,true,true));
    return body;
  },{container:gauge,followPointer:true});
  // 文字区域覆盖命中层，不触发仪表盘说明；数值与外部标题也不参与命中。
  const labelZone=make('g',{class:'gauge-label-zone'});
  labelZone.append(make('rect',{x:37,y:33,width:46,height:28,class:'gauge-label-blocker','aria-hidden':'true'}));
  const name=make('text',{x:60,y:47,'text-anchor':'middle','dominant-baseline':'middle',class:'gauge-label','aria-hidden':'true'});name.textContent=label;labelZone.append(name);svg.append(labelZone);
  const value=el('strong',row.after),delta=difference(row);if(delta)value.append(delta);
  gauge.setAttribute('aria-label',`${label} · ${t('成长率')} ${row.after} · 0–${maximum}%`);
  gauge.append(svg,value);return gauge;
}
function statExplanation(calculation,growth,remaining=false){
  const unit=growth?'%':'';
  const term=(value,label)=>`${value}${unit}（${label}）`;
  const components=[...(remaining?[]:[term(calculation.base,t('基础值'))]),...(remaining?calculation.remainingContributions:calculation.contributions).map(row=>term(row.value,`${t(calculation.kind==='rank'?'特训':'开花')}${row.rank}`))];
  return el('p',components.join('+'),'idol-stat-equation');
}
export function idolStats(result,{explain=statExplanation,remainingLabel=t('剩余提升')}={}){
  const stats=el('div','','idol-current-stats');stats.setAttribute('aria-label',t('初始属性'));
  const values=new Map(result.stats.map(row=>[row.label,row])),meters=el('div','','idol-stat-meters'),growth=el('div','','idol-growth-rates');
  const max=result.statMaximum;
  for(const [key,label] of [['Vocal','Vo'],['Dance','Da'],['Visual','Vi']]){
    const row=values.get('初始 '+key),calculation=result.calculations['初始 '+key],meter=el('div','','idol-stat-meter');meter.dataset.attribute=label;meter.dataset.maximum=String(max);meter.setAttribute('aria-label',`${label} · ${t('初始属性')} ${row.after}`);
    const track=el('span','','idol-stat-track'),reachable=el('button','','idol-stat-reachable'),fill=el('button','','idol-stat-fill');
    fill.style.width=`${calculation.value/max*100}%`;reachable.style.left=fill.style.width;reachable.style.width=`${calculation.remaining/max*100}%`;
    fill.setAttribute('aria-label',`${label} · ${row.after}`);reachable.setAttribute('aria-label',`${label} · ${remainingLabel}`);
    if(calculation.value>0){track.append(fill);supportHint(fill,()=>explain(calculation,false),{container:meter,followPointer:true});}
    if(calculation.remaining>0){track.append(reachable);supportHint(reachable,()=>explain(calculation,false,true),{container:meter,followPointer:true});}
    const number=el('strong',row.after),delta=difference(row);if(delta)number.append(delta);meter.append(el('span',label),track,number);meters.append(meter);
    const growthCalculation=result.calculations[key+' 成长率'];
    growth.append(growthGauge(label,values.get(key+' 成长率'),result.growthMaximum,growthCalculation,explain,remainingLabel));
  }
  const summary=el('div','','idol-stat-summary');
  for(const key of ['合计','体力']){
    const row=values.get(key),block=el('div','',key==='体力'?'idol-stamina':''),number=el('strong',row.after),delta=difference(row);if(delta)number.append(delta);block.append(el('small',t(key)),number);summary.append(block);
  }
  growth.prepend(el('span',t('属性成长率'),'idol-growth-heading'));
  growth.setAttribute('aria-label',t('属性成长率'));stats.append(meters,summary,growth);return stats;
}
// 自绘的服装／附魔语义图标，不作为游戏原始素材标注。
function unlockIcon(kind){
  const frame=el('span','','idol-unlock-icon');frame.dataset.iconKind=kind;frame.setAttribute('aria-hidden','true');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 32 32');
  const path=(d,fill='none',width=2)=>{
    const node=document.createElementNS(svg.namespaceURI,'path');node.setAttribute('d',d);node.setAttribute('fill',fill);node.setAttribute('stroke','currentColor');node.setAttribute('stroke-width',String(width));node.setAttribute('stroke-linecap','round');node.setAttribute('stroke-linejoin','round');svg.append(node);
  };
  if(kind==='costume')path('M11 7 4 11 7 17 10 15V27H22V15L25 17 28 11 21 7C21 12 11 12 11 7Z');
  else{
    path('M18 27H7Q5 27 5 25V7Q5 5 7 5H20Q22 5 22 7V14');
    path('M13 11 14.5 14.5 18 16 14.5 17.5 13 21 11.5 17.5 8 16 11.5 14.5Z','currentColor',.5);
    path('M19 27 28 18M24 22 23 21', 'none',2.5);
    path('M27 6 28 9 31 10 28 11 27 14 26 11 23 10 26 9Z','currentColor',.5);
  }
  frame.append(svg);return frame;
}
// 三类效果入口共用状态行与正文容器，避免各自设置间距。
function idolEffectHint(button,status,content,{customization=false}={}){
  const body=el('div','','idol-effect-description');
  body.classList.toggle('idol-customization-detail',customization);
  body.append(el('p',status,'small muted idol-effect-status'),content);
  return supportHint(button,body);
}
export function idolSkills(result){
  const list=el('ul','','idol-skill-list');
  for(const skill of result.skills){
    const item=el('li','','idol-passive');item.dataset.skillId=skill.id;
    item.classList.toggle('support-skill-locked',skill.locked);item.classList.toggle('support-skill-gained',skill.gained);item.classList.toggle('support-skill-lost',skill.lost);
    const label=t(skill.kind==='rank'?'特训 {0} 解锁':'开花 {0} 解锁',[skill.unlockRank]);
    const state=skill.locked?t(skill.lost?'预览未解锁':'未解锁'):skill.gained?t('预览解锁'):skill.changed?t('效果变化'):'';
    const reading=effectReading(skill.text,{descriptionParts:skill.descriptionParts,effectIds:skill.effectIds,cardReferences:skill.cardReferences,numberChanges:skill.numberChanges});
    const button=el('button','','idol-effect-trigger');button.setAttribute('aria-label',[state,label,skill.text].filter(Boolean).join(' · '));
    const icon=reading.querySelector('.effect-inline-icon');
    if(icon)button.append(icon.cloneNode(true));
    else{const fallback=el('img');fallback.src=uiIconURL(`idol-${skill.kind==='rank'?'training':'potential'}.webp`);fallback.alt='';button.append(fallback);}
    if(skill.iconValue)button.append(el('span',skill.iconValue,'idol-effect-value'));
    const marker=skill.gained?'＋':skill.lost?'−':skill.changed?'↔':skill.locked?'🔒':'';
    if(marker)button.append(el('span',marker,'idol-effect-state'));
    item.append(idolEffectHint(button,[state,label].filter(Boolean).join(' · '),reading));list.append(item);
  }
  if(result.costume){
    const unlock=result.costume,item=el('li','','idol-costume-status');
    item.classList.toggle('support-skill-locked',!unlock.unlocked);item.classList.toggle('support-skill-gained',unlock.unlocked&&!unlock.actualUnlocked);
    const label=t('开花 {0} 解锁',[unlock.rank]);
    const state=!unlock.unlocked?t(unlock.actualUnlocked?'预览未解锁':'未解锁'):!unlock.actualUnlocked?t('预览解锁'):'';
    const status=[state,label].filter(Boolean).join(' · ');
    const text=`${t('解锁额外的异色装扮')} · ${status}`;
    const button=el('button','','idol-effect-trigger');button.append(unlockIcon('costume'));if(!unlock.unlocked)button.append(el('span','🔒','idol-effect-state'));button.setAttribute('aria-label',text);
    const reading=effectReading(t('解锁额外的异色装扮'),{interfaceText:true}),icon=unlockIcon('costume');icon.classList.add('effect-inline-icon');reading.prepend(icon);
    item.append(idolEffectHint(button,status,reading));list.append(item);
  }
  if(result.customization){
    const unlock=result.customization,item=el('li','','idol-customization-status');
    item.classList.toggle('support-skill-locked',!unlock.unlocked);item.classList.toggle('support-skill-gained',unlock.unlocked&&!unlock.actualUnlocked);
    const label=t('特训 {0} 解锁',[unlock.rank]);
    const state=!unlock.unlocked?t(unlock.actualUnlocked?'预览未解锁':'未解锁'):!unlock.actualUnlocked?t('预览解锁'):'';
    const text=[state,label].filter(Boolean).join(' · ');
    const button=el('button','','idol-effect-trigger');button.append(unlockIcon('customization'));if(!unlock.unlocked)button.append(el('span','🔒','idol-effect-state'));button.setAttribute('aria-label',`${t('专属技能卡附魔')} · ${text}`);
    item.append(idolEffectHint(button,text,customizationPanel(unlock,{expanded:true}),{customization:true}));list.append(item);
  }
  return list;
}
