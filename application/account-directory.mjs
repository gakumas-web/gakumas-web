import {AccountDirectoryError,prepareAccountDirectory} from '../domain/account-import.mjs';

export async function readAccountDirectory(files){
  // 只处理采集器约定的文件，日志、配置、清单和其它 JSON 不参与导入。
  const snapshots=[...files].filter(file=>file.name==='snapshot.json').sort((a,b)=>(a.webkitRelativePath||a.name).localeCompare(b.webkitRelativePath||b.name));
  if(snapshots.some(file=>file.size>20*1024*1024)||snapshots.reduce((sum,file)=>sum+file.size,0)>200*1024*1024)throw new AccountDirectoryError('账号目录过大：单个快照最多 20 MiB，本次导入总计最多 200 MiB。');
  const documents=[];
  for(const file of snapshots){
    try{documents.push(JSON.parse(await file.text()));}
    catch{throw new AccountDirectoryError('目录中有无法读取的 snapshot.json；请检查文件是否完整，原数据未改动。');}
  }
  return prepareAccountDirectory(documents);
}
