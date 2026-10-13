import {el} from './dom.mjs';
import {t} from '../i18n.mjs';
import {uiIconURL} from '../resources.mjs';
import {selectionFlowDefinitions} from '../domain/catalog.mjs';
import {filterSymbol} from './illustrations.mjs';

// 图标筛选只修改候选列表的筛选值，不改写调用方的已选项目。
export function choiceFilterIcons(input,kind,label,onChange,{id=input.id}={}){
  const group=el('fieldset','','contest-memory-icon-filters'),buttons=[];group.id=id;group.setAttribute('role','radiogroup');group.setAttribute('aria-label',t(label));if(kind==='rarity')group.classList.add('contest-item-rarities');
  for(const option of input.options){
    const button=el('button');button.dataset.value=option.value;button.title=option.text;button.setAttribute('aria-label',option.text);button.setAttribute('role','radio');
    if(!option.value){const icon=el('span','','contest-filter-all');icon.setAttribute('aria-hidden','true');for(let i=0;i<4;i++)icon.append(el('i'));button.append(icon);}
    else if(kind==='plan')button.append(filterSymbol(option.value));
    else if(kind==='flow'&&option.value!=='unclassified')button.append(filterSymbol('ProduceExamEffectType_'+selectionFlowDefinitions.find(value=>value.id===option.value).prefixes[0]));
    else if(kind==='rarity'&&['R','SR','SSR'].includes(option.value)){const icon=el('img','','contest-item-rarity-icon');icon.src=uiIconURL(`rarity-${option.value.toLowerCase()}.webp`);icon.alt='';button.append(icon);}
    else{const icon=el('span',kind==='flow'?'?':option.value,'contest-filter-symbol');icon.setAttribute('aria-hidden','true');button.append(icon);}
    button.onclick=()=>{input.value=option.value;onChange();};button.onkeydown=event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const visible=buttons.filter(value=>!value.hidden),direction=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1,index=visible.indexOf(button),next=visible[(index+direction+visible.length)%visible.length];next.click();next.focus();
    };buttons.push(button);group.append(button);
  }
  return {input,group,buttons};
}
