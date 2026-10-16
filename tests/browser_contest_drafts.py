"""用合成账号验证草稿刷新恢复、编辑保护、账号隔离及真实 IndexedDB 事务。"""
import argparse
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect
from browser_artifacts import artifact_path
from browser_static import ROOT, fixtures
from browser_simulation_helpers import select_season


def check_storage(browser, url):
    context = browser.new_context()
    page = context.new_page()
    page.route('**/draft-storage-probe', lambda route: route.fulfill(content_type='text/html', body='<!doctype html><title>Draft storage probe</title>'))
    page.goto(url.rstrip('/')+'/draft-storage-probe')
    result = page.evaluate('''async()=>{
      const profile='account-synthetic-drafts-store',other='account-synthetic-drafts-other';
      await new Promise((resolve,reject)=>{const open=indexedDB.open('gakumas-web',3);open.onupgradeneeded=()=>{const db=open.result;db.createObjectStore('profiles');db.createObjectStore('snapshots',{keyPath:['profile','id']}).createIndex('profile','profile');const runs=db.createObjectStore('simulationRuns',{keyPath:['profile','id']});runs.createIndex('profile','profile');runs.createIndex('profileStage',['profile','stageKey']);db.createObjectStore('simulationLoadouts',{keyPath:['profile','id']}).createIndex('profile','profile');};open.onsuccess=()=>{const db=open.result,tx=db.transaction(['profiles','simulationLoadouts'],'readwrite');tx.objectStore('profiles').put({snapshot:{publicUserId:'synthetic-drafts-store',memories:[]},lifecycleId:'synthetic-lifecycle'},profile);tx.objectStore('simulationLoadouts').put({profile,id:'preserved',format:1,name:'preserved',updatedAt:new Date().toISOString(),loadout:{memories:[{},{}]} });tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};open.onerror=()=>reject(open.error);});
      const s=await import('./application/storage.mjs'),identity='synthetic-lifecycle';
      if((await s.savedSimulationLoadouts(profile)).length!==1)throw Error('升级丢失已保存编组');
      const otherIdentity=await s.saveAccountDirectory(other,{snapshot:{publicUserId:'synthetic-drafts-other',memories:[]}});
      const draft=(id,offset=0)=>({format:1,id,stage:{id:'synthetic-stage'},mode:'selected',updatedAt:new Date(Date.now()+offset).toISOString(),configuration:{}});
      await s.saveSimulationDraft(other,draft('other'),otherIdentity);
      await s.saveSimulationDraft(profile,draft('expired',-31*86400000),identity);
      if((await s.simulationDrafts(profile)).length)throw Error('过期草稿仍可见');
      for(let i=0;i<6;i++)await s.saveSimulationDraft(profile,draft('draft-'+i,i),identity);
      const kept=await s.simulationDrafts(profile);if(kept.length!==5||kept.some(entry=>entry.id==='draft-0'))throw Error('保留上限错误');
      let rejected=false;try{await s.saveSimulationDraft(profile,draft('stale'),identity,()=>false);}catch(error){rejected=error.code==='account_session_expired';}if(!rejected||(await s.simulationDrafts(profile)).some(entry=>entry.id==='stale'))throw Error('过期页面仍写入草稿');
      const loadout=id=>({format:1,id,name:id,updatedAt:new Date().toISOString(),loadout:{memories:[{},{}]}});
      try{await s.saveSimulationLoadouts(profile,[loadout('partial'),loadout('preserved')],identity);}catch{}
      if((await s.savedSimulationLoadouts(profile)).some(entry=>entry.id==='partial'))throw Error('批量冲突留下部分写入');
      try{await s.saveSimulationLoadouts(profile,[loadout('invalid-partial'),{format:1,id:'invalid'}],identity);}catch{}
      if((await s.savedSimulationLoadouts(profile)).some(entry=>entry.id==='invalid-partial'))throw Error('验证失败留下部分写入');
      await s.saveSimulationLoadouts(profile,[loadout('bulk-a'),loadout('bulk-b')],identity);
      if((await s.savedSimulationLoadouts(profile)).length!==3)throw Error('批量写入失败');
      if((await s.accountDataSummary(profile)).drafts!==5)throw Error('清理摘要遗漏草稿');
      await s.clearAccountData(profile);if((await s.simulationDrafts(profile)).length||(await s.simulationDrafts(other)).length!==1)throw Error('草稿账号清理范围错误');
      const newIdentity=await s.saveAccountDirectory(profile,{snapshot:{publicUserId:'synthetic-drafts-store',memories:[]}});
      rejected=false;try{await s.saveSimulationDraft(profile,draft('old-session'),identity);}catch(error){rejected=error.code==='account_session_expired';}if(!rejected||newIdentity===identity)throw Error('同名账号重建接受旧草稿');
      return {upgrade:true,retention:true,ttl:true,atomicImport:true,staleWrite:true,cleanup:true};
    }''')
    context.close()
    return result


