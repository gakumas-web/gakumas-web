import {imageManager,retryContentImages} from '../resources.mjs';
import {$} from './dom.mjs';
import {t,onLocaleChange} from '../i18n.mjs';
import {contentManager,readBounded} from '../application/content-manager.mjs';
import {contentLimits,ContentError} from '../domain/content-contract.mjs';

export function setupContentControls({loaded=()=>{},canReload=()=>true}={}){
  let busy=false,importError='';
  function render(){
    const state=contentManager.status(),working=busy||['checking','downloading'].includes(state.phase);
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
  function renderImages(){
    const state=imageManager.status();let text='';
    if(state.phase==='checking')text=t('正在检查本地图片…');
    if(state.phase==='baseline')text=t('正在准备图片：{0}/{1}，当前下载 {2} MiB',[state.completed,state.total,(state.bytes/1048576).toFixed(1)]);
    if(state.phase==='incremental')text=t('正在更新图片：{0}/{1}',[state.completed,state.total]);
    if(state.phase==='ready')text=t('图片已保存到本机，后续只补充缺失图片。');
    if(state.phase==='error')text=t(state.error==='image_storage_full'?'浏览器空间不足，已完成的图片仍保留。':'图片准备未完成，已完成部分保留，可重试。');
    $('image-status').textContent=text;
    $('image-retry').hidden=state.phase!=='error';
    const notice=$('image-notice');notice.textContent=text;notice.hidden=['idle','ready'].includes(state.phase);
  }
  imageManager.subscribe(renderImages);onLocaleChange(renderImages);
  $('image-retry').onclick=async()=>{if(!canReload())return;await retryContentImages();if(imageManager.status().phase==='ready')location.reload();};
  contentManager.subscribe(render);onLocaleChange(render);
  $('content-check').onclick=async()=>{
    importError='';busy=true;render();
    try{await contentManager.refresh();if(contentManager.status().version)await loaded();}catch{}
    finally{busy=false;render();}
  };
  $('content-import').onclick=()=>$('content-file').click();
  $('content-file').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(!file||busy)return;
    busy=true;importError='';render();
    try{
      if(file.size>contentLimits.bundle)throw new ContentError('content_too_large');
      const header=new Uint8Array(await file.slice(0,2).arrayBuffer());
      const stream=header[0]===31&&header[1]===139?file.stream().pipeThrough(new DecompressionStream('gzip')):file.stream();
      const bytes=await readBounded(new Response(stream),contentLimits.bundle);
      await contentManager.importBundle(bytes);if(contentManager.status().version)await loaded();
    }catch(error){importError=t(error.message==='content_web_too_old'?'这份资料需要更新 Web，现有资料未替换。':'内容包格式或校验不通过，现有资料未替换。');}
    finally{busy=false;render();}
  };
  $('content-apply').onclick=()=>{if(canReload())location.reload();};
}
