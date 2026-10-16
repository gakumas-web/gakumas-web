"""以合成账号和正式界面验证计算门控，并保留未门控站点的竞争测量入口。"""

import argparse
import copy
import json
import math
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from browser_artifacts import artifact_path
from browser_contest_task_lifecycle import import_account, open_workspace, prepare_task, write_account
from browser_static import ROOT, fixtures


ACCOUNT = 'synthetic-compute-contention'
REPORT_DIR = ROOT/'local/checks/nextsteps-20261016'
PROBE = r'''() => {
  Object.defineProperty(navigator,'hardwareConcurrency',{value:8});
  localStorage.setItem('gakumas-web:recommendation-multicore','true');
  // 仅固定正式入口请求的单个 Uint32 随机种子；引擎、结果和消息交付保持原样。
  const random=crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues=value=>value instanceof Uint32Array&&value.length===1?(value[0]=73,value):random(value);
  const NativeWorker=Worker,heavy=new Set(['optimization-validate','simulation-batch','simulation-finish',
    'batch-scores','batch-card-effects','session-start','session-advance','session-finish']);
  const p=window.contentionProbe={workers:[],label:'setup',gaps:[],samples:[],started:0,last:0};
  p.sample=()=>{
    const live=p.workers.filter(w=>w.contest&&!w.ended),busy=live.filter(w=>w.pending&&heavy.has(w.mode));
    p.samples.push({time:performance.now(),alive:live.length,busy:busy.length,
      labels:[...new Set(busy.map(w=>w.label))],running:[...document.querySelectorAll('.season-simulation-task')]
        .filter(row=>[...row.querySelectorAll('button')].some(b=>b.textContent==='停止')).length});
  };
  p.reset=()=>{p.started=performance.now();p.last=p.started;p.gaps=[];p.samples=[];p.first=p.workers.length;p.sample();};
  p.snapshot=()=>({elapsed:performance.now()-p.started,gaps:p.gaps,samples:p.samples,
    workers:p.workers.slice(p.first).map(w=>({...w}))});
  setInterval(()=>{const now=performance.now();if(p.started){p.gaps.push(now-p.last);p.last=now;p.sample();}},20);
  window.Worker=class extends NativeWorker {
    constructor(...args){super(...args);this.record={id:p.workers.length,contest:String(args[0]).includes('contest-simulation-worker.mjs'),
      label:p.label,ended:false,pending:false,modes:[],messages:[],created:performance.now()};p.workers.push(this.record);
      this.addEventListener('message',({data})=>{const r=this.record;if(data.type!=='progress'){
        r.pending=false;const m=r.messages.at(-1);if(m){m.elapsed=performance.now()-m.at;m.type=data.type;
          m.scoreCount=data.result?.scores?.length;m.resultRuns=data.result?.runs;m.finite=data.result?.scores?.every(Number.isFinite);m.code=data.code;}
        p.sample();}});
    }
    postMessage(value,...args){const r=this.record;r.mode=value.mode;r.pending=true;r.modes.push(value.mode);
      r.messages.push({mode:value.mode,seed:value.seed,runs:value.runs,vocal:value.request?.params?.vocal,at:performance.now()});
      p.sample();return super.postMessage(value,...args);
    }
    terminate(){this.record.ended=true;this.record.pending=false;this.record.terminated=performance.now();p.sample();return super.terminate();}
  };
}'''


