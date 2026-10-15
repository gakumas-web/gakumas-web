import {el} from './dom.mjs';

// 共用按钮、输入框的排列及禁用状态；数值含义、空值处理和提交时机由调用方负责。
export function createNumberStepper({input,before,after,onAction,className}){
  const element=el('div','',className),buttons=[];
  function append(actions){
    for(const action of actions){
      const button=el('button',action.text);button.setAttribute('aria-label',action.label);Object.assign(button.dataset,action.data);
      if(input.id)button.setAttribute('aria-controls',input.id);
      button.onclick=()=>onAction(action.value);element.append(button);buttons.push({button,value:action.value});
    }
  }
  append(before);element.append(input);append(after);
  return {element,setDisabled(disabled){for(const {button,value} of buttons)button.disabled=disabled(value);}};
}
