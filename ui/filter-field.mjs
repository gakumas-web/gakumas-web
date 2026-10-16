import {el} from './dom.mjs';

// 单项标签与整组图例共用标题外观，调用方保留各自的 HTML 语义。
export function filterTitle(text,tag='span'){
  return el(tag,text,'filter-title');
}

export function filterField(text,control){
  const label=el('label','','filter-field');label.append(filterTitle(text),control);return label;
}
