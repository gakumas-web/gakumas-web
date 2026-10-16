"""通过真实界面和正式 Worker 验证运行中任务的账号及快照隔离。"""

import argparse
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from browser_artifacts import artifact_path
from browser_simulation_helpers import select_season
from browser_static import ROOT, fixtures


ACCOUNTS = ['synthetic-task-lifecycle-a', 'synthetic-task-lifecycle-b']
MODES = ['recommended', 'optimization', 'selected']

# 只延迟正式 Worker 已产生的最终消息；生产入口、评分和结果内容保持原样。
WORKER_PROBE = '''() => {
  const NativeWorker=window.Worker;
  const probe=window.lifecycleProbe={workers:[],held:[],gate:null,privatePayload:false};
  probe.arm=mode=>{if(probe.held.length)throw Error('Unreleased worker message');probe.gate=mode;};
  probe.release=async()=>{
    probe.gate=null;const queued=probe.held.splice(0);
    const evidence=queued.map(({worker,event})=>({workerId:worker.record.id,
      terminated:worker.record.terminated,mode:worker.record.mode,
      runs:event.data.result.runs,scoreCount:event.data.result.scores.length}));
    // 销毁后故意交付已排队的旧回调，验证控制器的取消与过期过滤。
    for(const {worker,event,handler} of queued)handler.call(worker,event);
    await new Promise(resolve=>setTimeout(resolve,0));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return evidence;
  };
  window.Worker=class extends NativeWorker {
    constructor(...args){
      super(...args);
      this.record={id:probe.workers.length,contest:String(args[0]).includes('contest-simulation-worker.mjs'),terminated:false,modes:[]};
      probe.workers.push(this.record);
      super.addEventListener('message',event=>{
        const handler=this.lifecycleHandler;if(!handler)return;
        if(this.record.contest&&event.data.type==='result'&&this.record.mode===probe.gate){
          probe.held.push({worker:this,event,handler});return;
        }
        handler.call(this,event);
      });
    }
    set onmessage(handler){this.lifecycleHandler=handler;}
    get onmessage(){return this.lifecycleHandler;}
    postMessage(value,...args){
      this.record.mode=value.mode;this.record.modes.push(value.mode);
      if(/publicUserId|userMemoryId|synthetic-task-lifecycle/.test(JSON.stringify(value)))probe.privatePayload=true;
      return super.postMessage(value,...args);
    }
    terminate(){this.record.terminated=true;return super.terminate();}
  };
}'''


def write_account(folder, documents):
    for name, document in documents.items():
        target = folder/name/'snapshot.json'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(document), encoding='utf-8')


def storage_state(page):
    # 比较完整内容摘要，既保留合法旧历史，也能发现旧任务追加或覆盖记录。
    return page.evaluate('''async accounts=>{
      const storage=await import('./application/storage.mjs');
      const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(JSON.stringify(value))))].map(value=>value.toString(16).padStart(2,'0')).join('');
      return Object.fromEntries(await Promise.all(accounts.map(async account=>{
        const profile='account-'+account,history=await storage.simulationHistory(profile),loadouts=await storage.savedSimulationLoadouts(profile);
        return [account,{historyCount:history.length,loadoutCount:loadouts.length,
          historyDigest:await digest(history),loadoutDigest:await digest(loadouts)}];
      })));
    }''', ACCOUNTS)


def import_account(page, folder, account):
    page.locator('#account-directory-files').set_input_files(str(folder))
    expect(page.locator('#profile')).to_be_enabled(timeout=60000)
    expect(page.locator('#profile')).to_have_value('account-'+account)
    expect(page.locator('#message')).to_contain_text('账号目录已导入')


def open_workspace(page, setup, mode):
    page.locator('[data-tab="seasonSimulation"]').click()
    expect(page.locator('#season-simulation-page')).to_be_visible(timeout=60000)
    select_season(page, setup['season'])
    page.locator(f'.season-stage-tab[data-stage-id="{setup["stageId"]}"]').click()
    page.locator(f'.simulation-mode-tabs [data-mode="{mode}"]').click()