def prepare_account(page, temporary, request):
    setup = page.evaluate('''async request=>{
      await (await import('./application/master-loader.mjs')).loadMaster('contests');
      const c=await import('./domain/catalog.mjs'),idolCardId=request.cards[0].record.definition.originIdolCardId;
      const base=c.contestCatalog().choices.find(s=>s.preset?.id===request.stage.preset.id);
      const other=c.contestCatalog().choices.find(s=>s.kind==='contest'&&s.planType===base.planType&&
        s.preset&&!s.preset.preview&&s.id!==base.id&&s.seasonNumber<base.seasonNumber);
      let low=0,high=1000000000;while(low<high){const mid=Math.floor((low+high)/2);if(c.accountProducerLevel(mid)>=80)high=mid;else low=mid+1;}
      return {idolCardId,characterId:c.idolInfo({idolCardId}).characterId,producerExp:low,
        stages:[base,other].map(s=>({stageId:s.id,season:'contest:'+s.season.id}))};
    }''', request)
    docs = fixtures()
    for document in docs.values():
        document['publicUserId'] = ACCOUNT
    capture = docs['capture']
    base = capture['memories'][0]
    memories = []
    for index in [0, 1]:
        memory = copy.deepcopy(base)
        memory.update(userMemoryId=f'synthetic-contention-{index}', characterId=setup['characterId'],
                      idolCardId=setup['idolCardId'], grade=15, planType=2, **request['params'],
                      produceCard=request['cards'][0]['reference'],
                      examBattleProduceCards=[row['reference'] for row in request['cards']],
                      examBattleProduceItemIds=[row['id'] for row in request['items']])
        memories.append(memory)
    capture.update(memories=memories, count=2, producerExp=setup['producerExp'], supportCards=[])
    capture['idolCards'] = [dict(capture['idolCards'][0], idolCardId=setup['idolCardId'], levelLimitRank=3, potentialRank=2)]
    docs['selection']['selectionMemories'][0].update(characterId=setup['characterId'], idolCardId=setup['idolCardId'])
    folder = Path(temporary)/'account'
    write_account(folder, docs)
    import_account(page, folder, ACCOUNT)
    return setup['stages']


def summary(raw):
    gaps = sorted(raw['gaps'])
    samples = raw['samples']
    workers = [row for row in raw['workers'] if row['contest']]
    heavy = [row for row in workers if any(mode not in ['multipliers', 'suggest-parameters'] for mode in row['modes'])]
    overlap = [row for row in samples if len(row['labels']) > 1]
    return {'elapsed_ms': round(raw['elapsed'], 2), 'compute_workers_created': len(workers),
            'heavy_workers_created': len(heavy), 'peak_alive_workers': max(row['alive'] for row in samples),
            'peak_busy_heavy_workers': max(row['busy'] for row in samples),
            'active_workers_at_end': samples[-1]['alive'],
            'heartbeat_max_gap_ms': round(max(gaps, default=0), 2),
            'heartbeat_p95_gap_ms': round(gaps[max(0, math.ceil(len(gaps)*.95)-1)], 2) if gaps else 0,
            'heartbeat_samples': len(gaps), 'peak_running_ui_tasks': max(row['running'] for row in samples),
            'overlap_observed_ms': round(overlap[-1]['time']-overlap[0]['time'], 2) if overlap else 0,
            'worker_labels': sorted(set(row['label'] for row in heavy)),
            'heavy_task_duration_ms': {label: round(max(row.get('terminated', row['created']) for row in heavy if row['label']==label)-
                min(row['created'] for row in heavy if row['label']==label), 2) for label in set(row['label'] for row in heavy)},
            'real_completed_score_messages': sum(1 for row in heavy for message in row['messages']
                                                 if (message.get('scoreCount') or 0) > 0 and message.get('finite'))}


def short_preview(page):
    # 通过正式属性输入触发倍率控制器，计入去抖、Worker 启动和真实引擎换算。
    panel = page.locator('#contest-optimization')
    before = page.evaluate('contentionProbe.workers.length')
    busy_at_start = page.evaluate('contentionProbe.samples.at(-1)?.busy??0')
    started = page.evaluate('performance.now()')
    value = panel.locator('[data-optimization-attribute="vocal"]')
    value.fill(str(int(value.input_value())+1))
    page.wait_for_function('''before=>contentionProbe.workers.slice(before).some(w=>w.modes.includes('multipliers')&&w.ended&&
      w.messages.some(m=>m.mode==='multipliers'&&m.type==='result'))''', arg=before, timeout=30000)
    expect(panel.locator('[data-optimization-multiplier="vocal"]')).to_be_visible()
    result = page.evaluate('''({before,started})=>({ui_elapsed_ms:performance.now()-started,
      worker_elapsed_ms:contentionProbe.workers.slice(before).find(w=>w.modes.includes('multipliers')).messages
        .find(m=>m.mode==='multipliers').elapsed})''', {'before': before, 'started': started})
    return {**result, 'busy_heavy_workers_at_input': busy_at_start}


def stop_all(page):
    started = page.evaluate('performance.now()')
    while page.locator('.season-simulation-task').filter(has=page.get_by_role('button', name='停止', exact=True)).count():
        page.locator('.season-simulation-task').filter(has=page.get_by_role('button', name='停止', exact=True)).first.get_by_role('button', name='停止', exact=True).click()
    page.wait_for_function('()=>contentionProbe.workers.filter(w=>w.contest&&!w.ended).length===0', timeout=15000)
    return page.evaluate('started=>performance.now()-started', started)


