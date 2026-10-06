// 独立于模块依赖图运行，主模块或其依赖加载失败时仍能保留解释与刷新入口。
(()=>{
  const node=document.getElementById('startup-status');if(!node)return;
  const text=node.querySelector('[data-startup-text]'),details=node.querySelector('details'),code=node.querySelector('code');
  let done=false,failed=false,language='zh-CN';try{language=localStorage.getItem('memory-language')??language;}catch{}
  const ja=language==='ja';
  if(ja){text.textContent='回想整理室を起動中…';node.querySelector('a').textContent='再読み込み';node.querySelector('summary').textContent='エラーの詳細';}
  globalThis.__gakumasStartup={'shell-visible':Math.round(performance.now())};
  function failure(value){if(done)return;failed=true;node.hidden=false;text.textContent=ja?'起動できませんでした。再読み込みしてください。':'启动失败，请重新加载页面。';details.hidden=false;code.textContent=value;}
  const timer=setTimeout(()=>{if(!done&&!failed)text.textContent=ja?'起動に時間がかかっています。通信状況を確認してください。':'启动时间较长，请检查网络连接。';},8000);
  window.addEventListener('error',event=>{if(event.target?.tagName==='SCRIPT')failure('module_load_failed');else if(event.error)failure('startup_failed');},true);
  window.addEventListener('unhandledrejection',()=>failure('startup_failed'));
  window.addEventListener('gakumas-ready',()=>{done=true;clearTimeout(timer);node.hidden=true;globalThis.__gakumasStartup['import-ready']=Math.round(performance.now());},{once:true});
})();
