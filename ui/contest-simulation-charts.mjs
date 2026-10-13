import {el} from './dom.mjs';
import {RECOMMENDATION_STABILITY_WEIGHT} from '../domain/contest-recommendations.mjs';
import {t,locale} from '../i18n.mjs';

const number=value=>new Intl.NumberFormat(locale(),{maximumFractionDigits:0}).format(value);
const svgNode=(tag,attributes={},text)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;return node;};
export function scoreDistribution(scores){
  const minimum=Math.min(...scores),maximum=Math.max(...scores),count=minimum===maximum?1:Math.min(20,Math.ceil(Math.sqrt(scores.length))),width=(maximum-minimum||1)/count;
  const bins=Array.from({length:count},(_,index)=>({from:minimum+index*width,to:minimum+(index+1)*width,count:0}));
  for(const score of scores)bins[Math.min(count-1,Math.floor((score-minimum)/width))].count++;
  return bins;
}
export function scoreQuantile(scores,fraction){const position=(scores.length-1)*fraction,left=Math.floor(position);return scores[left]+(scores[Math.ceil(position)]-scores[left])*(position-left);}

export function comparisonScore(stats){
  const metric=el('div','','comparison-score'),value=el('strong',number(stats.score));metric.dataset.metric='score';
  value.title=`(${stats.mean.toFixed(2)} + ${stats.median.toFixed(2)}) ÷ 2 + ${RECOMMENDATION_STABILITY_WEIGHT} × ${stats.upside.toFixed(2)} − ${RECOMMENDATION_STABILITY_WEIGHT} × ${stats.downside.toFixed(2)} ≈ ${stats.score.toFixed(2)}`;
  value.tabIndex=0;value.setAttribute('aria-label',`${t('综合分')} ${value.title}`);metric.append(el('small',t('综合分')),value);return metric;
}

export function comparisonRange(result,minimum,maximum){
  const node=el('div','','simulation-history-range'),span=maximum-minimum||1,position=value=>maximum===minimum?50:(value-minimum)/span*100;
  node.setAttribute('role','img');node.setAttribute('aria-label',t('最低 {0}，中位数 {1}，最高 {2}',[number(result.minimum),number(result.median),number(result.maximum)]));
  const whisker=el('span','','history-whisker'),box=el('span','','history-box'),median=el('span','','history-median');
  whisker.style.left=position(result.minimum)+'%';whisker.style.width=Math.max(.2,position(result.maximum)-position(result.minimum))+'%';
  const q1=scoreQuantile(result.scores,.25),q3=scoreQuantile(result.scores,.75);box.style.left=position(q1)+'%';box.style.width=Math.max(.3,position(q3)-position(q1))+'%';median.style.left=position(result.median)+'%';node.append(whisker,box,median);const scale=el('div','','simulation-history-scale');const low=el('span',number(result.minimum)),high=el('span',number(result.maximum));low.dataset.endpoint='minimum';high.dataset.endpoint='maximum';low.style.left=position(result.minimum)+'%';high.style.left=position(result.maximum)+'%';scale.append(low,high);node.classList.toggle('is-narrow-range',position(result.maximum)-position(result.minimum)<25);node.append(scale);return node;
}

