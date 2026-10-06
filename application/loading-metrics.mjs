// 只记录公共阶段与时长；不记录账号标识、文件正文或请求凭据。
const marks={},events=[],runs=[],longTasks={count:0,total:0,max:0};let sequence=0;
const now=()=>Math.round(performance.now());
const scopeFields=['view','run','version','total','full','scope','mode'];
const publicScope=scope=>Object.fromEntries(scopeFields.filter(key=>scope?.[key]!==undefined).map(key=>[key,scope[key]]));
export function markLoading(name,scope){
  const at=now();if(!(name in marks))marks[name]=at;
  if(scope){const event={name,at,...publicScope(scope)},previous=events.at(-1);if(!previous||previous.name!==name||JSON.stringify({...previous,at:0})!==JSON.stringify({...event,at:0})){events.push(event);if(events.length>100)events.shift();}}
}
export function startLoading(name,scope={}){
  const token={id:++sequence,name,startedAt:now(),...publicScope(scope)};
  runs.push(token);if(runs.length>100)runs.shift();return token;
}
export function finishLoading(token,outcome='ready',scope={}){
  if(!token||token.endedAt!==undefined)return;
  Object.assign(token,publicScope(scope),{endedAt:now(),outcome});token.durationMs=token.endedAt-token.startedAt;
}
// 只有当前视图满足依赖才结算，迟到的后台分包不能结束另一视图的等待。
export function createViewTiming({ready,version=()=>undefined}){
  let current;
  return {
    begin(view,run){
      if(current?.view===view&&current.run===run&&current.outcome!=='error')return;
      finishLoading(current,'superseded');current=startLoading('view',{view,run,version:version()});
    },
    complete(){if(current&&ready(current.view)){finishLoading(current,'ready',{version:version()});markLoading('view-ready',{view:current.view,run:current.run,version:version()});}},
    fail(view){if(current?.view===view&&!ready(view))finishLoading(current,'error');},
  };
}
export function loadingMetrics(){return {marks:{...(globalThis.__gakumasStartup??{}),...marks},longTasks:{...longTasks},events:events.map(row=>({...row})),runs:runs.map(row=>({...row})),cacheCheckTimeUnit:'summed-object-ms'};}
if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){
  new PerformanceObserver(list=>{for(const row of list.getEntries()){longTasks.count++;longTasks.total+=Math.round(row.duration);longTasks.max=Math.max(longTasks.max,Math.round(row.duration));}}).observe({type:'longtask',buffered:true});
}

// 诊断仅保留公共资料状态；未知异常降为固定错误码，不携带异常正文或其它字段。
export function publicContentDiagnostics(state){
  const codes=new Set(['content_unavailable','content_cache_failed','content_hash_mismatch','content_scope_invalid','content_too_large','content_version_mismatch','content_manifest_invalid','content_web_too_old','content_format_unsupported','content_files_invalid','content_channel_invalid','content_assets_invalid','content_part_invalid','content_bundle_invalid']);
  return {phase:state.phase,version:state.version,availableVersion:state.availableVersion,cached:state.cached,
    error_code:state.error?(codes.has(state.error)?state.error:'content_unavailable'):null,bytes:state.bytes,totalBytes:state.totalBytes};
}
