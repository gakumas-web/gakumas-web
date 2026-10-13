import {el} from './dom.mjs';
import {simulationCardReference} from '../domain/contest-engine-display.mjs';
import {t,locale} from '../i18n.mjs';
import {skillThumbnailFor,itemThumbnail} from './illustrations.mjs';
import {itemRewardInfo} from '../domain/catalog.mjs';
import {simulationSkipChart} from './contest-simulation-charts.mjs';

export function simulationStatistics(statistics,{characterId}={}){
  const details=el('details','','simulation-statistics');details.append(el('summary',t('卡片使用统计')));
  if(!statistics){details.append(el('p',t('此历史记录没有卡片统计，请重新模拟。'),'small muted'));return details;}
  const controls=el('div','','simulation-stat-controls'),label=el('label',t('统计范围')),scope=el('select'),meta=el('section','','simulation-stat-summary'),wrap=el('div','','simulation-stat-table-wrap');scope.setAttribute('aria-label',t('统计范围'));
  scope.append(new Option(t('全部回合'),'all'));statistics.turns.forEach((_,index)=>scope.append(new Option(t('第 {0} 回合',[index+1]),String(index))));label.append(scope);controls.append(label);
  const note=el('p',t('使用率按各回合手牌中同版本卡的最大出现数量计算；得分贡献包含自身及延迟效果，不代表增益卡的全部间接收益。'),'small muted');
  const overview=el('div','','simulation-stat-overview'),summary=el('div','','simulation-stat-selection');summary.append(controls,meta);overview.append(summary,simulationSkipChart(statistics));details.append(overview,wrap,note);let sort='usePct',direction=-1;
  const format=(value,digits=1)=>new Intl.NumberFormat(locale(),{maximumFractionDigits:digits}).format(value);
  function draw(){
    const data=scope.value==='all'?statistics.total:statistics.turns[Number(scope.value)],table=el('table'),head=el('thead'),heading=el('tr'),body=el('tbody');
    const value=(row,key)=>key==='name'?row.name:key==='usePct'?row.draw?row.use/row.draw:-1:row[key];
    for(const [key,text] of [['name','技能卡 / P 道具'],['use','使用次数'],['usePct','使用率'],['score','平均得分贡献']]){
      const cell=el('th'),button=el('button',t(text)+(sort===key?(direction===1?' ↑':' ↓'):''));cell.scope='col';cell.setAttribute('aria-sort',sort===key?(direction===1?'ascending':'descending'):'none');
      button.onclick=()=>{direction=sort===key?-direction:key==='name'?1:-1;sort=key;draw();};cell.append(button);heading.append(cell);
    }
    head.append(heading);table.append(head,body);
    const rows=[...data.rows].sort((a,b)=>{const left=value(a,sort),right=value(b,sort);return direction*(typeof left==='string'?left.localeCompare(right):left-right)||a.name.localeCompare(b.name);});
    for(const row of rows){
      const tr=el('tr'),identity=el('td'),content=el('div','','simulation-stat-entity'),name=el('span',row.name);tr.dataset.entityType=row.type;
      const reference=row.type==='skillCard'?simulationCardReference(row):null;
      if(reference)content.append(skillThumbnailFor(reference,characterId,{compact:true,showValues:!row.customizationCount||(reference.customizes??[]).reduce((sum,custom)=>sum+custom.customizeCount,0)===row.customizationCount}));else if(row.itemId)content.append(itemThumbnail(itemRewardInfo(row.itemId)));
      if(row.customizationCount){const badge=el('small',t('附魔次数：{0}',[row.customizationCount]));name.append(badge);}content.append(name);identity.append(content);
      const rate=el('td',row.draw?`${format(row.use/row.draw*100)}%`:'—');rate.title=t('使用 {0} 次 / 入手 {1} 次',[format(row.use,0),format(row.draw,0)]);
      tr.append(identity,el('td',format(row.use,0)),rate,el('td',format(row.score/statistics.runs)));body.append(tr);
    }
    const average=el('div','','simulation-stat-average'),allocation=el('div','','simulation-stat-allocation'),bar=el('div','','contest-criteria-bar simulation-stat-ratio'),legend=el('div','','simulation-stat-legend');
    average.append(el('small',t('平均得分')),el('strong',format(data.totalScore/statistics.runs)));bar.setAttribute('role','img');
    const types=[['vocal','Vo'],['dance','Da'],['visual','Vi']],total=types.reduce((sum,[type])=>sum+data.totalScoreByType[type],0),labels=[];
    for(const [type,name] of types){
      const value=data.totalScoreByType[type]/statistics.runs,percent=total?`${format(data.totalScoreByType[type]/total*100)}%`:'—',segment=el('span'),entry=el('div'),heading=el('span');
      segment.dataset.attribute=entry.dataset.attribute=type;segment.style.flexGrow=String(total?data.totalScoreByType[type]/total:0);segment.title=`${name} ${format(value)} · ${percent}`;bar.append(segment);
      heading.append(el('small',name));entry.append(heading,el('strong',format(value)));entry.title=t('出现 {0} 回合',[format(data.turnTypeCounts[type],0)]);legend.append(entry);labels.push(segment.title);
    }
    bar.setAttribute('aria-label',labels.join(' · '));allocation.append(bar,legend);
    meta.replaceChildren(average,allocation);
    wrap.replaceChildren(table);
  }
  scope.onchange=draw;draw();return details;
}
