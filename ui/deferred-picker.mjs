// 选项和输入框立即可用；图片及效果预览按弹窗滚动位置分批补齐。
const controllers=new WeakMap();
export function createDeferredPicker(root){
  const previous=controllers.get(root);previous?.reset();
  if(!previous){const dialog=root.closest('dialog');dialog.addEventListener('close',()=>{if(!dialog.open)controllers.get(root)?.reset();});}
  const pending=new Map(),ready=new Set();let frame=0;
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){if(entry.isIntersecting)ready.add(entry.target);else ready.delete(entry.target);}
    schedule();
  },{root,rootMargin:'120px 0px'});
  function schedule(){if(!frame&&ready.size)frame=requestAnimationFrame(run);}
  function flush(node){
    const build=pending.get(node);if(!build)return;
    pending.delete(node);ready.delete(node);observer.unobserve(node);node.classList.remove('picker-visual-pending');
    node.removeEventListener('focusin',focus);if(node.isConnected)build();
  }
  function focus(event){flush(event.currentTarget);}
  function run(){
    frame=0;const started=performance.now();let count=0;
    for(const node of ready){flush(node);if(++count>=4||performance.now()-started>=8)break;}
    schedule();
  }
  function reset(){
    observer.disconnect();cancelAnimationFrame(frame);frame=0;ready.clear();
    for(const node of pending.keys())node.removeEventListener('focusin',focus);
    pending.clear();
  }
  const controller={reset,add(node,build){node.classList.add('picker-visual-pending');pending.set(node,build);node.addEventListener('focusin',focus);observer.observe(node);}};
  controllers.set(root,controller);return controller;
}