def prepare_task(page, setup, request, mode):
    open_workspace(page, setup, mode)
    if mode == 'selected':
        for index in [0, 1]:
            page.locator('.simulation-selected-panel .season-memory-slot-pick').nth(index).click()
            page.locator('.contest-memory-option[aria-disabled="false"] .contest-memory-choose').first.click()
        page.locator('#contest-simulation-run-number').fill('100')
        return page.locator('.season-simulate')
    panel = page.locator('#contest-'+('recommendations' if mode == 'recommended' else 'optimization'))
    if mode == 'recommended':
        return panel.locator('.recommendation-start')
    for index in [0, 1]:
        panel.locator(f'[data-slot="{index}"] .season-memory-slot-pick').click()
        page.locator(f'.optimization-picker [data-choice-id="{request["cards"][0]["reference"]["id"]}"]').click()
        page.locator('.optimization-picker-confirm').click()
        panel.locator(f'[data-optimization-grade="{index}"]').select_option('15')
    for key, value in request['params'].items():
        panel.locator(f'[data-optimization-attribute="{key}"]').fill(str(value))
    advanced = panel.locator('.optimization-advanced')
    if not advanced.evaluate('element=>element.open'):
        advanced.locator('summary').click()
    panel.locator('#optimization-strength').select_option('custom')
    budget = {'population': 4, 'generations': 2, 'samples': 2, 'polishParents': 1,
              'polishNeighbors': 2, 'polishRounds': 1, 'polishRuns': 2, 'reviewCandidates': 3,
              'screenRuns': 3, 'reviewRuns': 4, 'finalCandidates': 2, 'finalRuns': 5, 'totalRunLimit': 250000}
    for key, value in budget.items():
        panel.locator(f'[data-optimization-budget="{key}"]').fill(str(value))
    expect(panel.locator('#optimization-budget-error')).not_to_be_visible()
    return panel.locator('.optimization-start')


def wait_completed(page, mode):
    if mode == 'selected':
        expect(page.locator('.simulation-save-status')).to_have_text('已保存到此舞台的模拟历史。', timeout=120000)
        expect(page.locator('.contest-simulation-output [data-score="mean"] strong')).to_be_visible()
    else:
        panel = page.locator('#contest-'+('recommendations' if mode == 'recommended' else 'optimization'))
        expect(panel.locator('.recommendation-entry').first).to_be_visible(timeout=120000)
        expect(panel.locator('.recommendation-start' if mode == 'recommended' else '.optimization-start')).to_be_enabled()
    page.wait_for_function('''()=>lifecycleProbe.workers.every(worker=>worker.terminated||
      !worker.modes.some(mode=>['session-start','simulation-batch','batch-scores','batch-card-effects','optimization-validate'].includes(mode)))''')


def assert_empty_workspace(page):
    expect(page.locator('.recommendation-entry')).to_have_count(0)
    expect(page.locator('.contest-simulation-output [data-score]')).to_have_count(0)
    expect(page.locator('.season-simulation-task')).to_have_count(0)
    expect(page.locator('.season-stage-task-status')).to_have_count(0)
    expect(page.locator('.season-memory-board')).to_have_count(0)


