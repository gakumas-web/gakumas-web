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
  observer.disconnect();cancelAnimationFrame(frame);frame=0;ready.clear();
  for(const [node,flush] of pending)node.removeEventListener('focusin',flush);
  pending.clear();
}
