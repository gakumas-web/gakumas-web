import {$,el} from './dom.mjs';
import {t,onLocaleChange} from '../i18n.mjs';

// 单次编辑保留节点和按钮顺序；账号切换后不沿用旧关联。
export function setupInlineTags({current,changed}){
  let active=null,failure=null;
  const assigned=target=>target.owner.data[target.record.kind][target.record.key]??[];
  const valid=target=>target?.owner===current();
  function closeEditor(focus=false){
    if(!active)return;
    const button=active.resolve()?.querySelector('.edit-custom-tags');
    button?.setAttribute('aria-expanded','false');button?.removeAttribute('aria-controls');
    if(button?.dataset.closedLabel){button.textContent=button.dataset.closedLabel;delete button.dataset.closedLabel;}
    active.panel.remove();active=null;if(focus)button?.focus({preventScroll:true});
  }
  function clearFailure(){failure?.node.remove();failure=null;}
  function sync(){
    if(active){
      const box=valid(active)?active.resolve():null;
      if(!box?.isConnected)closeEditor();
      else{
        if(active.panel.parentNode!==box)box.append(active.panel);
        const button=box.querySelector('.edit-custom-tags');
        button.dataset.closedLabel??=button.textContent;button.textContent=t('收起');button.setAttribute('aria-expanded','true');button.setAttribute('aria-controls','inline-tag-editor');
        const values=assigned(active);
        for(const option of active.options.children)option.setAttribute('aria-pressed',String(values.includes(option.dataset.tag)));
      }
    }
    if(failure){
      if(!valid(failure)){clearFailure();return;}
      const box=failure.resolve();
      if(box?.isConnected){if(failure.node.parentNode!==box)box.append(failure.node);}
      else $('list').before(failure.node);
    }
  }
  function showFailure(target){
    clearFailure();
    const node=el('span',t('标签未能保存，请检查浏览器存储空间。'),'inline-tag-error');node.setAttribute('role','alert');
    failure={...target,node};sync();
  }
  function change(target,values){
    if(!valid(target))return false;
    const focus=document.activeElement;
    const scroll={left:window.scrollX,top:window.scrollY,behavior:'instant'};
    try{
      const before=target.owner.data;target.owner.assign(target.record.kind,target.record.key,values);
      if(active)active.error.hidden=true;
      clearFailure();changed(before);sync();
      if(focus?.isConnected)focus.focus({preventScroll:true});
      else target.resolve()?.querySelector('.edit-custom-tags')?.focus({preventScroll:true});
      // 关联变化可能改变卡片高度；抵消浏览器滚动锚点对背景列表的补偿。
      window.scrollTo(scroll);
      return true;
    }catch{
      if(active&&active.owner===target.owner&&active.record.kind===target.record.kind&&active.record.key===target.record.key){
        active.error.textContent=t('标签未能保存，请检查浏览器存储空间。');active.error.hidden=false;
      }else showFailure(target);
      sync();return false;
    }
  }
  function open(record,resolve){
    const box=resolve(),owner=current();if(!box||!owner)return;
    if(active?.resolve()===box){closeEditor(true);return;}
    closeEditor();
    const panel=el('span','','inline-tag-editor');panel.id='inline-tag-editor';panel.setAttribute('role','group');panel.setAttribute('aria-label',t('编辑自定义标签'));
    const options=el('span','','inline-tag-options'),empty=el('span','','inline-tag-empty'),error=el('span','','inline-tag-error');
    error.setAttribute('role','alert');error.hidden=true;
    active={record,resolve,owner,panel,options,error};const target=active,values=assigned(target);
    // 打开时已选优先；编辑过程中不重排，避免连续点击的目标移动。
    const names=[...owner.data.tags].sort((a,b)=>Number(values.includes(b))-Number(values.includes(a)));
    for(const name of names){
      const option=el('button',name,'inline-tag-option');option.dataset.tag=name;
      option.onclick=()=>{
        const values=assigned(target),has=values.includes(name);
        change(target,has?values.filter(value=>value!==name):[...values,name]);
      };options.append(option);
    }
    empty.hidden=names.length>0;empty.textContent=t('暂无标签，请先在标签管理中创建。');
    panel.append(options,empty,error);
    sync();(options.firstElementChild??box.querySelector('.edit-custom-tags')).focus({preventScroll:true});
  }
  function close(){closeEditor();clearFailure();}
  document.addEventListener('click',event=>{
    if(active&&!active.resolve()?.contains(event.target)&&!event.target.closest('.edit-custom-tags'))closeEditor();
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&active&&!event.isComposing){event.preventDefault();event.stopImmediatePropagation();closeEditor(true);}
  },true);
  onLocaleChange(close);
  return {open,sync,close,remove(record,name,resolve){
    const owner=current();if(!owner)return;
    const target={record,resolve,owner};change(target,assigned(target).filter(value=>value!==name));
  }};
}
