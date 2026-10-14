"""验证评审指出的候选恢复、结果来源和模拟次数控制。"""
from browser_artifacts import artifact_path
import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]

def check(url):
 with sync_playwright() as p:
  browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[]
  page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda r:uploads.append(r.url) if r.post_data else None)
  # 仅注入一次 Worker 传输故障，重试仍执行正式候选审计。
  page.add_init_script("window.failAudit=true;const Original=Worker;window.Worker=class extends Original{postMessage(value,...rest){if(value.mode==='optimization-validate'&&window.failAudit){window.failAudit=false;queueMicrotask(()=>this.dispatchEvent(new ErrorEvent('error',{message:'synthetic transport failure'})));return;}return super.postMessage(value,...rest);}}")
  page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab=seasonSimulation]').click();page.locator('[data-mode=optimization]').click()
  retry=page.locator('.optimization-pool-retry');expect(retry).to_be_visible(timeout=30000);expect(retry).to_be_enabled();before=page.locator('.optimization-fields input,.optimization-fields select').evaluate_all('nodes=>nodes.map(n=>n.value)');retry.click();expect(page.locator('.optimization-fields')).to_be_enabled(timeout=30000);assert page.locator('.optimization-fields input,.optimization-fields select').evaluate_all('nodes=>nodes.map(n=>n.value)')==before
  for width in [1280,390,360]:
   page.set_viewport_size({'width':width,'height':1000});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.locator('.simulation-mode-tabs').screenshot(path=artifact_path(str(ROOT/f'local/review-065-optimization/tabs-{width}.png')))
  request=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['requests'][0]
  # 正式模拟生成结果，再以不同来源的历史副本验证同一控制器的展示。
  page.evaluate('''async request=>{
   const {startContestSimulation}=await import('./application/contest-simulation-client.mjs');
   const result=await startContestSimulation(request,{runs:100,seed:42}).promise;
   const {createContestSimulationPanel}=await import('./ui/contest-simulation-result.mjs');
   const {createSimulationRecord}=await import('./application/contest-simulation-history.mjs');
   window.reviewResult=result;window.reviewEntry=createSimulationRecord(request,request.stage,result);
   window.reviewPanel=createContestSimulationPanel({profile:null,stage:request.stage,getInput:()=>({request,stage:request.stage})});
   for(const child of document.body.children)if(child.tagName!=='SCRIPT')child.hidden=true;const host=document.createElement('div');host.id='review-host';host.append(reviewPanel.element);document.body.append(host);reviewPanel.update({available:true,signature:'review',stage:request.stage});
   window.reviewOriginal=JSON.stringify(reviewEntry);
   for(const commit of ['1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']){
    const entry=structuredClone(reviewEntry);entry.result.source.commit=commit;reviewPanel.restoreState({runs:'100',entry,signature:'review'});
    const link=document.querySelector('#review-host .simulation-heading-title a');if(link.textContent!==`GakumasTools · ${commit.slice(0,7)}`||link.title!==commit||!link.href.endsWith('/commit/'+commit))throw Error('source mismatch');
   }
   if(JSON.stringify(reviewEntry)!==reviewOriginal)throw Error('history mutated');
  }''',request)
  panel=page.locator('#review-host')
  runs=panel.locator('#contest-simulation-run-number');start=panel.locator('.season-simulate')
  for value in ['','0','101','10001']:
   runs.fill(value);expect(start).to_be_disabled();expect(runs).to_have_attribute('aria-invalid','true')
  panel.locator('.simulation-run-presets').get_by_role('button',name='500',exact=True).click();expect(runs).to_have_value('500');expect(start).to_be_enabled()
  panel.locator('#contest-simulation-runs').fill('200');panel.locator('#contest-simulation-runs').dispatch_event('input');expect(runs).to_have_value('200')
  start.click();expect(runs).to_be_disabled();expect(panel.locator('.simulation-run-presets button').first).to_be_disabled();expect(runs).to_be_enabled(timeout=60000)
  source=page.evaluate('reviewResult.source');link=panel.locator('.simulation-heading-title a');expect(link).to_have_attribute('title',source['commit']);expect(link).to_contain_text(source['commit'][:7])
  expect(panel.locator('[data-score=deviation]')).to_be_visible();expect(panel.locator('.simulation-extra-metrics')).to_have_count(0)
  for width in [1280,390,360]:
   page.set_viewport_size({'width':width,'height':1000});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=artifact_path(str(ROOT/f'local/review-065-optimization/result-{width}.png')))
  assert not errors and not uploads,(errors,uploads);browser.close()
 print('候选故障重试、历史来源同步、输入校验、运行锁定和结果分层通过。',flush=True)
