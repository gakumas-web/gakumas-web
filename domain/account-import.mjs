import {validPublicUserId} from './account.mjs';
import {prepareSnapshot,compareCapturedAt} from './model.mjs';
import {prepareSelectionSnapshot} from './selection-memories.mjs';
import {prepareSelectionDetail,mergeSelectionDetails} from './selection-details.mjs';

export class AccountDirectoryError extends Error {}
const byTime=(a,b)=>compareCapturedAt(a.captured_at,b.captured_at);
const latest=values=>values.filter(Boolean).sort(byTime).at(-1)??null;

// 账号以文件内公开 ID 为准，不依赖目录名，也不混用当前打开的其它账号。
export async function prepareAccountDirectory(documents){
  if(!documents.length)throw new AccountDirectoryError('所选目录没有 snapshot.json，请选择采集器的账号目录。');
  const publicUserId=documents[0]?.publicUserId;
  if(!validPublicUserId(publicUserId)||documents.some(document=>!validPublicUserId(document?.publicUserId)))throw new AccountDirectoryError('账号目录中的快照必须包含有效的游戏账号 ID。');
  if(documents.some(document=>document.publicUserId!==publicUserId))throw new AccountDirectoryError('所选目录包含多个游戏账号，请选择单个账号目录；原数据未改动。');
  const snapshots=[],selections=[],details=[];
  for(const document of documents){
    if(document.source==='user_get')snapshots.push(await prepareSnapshot(document));
    else if(document.source==='selection_memory_list')selections.push(await prepareSelectionSnapshot(document));
    else if(document.source==='selection_memory_get'){
      details.push(await prepareSelectionDetail(document));
    }
    else throw new AccountDirectoryError('目录中有无法识别的 snapshot.json；请检查采集文件，原数据未改动。');
  }
  return {publicUserId,snapshots:snapshots.sort(byTime),selections:selections.sort(byTime),details:details.sort(byTime)};
}

export function combineAccountDirectory(bundle,{snapshot=null,selectionSnapshot=null}={}){
  for(const previous of [snapshot,selectionSnapshot])if(previous&&previous.publicUserId!==bundle.publicUserId)throw new AccountDirectoryError('已有档案与导入目录的账号不匹配，已停止导入。');
  const next=latest([snapshot,...bundle.snapshots]),selection=latest([selectionSnapshot,...bundle.selections]);
  if(bundle.details.length&&!selection)throw new AccountDirectoryError('目录包含选拔详情，但没有同账号的选拔列表；请补充列表后重试。');
  const keys=new Set(selection?.selectionMemories.map(row=>row.key)??[]);
  const applicable=bundle.details.filter(detail=>keys.has(detail.key));
  const previousDetails=(selectionSnapshot?.details??[]).filter(detail=>keys.has(detail.key));
  const merged=selection?mergeSelectionDetails(selection,[...previousDetails,...applicable]):null;
  return {snapshot:next,selectionSnapshot:merged,
    history:[...(snapshot?[snapshot]:[]),...bundle.snapshots],
    ignoredDetails:new Set(bundle.details.filter(detail=>!keys.has(detail.key)).map(detail=>detail.key)).size};
}
