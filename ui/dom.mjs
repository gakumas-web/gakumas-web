
export const $ = id => document.getElementById(id);
export function el(tag, text = '', className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className;
  if (tag === 'button') node.type = 'button';
  return node;
}

const dialogSettings=new WeakMap();
// 沿用原生模态焦点与 Escape；只有明确的只读窗口允许点击背景关闭。
export function openDialog(dialog,{dismissOnBackdrop=false,returnFocus=null}={}){
  let settings=dialogSettings.get(dialog);
  if(!settings){
    settings={};dialogSettings.set(dialog,settings);
    let pressedOutside=false;
    const outside=event=>{
      const box=dialog.getBoundingClientRect();
      return event.target===dialog&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom);
    };
    dialog.addEventListener('pointerdown',event=>{pressedOutside=outside(event);});
    dialog.addEventListener('click',event=>{
      const close=pressedOutside&&outside(event)&&settings.dismissOnBackdrop;pressedOutside=false;
      if(close&&dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close();
    });
    dialog.addEventListener('keydown',event=>{
      if(event.key!=='Tab'||event.defaultPrevented||event.ctrlKey||event.altKey||event.metaKey)return;
      const targets=[...dialog.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')].filter(node=>node.tabIndex>=0&&!node.disabled&&!node.closest('[inert]')&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
      const index=targets.indexOf(document.activeElement);
      if(!targets.length){event.preventDefault();dialog.tabIndex=-1;dialog.focus();}
      else if(index<0||event.shiftKey&&index===0||!event.shiftKey&&index===targets.length-1){event.preventDefault();(event.shiftKey?targets.at(-1):targets[0]).focus();}
    });
    dialog.addEventListener('close',()=>{pressedOutside=false;const returnFocus=settings.returnFocus;settings.returnFocus=null;returnFocus?.()?.focus({preventScroll:true});});
  }
  settings.dismissOnBackdrop=dismissOnBackdrop;settings.returnFocus=returnFocus;
  if(!dialog.open){dialog.showModal();dialog.scrollTop=0;}
}