def check(url):
    request = json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['customized']
    with TemporaryDirectory(dir=ROOT/'local', prefix='contest-drafts-') as temporary, sync_playwright() as p:
        browser = p.chromium.launch()
        storage_result = check_storage(browser, url)
        page = browser.new_page(viewport={'width':1280,'height':1000})
        errors, uploads = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda req: uploads.append(req.url) if req.post_data else None)
        page.add_init_script("window.draftSearchStarts=0;const NativeWorker=Worker;window.Worker=class extends NativeWorker{postMessage(value,...rest){if(['session-start','batch-engine','batch-fast','optimization'].includes(value?.mode))window.draftSearchStarts++;return super.postMessage(value,...rest);}};")
        page.goto(url, wait_until='networkidle')
        identity = page.evaluate('''async id=>{await(await import('./application/master-loader.mjs')).loadMaster('contests');return(await import('./domain/catalog.mjs')).idolInfo({idolCardId:id});}''', request['cards'][0]['record']['definition']['originIdolCardId'])
        docs = fixtures()
        memories = []
        for index in range(2):
            memory = copy.deepcopy(docs['capture']['memories'][0])
            memory.update(userMemoryId=f'synthetic-draft-memory-{index}',idolCardId=request['cards'][0]['record']['definition']['originIdolCardId'],characterId=identity['characterId'],planType=2,**request['params'],produceCard=request['cards'][0]['reference'],examBattleProduceCards=[row['reference'] for row in request['cards']],examBattleProduceItemIds=[row['id'] for row in request['items']])
            memories.append(memory)
        docs['capture'].update(memories=memories,count=2,producerExp=10000)
        docs['capture']['idolCards'][0]['idolCardId'] = memories[0]['idolCardId']
        folder = Path(temporary)/'account'
        for name, document in docs.items():
            document['publicUserId'] = 'synthetic-draft-ui'
            path = folder/name/'snapshot.json'
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(document))
        page.locator('#account-directory-files').set_input_files(str(folder))
        expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        page.locator('[data-tab="seasonSimulation"]').click()
        select_season(page,'contest:pvp_rate_config-53')
        page.locator('.season-stage-tab').first.click()
        page.locator('.simulation-mode-tabs [data-mode=selected]').click()
        for index in range(2):
            page.locator('.season-memory-slot-pick:visible').nth(index).click()
            page.locator('.contest-memory-choose:enabled').first.click()
        page.locator('#contest-simulation-run-number').fill('700')
        page.wait_for_function("async()=>{const rows=await(await import('./application/storage.mjs')).simulationDrafts(document.querySelector('#profile').value);return rows.some(row=>row.mode==='selected'&&row.configuration.selectedKeys.every(Boolean)&&row.configuration.runs==='700');}")
        page.locator('.simulation-mode-tabs [data-mode=optimization]').click()
        field = page.locator('[data-optimization-attribute=vocal]')
        expect(field).to_be_enabled(timeout=60000)
        field.fill('4321')
        page.locator('.optimization-advanced>summary').click()
        page.locator('#optimization-strength').select_option('custom')
        page.locator('[data-optimization-budget=population]').fill('7')
        page.wait_for_function("async()=>{const rows=await(await import('./application/storage.mjs')).simulationDrafts(document.querySelector('#profile').value);return rows.some(row=>row.mode==='optimization'&&row.configuration.optimization.params.vocal==='4321'&&row.configuration.optimization.customBudget.population==='7');}")
        stored = page.evaluate("async()=>{const rows=await(await import('./application/storage.mjs')).simulationDrafts(document.querySelector('#profile').value);return rows.find(row=>row.mode==='optimization');}")
        assert not any(key in json.dumps(stored) for key in ['reportContext','reportSignature','userMemoryId','publicUserId','scores','worker'])
        page.reload(wait_until='networkidle')
        expect(page.locator('#season-simulation-page')).to_be_visible(timeout=60000)
        recovery = page.locator('.contest-draft-recovery')
        target = recovery.locator(f'[data-draft-id="{stored["id"]}"]')
        expect(target).to_be_visible()
        expect(page.locator('.season-memory-board')).to_have_count(0)
        assert page.evaluate('window.draftSearchStarts') == 0
        target.get_by_role('button',name='恢复草稿',exact=True).click()
        expect(page.locator('[data-optimization-attribute=vocal]')).to_have_value('4321')
        expect(page.locator('[data-optimization-budget=population]')).to_have_value('7')
        expect(page.locator('.season-memory-board')).to_have_count(2)
        expect(recovery).to_contain_text('已恢复配置，请检查后手动开始。')
        assert page.evaluate('window.draftSearchStarts') == 0
        page.wait_for_function("async id=>!(await(await import('./application/storage.mjs')).simulationDrafts(document.querySelector('#profile').value)).some(row=>row.id===id)",arg=stored['id'])
        page.locator('[data-optimization-attribute=vocal]').fill('4322')
        page.wait_for_function("async()=>{const rows=await(await import('./application/storage.mjs')).simulationDrafts(document.querySelector('#profile').value);return rows.some(row=>row.mode==='optimization'&&row.configuration.optimization.params.vocal==='4322');}")
        stored = page.evaluate("async()=>{const rows=await(await import('./application/storage.mjs')).simulationDrafts(document.querySelector('#profile').value);return rows.find(row=>row.mode==='optimization');}")
        page.reload(wait_until='networkidle')
        expect(page.locator('#season-simulation-page')).to_be_visible(timeout=60000)
        select_season(page,'contest:pvp_rate_config-53')
        page.locator('.season-stage-tab').first.click()
        page.locator('.simulation-mode-tabs [data-mode=optimization]').click()
        expect(page.locator('[data-optimization-attribute=vocal]')).to_be_enabled(timeout=60000)
        page.locator('[data-optimization-attribute=vocal]').fill('9999')
        expect(recovery.locator(f'[data-draft-id="{stored["id"]}"]').get_by_role('button',name='恢复草稿',exact=True)).to_be_disabled()
        expect(recovery).to_contain_text('此舞台已有新配置，草稿不会覆盖当前填写。')
        expect(page.locator('[data-optimization-attribute=vocal]')).to_have_value('9999')
        for language in ['zh-CN','ja']:
            page.locator('#language').select_option(language)
            expect(recovery.get_by_role('heading',name='未完成配置草稿' if language=='zh-CN' else '未完了の設定下書き',exact=True)).to_be_visible()
            for width in [360,390]:
                page.set_viewport_size({'width':width,'height':1000})
                recovery.scroll_into_view_if_needed()
                assert recovery.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                recovery.screenshot(path=artifact_path(f'local/checks/nextsteps-20261016/drafts-{language}-{width}.png'))
        page.locator('#language').select_option('zh-CN')
        page.set_viewport_size({'width':1280,'height':1000})
        recovery.locator(f'[data-draft-id="{stored["id"]}"]').get_by_role('button',name='放弃草稿',exact=True).click()
        expect(recovery.locator(f'[data-draft-id="{stored["id"]}"]')).to_have_count(0)
        for name, document in docs.items():
            document['publicUserId'] = 'synthetic-draft-ui-other'
            (folder/name/'snapshot.json').write_text(json.dumps(document))
        page.locator('#account-directory-files').set_input_files(str(folder))
        expect(page.locator('#profile')).to_have_value('account-synthetic-draft-ui-other',timeout=60000)
        expect(page.locator('.contest-draft-recovery [data-draft-id]')).to_have_count(0)
        assert not errors and not uploads,(errors,uploads)
        browser.close()
    print(json.dumps({'storage':storage_result,'refresh_restore':True,'new_configuration_protected':True,'account_isolation':True,'automatic_search':False,'uploads':False},ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url',required=True)
    check(parser.parse_args().url)
