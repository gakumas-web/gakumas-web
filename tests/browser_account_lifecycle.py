"""用两个真实页签验证删除通知及同名账号重建后的旧任务写入隔离。"""
import argparse
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import ROOT,fixtures


def check(url):
    with TemporaryDirectory(dir=ROOT/'local',prefix='account-lifecycle-') as temporary,sync_playwright() as p:
        folders={}
        for account in ['synthetic-lifecycle-a','synthetic-lifecycle-b']:
            folder=Path(temporary)/account;folders[account]=folder
            for name,document in copy.deepcopy(fixtures()).items():
                document['publicUserId']=account
                path=folder/name/'snapshot.json';path.parent.mkdir(parents=True);path.write_text(json.dumps(document))
        browser=p.chromium.launch();context=browser.new_context();page=context.new_page();writer=context.new_page();errors=[];uploads=[]
        context.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        for tab in [page,writer]:tab.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url,wait_until='networkidle')
        def import_account(account):
            page.locator('#account-directory-files').set_input_files(str(folders[account]));expect(page.locator('#profile')).to_be_enabled(timeout=60000);expect(page.locator('#profile')).to_have_value('account-'+account)
        import_account('synthetic-lifecycle-b');import_account('synthetic-lifecycle-a')
        writer.route('**/lifecycle-probe',lambda route:route.fulfill(content_type='text/html',body='<!doctype html><title>Lifecycle probe</title>'))
        writer.goto(url.rstrip('/')+'/lifecycle-probe')
        writer.evaluate('''async()=>{
          window.storage=await import('./application/storage.mjs');window.profile='account-synthetic-lifecycle-a';
          const {createContestSimulationController}=await import('./application/contest-simulation-controller.mjs');
          window.oldLifecycle=(await storage.workspaceData(profile)).lifecycleId;window.events=[];window.notifications=[];
          // 不改写控制器或数据库；只延迟外部 Worker 完成，以固定跨页签竞态。
          let finish;const promise=new Promise(resolve=>finish=resolve);window.finishOld=()=>finish({runs:100,scores:[1],minimumRun:{turns:[]},representative:{turns:[]},maximumRun:{turns:[]}});
          window.task=createContestSimulationController({profile,lifecycleId:oldLifecycle,start:()=>({promise,cancel(){}}),onEvent:event=>events.push({type:event.type,code:event.error?.code})});
          window.running=task.run({request:{},stage:{kind:'contest',id:'old-stage'}},{runs:100,signature:'old'});
          window.channel=new BroadcastChannel('gakumas-web:account-cleanup');channel.onmessage=async event=>notifications.push({profile:event.data.profile,deleted:!(await storage.workspaceData(event.data.profile))});
        }''')
        # 制造剩余账号恢复失败；删除事务本身仍必须成功并通知另一页签。
        page.evaluate('''async()=>{
          const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('gakumas-web');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
          try{await new Promise((resolve,reject)=>{const tx=db.transaction('profiles','readwrite'),store=tx.objectStore('profiles'),key='account-synthetic-lifecycle-b',request=store.get(key);request.onsuccess=()=>store.put({...request.result,snapshot:{...request.result.snapshot,publicUserId:'synthetic-mismatch'}},key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}finally{db.close();}
        }''')
        page.locator('#data-open').click();page.locator('#clear-account').click();expect(page.locator('#account-cleanup-confirmed')).to_be_enabled();page.locator('#account-cleanup-confirmed').check();page.locator('#confirm-account-cleanup').click()
        expect(page.locator('#account-cleanup-dialog')).to_contain_text('数据已清除，但页面刷新失败')
        writer.wait_for_function('notifications.length===1');assert writer.evaluate('notifications[0]')=={'profile':'account-synthetic-lifecycle-a','deleted':True}
        page.locator('#cancel-account-cleanup').click();import_account('synthetic-lifecycle-a')
        result=writer.evaluate('''async()=>{
          const current=(await storage.workspaceData(profile)).lifecycleId;if(!current||current===oldLifecycle)throw Error('同名账号复用了旧生命周期');
          finishOld();await running;
          const saved={format:1,id:'old-loadout',name:'synthetic',loadout:{memories:[{},{}]}};let oldRejected=false;
          try{await storage.saveSimulationLoadout(profile,saved,oldLifecycle);}catch(error){oldRejected=error.code==='account_session_expired';}
          const empty=(await storage.simulationHistory(profile)).length===0&&(await storage.savedSimulationLoadouts(profile)).length===0;
          await storage.saveSimulationRun(profile,{...task.entry,id:'new-result'},current);await storage.saveSimulationLoadout(profile,{...saved,id:'new-loadout'},current);
          const records=await storage.simulationHistory(profile),loadouts=await storage.savedSimulationLoadouts(profile);
          const {createAccountSessionManager}=await import('./application/account-session.mjs'),{captureAccountBackup}=await import('./application/account-package-store.mjs');
          const session=await createAccountSessionManager().restore(profile),backup=await captureAccountBackup(profile,{views:session.views,tab:session.tab,idolArt:session.idolArt},session.library.data);
          return {expired:events.some(event=>event.type==='save-failed'&&event.code==='account_session_expired'),oldRejected,empty,newWrites:records.length===1&&loadouts.length===1,metadataPrivate:!JSON.stringify({backup,records,loadouts}).includes('lifecycleId')};
        }''')
        assert all(result.values()),result
        assert not errors and not uploads,(errors,uploads);browser.close()
    print('跨页签删除通知不受恢复失败阻断，同名账号重建后拒绝旧模拟与编组写入，新会话可保存，生命周期元数据不进入备份或记录；无上传。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);check(parser.parse_args().url)
