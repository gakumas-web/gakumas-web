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
          let rejected=false;try{await storage.saveSimulationRun(profile,legacy);}catch{rejected=true;}if(!rejected)throw Error('接受了旧格式记录');
          await new Promise((resolve,reject)=>{const request=indexedDB.open('gakumas-web');request.onsuccess=()=>{const db=request.result,tx=db.transaction('simulationRuns','readwrite');tx.objectStore('simulationRuns').put({...legacy,profile});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);});
          if((await storage.simulationHistory(profile)).length||(await storage.simulationHistory(profile,'contest:1')).length)throw Error('读取了旧格式记录');
          await storage.deleteSimulationRun(profile,'99');
          for(let i=0;i<21;i++)await storage.saveSimulationRun(profile,entry(String(i),'contest:1'));
          await storage.saveSimulationRun(profile,entry('30','contest:2'));await storage.saveSimulationRun(other,entry('40','contest:1'));
          const first=await storage.simulationHistory(profile,'contest:1'),second=await storage.simulationHistory(profile,'contest:2');
          if(first.length!==20||first.some(row=>row.id==='0')||second.length!==1)throw Error('舞台保留范围错误');
          if((await storage.simulationHistory(other)).length!==1)throw Error('账号隔离错误');
          await storage.deleteSimulationRun(profile,'40');if((await storage.simulationHistory(other)).length!==1)throw Error('跨账号删除');
          const saved={format:1,id:'saved-a',name:'保留编组',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),loadout:{memories:[{},{}]}};
          await storage.saveSimulationLoadout(profile,saved);await storage.saveSimulationLoadout(other,saved);
          await storage.deleteSimulationLoadout('account-synthetic-missing',saved.id);
          if((await storage.savedSimulationLoadouts(profile)).length!==1||(await storage.savedSimulationLoadouts(other)).length!==1)throw Error('已保存编组账号隔离错误');
          const counts=await storage.accountDataSummary(profile);if(counts.loadouts!==1)throw Error('清理摘要缺失已保存编组');if(counts.simulations!==21)throw Error('清理摘要缺失模拟历史');
          await storage.clearAccountData(profile);
          if((await storage.savedSimulationLoadouts(profile)).length||(await storage.savedSimulationLoadouts(other)).length!==1)throw Error('已保存编组清理范围错误');
          if((await storage.simulationHistory(profile)).length||await storage.workspaceData(profile))throw Error('未清理当前账号');
          if((await storage.simulationHistory(other)).length!==1||!(await storage.workspaceData(other)))throw Error('误清理其他账号');
          return true;
        }''')
        assert result
        browser.close()
    print('模拟历史数据库：版本升级、原账号保留、按舞台保留 20 次、账号隔离、精确删除和账号清理通过。')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8091/');args=parser.parse_args();check(args.url)