def check(url, modes=MODES):
    request = json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['requests'][0]
    report = []
    (ROOT/'local').mkdir(exist_ok=True)
    with TemporaryDirectory(dir=ROOT/'local', prefix='contest-task-lifecycle-') as temporary, sync_playwright() as driver:
        browser = driver.chromium.launch(headless=True)
        try:
            for mode in modes:
                context = browser.new_context(viewport={'width': 1280, 'height': 1000})
                context.add_init_script('('+WORKER_PROBE+')()')
                page = context.new_page()
                errors, uploads, private_requests = [], [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                def observe_request(value):
                    if value.method not in ['GET', 'HEAD'] or value.post_data:
                        uploads.append(value.url)
                    if any(account in value.url+(value.post_data or '') for account in ACCOUNTS):
                        private_requests.append(value.url)
                context.on('request', observe_request)
                try:
                    page.goto(url, wait_until='networkidle')
                    setup = page.evaluate('''async request=>{
                      const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');
                      const catalog=await import('./domain/catalog.mjs'),idolCardId=request.cards[0].record.definition.originIdolCardId;
                      const stage=catalog.contestCatalog().choices.find(row=>row.preset?.id===request.stage.preset.id);
                      let low=0,high=1000000000;while(low<high){const mid=Math.floor((low+high)/2);if(catalog.accountProducerLevel(mid)>=80)high=mid;else low=mid+1;}
                      return {idolCardId,characterId:catalog.idolInfo({idolCardId}).characterId,
                        producerExp:low,stageId:stage.id,season:'contest:'+stage.season.id};
                    }''', request)
                    folders, documents = {}, {}
                    for account in ACCOUNTS:
                        docs = fixtures()
                        for document in docs.values():
                            document['publicUserId'] = account
                        capture = docs['capture']
                        base = capture['memories'][0]
                        memories = []
                        for index in [0, 1]:
                            memory = copy.deepcopy(base)
                            memory.update(userMemoryId=f'synthetic-lifecycle-{index}', characterId=setup['characterId'],
                                          idolCardId=setup['idolCardId'], grade=15, planType=2, **request['params'],
                                          produceCard=request['cards'][0]['reference'],
                                          examBattleProduceCards=[row['reference'] for row in request['cards']],
                                          examBattleProduceItemIds=[row['id'] for row in request['items']])
                            memories.append(memory)
                        capture.update(memories=memories, count=2, producerExp=setup['producerExp'], supportCards=[])
                        capture['idolCards'] = [dict(capture['idolCards'][0], idolCardId=setup['idolCardId'], levelLimitRank=3, potentialRank=2)]
                        docs['selection']['selectionMemories'][0].update(characterId=setup['characterId'], idolCardId=setup['idolCardId'])
                        folders[account] = Path(temporary)/mode/account
                        documents[account] = docs
                        write_account(folders[account], docs)
                    # 先经正式入口完成 B 账号任务，保留合法历史作为后续隔离检查的基线。
                    import_account(page, folders[ACCOUNTS[1]], ACCOUNTS[1])
                    prepare_task(page, setup, request, mode).click()
                    wait_completed(page, mode)
                    import_account(page, folders[ACCOUNTS[0]], ACCOUNTS[0])
                    for transition in ['account-switch', 'snapshot-update']:
                        start = prepare_task(page, setup, request, mode)
                        before = storage_state(page)
                        gate = 'simulation-finish' if mode == 'selected' else 'session-finish'
                        page.evaluate('mode=>lifecycleProbe.arm(mode)', gate)
                        expect(start).to_be_enabled()
                        start.click()
                        page.wait_for_function('()=>lifecycleProbe.held.length>0', timeout=120000)
                        expect(start).to_be_disabled()
                        expect(page.locator('.season-simulation-task')).to_have_count(1)
                        held = page.evaluate('''()=>lifecycleProbe.held.map(({event,worker})=>({
                          mode:worker.record.mode,runs:event.data.result.runs,scores:event.data.result.scores.length,
                          finite:event.data.result.scores.every(Number.isFinite),terminated:worker.record.terminated}))''')
                        assert all(row['scores'] > 0 and row['finite'] and not row['terminated'] for row in held), held
                        if transition == 'account-switch':
                            page.locator('#profile').select_option('account-'+ACCOUNTS[1])
                            expect(page.locator('#profile')).to_be_enabled(timeout=60000)
                            expect(page.locator('#profile')).to_have_value('account-'+ACCOUNTS[1])
                        else:
                            docs = copy.deepcopy(documents[ACCOUNTS[0]])
                            for document in docs.values():
                                document['captured_at'] = '2026-01-02T00:00:00Z'
                            docs['capture']['memories'][0]['vocal'] += 1
                            updated = Path(temporary)/mode/'updated'
                            write_account(updated, docs)
                            import_account(page, updated, ACCOUNTS[0])
                        open_workspace(page, setup, mode)
                        assert_empty_workspace(page)
                        delivered = page.evaluate('()=>lifecycleProbe.release()')
                        assert delivered and all(row['terminated'] for row in delivered), delivered
                        assert_empty_workspace(page)
                        assert storage_state(page) == before, (mode, transition, before, storage_state(page))
                        page.wait_for_function('''()=>lifecycleProbe.workers.every(worker=>worker.terminated||
                          !worker.modes.some(mode=>['session-start','simulation-batch','batch-scores','batch-card-effects','optimization-validate'].includes(mode)))''')
                        report.append({'mode': mode, 'transition': transition, 'actual_final_results': delivered,
                                       'workspace_empty': True, 'storage_unchanged': True})
                        if transition == 'account-switch':
                            page.locator('#profile').select_option('account-'+ACCOUNTS[0])
                            expect(page.locator('#profile')).to_be_enabled(timeout=60000)
                    # 新工作区继续使用真实任务，确认销毁旧会话没有误伤新会话。
                    prepare_task(page, setup, request, mode).click()
                    wait_completed(page, mode)
                    after = storage_state(page)
                    if mode == 'selected':
                        assert after[ACCOUNTS[0]]['historyCount'] == 1 and after[ACCOUNTS[1]]['historyCount'] == 1, after
                    else:
                        assert all(row['historyCount'] == 0 and row['loadoutCount'] == 0 for row in after.values()), after
                    assert not page.evaluate('lifecycleProbe.privatePayload')
                    assert not errors and not uploads and not private_requests, (errors, uploads, private_requests)
                    print(json.dumps({'mode': mode, 'transitions': 2, 'fresh_task_completed': True, 'page_errors': 0, 'uploads': 0}, ensure_ascii=False), flush=True)
                except Exception:
                    page.screenshot(path=artifact_path(str(ROOT/f'local/checks/review067-followup/task-lifecycle-{mode}-failure.png')), full_page=True)
                    raise
                finally:
                    context.close()
        finally:
            browser.close()
    return {'cases': report, 'fresh_tasks_completed': len(modes)*2, 'page_errors': 0, 'uploads': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--modes', nargs='+', choices=MODES, default=MODES)
    arguments = parser.parse_args()
    result = check(arguments.url, arguments.modes)
    report_path = artifact_path(str(ROOT/'local/checks/review067-followup/task-lifecycle.json'))
    report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
