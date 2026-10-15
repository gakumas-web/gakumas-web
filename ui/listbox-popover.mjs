// 共用列表弹出层交互；选项内容、业务选择和返回焦点的目标由调用方提供。
export function createListboxPopover({button,popup,list,width,maxHeight,beforeShow=()=>{},returnFocus=()=>button}){
  popup.popover='auto';list.setAttribute('role','listbox');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-controls',list.id);button.setAttribute('aria-expanded','false');
  const restoreFocus=()=>returnFocus()?.focus({preventScroll:true});
  function hide(){if(popup.matches(':popover-open'))popup.hidePopover();button.setAttribute('aria-expanded','false');}
  function show(focusOption=false){
    if(button.disabled)return;
    beforeShow();popup.showPopover();
    const bounds=button.getBoundingClientRect(),popupWidth=Math.min(width,innerWidth-24),below=innerHeight-bounds.bottom-18,above=bounds.top-18,under=below>=240||below>=above;
    popup.style.width=`${popupWidth}px`;popup.style.maxHeight=`${Math.max(120,Math.min(maxHeight,under?below:above))}px`;popup.style.left=`${Math.max(12,Math.min(bounds.left,innerWidth-popupWidth-12))}px`;popup.style.top=`${under?bounds.bottom+6:Math.max(12,bounds.top-popup.getBoundingClientRect().height-6)}px`;list.scrollTop=0;
    button.setAttribute('aria-expanded','true');
    if(focusOption)(list.querySelector('[role=option][aria-selected=true]')??list.querySelector('[role=option]'))?.focus();
  }
  const toggle=()=>popup.matches(':popover-open')?hide():show();
  const triggerKeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();show(true);}};
  const popupKeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide();restoreFocus();return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const options=[...list.querySelectorAll('[role=option]')];if(!options.length)return;
    event.preventDefault();const index=options.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowUp'?-1:1)+options.length)%options.length;options[next].focus();
  };
  const syncExpanded=()=>button.setAttribute('aria-expanded',String(popup.matches(':popover-open')));
  const onScroll=event=>{if(popup.matches(':popover-open')&&!popup.contains(event.target))hide();};
  button.addEventListener('click',toggle);button.addEventListener('keydown',triggerKeydown);popup.addEventListener('keydown',popupKeydown);popup.addEventListener('toggle',syncExpanded);document.addEventListener('scroll',onScroll,true);window.addEventListener('resize',hide);
  return {hide,restoreFocus,dispose(){hide();button.removeEventListener('click',toggle);button.removeEventListener('keydown',triggerKeydown);popup.removeEventListener('keydown',popupKeydown);popup.removeEventListener('toggle',syncExpanded);document.removeEventListener('scroll',onScroll,true);window.removeEventListener('resize',hide);}};
}