export function simulationChart(result,type){
  const panel=el('figure','','contest-simulation-chart'),plot=el('div','','simulation-chart-plot'),svg=svgNode('svg',{viewBox:'0 0 640 240',role:'img','aria-label':t(({distribution:'分数分布',box:'分位区间',turns:'平均得分走势'})[type])});
  const text=(x,y,value,anchor='middle')=>svg.append(svgNode('text',{x,y,'text-anchor':anchor,class:x===49?'chart-axis-y':'chart-axis-x'},value));
  const line=(x1,y1,x2,y2,className='chart-grid')=>svg.append(svgNode('line',{x1,y1,x2,y2,class:className}));
  if(type==='box'){plot.append(comparisonRange(result,result.minimum,result.maximum));panel.append(plot,el('figcaption',t('色块表示中间 50% 的结果；两端为本次抽样最低分与最高分。'),'small muted'));return panel;}
  const bins=type==='distribution'?scoreDistribution(result.scores):null,maxY=bins?Math.max(...bins.map(bin=>bin.count)):Math.max(1,...result.turnAverages.map(turn=>turn.score)),y=value=>195-value/(maxY||1)*160;
  for(let index=0;index<=4;index++){const value=maxY*index/4;line(58,y(value),620,y(value));text(49,y(value)+4,number(value),'end');}
  if(bins){
    const width=562/bins.length;
    bins.forEach((bin,index)=>{const bar=svgNode('rect',{x:58+index*width+1,y:y(bin.count),width:Math.max(1,width-2),height:195-y(bin.count),rx:2,class:result.median>=bin.from&&(result.median<bin.to||index===bins.length-1)?'chart-bar chart-median':'chart-bar'});bar.append(svgNode('title',{},`${number(bin.from)}–${number(bin.to)} · ${bin.count}/${result.runs}`));svg.append(bar);});
    text(58,218,number(result.minimum),'start');text(339,218,number((result.minimum+result.maximum)/2));text(620,218,number(result.maximum),'end');
    plot.append(svg);panel.append(plot,el('figcaption',t('横轴为分数，纵轴为次数；高亮区间包含中位数。'),'small muted'));
  }else{
    const points=[{turn:0,score:0},...result.turnAverages],x=index=>58+index/(points.length-1||1)*562;
    const path=points.map((point,index)=>`${x(index)},${y(point.score)}`).join(' ');svg.append(svgNode('polygon',{points:`58,195 ${path} 620,195`,class:'chart-area'}),svgNode('polyline',{points:path,class:'chart-curve'}));
    points.forEach((point,index)=>{const dot=svgNode('circle',{cx:x(index),cy:y(point.score),r:3,class:'chart-dot'});dot.append(svgNode('title',{},`${t('回合')} ${point.turn} · ${number(point.score)}`));svg.append(dot);if(index%2===0||index===points.length-1)text(x(index),218,String(point.turn));});
    plot.append(svg);panel.append(plot,el('figcaption',t('全部模拟的每回合平均累计分数。'),'small muted'));
  }
  return panel;
}

export function cumulativeTurnSkips(turns){
  let skipped=0;return [{turn:0,skips:0},...turns.map((value,index)=>({turn:index+1,skips:skipped+=value.skips}))];
}
export function simulationSkipChart(statistics){
  const points=cumulativeTurnSkips(statistics.turns),total=points.at(-1).skips,maximum=Math.max(1,total),panel=el('figure','','contest-simulation-chart simulation-skip-chart'),heading=el('div','','simulation-skip-heading');
  heading.append(el('span',t('回合跳过')),el('strong',t('累计 {0} 次',[number(total)])));
  const svg=svgNode('svg',{viewBox:'0 0 480 180',role:'img','aria-label':t('累计跳过次数')}),x=index=>48+index/(points.length-1||1)*416,y=value=>140-value/maximum*120;
  for(const value of new Set(Array.from({length:5},(_,index)=>Math.round(maximum*index/4)))){svg.append(svgNode('line',{x1:48,y1:y(value),x2:464,y2:y(value),class:'chart-grid'}),svgNode('text',{x:40,y:y(value)+4,'text-anchor':'end',class:'chart-axis-y'},number(value)));}
  const path=points.map((point,index)=>`${x(index)},${y(point.skips)}`).join(' ');svg.append(svgNode('polygon',{points:`48,140 ${path} 464,140`,class:'chart-area'}),svgNode('polyline',{points:path,class:'chart-curve'}));
  for(const [index,point] of points.entries()){
    const dot=svgNode('circle',{cx:x(index),cy:y(point.skips),r:3,class:'chart-dot','data-turn':point.turn,'data-skips':point.skips});dot.append(svgNode('title',{},`${t('第 {0} 回合',[point.turn])} · ${t('累计 {0} 次',[number(point.skips)])}`));svg.append(dot);
    if(index%2===0||index===points.length-1)svg.append(svgNode('text',{x:x(index),y:164,'text-anchor':'middle',class:'chart-axis-x'},String(point.turn)));
  }
  panel.append(heading,svg,el('figcaption',t('全部模拟的逐回合累计跳过次数。'),'small muted'));return panel;
}