def check_ungated(url, report_dir=REPORT_DIR, runs=4000, observe_ms=1200):
    request = json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['requests'][0]
    report_dir.mkdir(parents=True, exist_ok=True)
    report = {'url': url, 'controlled_hardware_concurrency': 8, 'fixed_entry_seed': 73,
              'selected_runs': runs, 'observation_window_ms': observe_ms,
              'scope': 'Synthetic account, real UI tasks and real Workers; no production scheduling changes.', 'cases': []}
    with TemporaryDirectory(dir=ROOT/'local', prefix='contest-contention-') as temporary, sync_playwright() as driver:
        browser = driver.chromium.launch(headless=True)
        try:
            for name in ['single-selected', 'dual-stages', 'dual-modes']:
                context = browser.new_context(viewport={'width': 1280, 'height': 1000})
                context.add_init_script('('+PROBE+')()')
                page = context.new_page()
                errors, uploads, private_requests = [], [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                def observe_request(value):
                    if value.method not in ['GET', 'HEAD'] or value.post_data:
                        uploads.append(value.url)
                    if ACCOUNT in value.url+(value.post_data or ''):
                        private_requests.append(value.url)
                context.on('request', observe_request)
                try:
                    page.goto(url, wait_until='networkidle')
                    stages = prepare_account(page, Path(temporary)/name, request)
                    for stage in stages:
                        prepare_task(page, stage, request, 'selected')
                        page.locator('#contest-simulation-run-number').fill(str(runs))
                    prepare_task(page, stages[1], request, 'optimization')
                    prepare_task(page, stages[0], request, 'optimization')
                    panel = page.locator('#contest-optimization')
                    # 使搜索持续覆盖观察窗口，仍通过较小且有上限的正式自定义预算。
                    for key, value in {'population': 8, 'generations': 8, 'samples': 4,
                                       'polishParents': 2, 'polishNeighbors': 4, 'polishRounds': 1,
                                       'polishRuns': 4, 'totalRunLimit': 2000}.items():
                        panel.locator(f'[data-optimization-budget="{key}"]').fill(str(value))
                    panel.locator('.optimization-settings input[max="4294967295"]').fill('73')
                    baseline_preview = short_preview(page)
                    open_workspace(page, stages[0], 'selected')
                    page.evaluate("()=>{contentionProbe.label='selected-A';contentionProbe.reset();}")
                    page.locator('.season-simulate').click()
                    page.wait_for_function("()=>contentionProbe.samples.some(s=>s.busy===4)")
                    if name == 'dual-stages':
                        open_workspace(page, stages[1], 'selected')
                        page.evaluate("contentionProbe.label='selected-B'")
                        page.locator('.season-simulate').click()
                    elif name == 'dual-modes':
                        open_workspace(page, stages[0], 'optimization')
                        page.evaluate("contentionProbe.label='optimization-A'")
                        panel.locator('.optimization-start').click()
                    if name != 'single-selected':
                        page.wait_for_function('()=>contentionProbe.samples.some(s=>s.labels.length===2&&s.running===2)', timeout=15000)
                    # 两个重任务运行时，另一舞台的可编辑表单继续走正式短预览。
                    preview_stage = stages[1] if name == 'dual-modes' else stages[0]
                    open_workspace(page, preview_stage, 'optimization')
                    loaded_preview = short_preview(page)
                    page.wait_for_timeout(observe_ms)
                    page.wait_for_function('()=>contentionProbe.workers.filter(w=>w.contest&&!w.ended).length===0', timeout=60000)
                    raw = page.evaluate('contentionProbe.snapshot()')
                    # 完成耗时和停止延迟分开测量，避免把已经完成的任务误报为取消成功。
                    open_workspace(page, stages[0], 'selected')
                    page.evaluate("()=>{contentionProbe.label='selected-A';contentionProbe.reset();}")
                    page.locator('.season-simulate').click()
                    if name == 'dual-stages':
                        open_workspace(page, stages[1], 'selected')
                        page.evaluate("contentionProbe.label='selected-B'")
                        page.locator('.season-simulate').click()
                    elif name == 'dual-modes':
                        open_workspace(page, stages[0], 'optimization')
                        page.evaluate("contentionProbe.label='optimization-A'")
                        panel.locator('.optimization-start').click()
                    expected_tasks = 1 if name == 'single-selected' else 2
                    page.wait_for_function('count=>contentionProbe.samples.at(-1).running===count&&contentionProbe.samples.at(-1).busy>=count*4', arg=expected_tasks)
                    active_before_stop = page.evaluate('contentionProbe.samples.at(-1)')
                    stop_ms = stop_all(page)
                    stopped = page.evaluate('contentionProbe.snapshot()')
                    item = {'name': name, **summary(raw), 'stop_all_ui_elapsed_ms': round(stop_ms, 2),
                            'stop_started_with_running_tasks': active_before_stop['running'],
                            'stop_started_with_busy_heavy_workers': active_before_stop['busy'],
                            'active_workers_after_stop': stopped['samples'][-1]['alive'],
                            'preview_idle': baseline_preview, 'preview_under_load': loaded_preview,
                            'page_errors': errors, 'uploads': uploads, 'private_requests': private_requests}
                    assert item['peak_busy_heavy_workers'] >= (4 if name == 'single-selected' else 8), item
                    if name != 'single-selected':
                        assert item['peak_running_ui_tasks'] == 2 and item['overlap_observed_ms'] > 0, item
                    assert not errors and not uploads and not private_requests, item
                    assert item['active_workers_at_end'] == 0, item
                    (report_dir/f'compute-contention-{name}-raw.json').write_text(json.dumps({'completion': raw, 'cancellation': stopped}, ensure_ascii=False, indent=2)+'\n')
                    report['cases'].append(item)
                    (report_dir/'compute-contention.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
                    print(json.dumps(item, ensure_ascii=False), flush=True)
                except Exception:
                    page.screenshot(path=artifact_path(str(report_dir/f'compute-contention-{name}-failure.png')), full_page=True)
                    raise
                finally:
                    context.close()
        finally:
            browser.close()
    return report


def check(url, report_dir=REPORT_DIR):
    request = json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['requests'][0]
    report_dir.mkdir(parents=True, exist_ok=True)
    report = {'url': url, 'controlled_hardware_concurrency': 8, 'cases': []}
    with TemporaryDirectory(dir=ROOT/'local', prefix='contest-gated-') as temporary, sync_playwright() as driver:
        browser = driver.chromium.launch(headless=True)
        try:
            for name in ['dual-stages', 'dual-modes']:
                context = browser.new_context(viewport={'width': 1280, 'height': 1000})
                context.add_init_script('('+PROBE+')()')
                page = context.new_page()
                errors, uploads = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                context.on('request', lambda value: uploads.append(value.url) if value.method not in ['GET', 'HEAD'] or value.post_data or ACCOUNT in value.url else None)
                try:
                    page.goto(url, wait_until='networkidle')
                    stages = prepare_account(page, Path(temporary)/name, request)
                    for stage in stages:
                        prepare_task(page, stage, request, 'selected')
                        page.locator('#contest-simulation-run-number').fill('4000')
                        prepare_task(page, stage, request, 'optimization')
                    open_workspace(page, stages[0], 'selected')
                    page.locator('#contest-simulation-run-number').fill('10000')
                    page.evaluate("()=>{contentionProbe.label='selected-A';contentionProbe.reset();}")
                    page.locator('.season-simulate').click()
                    page.wait_for_function('()=>contentionProbe.samples.at(-1).busy===4')
                    target_stage = stages[1] if name == 'dual-stages' else stages[0]
                    mode = 'selected' if name == 'dual-stages' else 'optimization'
                    open_workspace(page, target_stage, mode)
                    start = page.locator('.season-simulate' if mode == 'selected' else '.optimization-start')
                    page.evaluate("contentionProbe.label='waiting-B'")
                    start.click()
                    waiting = page.locator('.season-simulation-task[data-task-state="queued"]')
                    running = page.locator('.season-simulation-task[data-task-state="running"]')
                    expect(waiting).to_have_count(1)
                    expect(running).to_have_count(1)
                    expect(waiting).to_contain_text('等待执行')
                    assert not page.evaluate("contentionProbe.workers.some(w=>w.label==='waiting-B'&&w.modes.some(m=>m!=='multipliers'))")
                    waiting.get_by_role('button', name='取消等待', exact=True).click()
                    expect(waiting).to_have_count(0)
                    expect(running).to_have_count(1)
                    expect(start).to_be_enabled()
                    page.evaluate("contentionProbe.label='submitted-B'")
                    start.click()
                    expect(waiting).to_have_count(1)
                    if mode == 'selected':
                        # 等待期间通过 DOM 发出后续输入事件，验证已提交任务的快照不被表单漂移修改。
                        page.locator('#contest-simulation-run-number').evaluate("element=>{element.value='100';element.dispatchEvent(new Event('input',{bubbles:true}));}")
                        expected_runs = 4000
                    else:
                        expected_vocal = int(page.locator('[data-optimization-attribute="vocal"]').input_value())
                        page.locator('[data-optimization-attribute="vocal"]').evaluate("element=>{element.value='9999';element.dispatchEvent(new Event('input',{bubbles:true}));}")
                        expected_runs = 5
                    preview_stage = stages[1] if name == 'dual-modes' else stages[0]
                    open_workspace(page, preview_stage, 'optimization')
                    loaded_preview = short_preview(page)
                    expect(waiting).to_have_count(1)
                    expect(running).to_have_count(1)
                    assert loaded_preview['busy_heavy_workers_at_input'] == 4, loaded_preview
                    assert not page.evaluate("contentionProbe.workers.some(w=>w.label==='submitted-B'&&w.modes.some(m=>m!=='multipliers'))")
                    page.evaluate("contentionProbe.label='submitted-B'")
                    running.get_by_role('button', name='停止', exact=True).click()
                    expect(waiting).to_have_count(0)
                    page.wait_for_function("()=>contentionProbe.workers.some(w=>w.label==='submitted-B'&&w.modes.some(m=>m!=='multipliers'))")
                    page.wait_for_function('()=>contentionProbe.workers.filter(w=>w.contest&&!w.ended).length===0', timeout=60000)
                    raw = page.evaluate('contentionProbe.snapshot()')
                    heavy_b = [w for w in raw['workers'] if w['label'] == 'submitted-B' and any(m != 'multipliers' for m in w['modes'])]
                    if mode == 'selected':
                        actual_runs = sum(m.get('runs', 0) for w in heavy_b for m in w['messages'] if m['mode'] == 'simulation-batch')
                        assert actual_runs == expected_runs, actual_runs
                    else:
                        actual_vocals = [m['vocal'] for w in heavy_b for m in w['messages'] if m.get('vocal') is not None]
                        assert actual_vocals and all(v == expected_vocal for v in actual_vocals), actual_vocals
                        actual_runs = [m['resultRuns'] for w in heavy_b for m in w['messages'] if m['mode'] == 'session-finish']
                        assert actual_runs and all(v == expected_runs for v in actual_runs), actual_runs
                    item = {'name': name, **summary(raw), 'waiting_cancelled_without_worker': True,
                            'submitted_snapshot_preserved': True, 'preview_while_waiting': loaded_preview,
                            'page_errors': errors, 'uploads': uploads}
                    assert item['peak_busy_heavy_workers'] == 4, item
                    assert item['peak_running_ui_tasks'] == 1 and item['active_workers_at_end'] == 0, item
                    assert not errors and not uploads, item
                    report['cases'].append(item)
                    (report_dir/f'compute-gated-{name}-raw.json').write_text(json.dumps(raw, ensure_ascii=False, indent=2)+'\n')
                    (report_dir/'compute-gated.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
                    print(json.dumps(item, ensure_ascii=False), flush=True)
                except Exception:
                    page.screenshot(path=artifact_path(str(report_dir/f'compute-gated-{name}-failure.png')), full_page=True)
                    raise
                finally:
                    context.close()
        finally:
            browser.close()
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--report-dir', type=Path, default=REPORT_DIR)
    parser.add_argument('--runs', type=int, default=4000)
    parser.add_argument('--observe-ms', type=int, default=1200)
    parser.add_argument('--gated', action='store_true', dest='gated', default=True)
    parser.add_argument('--ungated', action='store_false', dest='gated', help='对未门控站点复现竞争基线')
    arguments = parser.parse_args()
    if arguments.gated:
        check(arguments.url, arguments.report_dir)
    else:
        check_ungated(arguments.url, arguments.report_dir, arguments.runs, arguments.observe_ms)
