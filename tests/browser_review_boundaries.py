"""真实入口验收模拟次数、刷新恢复、备份与清理边界，以及中日窄屏。"""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_artifacts import artifact_path
from browser_static import fixtures,ROOT,ACCOUNT
from browser_simulation_helpers import select_season


def check(url,quick=False):
    request=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['requests'][0]
    with TemporaryDirectory(prefix='review-account-',dir=ROOT/'local') as temporary,sync_playwright() as p:
        browser=p.chromium.launch(headless=True);page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:uploads.append(r.url) if r.post_data or ACCOUNT in r.url or 'publicUserId=' in r.url else None)
        # 一次候选传输故障用于确认现有重试入口；重试后执行正式校验与搜索。
        page.add_init_script("window.failReviewAudit=true;const Native=Worker;window.Worker=class extends Native{postMessage(value,...rest){if(value.mode==='optimization-validate'&&window.failReviewAudit){window.failReviewAudit=false;queueMicrotask(()=>this.dispatchEvent(new ErrorEvent('error',{message:'synthetic candidate transport failure',cancelable:true})));return;}super.postMessage(value,...rest);}};")
        page.goto(url,wait_until='networkidle')
        setup=page.evaluate('''async request=>{
          const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');const c=await import('./domain/catalog.mjs');
          const idolCardId=request.cards[0].record.definition.originIdolCardId,stage=c.contestCatalog().choices.find(row=>row.preset?.id===request.stage.preset.id);
          let low=0,high=1000000000;while(low<high){const mid=Math.floor((low+high)/2);if(c.accountProducerLevel(mid)>=80)high=mid;else low=mid+1;}
          return {idolCardId,characterId:c.idolInfo({idolCardId}).characterId,producerExp:low,stageId:stage.id,season:'contest:'+stage.season.id};
        }''',request)
        docs=fixtures();capture=docs['capture'];memory=capture['memories'][0]
        memory.update(characterId=setup['characterId'],idolCardId=setup['idolCardId'],grade=15,planType=2,**request['params'],produceCard=request['cards'][0]['reference'],examBattleProduceCards=[row['reference'] for row in request['cards']],examBattleProduceItemIds=[row['id'] for row in request['items']])
        capture['idolCards']=[dict(capture['idolCards'][0],idolCardId=setup['idolCardId'],levelLimitRank=3,potentialRank=2)];capture['producerExp']=setup['producerExp'];capture['supportCards']=[]
        docs['selection']['selectionMemories'][0].update(characterId=setup['characterId'],idolCardId=setup['idolCardId'])
        folder=Path(temporary)/'account'
        for name,data in docs.items():
            path=folder/name/'snapshot.json';path.parent.mkdir(parents=True);path.write_text(json.dumps(data))
        page.locator('#account-directory-files').set_input_files(str(folder));expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        profile=page.locator('#profile').input_value()
        page.locator('[data-tab=seasonSimulation]').click();select_season(page,setup['season']);page.locator(f'.season-stage-tab[data-stage-id="{setup["stageId"]}"]').click();page.locator('[data-mode=optimization]').click()
        panel=page.locator('#contest-optimization');retry=panel.locator('.optimization-pool-retry');expect(retry).to_be_visible(timeout=30000)
        before=panel.locator('input,select').evaluate_all('nodes=>nodes.map(node=>node.value)');retry.click()
        expect(panel.locator('.optimization-fields')).to_be_enabled(timeout=60000)
        assert panel.locator('input,select').evaluate_all('nodes=>nodes.map(node=>node.value)')==before
        for index in [0,1]:
            panel.locator(f'[data-slot="{index}"] .season-memory-slot-pick').click();page.locator(f'.optimization-picker [data-choice-id="{request["cards"][0]["reference"]["id"]}"]').click();page.locator('.optimization-picker-confirm').click();panel.locator(f'[data-optimization-grade="{index}"]').select_option('15')
        for key,value in request['params'].items():panel.locator(f'[data-optimization-attribute="{key}"]').fill(str(value))
        page.set_viewport_size({'width':360,'height':1000})
        panel.locator('.optimization-total input').evaluate_all("nodes=>nodes.forEach(node=>node.style.fontSize='20px')")
        assert panel.locator('.optimization-total').evaluate('e=>e.scrollWidth<=e.clientWidth')
        panel.locator('.optimization-total').screenshot(path=artifact_path(str(ROOT/'local/checks/review-066-followup/attributes-large-text-360.png')))
        panel.locator('.optimization-total input').evaluate_all("nodes=>nodes.forEach(node=>node.style.fontSize='')")
        panel.locator('[data-slot="0"] .season-memory-slot-pick').click()
        assert page.locator('.optimization-picker').evaluate('e=>e.scrollWidth<=e.clientWidth')
        page.locator('.optimization-picker').screenshot(path=artifact_path(str(ROOT/'local/checks/review-066-followup/memory-picker-360.png')))
        page.locator('.optimization-picker-confirm').click();page.set_viewport_size({'width':1280,'height':1000})
        if quick:
            panel.locator('.optimization-advanced > summary').click();panel.locator('#optimization-strength').select_option('custom')
            for key,value in {'population':4,'generations':2,'samples':2,'polishParents':1,'polishNeighbors':2,'polishRounds':1,'polishRuns':2,'reviewCandidates':3,'screenRuns':3,'reviewRuns':4,'finalCandidates':2,'finalRuns':5}.items():panel.locator(f'[data-optimization-budget="{key}"]').fill(str(value))
        result_count=2 if quick else 20
        panel.locator('.optimization-start').click();expect(panel.locator('.optimization-entry')).to_have_count(result_count,timeout=300000)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        for width in [1280,390,360]:
            page.set_viewport_size({'width':width,'height':1000});assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth')
            panel.locator('.optimization-entry').first.screenshot(path=artifact_path(str(ROOT/f'local/checks/review-066-followup/results-{result_count}-{width}.png')))
        page.set_viewport_size({'width':1280,'height':1000})
        panel.locator('.optimization-entry').first.get_by_role('button',name='载入编组至自选模拟',exact=True).click()
        expect(page.locator('.loadout-local-notice')).to_contain_text('不包含在账号数据包中')
        page.locator('.simulation-run-presets').get_by_role('button',name='100',exact=True).click()
        expect(page.locator('#contest-simulation-runs')).to_have_value('100');expect(page.locator('#contest-simulation-run-number')).to_have_value('100')
        page.locator('.season-simulate').click()
        expect(page.locator('progress[aria-label="模拟进度"]')).to_have_attribute('max','100')
        expect(page.locator('.simulation-save-status')).to_have_text('已保存到此舞台的模拟历史。',timeout=60000)
        expect(page.locator('.simulation-result-caption')).to_contain_text('100 次模拟')
        first=page.evaluate("async profile=>(await(await import('./application/storage.mjs')).simulationHistory(profile)).map(row=>({id:row.id,runs:row.result.runs,scores:row.result.scores.length}))",profile)
        assert len(first)==1 and first[0]['runs']==first[0]['scores']==100,first
        page.locator('.season-loadout-save').click();dialog=page.locator('#contest-loadout-library')
        dialog.locator('#loadout-library-name').fill('评审验收编组');dialog.locator('.loadout-library-name-form').get_by_role('button',name='保存',exact=True).click();expect(dialog.locator('.loadout-library-status')).to_have_text('编组已保存。');dialog.locator('.dialog-head button').click()
        page.locator('.season-simulate').click()
        expect(page.locator('.simulation-save-status')).to_have_text('已保存到此舞台的模拟历史。',timeout=60000)
        stored=page.evaluate("async profile=>(await(await import('./application/storage.mjs')).simulationHistory(profile)).map(row=>({id:row.id,runs:row.result.runs,seed:row.result.seed,scores:row.result.scores}))",profile)
        assert len(stored)==2,stored
        page.reload(wait_until='networkidle');page.locator('[data-tab=seasonSimulation]').click();select_season(page,setup['season']);page.locator(f'.season-stage-tab[data-stage-id="{setup["stageId"]}"]').click();page.locator('[data-mode=history]').click()
        trace=page.evaluate("async profile=>({profile:document.querySelector('#profile').value,stage:document.querySelector('.season-stage-tab[aria-selected=true]')?.dataset.stageId,entries:(await(await import('./application/storage.mjs')).simulationHistory(profile)).map(row=>({id:row.id,stageKey:row.stageKey,stage:row.stage,runs:row.result.runs})),visible:[...document.querySelectorAll('.simulation-history-entry')].map(row=>row.dataset.historyId)})",profile)
        trace['beforeReload']=[{'id':row['id'],'runs':row['runs']} for row in stored]
        (ROOT/'local/checks/review-066-followup/history-trace.json').write_text(json.dumps(trace,ensure_ascii=False,indent=2)+'\n')
        expect(page.locator('.simulation-history-entry')).to_have_count(2)
        restored=page.evaluate("async profile=>(await(await import('./application/storage.mjs')).simulationHistory(profile)).map(row=>({id:row.id,runs:row.result.runs,seed:row.result.seed,scores:row.result.scores}))",profile)
        assert restored==stored
        page.locator('.simulation-history-entry').first.locator('[data-action=baseline]').click();expect(page.locator('.simulation-history-comparison')).to_be_visible()
        for width in [390,360]:
            page.set_viewport_size({'width':width,'height':1000});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.locator('.simulation-history-comparison').screenshot(path=artifact_path(str(ROOT/f'local/checks/review-066-followup/history-{width}.png')))
        page.set_viewport_size({'width':1280,'height':1000});page.locator('#data-open').click();page.locator('#export-account-package').click()
        expect(page.locator('.package-simulation-exclusion')).to_have_text('不包含：图片缓存、模拟历史、已保存的模拟编组、未完成配置草稿和技能卡转换设置。')
        with page.expect_download() as pending:page.locator('#package-download').click()
        downloaded=Path(temporary)/'backup.json';pending.value.save_as(downloaded)
        keys=page.evaluate("async envelope=>Object.keys(await(await import('./application/account-package.mjs')).decodeAccountPackage(envelope))",json.loads(downloaded.read_text()))
        assert 'simulationRuns' not in keys and 'simulationLoadouts' not in keys and 'simulationDrafts' not in keys
        if not page.locator('#data-dialog').is_visible():page.locator('#data-open').click()
        page.locator('#clear-account').click();warning=page.locator('.account-cleanup-simulation-warning').first;expect(warning).to_contain_text('模拟历史 2 条、已保存编组 1 条')
        expect(page.locator('#account-cleanup-summary')).to_contain_text('未完成配置草稿')
        for width in [390,360]:
            page.set_viewport_size({'width':width,'height':1000});assert page.locator('#account-cleanup-dialog').evaluate('e=>e.scrollWidth<=e.clientWidth')
            page.locator('#account-cleanup-dialog').screenshot(path=artifact_path(str(ROOT/f'local/checks/review-066-followup/cleanup-{width}.png')))
        page.evaluate("async()=>{(await import('./i18n.mjs')).setLocale('ja')}");expect(warning).to_contain_text('データパック')
        page.locator('#account-cleanup-dialog').screenshot(path=artifact_path(str(ROOT/'local/checks/review-066-followup/cleanup-ja-360.png')))
        page.locator('#cancel-account-cleanup').click()
        counts=page.evaluate("async profile=>(await import('./application/storage.mjs')).accountDataSummary(profile)",profile)
        assert counts['simulations']==2 and counts['loadouts']==1
        # 新的浏览器上下文只通过真实数据包导入，明确核对模拟内容没有被恢复。
        target_context=browser.new_context();target=target_context.new_page()
        target.on('request',lambda r:uploads.append(r.url) if r.post_data or ACCOUNT in r.url or 'publicUserId=' in r.url else None);target.on('pageerror',lambda e:errors.append(str(e)))
        target.goto(url,wait_until='networkidle');target.locator('#account-package-file').set_input_files(str(downloaded))
        expect(target.locator('#package-apply')).to_be_visible();target.locator('#package-apply').click()
        expect(target.locator('#account-package-dialog')).to_be_hidden(timeout=60000);expect(target.locator('#profile')).to_have_value(profile)
        migrated=target.evaluate("async profile=>(await import('./application/storage.mjs')).accountDataSummary(profile)",profile)
        assert migrated['memories']==counts['memories'] and migrated['simulations']==0 and migrated['loadouts']==0 and migrated['drafts']==0
        target_context.close()
        assert not errors and not uploads,(errors,uploads)
        (ROOT/'local/checks/review-066-followup/boundaries.json').write_text(json.dumps({'recommendations':result_count,'candidateRetryPreservedInputs':True,'runs':100,'historyAfterReload':2,'savedLoadouts':1,'exportedKeys':keys,'cleanupCancelled':True,'migratedSimulationCounts':[migrated['simulations'],migrated['loadouts']],'widths':[1280,390,360],'largeInputFontPx':20,'uploads':uploads,'pageErrors':errors},ensure_ascii=False,indent=2)+'\n')
        browser.close()
    print(f'{result_count} 个真实推荐结果、100 次输入到历史一致性、刷新恢复、备份范围、清理数量与中日窄屏通过。')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);parser.add_argument('--quick',action='store_true',help='复用完整预设证据，只重验后续页面流程');args=parser.parse_args();check(args.url,args.quick)
