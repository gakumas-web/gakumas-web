"""验证旧数据库升级、舞台与账号隔离、保留上限和账号清理。"""
import argparse
from playwright.sync_api import sync_playwright


def check(url):
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page()
        page.route('**/history-storage-probe',lambda route:route.fulfill(content_type='text/html',body='<!doctype html><title>Storage probe</title>'))
        page.goto(url.rstrip('/')+'/history-storage-probe')
        result=page.evaluate('''async()=>{
          const profile='account-synthetic-history-a',other='account-synthetic-history-b';
          await new Promise((resolve,reject)=>{const request=indexedDB.open('gakumas-web',2);request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('profiles');db.createObjectStore('snapshots',{keyPath:['profile','id']}).createIndex('profile','profile');const runs=db.createObjectStore('simulationRuns',{keyPath:['profile','id']});runs.createIndex('profile','profile');runs.createIndex('profileStage',['profile','stageKey']);};request.onsuccess=()=>{const db=request.result,tx=db.transaction('profiles','readwrite');tx.objectStore('profiles').put({snapshot:{memories:[]}},profile);tx.objectStore('profiles').put({snapshot:{memories:[]}},other);tx.oncomplete=()=>{db.close();resolve();};};request.onerror=()=>reject(request.error);});
          const storage=await import('./application/storage.mjs');
          if(!(await storage.workspaceData(profile)))throw Error('升级丢失原账号');
          const entry=(id,stageKey)=>({format:1,id,stageKey,createdAt:new Date(1700000000000+Number(id)*1000).toISOString(),result:{marker:'synthetic',minimumRun:{turns:[{events:[]}]},representative:{turns:[{events:[]}]},maximumRun:{turns:[{events:[]}]}}});
          const legacy={...entry('99','contest:1'),result:{marker:'legacy'}};
          let rejected=false;try{await storage.saveSimulationRun(profile,legacy,null);}catch{rejected=true;}if(!rejected)throw Error('接受了旧格式记录');
          await new Promise((resolve,reject)=>{const request=indexedDB.open('gakumas-web');request.onsuccess=()=>{const db=request.result,tx=db.transaction('simulationRuns','readwrite');tx.objectStore('simulationRuns').put({...legacy,profile});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);});
          if((await storage.simulationHistory(profile)).length||(await storage.simulationHistory(profile,'contest:1')).length)throw Error('读取了旧格式记录');
          await storage.deleteSimulationRun(profile,'99');
          for(let i=0;i<21;i++)await storage.saveSimulationRun(profile,entry(String(i),'contest:1'),null);
          await storage.saveSimulationRun(profile,entry('30','contest:2'),null);await storage.saveSimulationRun(other,entry('40','contest:1'),null);
          const first=await storage.simulationHistory(profile,'contest:1'),second=await storage.simulationHistory(profile,'contest:2');
          if(first.length!==20||first.some(row=>row.id==='0')||second.length!==1)throw Error('舞台保留范围错误');
          if((await storage.simulationHistory(other)).length!==1)throw Error('账号隔离错误');
          await storage.deleteSimulationRun(profile,'40');if((await storage.simulationHistory(other)).length!==1)throw Error('跨账号删除');
          const saved={format:1,id:'saved-a',name:'保留编组',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),loadout:{memories:[{},{}]}};
          await storage.saveSimulationLoadout(profile,saved,null);await storage.saveSimulationLoadout(other,saved,null);
          await storage.deleteSimulationLoadout('account-synthetic-missing',saved.id);
          if((await storage.savedSimulationLoadouts(profile)).length!==1||(await storage.savedSimulationLoadouts(other)).length!==1)throw Error('已保存编组账号隔离错误');
          const counts=await storage.accountDataSummary(profile);if(counts.loadouts!==1)throw Error('清理摘要缺失已保存编组');if(counts.simulations!==21)throw Error('清理摘要缺失模拟历史');
          await storage.clearAccountData(profile);
          if((await storage.savedSimulationLoadouts(profile)).length||(await storage.savedSimulationLoadouts(other)).length!==1)throw Error('已保存编组清理范围错误');
          if((await storage.simulationHistory(profile)).length||await storage.workspaceData(profile))throw Error('未清理当前账号');
          if((await storage.simulationHistory(other)).length!==1||!(await storage.workspaceData(other)))throw Error('误清理其他账号');
          // 已删除账号的普通保存入口同样拒绝写入，不依赖当前页签是否收到清理通知。
          for(const write of [()=>storage.saveSimulationRun(profile,entry('50','contest:1'),null),()=>storage.saveSimulationLoadout(profile,saved,null)]){
            let rejected=false;try{await write();}catch(error){rejected=error.code==='account_unavailable';}if(!rejected)throw Error('删除后仍接受账号写入');
          }
          // 正式控制器和真实 IndexedDB 复现删除中的迟到结果；只控制外部 Worker 返回时机。
          const raceLifecycle=await storage.saveAccountDirectory(profile,{snapshot:{publicUserId:'synthetic-history-a',memories:[]}});
          await new Promise((resolve,reject)=>{const request=indexedDB.open('gakumas-web');request.onsuccess=()=>{const db=request.result,tx=db.transaction('snapshots','readwrite');for(let i=0;i<1000;i++)tx.objectStore('snapshots').put({profile,id:'race-'+i,synthetic:true});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};request.onerror=()=>reject(request.error);});
          const {createContestSimulationController}=await import('./application/contest-simulation-controller.mjs');let finish;
          const promise=new Promise(resolve=>finish=resolve),events=[];
          const controller=createContestSimulationController({profile,lifecycleId:raceLifecycle,start:()=>({promise,cancel(){}}),onEvent:event=>events.push(event.type)});
          const running=controller.run({request:{},stage:{kind:'contest',id:'race'}},{runs:100,signature:'race'});
          const original=IDBDatabase.prototype.transaction;let armed=true;
          IDBDatabase.prototype.transaction=function(stores,mode,...args){const tx=original.call(this,stores,mode,...args);if(armed&&mode==='readwrite'&&Array.from(stores).includes('profiles')){armed=false;queueMicrotask(()=>finish(entry('51','contest:race').result));}return tx;};
          try{await storage.clearAccountData(profile);controller.dispose();await running;}
          finally{IDBDatabase.prototype.transaction=original;}
          if(!events.includes('completed'))throw Error('未覆盖结果完成与删除重叠');
          if((await storage.simulationHistory(profile)).length||(await storage.savedSimulationLoadouts(profile)).length||await storage.workspaceData(profile))throw Error('迟到写入重建孤立数据');
          // 新导入的有效账号仍可以正常保存，拒绝结果不污染后续事务。
          const currentLifecycle=await storage.saveAccountDirectory(profile,{selectionSnapshot:{publicUserId:'synthetic-history-a',selectionMemories:[]}});
          await storage.saveSimulationRun(profile,entry('52','contest:1'),currentLifecycle);await storage.saveSimulationLoadout(profile,saved,currentLifecycle);
          if((await storage.simulationHistory(profile)).length!==1||(await storage.savedSimulationLoadouts(profile)).length!==1)throw Error('新账号保存失败');
          if(!currentLifecycle||currentLifecycle===raceLifecycle)throw Error('账号重建没有更换生命周期');
          if(await storage.saveAccountDirectory(profile,{snapshot:{publicUserId:'synthetic-history-a',memories:[]}})!==currentLifecycle)throw Error('补充普通快照改变生命周期');
          const legacyLifecycle=await storage.saveAccountDirectory(other,{snapshot:{publicUserId:'synthetic-history-b',memories:[]}});
          if(legacyLifecycle!==null)throw Error('现有工作副本的生命周期被改写');
          await storage.saveSimulationRun(other,entry('41','contest:1'),legacyLifecycle);
          for(const identity of [undefined,raceLifecycle]){
            let rejected=false;try{await storage.saveSimulationRun(profile,entry('53','contest:1'),identity);}catch(error){rejected=error.code==='account_session_expired';}if(!rejected)throw Error('缺少或过期标识仍能保存');
          }
          const parallel='account-synthetic-parallel';
          const identities=await Promise.all([storage.saveAccountDirectory(parallel,{snapshot:{publicUserId:'synthetic-parallel',memories:[]}}),storage.saveAccountDirectory(parallel,{selectionSnapshot:{publicUserId:'synthetic-parallel',selectionMemories:[]}})]);
          if(!identities[0]||identities[0]!==identities[1])throw Error('并发首次导入生成不同生命周期');
          return true;

        }''')
        assert result
        browser.close()
    print('模拟历史数据库：版本升级、原账号保留、按舞台保留 20 次、账号隔离、精确删除和账号清理通过。')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8091/');args=parser.parse_args();check(args.url)
