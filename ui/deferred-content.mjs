// 一页共用一个观察器；翻页、切换账号或重绘时取消旧页工作，避免残留节点继续构建。
const pending=new Map(),ready=new Set();
let frame=0;
const observer=new IntersectionObserver(entries=>{
  for(const entry of entries){if(entry.isIntersecting)ready.add(entry.target);else ready.delete(entry.target);}
  schedule();
},{rootMargin:'240px 0px'});
function schedule(){if(!frame&&ready.size)frame=requestAnimationFrame(run);}
function run(){
  frame=0;
  const node=ready.values().next().value;
  if(node){ready.delete(node);pending.get(node)?.();}
  schedule();
}
export function deferVisibleContent(node,build){
  const flush=()=>{
    if(!pending.has(node))return;
    observer.unobserve(node);ready.delete(node);pending.delete(node);
    node.removeEventListener('focusin',flush);
    if(node.isConnected)build();
  };
  pending.set(node,flush);observer.observe(node);
  // 键盘进入时立即补齐可操作内容，不能让 Tab 跳过尚未创建的按钮。
  node.addEventListener('focusin',flush);
  return flush;
}
export function resetDeferredContent(){
  sizeObserver?.disconnect();observer.disconnect();cancelAnimationFrame(frame);frame=0;ready.clear();
  for(const [node,flush] of pending)node.removeEventListener('focusin',flush);
  pending.clear();
}

// 保留列表顺序和键盘入口，仅在接近视口时创建完整卡片。
export function deferredEntry(build,{className,dataset,label}){
  const node=document.createElement('article');node.className=className+' deferred-entry';
  Object.assign(node.dataset,dataset);node.tabIndex=0;node.setAttribute('aria-busy','true');node.setAttribute('aria-label',label);
  const caption=document.createElement('span');caption.className='muted';caption.textContent=label;node.append(caption);
  deferVisibleContent(node,()=>{
    const focused=document.activeElement===node,backward=node.dataset.focusBackward==='true';
    const row=build();node.replaceWith(row);
    if(focused){
      const targets=[...row.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex]')].filter(target=>target.tabIndex>=0&&!target.matches(':disabled')&&target.getClientRects().length&&!hiddenByDetails(target,row));
      const target=backward?targets.at(-1):targets[0];
      if(target)target.focus({preventScroll:true});else{row.tabIndex=-1;row.focus({preventScroll:true});}
    }
  });
  node.addEventListener('focus',event=>{node.dataset.focusBackward=String(Boolean(event.relatedTarget&&(node.compareDocumentPosition(event.relatedTarget)&Node.DOCUMENT_POSITION_FOLLOWING)));});
  return node;
}
const listSizes=new Map();
let sizeObserver;
export function sizeDeferredEntries(list){
  sizeObserver?.disconnect();
  const entries=[...list.children],pendingEntries=entries.filter(node=>node.classList.contains('deferred-entry'));
  const update=height=>{listSizes.set(list.className,height);for(const node of pendingEntries)if(node.isConnected)node.style.height=height+'px';};
  for(const node of pendingEntries){node.style.height=(listSizes.get(list.className)??480)+'px';node.style.boxSizing='border-box';}
  sizeObserver=new ResizeObserver(records=>{
    const height=Math.max(0,...records.map(record=>record.borderBoxSize[0]?.blockSize??record.contentRect.height));
    if(height)update(height);
  });
  for(const node of entries)if(!node.classList.contains('deferred-entry'))sizeObserver.observe(node);
}
export function flushDeferredContent(node){pending.get(node)?.();}

function hiddenByDetails(target,row){
  for(let parent=target.parentElement;parent&&parent!==row;parent=parent.parentElement){
    if(parent.tagName==='DETAILS'&&!parent.open&&!parent.querySelector(':scope > summary')?.contains(target))return true;
  }
  return false;
}
