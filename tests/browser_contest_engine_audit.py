"""验证候选池前置审计、固定道具失败时零评分，以及引擎来源版本署名。"""
from playwright.sync_api import sync_playwright,expect


def check(url):
 with sync_playwright() as p:
  browser=p.chromium.launch();page=browser.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  page.add_init_script("window.auditScores=0;window.auditChecks=0;const OriginalWorker=Worker;window.Worker=class extends OriginalWorker{postMessage(value,...rest){if(value.mode==='optimization-validate')window.auditChecks++;if(value.mode==='batch-scores')window.auditScores++;return super.postMessage(value,...rest);}}")
  page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab="seasonSimulation"]').click();page.locator('[data-mode="optimization"]').click()
  expect(page.locator('.optimization-fields')).to_be_enabled(timeout=30000);expect(page.locator('.optimization-pool-audit')).to_have_count(0);assert page.evaluate('auditChecks')>0
  metadata=page.evaluate("async()=>{const {contestEngineMap}=await import('./domain/contest-engine-map.mjs');return contestEngineMap.source}")
  credit=page.locator(f'a[href="https://github.com/{metadata["repository"]}/commit/{metadata["commit"]}"]');expect(credit).to_contain_text(metadata['commit'][:7]);expect(credit).to_have_attribute('title',metadata['commit'])
  code=page.evaluate("""async()=>{const {startContestOptimization,OPTIMIZATION_BUDGETS}=await import('./application/contest-optimization-client.mjs');const input={probes:[{key:'item:synthetic-missing-fixed',kind:'item',entry:{id:'synthetic-missing-fixed',record:null}}],fixedProbes:['item:synthetic-missing-fixed']};try{await startContestOptimization({input,stage:{}},{budget:{...OPTIMIZATION_BUDGETS.standard,population:1}}).promise;return 'unexpected-success';}catch(error){return error.code;}}""")
  assert code=='optimization_unsupported_fixed' and page.evaluate('auditScores')==0
  assert not errors,errors;browser.close()
 print('候选池前置检查、固定道具零评分失败和锁定引擎提交署名通过。')
