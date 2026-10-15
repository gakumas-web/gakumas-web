import {el} from './dom.mjs';

// 按舞台原始权重展示比例；未知值提示由调用方保留，不在展示层归一化。
export function appendContestCriteria(target,criteria){
  const bar=el('span','','contest-criteria-bar'),labels=el('span','','contest-criteria-labels');bar.setAttribute('aria-hidden','true');
  for(const [key,short] of [['vocal','Vo'],['dance','Da'],['visual','Vi']]){
    const value=criteria[key],part=el('span'),label=el('span',`${short} ${Number((value*100).toFixed(1))}%`);
    part.style.flexGrow=String(value);part.dataset.attribute=key;label.dataset.attribute=key;bar.append(part);labels.append(label);
  }
  target.append(bar,labels);
}
