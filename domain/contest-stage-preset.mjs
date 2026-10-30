// 与生成器和正式模拟请求共用业务投影，不依赖引擎或能力索引。
export const contestStagePreset=preset=>preset?Object.fromEntries(['id','type','plan','season','stage','round','criteria','turnCounts','firstTurns','effectReference','linkTurnCounts'].map(key=>[key,preset[key]])):null;
export const stableStageJSON=value=>JSON.stringify(value,(_,entry)=>entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])):entry);
