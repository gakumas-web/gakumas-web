"""用真实 Worker 检查分阶段推荐、统计排名、停止、历史与载入保存。"""
from browser_artifacts import artifact_path
import copy
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import fixtures,ROOT
from browser_simulation_helpers import select_season


def check(url='http://127.0.0.1:18765/'):
    request=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['customized'];compatible=json.loads((ROOT/'tests/fixtures/public-data/contest-customization-compatibility.json').read_text())
    with TemporaryDirectory(dir=ROOT/'local',prefix='recommendations-') as temporary,sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda value:uploads.append(value.url) if value.post_data else None)
        page.add_init_script('''Object.defineProperty(navigator,'hardwareConcurrency',{value:8});window.__activeWorkers=0;window.__workerPeak=0;window.__workerPrivate=false;window.__workerRequests=[];const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.simulationWorker=String(args[0]).endsWith('/contest-simulation-worker.mjs');if(this.simulationWorker){window.__activeWorkers++;window.__workerPeak=Math.max(window.__workerPeak,window.__activeWorkers);}}postMessage(value,...args){if(this.simulationWorker)window.__workerRequests.push({mode:value.mode,runs:value.runs,offset:value.offset});if(/userMemoryId|publicUserId|synthetic-recommend-memory/.test(JSON.stringify(value)))window.__workerPrivate=true;super.postMessage(value,...args);}terminate(){if(this.simulationWorker&&!this.ended){this.ended=true;window.__activeWorkers--;}super.terminate();}};''')
        page.goto(url,wait_until='networkidle')
        identity=page.evaluate('''async id=>{const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');const {idolInfo}=await import('./domain/catalog.mjs');return idolInfo({idolCardId:id})}''',request['cards'][0]['record']['definition']['originIdolCardId'])
        docs=fixtures();base=docs['capture']['memories'][0];memories=[]
        for index in range(9):
            memory=copy.deepcopy(base);memory.update(userMemoryId=f'synthetic-recommend-memory-{index}',idolCardId=request['cards'][0]['record']['definition']['originIdolCardId'],characterId=identity['characterId'],planType=2,**request['params'],produceCard=request['cards'][0]['reference'],examBattleProduceCards=[entry['reference'] for entry in request['cards']],examBattleProduceItemIds=[entry['id'] for entry in request['items']]);memory['vocal']+=index*97;memory['dance']+=index*index*7;memories.append(memory)
        for memory in memories:
            memory['examBattleProduceCards'][2]=compatible['card']['reference'];memory['examBattleProduceItemIds'].append(compatible['supportItem']['id'])
        memories[5]['examBattleProduceItemIds']=[];memories[6]['examBattleProduceItemIds']=[entry['id'] for entry in request['items']]
        memories[-1]['examBattleProduceCards'].append({'id':'synthetic-unsupported-card','upgradeCount':0,'customizes':[]})
        other=copy.deepcopy(memories[0]);other.update(userMemoryId='synthetic-recommend-memory-other',characterId='ttmr');memories.append(other)
        docs['capture'].update(memories=memories,count=len(memories));docs['capture']['idolCards'][0]['idolCardId']=memories[0]['idolCardId']
        folder=Path(temporary)/'account'
        for name,document in docs.items():
            file=folder/name/'snapshot.json';file.parent.mkdir(parents=True);file.write_text(json.dumps(document))
        page.locator('#account-directory-files').set_input_files(str(folder));expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab="seasonSimulation"]').click();select_season(page,'contest:pvp_rate_config-53');page.locator('.season-stage-tab').first.click()
        multi_core=page.get_by_role('checkbox',name='模拟开启多核加速',exact=True);expect(multi_core).not_to_be_checked();assert multi_core.locator('xpath=../..').get_by_role('heading',name='舞台模拟',exact=True).count()==1;multi_core.check()
        page.get_by_role('tab',name='回忆编组搜索',exact=True).click();dialog=page.locator('#contest-recommendations');expect(dialog).to_be_visible();assert page.locator('dialog:modal').count()==0;assert dialog.get_by_role('radiogroup',name='模拟偶像(按回忆持有数排序)').count()==1;expect(dialog.locator('.recommendation-description')).to_have_text('使用当前舞台与持有回忆，所有符合偶像与计划条件的回忆都参与主副组合。');assert dialog.locator('.recommendation-content').evaluate('e=>e.firstElementChild.classList.contains("recommendation-description")');expect(dialog.locator('.recommendation-algorithm')).not_to_have_attribute('open','');expect(dialog.locator('.recommendation-algorithm')).to_contain_text('4 → 16 → 64');expect(dialog.locator('.recommendation-algorithm')).to_contain_text('2000');expect(dialog.locator('.recommendation-algorithm')).to_contain_text('前三名竞争接近')
        selected_tab=page.get_by_role('tab',name='自选模拟',exact=True)
        expect(page.locator('.season-memory-results')).not_to_be_visible()
        selected_tab.click();expect(page.locator('.season-memory-results')).to_be_visible();expect(dialog).not_to_be_visible()
        selected_tab.press('Home');expect(dialog).to_be_visible();expect(page.get_by_role('tab',name='回忆编组搜索',exact=True)).to_be_focused()
        assert page.locator('.simulation-mode-tabs').evaluate('e=>e.previousElementSibling.classList.contains("simulation-section-intro")')
        idol=dialog.get_by_role('radiogroup',name='模拟偶像(按回忆持有数排序)',exact=True);idol.locator('[data-character-id=ttmr]').click();expect(dialog.locator('.recommendation-start')).to_be_disabled();idol.locator(f'[data-character-id="{identity["characterId"]}"]').click();expect(dialog.locator('.recommendation-start')).to_be_enabled()
        page.evaluate('''()=>{window.__phases=[];const node=document.querySelector('.recommendation-status');new MutationObserver(()=>{for(const phase of ['牌效粗筛','牌效初筛','复筛','最终复评'])if(node.textContent.startsWith(phase)&&!window.__phases.includes(phase))window.__phases.push(phase);}).observe(node,{childList:true,subtree:true,characterData:true});}''')
        dialog.locator('.recommendation-start').click();expect(dialog.locator('.recommendation-summary')).to_contain_text('推荐 10 组',timeout=600000)
        assert page.evaluate('window.__phases')==['牌效粗筛','牌效初筛','复筛','最终复评'];assert page.evaluate('window.__activeWorkers')==0;assert page.evaluate('window.__workerPeak')==4;assert not page.evaluate('window.__workerPrivate')
        expect(dialog.locator('.recommendation-characters legend')).to_contain_text('持有 9 条回忆');expect(dialog.locator('.recommendation-count')).to_have_text('按回忆持有数排序');expect(dialog.locator('.recommendation-entry')).to_have_count(10);expect(dialog.locator('[data-metric=mean]')).to_have_count(10);expect(dialog.locator('[data-metric=median]')).to_have_count(10);expect(dialog.locator('[data-metric=deviation]')).to_have_count(10);expect(dialog.locator('[data-metric=p75],[data-metric=p25]')).to_have_count(0);expect(dialog.locator('[data-metric=downside]')).to_have_count(0);expect(page.locator('.simulation-score-note')).to_contain_text('0.25 × 上行波动 − 0.25 × 下行波动');expect(dialog.locator('.recommendation-skipped > summary')).to_have_text('16 种配置无法完整模拟，未参与推荐。')
        scores=dialog.locator('.recommendation-entry').evaluate_all('(nodes)=>nodes.map(e=>Number(e.dataset.score))');assert scores==sorted(scores,reverse=True)
        assert dialog.locator('.recommendation-entry').evaluate_all('(nodes)=>nodes.every(e=>e.dataset.main!==e.dataset.sub&&Number(e.dataset.main)<8&&Number(e.dataset.sub)<8)')
        records=page.evaluate("async()=>{const {simulationHistory}=await import('./application/storage.mjs');return simulationHistory(document.querySelector('#profile').value)}")
        assert records==[],records
        combinations=int(re.findall(r'\d+',dialog.locator('.recommendation-summary').inner_text())[1])
        batches=page.evaluate("window.__workerRequests.filter(r=>r.mode.startsWith('batch-'))")
        assert len([r for r in batches if r['offset']==0 and r['runs']==4])==combinations
        assert len([r for r in batches if r['offset']==4 and r['runs']==12])==40
        assert len([r for r in batches if r['offset']==16 and r['runs']==48])==40
        assert len(batches)==combinations+80
        assert page.evaluate("window.__workerRequests.filter(r=>r.mode==='session-start').length")==20
        advances=page.evaluate("window.__workerRequests.filter(r=>r.mode==='session-advance')")
        assert advances and all(r['runs']==2000 for r in advances),advances
        print('4→16→64真实引擎推荐、累计前缀、20组最终轮、前十排名和不自动写入历史通过。',flush=True)
        expect(dialog.locator('.loadout-library-preview').first).to_be_visible();assert dialog.locator('.recommendation-loadout>summary').count()==0;assert dialog.locator('[data-metric=variance]').count()==0;expect(dialog.locator('[data-metric=score] strong').first).to_have_attribute('title',re.compile(r'.*÷ 2 \+ 0\.25 × .* − 0\.25 × .*≈.*',re.S))
        for width in [1280,375,320]:
            page.set_viewport_size({'width':width,'height':1000});assert dialog.evaluate('e=>e.scrollWidth<=e.clientWidth');assert page.locator('.simulation-mode-tabs').evaluate('e=>e.scrollWidth<=e.clientWidth');dialog.screenshot(path=artifact_path(f'local/ui-visual-refinement/recommendations-{width}.png'))
        dialog.locator('.recommendation-entry [data-action="save"]').first.click();library=page.locator('#contest-loadout-library');expect(library).to_be_visible();assert page.locator('dialog:modal').count()==1;library.locator('#loadout-library-name').fill('推荐第一名');library.locator('.loadout-library-name-form').get_by_role('button',name='保存',exact=True).click();expect(library.locator('.loadout-library-status')).to_have_text('编组已保存。');library.locator('.dialog-head button').click()
        page.get_by_role('tab',name='回忆编组搜索',exact=True).click();expect(dialog.locator('.recommendation-entry')).to_have_count(10);dialog.locator('.recommendation-entry [data-action="load"]').first.click();expect(dialog).not_to_be_visible();expect(page.locator('.season-memory-board')).to_have_count(2);expect(page.locator('.season-simulate')).to_be_enabled()
        page.evaluate('window.__workerPeak=0')
        page.locator('.season-simulate').click();simulation=page.locator('#contest-simulation-result')
        expect(simulation.locator('.simulation-save-status')).to_have_text('已保存到此舞台的模拟历史。',timeout=120000)
        records=page.evaluate("async()=>{const {simulationHistory}=await import('./application/storage.mjs');return simulationHistory(document.querySelector('#profile').value)}")
        assert len(records)==1 and records[0]['result']['runs']==500
        assert page.evaluate('window.__workerPeak')==4 and page.evaluate('window.__activeWorkers')==0
        page.get_by_role('tab',name='回忆编组搜索',exact=True).click();dialog.locator('.recommendation-start').click();dialog.locator('.recommendation-stop').click();expect(dialog.locator('.recommendation-status')).to_have_text('推荐已停止，保留上次完成结果。');expect(dialog.locator('.recommendation-entry')).to_have_count(10);assert page.evaluate('window.__activeWorkers')==0
        dialog.locator('.recommendation-start').click();selected_tab.click();expect(dialog).not_to_be_visible();assert page.evaluate('window.__activeWorkers')>0
        page.get_by_role('tab',name='回忆编组搜索',exact=True).click();dialog.locator('.recommendation-stop').click();expect(dialog.locator('.recommendation-status')).to_have_text('推荐已停止，保留上次完成结果。');assert page.evaluate('window.__activeWorkers')==0
        select_season(page,'event:1:1');page.get_by_role('tab',name='回忆编组搜索',exact=True).click();expect(dialog.locator('.recommendation-start')).to_be_disabled();expect(dialog.locator('.recommendation-status')).to_have_text('请先填写此舞台的 Vo、Da、Vi 比赛倍率。');selected_tab.click()
        small=page.evaluate('''async memories=>{
          const {contestCatalog}=await import('./domain/catalog.mjs');const {startContestRecommendations}=await import('./application/contest-recommendation-client.mjs');
          const stage=contestCatalog().choices.find(s=>s.kind==='contest'&&s.seasonNumber===53&&s.stageNumber===1),progress=[];
          const report=await startContestRecommendations({memories,stage,supportCards:[]},{seed:123,onProgress:p=>progress.push(p)}).promise;
          return {rows:report.rows.map(r=>({runs:r.stats.runs,seed:r.result.seed,scores:r.result.scores.length,detailRuns:r.result.detailRuns})),totalRuns:report.totalRuns,phases:[...new Set(progress.map(p=>p.phase))]};
        }''',memories[5:7])
        # 两条回忆分别没有 P 道具、只有专属 P 道具，均须通过真实推荐入口完成主位模拟。
        assert len(small['rows'])==2 and small['phases']==['final']
        assert all(r['seed']==(123^0x9e3779b9) and r['runs']==r['scores'] for r in small['rows'])
        assert small['totalRuns']==sum(r['runs']+r['detailRuns'] for r in small['rows'])
        assert page.evaluate('window.__activeWorkers')==0
        medium_memories=[]
        for i in range(6):
            m=copy.deepcopy(memories[0]);m.update(key=f'synthetic-medium-{i}',vocal=memories[0]['vocal']+101*i);medium_memories.append(m)
        medium=page.evaluate('''async memories=>{
          const {contestCatalog}=await import('./domain/catalog.mjs');const {startContestRecommendations}=await import('./application/contest-recommendation-client.mjs');
          const stage=contestCatalog().choices.find(s=>s.kind==='contest'&&s.seasonNumber===53&&s.stageNumber===1);window.__workerRequests=[];window.__workerPeak=0;const phases=[];
          const report=await startContestRecommendations({memories,stage,supportCards:[]},{seed:123,multiCore:true,onProgress:p=>phases.push(p.phase)}).promise;
          const requests=[...window.__workerRequests],parallelPeak=window.__workerPeak;window.__workerPeak=0;
          const single=await startContestRecommendations({memories,stage,supportCards:[]},{seed:123,multiCore:false}).promise;
          return {rows:report.rows.length,combinations:report.combinations,phases:[...new Set(phases)],batches:requests.filter(r=>r.mode.startsWith('batch-')),finalCount:requests.filter(r=>r.mode==='session-start').length,parallelPeak,serialPeak:window.__workerPeak,identical:JSON.stringify(report.rows)===JSON.stringify(single.rows)&&report.totalRuns===single.totalRuns,seeds:[...new Set(report.rows.map(r=>r.result.seed))]};
        }''',medium_memories)
        assert 20<medium['combinations']<=40 and medium['rows']==10 and medium['phases']==['review','final'],medium
        assert len(medium['batches'])==medium['combinations'] and all(r['offset']==0 and r['runs']==64 for r in medium['batches'])
        assert medium['parallelPeak']==4 and medium['serialPeak']==1 and medium['identical'],medium
        assert medium['finalCount']==20 and medium['seeds']==[123^0x85ebca6b]
        assert page.evaluate('window.__activeWorkers')==0
        identical=page.evaluate('''async memory=>{
          const {contestCatalog}=await import('./domain/catalog.mjs'),{startContestRecommendations}=await import('./application/contest-recommendation-client.mjs');
          const stage=contestCatalog().choices.find(s=>s.kind==='contest'&&s.seasonNumber===53&&s.stageNumber===1),memories=[0,1,2].map(i=>({...structuredClone(memory),key:'synthetic-identical-'+i}));window.__workerRequests=[];
          const report=await startContestRecommendations({memories,stage,supportCards:[]},{seed:123,multiCore:true}).promise;
          return {combinations:report.combinations,pairs:report.rows.map(r=>`${r.main}:${r.sub}`),sessions:window.__workerRequests.filter(r=>r.mode==='session-start').length};
        }''',memories[0])
        assert identical['combinations']==6 and identical['sessions']==6 and set(identical['pairs'])=={'0:1','0:2','1:0','1:2','2:0','2:1'},identical
        assert page.evaluate('window.__activeWorkers')==0
        select_season(page,'contest:pvp_rate_config-53');page.locator('.season-stage-tab').first.click()
        toggle=page.get_by_role('checkbox',name='模拟开启多核加速',exact=True);expect(toggle).to_be_checked();toggle.uncheck()
        page.locator('.season-stage-tab').nth(1).click();expect(page.get_by_role('checkbox',name='模拟开启多核加速',exact=True)).not_to_be_checked()
        page.get_by_role('checkbox',name='模拟开启多核加速',exact=True).check();page.locator('.season-stage-tab').first.click();expect(page.get_by_role('checkbox',name='模拟开启多核加速',exact=True)).to_be_checked()
        page.reload(wait_until='networkidle');page.locator('[data-tab="seasonSimulation"]').click();expect(page.get_by_role('checkbox',name='模拟开启多核加速',exact=True)).to_be_checked()
        assert not errors,errors;assert not uploads,uploads;browser.close()
    print('推荐载入、保存、页内选项卡切换与状态保留、停止终止 Worker、活动倍率阻断、窄屏、多核开关持久化、单／四 Worker 结果一致和无上传验证通过。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
