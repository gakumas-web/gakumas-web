import {$,el,openDialog} from './dom.mjs';
import {t,onLocaleChange} from '../i18n.mjs';
import {LibraryError} from '../domain/personal-library.mjs';

export function tagControls(tags=[],edit,disabled=false,inline=false,remove){
  const box=el(inline?'span':'div','','custom-tags'+(inline?' inline-tags':''));
  for(const name of tags){
    const chip=el('span','','custom-tag');chip.title=name;box.append(chip);
    let clearOutside=()=>{};
    function draw(confirm=false){
      clearOutside();
      chip.classList.toggle('tag-remove-pending',confirm);chip.replaceChildren(el('span',name,'custom-tag-name'));
      if(!remove)return;
      const button=el('button',confirm?t('确认'):'×',confirm?'tag-remove-confirm':'tag-chip-remove');button.type='button';button.disabled=disabled;
      button.setAttribute('aria-label',t(confirm?'确认移除标签：{0}':'移除标签：{0}',[name]));button.title=button.getAttribute('aria-label');
      button.onclick=()=>{if(confirm){clearOutside();remove(name);if(chip.isConnected)draw();}else{draw(true);chip.querySelector('.tag-remove-confirm').focus({preventScroll:true});}};chip.append(button);
      if(confirm){
        const outside=event=>{if(!chip.contains(event.target))draw();};
        document.addEventListener('click',outside,true);clearOutside=()=>document.removeEventListener('click',outside,true);
      }
    }
    chip.onkeydown=event=>{if(event.key==='Escape'&&chip.classList.contains('tag-remove-pending')){event.preventDefault();event.stopPropagation();draw();chip.querySelector('.tag-chip-remove')?.focus({preventScroll:true});}};
    draw();
  }
  const button=el('button',t(!inline&&tags.length?'编辑标签':'添加标签'),'edit-custom-tags');button.type='button';button.disabled=disabled;
  button.setAttribute('aria-label',t('编辑自定义标签'));button.onclick=edit;box.append(button);return box;
}
export function favoriteButton(active,onChange,disabled=false){
  const button=el('button','','favorite-button');button.type='button';button.disabled=disabled;button.setAttribute('aria-pressed',String(active));
  button.setAttribute('aria-label',t(active?'取消收藏':'添加收藏'));button.title=t(active?'取消收藏':'添加收藏');
  const heart=document.createElementNS('http://www.w3.org/2000/svg','svg');heart.setAttribute('viewBox','0 0 24 24');heart.setAttribute('aria-hidden','true');
  const path=document.createElementNS(heart.namespaceURI,'path');path.setAttribute('d','M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z');heart.append(path);button.append(heart);
  button.onclick=()=>{
    const next=button.getAttribute('aria-pressed')!=='true';
    if(onChange(next)===false)return;
    button.setAttribute('aria-pressed',String(next));
    const label=t(next?'取消收藏':'添加收藏');button.setAttribute('aria-label',label);button.title=label;
  };return button;
}
export function setupLibraryUI({current,changed}){
  const dialog=$('tags-dialog');let record=null,renaming=null,pendingDelete=null,restoreFocus=null;
  const error=text=>{const node=$('tags-error');node.hidden=!text;node.textContent=text;};
  function run(action){
    try{action();error('');changed();draw();return true;}
    catch(reason){draw();error(reason instanceof LibraryError?t(reason.message):t('标签未能保存，请检查浏览器存储空间。'));return false;}
  }
  function draw(){
    const data=current()?.data;if(!data)return;
    dialog.classList.toggle('tag-picker',Boolean(record));$('tag-form').hidden=Boolean(record);
    $('tags-title').textContent=t(record?'选择自定义标签':'管理自定义标签');
    $('tags-hint').textContent=t(record?'勾选标签即可添加到这条回忆，修改自动保存。':'标签由当前账号的普通回忆和选拔回忆共用。');
    $('tag-name').placeholder=t('标签名称（最多 40 字）');$('tag-submit').textContent=t(renaming?'保存名称':'创建标签');$('tag-cancel-rename').hidden=renaming===null;
    const list=$('tag-list'),focused=document.activeElement?.closest('[data-tag]');
    const focusName=focused?.dataset.tag,focusAction=document.activeElement?.dataset.action;list.replaceChildren();
    const assigned=record?data[record.kind][record.key]??[]:[];
    for(const name of data.tags){
      const row=el('div','','tag-manager-row');row.dataset.tag=name;
      const title=el('label','','tag-manager-name');
      if(record){const input=el('input');input.type='checkbox';input.checked=assigned.includes(name);input.dataset.action='assign';input.setAttribute('aria-label',name);
        input.onchange=()=>run(()=>current().assign(record.kind,record.key,input.checked?[...assigned,name]:assigned.filter(value=>value!==name)));title.append(input);}
      title.append(el('span',name));row.append(title);
      if(record){list.append(row);continue;}
      const actions=el('div','','tag-manager-actions');
      if(pendingDelete===name){
        actions.append(el('span',t('同时移除所有关联？'),'small'));
        const confirm=el('button',t('删除'),'danger-button'),cancel=el('button',t('取消'));
        confirm.onclick=()=>{if(run(()=>current().remove(name))){pendingDelete=null;if(renaming===name)resetForm();draw();$('tag-name').focus();}};
        cancel.onclick=()=>{pendingDelete=null;draw();};actions.append(confirm,cancel);
      }else{
        const rename=el('button',t('重命名')),remove=el('button',t('删除'));rename.dataset.action='rename';remove.dataset.action='remove';
        rename.onclick=()=>{renaming=name;$('tag-name').value=name;draw();$('tag-name').focus();$('tag-name').select();};
        remove.onclick=()=>{pendingDelete=name;draw();};actions.append(rename,remove);
      }
      row.append(actions);list.append(row);
    }
    if(!data.tags.length)list.append(el('p',t(record?'暂无标签，请先在标签管理中创建。':'还没有自定义标签，先创建一个。'),'muted'));
    if(focusName&&focusAction)[...list.children].find(row=>row.dataset.tag===focusName)?.querySelector(`[data-action="${focusAction}"]`)?.focus({preventScroll:true});
  }
  function resetForm(){renaming=null;$('tag-name').value='';}
  function open(value=null,focus=null){
    if(!current()?.data)return;record=value;restoreFocus=focus;pendingDelete=null;resetForm();error('');draw();openDialog(dialog);(record?dialog.querySelector('input[type="checkbox"]')??$('close-tags'):$('tag-name')).focus();
  }
  $('manage-tags').onclick=()=>open(null,()=>$('manage-tags').focus());
  $('tag-form').onsubmit=event=>{
    event.preventDefault();if(record)return;const old=renaming,name=$('tag-name').value;
    if(run(()=>current().rename(old,name))){resetForm();draw();$('tag-name').focus();}
  };
  $('tag-cancel-rename').onclick=()=>{resetForm();draw();};
  $('close-tags').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{record=null;renaming=null;pendingDelete=null;restoreFocus?.();restoreFocus=null;});
  onLocaleChange(()=>{if(dialog.open)draw();});
  return {open};
}
