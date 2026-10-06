// 只记录公共阶段与时长；不记录账号标识、文件正文或请求凭据。
const marks={},longTasks={count:0,total:0,max:0};
export function markLoading(name){if(!(name in marks))marks[name]=Math.round(performance.now());}
export function loadingMetrics(){return {marks:{...(globalThis.__gakumasStartup??{}),...marks},longTasks:{...longTasks}};}
if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){
  new PerformanceObserver(list=>{for(const row of list.getEntries()){longTasks.count++;longTasks.total+=Math.round(row.duration);longTasks.max=Math.max(longTasks.max,Math.round(row.duration));}}).observe({type:'longtask',buffered:true});
}
