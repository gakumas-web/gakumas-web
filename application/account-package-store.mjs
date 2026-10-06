import {parseLibrary,emptyLibrary,mergeLibraries} from '../domain/personal-library.mjs';
import {libraryKey} from './personal-library.mjs';
import {accountProfile,profileAccountId} from '../domain/account.mjs';
import {combineAccountDirectory} from '../domain/account-import.mjs';
import {workspaceData,snapshotHistory,saveAccountDirectory} from './storage.mjs';
import {snapshotId} from './history.mjs';
import {parseAccountBackup,AccountPackageError} from './account-package.mjs';

export async function captureAccountBackup(profile,preferences,library){
  const publicUserId=profileAccountId(profile);
  if(!publicUserId)throw new AccountPackageError('请先导入包含游戏账号 ID 的账号数据。');
  const [ordinary,selection,history]=await Promise.all([workspaceData(profile),workspaceData('selection:'+profile),snapshotHistory(profile)]);
  const snapshots=new Map(history.map(entry=>[entry.id,entry.snapshot]));
  const currentSnapshotId=ordinary?.snapshot?await snapshotId(ordinary.snapshot):null;
  if(currentSnapshotId)snapshots.set(currentSnapshotId,ordinary.snapshot);
  return parseAccountBackup({format:'gakumas-web-account-backup',version:1,publicUserId,exportedAt:new Date().toISOString(),
    currentSnapshotId,snapshots:[...snapshots.values()],
    selectionSnapshot:selection?.snapshot??null,library,preferences,
    savedViews:JSON.parse(localStorage.getItem(`gakumas-web:saved-views:${profile}`)??'[]')});
}

export async function importAccountBackup(input){
  const backup=await parseAccountBackup(input),profile=accountProfile(backup.publicUserId);
  const [ordinary,selection]=await Promise.all([workspaceData(profile),workspaceData('selection:'+profile)]);
  const ids=await Promise.all(backup.snapshots.map(snapshotId));
  const active=backup.snapshots[ids.indexOf(backup.currentSnapshotId)]??null;
  const plan=combineAccountDirectory({publicUserId:backup.publicUserId,snapshots:active?[active]:[],selections:backup.selectionSnapshot?[backup.selectionSnapshot]:[],details:backup.selectionSnapshot?.details??[]},
    {snapshot:ordinary?.snapshot,selectionSnapshot:selection?.snapshot});
  plan.history=[...(ordinary?.snapshot?[ordinary.snapshot]:[]),...backup.snapshots];
  const rawLibrary=localStorage.getItem(libraryKey(profile));
  const previousLibrary=rawLibrary?parseLibrary(JSON.parse(rawLibrary),profile):emptyLibrary(profile);
  const library=mergeLibraries(previousLibrary,backup.library);
  const settings=new Map([[libraryKey(profile),JSON.stringify(library)],[`gakumas-web:view:${profile}`,JSON.stringify(backup.preferences)],
    [`gakumas-web:saved-views:${profile}`,JSON.stringify(backup.savedViews)]]);
  await saveAccountDirectory(profile,plan,{settings});
  return {profile,...plan,preferences:backup.preferences};
}
