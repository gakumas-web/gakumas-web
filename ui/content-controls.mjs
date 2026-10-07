import {loadingMetrics,markLoading,publicContentDiagnostics} from '../application/loading-metrics.mjs';
import {WEB_VERSION} from '../application/version.mjs';
import {imageManager,retryContentImages,completeImageBytes} from '../resources.mjs';
import {$} from './dom.mjs';
import {t,onLocaleChange} from '../i18n.mjs';
import {contentManager,readBounded} from '../application/content-manager.mjs';
import {contentLimits,ContentError} from '../domain/content-contract.mjs';

export function setupContentControls({loaded=()=>{},canReload=()=>true}={}){
  let busy=false,importError='';
  function render(){
    const state=contentManager.status(),working=busy||['checking','downloading','verifying','saving'].includes(state.phase);
    $('content-version').textContent=state.version?t('当前资料版本：{0}',[state.version]):t('尚未安装卡片资料');
    let status=state.local?t('使用本地导入的资料。'):t('公开卡片资料与账号库存分开更新。');
    if(state.phase==='checking')status=t('正在检查资料更新…');
    if(state.phase==='downloading')status=t('正在下载并校验完整资料…');
    if(state.availableVersion)status=t('资料 {0} 已准备好，应用后刷新页面。',[state.availableVersion]);
    if(state.version&&!state.cached)status=t('资料已载入，浏览器未能保存离线副本。');
    if(state.error)status=t(!state.version?'尚未取得卡片资料，可导入内容包。':state.error==='content_web_too_old'?'新资料需要更新 Web，当前资料继续保留。':state.error==='content_cache_failed'?'无法保存新资料，当前资料继续保留。':'资料更新未完成，已有资料仍可使用。');
    if(importError)status=importError;
    $('content-status').textContent=status;
    $('content-check').disabled=working||Boolean(state.availableVersion);
    $('content-import').disabled=busy;
    $('content-apply').hidden=!state.availableVersion;
  }
  let timer,lastPhase='',expanded=true,autoCollapsed=false,imageError='',actionBusy=false,lastCompleted='',badgeTimer,feedbackTimer,badgeLabel='';
  function renderBadge(kind,label){
    const button=$('resources-open'),indicator=$('resource-indicator');badgeLabel=label;
    const apply=()=>{button.dataset.status=kind;button.setAttribute('aria-label',badgeLabel);button.title=badgeLabel;indicator.hidden=kind==='idle';indicator.textContent=kind==='error'?'!':kind==='update'?'↑':kind==='paused'?'Ⅱ':'';};
    // 短暂的自动加载不闪烁；失败和可操作状态立即呈现。
    if(kind==='busy'&&button.dataset.status==='idle'){if(!badgeTimer)badgeTimer=setTimeout(()=>{badgeTimer=null;apply();},400);return;}
    clearTimeout(badgeTimer);badgeTimer=null;apply();
  }
  function completedFeedback(){
    if($('resources-dialog').open)return;
    clearTimeout(feedbackTimer);$('resource-feedback').textContent=t('完整图片准备完成');$('resource-feedback').hidden=false;
    feedbackTimer=setTimeout(()=>{$('resource-feedback').hidden=true;},3000);
  }
  const contentPhases={checking:'正在检查公开资料…',downloading:'正在下载公开资料…',verifying:'正在校验公开资料…',saving:'正在保存公开资料…'};
  const phases={checking:'正在检查已保存图片…',downloading:'正在下载图片…',verifying:'正在校验图片…',waiting:'正在等待处理图片…',unpacking:'正在解包图片…',saving:'正在保存图片…'};
  const errors={image_storage_full:'浏览器空间不足，请清理公共图片缓存后重试。账号数据会保留。',image_hash_mismatch:'图片校验失败，已保留其它成功项。',image_not_found:'图片文件不存在，请刷新页面检查版本。',image_timeout:'图片下载超时，可以重试失败项。',image_source_not_allowed:'图片来源与当前程序不匹配，请刷新页面。'};
  function renderImages(){
    clearTimeout(timer);timer=null;
    if(!$('resource-feedback').hidden)$('resource-feedback').textContent=t('完整图片准备完成');
    const state=imageManager.status(),content=contentManager.status(),contentWorking=Boolean(contentPhases[content.phase]),working=Boolean(phases[state.phase]);
    const contentText=content.error?t('公开资料准备失败，已有资料保留，请重试。'):contentWorking?t(contentPhases[content.phase]):content.version?t('公开资料已就绪。'):'';
    $('resource-content-status').textContent=contentText+(content.totalBytes?' '+t('已读取 {0} / {1} MiB',[(content.bytes/1048576).toFixed(1),(content.totalBytes/1048576).toFixed(1)]):'');
    $('resource-content-progress').hidden=!contentWorking;
    if(content.totalBytes){$('resource-content-progress').max=content.totalBytes;$('resource-content-progress').value=content.bytes;}else $('resource-content-progress').removeAttribute('value');
    $('resource-content-retry').hidden=!content.error;$('resource-content-retry').disabled=contentWorking;
    if(state.phase==='ready'&&!contentWorking&&!content.error&&!autoCollapsed){expanded=false;autoCollapsed=true;}
    let text=working?t(['verifying','waiting','unpacking','saving'].includes(state.phase)?'正在完成图片准备…':phases[state.phase]):state.phase==='ready'?t(state.full?'图片已保存到本机，后续只补充缺失图片。':'已请求的图片已准备好。'):state.phase==='cancelled'?t('图片下载已停止，已完成部分保留。'):'';
    if(state.failed||state.error)text=t(errors[state.error]??'部分图片准备失败，已完成部分保留，可重试。');
    if(imageError)text=imageError;
    $('image-retry').hidden=!(state.failed||state.phase==='cancelled');
    $('resource-status').hidden=state.phase==='idle'&&!contentWorking&&!content.error;
    const issue=Boolean(content.error||state.failed||state.error||imageError||importError);
    const badge=issue?'error':contentWorking||working||actionBusy||busy?'busy':content.availableVersion?'update':state.phase==='cancelled'?'paused':'idle';
    const label=badge==='error'?t('资料：准备未完成，点击查看并重试'):badge==='busy'?t('资料：正在后台准备'):badge==='update'?t('资料：有资料更新可应用'):badge==='paused'?t('资料：图片准备已暂停'):t('资料与图片');
    renderBadge(badge,label);
    if($('image-notice').textContent!==(contentWorking||content.error?contentText:text))$('image-notice').textContent=contentWorking||content.error?contentText:text;
    // 自动需求会随浏览增加，不把变化中的下载总量展示成整体完成百分比。
    const progress=$('resource-progress');progress.hidden=!working;
    if(state.full&&state.total){progress.max=state.total;progress.value=state.completed;progress.setAttribute('aria-label',t('完整图片准备进度'));}
    else{progress.removeAttribute('value');progress.setAttribute('aria-label',t('图片准备进度'));}
    $('resource-bytes').textContent=state.networkBytes?t('本次会话已下载 {0} MiB',[(state.networkBytes/1048576).toFixed(1)]):'';
    const counts=Object.entries(phases).map(([phase,label])=>{const count=state.tasks.filter(task=>task.phase===phase).length;return count?t(label)+' '+count:'';}).filter(Boolean);
    $('resource-stage').textContent=[...counts,...(state.total?[t('已就绪 {0} / {1} 个图片对象',[state.completed,state.total])]:[])].join(' · ');
    $('resource-refresh').hidden=!['image_not_found','image_source_not_allowed'].includes(state.error);
    $('resource-stop').hidden=!working;$('resource-retry').hidden=!(state.failed||state.phase==='cancelled');
    $('resource-complete').disabled=actionBusy||!content.version||state.full&&working;
    $('image-clear').disabled=actionBusy;$('resource-retry').disabled=actionBusy;$('image-retry').disabled=actionBusy;
    $('resource-complete').textContent=t('准备完整图片');
    $('image-total-size').textContent=t('完整图片资源总量约 {0} MiB；已有缓存会复用，不代表本次剩余下载量。',[Math.ceil(completeImageBytes()/1048576)]);
    $('resource-details').hidden=!expanded;$('resource-toggle').textContent=t(expanded?'收起详情':'查看详情');$('resource-toggle').setAttribute('aria-expanded',String(expanded));
    const completedKey=[state.version,state.runId,state.total].join(':');
    if(state.phase==='ready'&&lastCompleted!==completedKey){lastCompleted=completedKey;markLoading('image-task-complete',{run:state.runId,version:state.version,total:state.total,full:state.full});}
  }
  function schedule(){
    const phase=imageManager.status().phase+':'+contentManager.status().phase;
    if(phase!==lastPhase){lastPhase=phase;if(imageManager.status().error||contentManager.status().error)expanded=true;renderImages();}else if(!timer)timer=setTimeout(renderImages,150);
  }
  imageManager.subscribe(schedule);onLocaleChange(renderImages);
  async function imageAction(action,{announce=false}={}){
    if(!canReload()||actionBusy)return;
    actionBusy=true;imageError='';clearTimeout(feedbackTimer);$('resource-feedback').hidden=true;renderImages();
    try{await action();if(announce&&imageManager.status().phase==='ready')completedFeedback();}catch{imageError=t('图片操作失败，已保存的账号数据保留，请重试。');}
    finally{actionBusy=false;renderImages();}
  }
  $('resource-toggle').onclick=()=>{autoCollapsed=true;expanded=!expanded;renderImages();};
  $('image-retry').onclick=$('resource-retry').onclick=()=>imageAction(retryContentImages);
  $('resource-refresh').onclick=()=>{if(canReload())location.reload();};
  $('resource-stop').onclick=()=>imageManager.cancel();
  $('resource-complete').onclick=()=>{expanded=true;autoCollapsed=true;return imageAction(()=>imageManager.complete(),{announce:true});};
  $('image-clear').onclick=()=>{if(canReload()&&confirm(t('清除公共图片缓存？账号数据和笔记会保留。')))return imageAction(async()=>{await imageManager.clear();location.reload();});};
  $('resource-content-retry').onclick=async()=>{try{await contentManager.refresh();if(contentManager.status().version)await loaded();}catch{}finally{renderImages();}};
  $('resource-diagnostics').onclick=()=>{
    const body={format:'gakumas-loading-diagnostics',version:WEB_VERSION,content_version:contentManager.status().version,public_content:publicContentDiagnostics(contentManager.status()),...loadingMetrics(),images:imageManager.status()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='gakumas-loading-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  contentManager.subscribe(()=>{render();schedule();});onLocaleChange(render);
  $('content-check').onclick=async()=>{
    importError='';busy=true;render();renderImages();
    try{await contentManager.refresh();if(contentManager.status().version)await loaded();}catch{}
    finally{busy=false;render();renderImages();}
  };
  $('content-import').onclick=()=>$('content-file').click();
  $('content-file').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(!file||busy)return;
    busy=true;importError='';render();renderImages();
    try{
      if(file.size>contentLimits.bundle)throw new ContentError('content_too_large');
      const header=new Uint8Array(await file.slice(0,2).arrayBuffer());
      const stream=header[0]===31&&header[1]===139?file.stream().pipeThrough(new DecompressionStream('gzip')):file.stream();
      const bytes=await readBounded(new Response(stream),contentLimits.bundle);
      await contentManager.importBundle(bytes);if(contentManager.status().version)await loaded();
    }catch(error){importError=t(error.message==='content_web_too_old'?'这份资料需要更新 Web，现有资料未替换。':'内容包格式或校验不通过，现有资料未替换。');}
    finally{busy=false;render();renderImages();}
  };
  $('content-apply').onclick=()=>{if(canReload())location.reload();};
}
