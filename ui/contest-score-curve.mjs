import {el} from './dom.mjs';
import {t} from '../i18n.mjs';
import {contestAttributeMultiplier} from '../domain/contest-simulation.mjs';

const attributes=['vocal','dance','visual'],labels=['Vo','Da','Vi'];
function svgNode(tag,attributes={},text=''){
  const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));node.textContent=text;return node;
}
export function contestScoreCurve(curve){
  const section=el('section','','season-score-curve');section.setAttribute('aria-label',t('属性评分曲线'));
  const chart=svgNode('svg',{viewBox:'0 0 460 238',role:'img','aria-label':t('属性评分曲线'),class:'season-curve-chart'});
  const left=48,right=440,top=24,bottom=196,min=curve[0].parameter,max=curve.at(-1).parameter,ceiling=Math.max(1,Math.ceil(Math.max(...curve.flatMap(row=>attributes.map(key=>row[key+'Permil']/1000)))));
  const x=value=>left+(value-min)/(max-min||1)*(right-left),y=value=>bottom-value/ceiling*(bottom-top);
  for(let index=0;index<=4;index++){
    const value=ceiling*index/4;chart.append(svgNode('line',{x1:left,x2:right,y1:y(value),y2:y(value),class:'season-curve-grid'}),svgNode('text',{x:left-7,y:y(value)+4,'text-anchor':'end'},`×${Number(value.toFixed(1))}`));
  }
  for(const value of [min,(min+max)/2,max])chart.append(svgNode('text',{x:x(value),y:bottom+18,'text-anchor':value===min?'start':value===max?'end':'middle'},String(value)));
  chart.append(svgNode('text',{x:left,y:14},t('属性倍率')),svgNode('text',{x:right,y:232,'text-anchor':'end'},t('属性值')));
  attributes.forEach((key,index)=>{
    const group=svgNode('g',{'data-attribute':key});group.append(svgNode('polyline',{points:curve.map(row=>`${x(row.parameter)},${y(row[key+'Permil']/1000)}`).join(' '),fill:'none','stroke-width':2.5,'stroke-dasharray':['none','7 3','2 3'][index]}));
    for(const row of curve)group.append(svgNode('circle',{cx:x(row.parameter),cy:y(row[key+'Permil']/1000),r:2.7}));chart.append(group);
  });
  const cursor=svgNode('line',{x1:left,x2:left,y1:top,y2:bottom,class:'season-curve-cursor'});chart.append(cursor);
  const legend=el('div','','season-curve-legend');for(const [index,key] of attributes.entries()){const item=el('span',labels[index]);item.dataset.attribute=key;legend.append(item);}
  const input=el('input');input.type='range';input.min=String(min);input.max=String(max);input.step='1';input.value=String(curve[Math.floor(curve.length/2)].parameter);input.setAttribute('aria-label',t('属性值'));input.className='season-curve-parameter';
  const label=el('label','','season-curve-control'),value=el('output');label.append(el('span',t('属性值')),value,input);
  const readings=el('div','','season-curve-readings');
  function update(){
    const parameter=Number(input.value);value.value=String(parameter);cursor.setAttribute('x1',x(parameter));cursor.setAttribute('x2',x(parameter));
    readings.replaceChildren(...attributes.map((key,index)=>{const cell=el('span');cell.dataset.attribute=key;const multiplier=contestAttributeMultiplier(curve,key,parameter);cell.append(el('small',labels[index]),el('strong',multiplier===null?'—':`×${multiplier.toFixed(3)}`));return cell;}));
  }
  input.oninput=update;update();
  section.append(legend,chart,label,readings);return section;
}
