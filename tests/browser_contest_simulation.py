"""实际静态入口、合成账号与真实 Worker 的舞台模拟验收。"""
from browser_artifacts import artifact_path
from browser_simulation_helpers import select_season
import argparse
import copy
import json
import math
import statistics
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import fixtures,ROOT


def check(url):
    data=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text());request=data['customized'];request['cards'][-1]=json.loads((ROOT/'tests/fixtures/public-data/contest-sleepiness-card.json').read_text())
    with TemporaryDirectory(dir=ROOT/'local',prefix='stage-simulator-') as temporary,sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[];requests=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda value:(requests.append(value.url),uploads.append(value.url) if value.post_data else None))
        page.goto(url,wait_until='networkidle')
        identity=page.evaluate('''async id=>{const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');const {idolInfo}=await import('./domain/catalog.mjs');return idolInfo({idolCardId:id})}''',request['cards'][0]['record']['definition']['originIdolCardId'])
        docs=fixtures();base=docs['capture']['memories'][0];memories=[]
        for index in range(2):
            memory=copy.deepcopy(base);memory.update(userMemoryId=f'synthetic-engine-{index}',idolCardId=request['cards'][0]['record']['definition']['originIdolCardId'],characterId=identity['characterId'],planType=2,**request['params'],produceCard=request['cards'][0]['reference'],examBattleProduceCards=[entry['reference'] for entry in request['cards']],examBattleProduceItemIds=[entry['id'] for entry in request['items']]);memories.append(memory)
        docs['capture'].update(memories=memories,count=2,supportCards=[{'supportCardId':'synthetic-support-engine','level':60,'levelLimitRank':0,'stockQuantity':1,'createdTime':0}]);docs['capture']['idolCards'][0]['idolCardId']=memories[0]['idolCardId']
        for name,document in docs.items():
            file=Path(temporary)/'account'/name/'snapshot.json';file.parent.mkdir(parents=True);file.write_text(json.dumps(document))
        page.locator('#account-directory-files').set_input_files(str(Path(temporary)/'account'));expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        page.locator('#season-simulation-open').click();select_season(page,'contest:pvp_rate_config-53');page.locator('[data-stage-id="contest:pvp_rate_config-53:0"]').click()
        for width in [390,320]:
            page.set_viewport_size({'width':width,'height':844});jump=page.get_by_role('button',name='前往模拟',exact=True);expect(jump).to_be_visible();assert page.locator('.season-group-controls').evaluate('e=>e.scrollWidth<=e.clientWidth');jump.click();title=page.locator('#contest-simulation-result-title');expect(title).to_be_focused();assert 0<=title.bounding_box()['y']<844;assert page.evaluate('scrollY')>0;expect(page.get_by_role('tab',name='推荐编组模拟',exact=True)).to_have_attribute('aria-selected','true');page.screenshot(path=artifact_path(str(ROOT/f'local/season-simulation/jump-{width}.png')))
        page.set_viewport_size({'width':1280,'height':1000});expect(page.get_by_role('button',name='前往模拟',exact=True)).not_to_be_visible()
        tabs=page.locator('.simulation-mode-tabs');expect(tabs.get_by_role('tab')).to_have_count(4);page.get_by_role('tab',name='推荐编组模拟',exact=True).focus();page.keyboard.press('ArrowLeft');expect(page.get_by_role('tab',name='模拟历史',exact=True)).to_have_attribute('aria-selected','true');page.keyboard.press('ArrowLeft');expect(page.get_by_role('tab',name='自选编组模拟',exact=True)).to_have_attribute('aria-selected','true');expect(page.locator('.simulation-result-view')).not_to_be_visible();assert page.locator('.simulation-result-tabs').count()==0
        expect(page.locator('.season-simulate')).to_have_text('开始模拟');expect(page.locator('.season-simulate')).to_be_disabled()
        page.locator('.season-memory-slot-pick').first.click();page.locator('.contest-memory-choose').first.click();expect(page.locator('.season-simulate')).to_be_disabled()
        expect(page.locator('.contest-memory-capacity')).to_contain_text('主回忆（')
        assert page.locator('.season-card-capacity').count()==len(request['cards'])
        assert not any('upstream-contest-engine.mjs' in value for value in requests)
        page.locator('.season-memory-slot-pick').last.click();page.locator('.contest-memory-option[aria-disabled="false"] .contest-memory-choose').first.click();expect(page.locator('.season-simulate')).to_be_enabled()
        for card in request['cards']:
            tiles=page.locator(f'#season-simulation-page [data-config-id="{card["reference"]["id"]}"]');expected=1 if card['record']['definition']['noDeckDuplication'] else 2
            expect(tiles.locator('xpath=self::*[@data-retained="true"]')).to_have_count(expected);expect(tiles.locator('xpath=self::*[@data-retained="false"]')).to_have_count(2-expected)
        page.locator('.season-simulate').click();dialog=page.locator('#contest-simulation-result');expect(dialog).to_be_visible();assert page.locator('dialog:modal').count()==0
        page.locator('.season-stage-tab').nth(1).click();page.get_by_role('tab',name='自选编组模拟',exact=True).click();expect(page.locator('.season-simulate')).to_be_disabled();page.locator('.season-stage-tab').first.click()
        page.locator('[data-tab="memories"]').click();expect(page.locator('#inventory')).to_be_visible();page.locator('[data-tab="seasonSimulation"]').click();expect(page.locator('#season-simulation-page')).to_be_visible()
        expect(dialog.locator('[data-score="mean"] strong')).to_be_visible(timeout=120000)
        assert int(dialog.locator('[data-score="mean"] strong').inner_text().replace(',',''))>0
        assert dialog.locator('.simulation-result-view').evaluate("e=>getComputedStyle(e).backgroundColor!=='rgba(0, 0, 0, 0)'&&getComputedStyle(e).borderRadius==='10px'")
        expect(dialog.locator('.simulation-selected-panel>[role="status"]')).to_have_text('已完成 500 次模拟')
        assert any('upstream-contest-engine.mjs' in value for value in requests)
        assert '支援奖励 +0.10%' in dialog.locator('.simulation-result-caption').inner_text()
        expect(dialog.locator('.simulation-save-status')).to_have_text('已保存到此舞台的模拟历史。')
        dialog.locator('.simulation-statistics > summary').click();assert dialog.locator('.simulation-statistics tbody tr').count()>0
        sleep=dialog.locator('.simulation-statistics tbody tr').filter(has_text='眠気');expect(sleep.locator('.support-skill-thumbnail')).to_be_visible();sleep.locator('.reward-art img').wait_for();page.wait_for_function("()=>[...document.querySelectorAll('.simulation-statistics tr')].find(row=>row.textContent.includes('眠気'))?.querySelector('.reward-art img')?.naturalWidth>1")
        saved_statistics=page.evaluate('''async()=>{const {simulationHistory}=await import('./application/contest-simulation-history.mjs');return (await simulationHistory(document.querySelector('#profile').value))[0].result.statistics}''')
        def check_summary(data):
            summary=dialog.locator('.simulation-stat-summary');assert summary.locator('table').count()==0
            average=float(summary.locator('.simulation-stat-average strong').inner_text().replace(',',''));assert abs(average-data['totalScore']/saved_statistics['runs'])<=.051
            weights=summary.locator('.simulation-stat-ratio>span').evaluate_all('nodes=>nodes.map(e=>Number(e.style.flexGrow))');totals=[data['totalScoreByType'][key] for key in ['vocal','dance','visual']];total=sum(totals);assert all(abs(actual-(value/total if total else 0))<.000001 for actual,value in zip(weights,totals)),(weights,totals)
            skip_chart=dialog.locator('.simulation-skip-chart');expected=[0]
            for turn in saved_statistics['turns']:expected.append(expected[-1]+turn['skips'])
            assert skip_chart.locator('[data-skips]').evaluate_all('nodes=>nodes.map(e=>Number(e.dataset.skips))')==expected
            expect(skip_chart.locator('.simulation-skip-heading>strong')).to_have_text(f'累计 {saved_statistics["total"]["skips"]:,} 次')
        assert dialog.locator('.simulation-stat-selection>.simulation-stat-controls').count()==1
        check_summary(saved_statistics['total']);skip_before=dialog.locator('.simulation-skip-chart').inner_html()
        dialog.get_by_role('combobox',name='统计范围').select_option('0');assert dialog.locator('.simulation-statistics tbody tr').count()>0;check_summary(saved_statistics['turns'][0]);assert dialog.locator('.simulation-skip-chart').inner_html()==skip_before
        dialog.get_by_role('combobox',name='统计范围').select_option('all');dialog.locator('.simulation-statistics th button').nth(1).click();expect(dialog.locator('.simulation-statistics th').nth(1)).to_have_attribute('aria-sort','descending')
        assert dialog.locator('.simulation-skip-chart').bounding_box()['x']>=dialog.locator('.simulation-stat-summary').bounding_box()['x']+dialog.locator('.simulation-stat-summary').bounding_box()['width'];dialog.locator('.simulation-statistics').screenshot(path=artifact_path(str(ROOT/'local/season-simulation/result-statistics-open.png')))
        dialog.locator('.simulation-statistics > summary').click()
        slider=dialog.get_by_role('slider',name='模拟次数');expect(slider).to_have_value('500');expect(slider).to_have_attribute('min','100');expect(slider).to_have_attribute('max','10000');expect(slider).to_have_attribute('step','100')
        expect(dialog.locator('.simulation-records')).not_to_have_attribute('open','')
        expect(dialog.locator('.simulation-result-overview .comparison-score')).to_be_visible()
        assert dialog.locator('.simulation-result-caption').evaluate("e=>new Set([...e.querySelectorAll(':scope>span,:scope>time')].map(n=>getComputedStyle(n).font)).size===1")
        assert dialog.locator('.simulation-result-extremes').count()==0
        assert dialog.locator('.simulation-result-caption').evaluate("e=>e.children[0].tagName==='TIME'&&e.children[1].classList.contains('simulation-result-face')&&e.children[2].textContent.includes('次模拟')&&e.children[3].textContent.includes('支援奖励')&&e.children[4].textContent.includes('随机种子')")
        assert dialog.locator('.contest-simulation-scores>div>span').all_text_contents()==['平均值','中位数','标准差','P25','P75']
        expect(dialog.locator('.simulation-result-deck .loadout-library-memory')).to_have_count(2)
        for width in [1280,768,375,320]:
            page.set_viewport_size({'width':width,'height':1100});result_view=dialog.locator('.simulation-result-view');result_view.scroll_into_view_if_needed()
            page.wait_for_function("()=>[...document.querySelectorAll('.simulation-result-view img')].filter(i=>i.offsetParent!==null).every(i=>i.complete)")
            assert result_view.evaluate('e=>e.scrollWidth<=e.clientWidth')
            chart=dialog.locator('.simulation-result-chart-panel').bounding_box();configuration=dialog.locator('.simulation-result-context').bounding_box()
            if width>=1000:assert configuration['x']>=chart['x']+chart['width']
            else:assert configuration['y']>=chart['y']+chart['height']
            sizes=[]
            for mode in ['distribution','box','turns']:
                dialog.locator(f'[data-view="{mode}"]').click();bounds=dialog.locator('.simulation-result-chart-panel').bounding_box();sizes.append((bounds['width'],bounds['height']))
                if mode=='box':dialog.locator('.simulation-result-chart-panel').screenshot(path=artifact_path(str(ROOT/f'local/season-simulation/result-box-{width}.png')))
            assert all(abs(width_value-sizes[0][0])<1 and abs(height-sizes[0][1])<1 for width_value,height in sizes),sizes
            dialog.locator('[data-view="distribution"]').click()
            result_view.screenshot(path=artifact_path(str(ROOT/f'local/season-simulation/result-redesign-{width}.png')))
            if width==768:
                dialog.locator('.simulation-statistics>summary').click();assert dialog.locator('.simulation-skip-chart').bounding_box()['y']+dialog.locator('.simulation-skip-chart').bounding_box()['height']<=dialog.locator('.simulation-stat-selection').bounding_box()['y'];dialog.locator('.simulation-statistics').screenshot(path=artifact_path(str(ROOT/'local/season-simulation/result-statistics-768.png')));dialog.locator('.simulation-statistics>summary').click()
            if width==320:
                for mode in ['box','turns']:
                    dialog.locator(f'[data-view="{mode}"]').click();dialog.locator('.simulation-result-chart-panel').screenshot(path=artifact_path(str(ROOT/f'local/season-simulation/result-{mode}-320.png')))
                dialog.locator('[data-view="box"]').click()
                expect(dialog.locator('.simulation-result-chart-panel .simulation-history-range')).to_be_visible();expect(dialog.locator('.simulation-result-chart-panel .simulation-history-scale>span')).to_have_count(2)
                dialog.locator('[data-view="distribution"]').click();dialog.locator('.simulation-statistics>summary').click();assert dialog.locator('.simulation-statistics').evaluate('e=>e.scrollWidth<=e.clientWidth');assert dialog.locator('.simulation-skip-chart').bounding_box()['y']+dialog.locator('.simulation-skip-chart').bounding_box()['height']<=dialog.locator('.simulation-stat-selection').bounding_box()['y'];dialog.locator('.simulation-statistics').screenshot(path=artifact_path(str(ROOT/'local/season-simulation/result-statistics-320.png')));dialog.locator('.simulation-statistics>summary').click()

        page.set_viewport_size({'width':1280,'height':1000})

        dialog.locator('.simulation-records > summary').click()
        assert dialog.locator('.simulation-turn').count()==request['stage']['turn']
        for view in ['box','turns','distribution']:
            dialog.locator(f'[data-view="{view}"]').click();expect(dialog.locator('.simulation-result-chart-panel .simulation-history-range' if view=='box' else '.simulation-result-chart-panel svg')).to_be_visible()
        saved_scores=page.evaluate('''async()=>{const {simulationHistory}=await import('./application/contest-simulation-history.mjs');const entry=(await simulationHistory(document.querySelector('#profile').value))[0];return {minimum:entry.result.minimum,maximum:entry.result.maximum}}''')
        for view,score in [('minimumRun','minimum'),('maximumRun','maximum')]:
            dialog.locator(f'[data-view="{view}"]').click();assert format(saved_scores[score],',') in dialog.locator('.simulation-record-score').inner_text()
        dialog.locator('[data-view="representative"]').click();turns=dialog.locator('.simulation-turn');assert dialog.locator('.simulation-turn[open]').count()==0
        expect(turns.first.locator('.simulation-turn-timeline')).not_to_be_visible();turns.first.locator('summary').first.click();expect(turns.first).to_have_attribute('open','')
        turns.nth(1).locator('summary').first.click();expect(turns.nth(1)).to_have_attribute('open','');expect(turns.first).to_have_attribute('open','');turns.nth(1).locator('summary').first.press('Enter');expect(turns.nth(1)).not_to_have_attribute('open','')
        expect(dialog.locator('.simulation-hand-card .support-skill-thumbnail').first).to_be_visible()
        images=dialog.locator('.simulation-hand-card .reward-art img')
        assert images.count()==dialog.locator('.simulation-hand-card').count()
        page.wait_for_function("""()=>[...document.querySelectorAll('.simulation-turn[open] .simulation-hand-card .reward-art img')].every(image=>image.complete&&image.naturalWidth>1&&!image.hidden&&!image.src.includes('unavailable.svg'))""")
        dialog.locator('.simulation-hand-state summary').first.click();expect(dialog.locator('.simulation-hand-state-values').first).to_be_visible();assert dialog.locator('.simulation-hand-card.is-selected').count()>0;assert dialog.locator('.simulation-event-entity .simulation-event-change').count()>0
        dialog.locator('.simulation-turn').first.screenshot(path=artifact_path(str(ROOT/'local/season-simulation/result-turn-open.png')))
        for width in [1280,390,320]:
            page.set_viewport_size({'width':width,'height':1000});assert dialog.evaluate('e=>e.scrollWidth<=e.clientWidth');page.screenshot(path=artifact_path(str(ROOT/f'local/season-simulation/simulation-result-{width}.png')))
            if width==320:dialog.locator('.simulation-turn').first.screenshot(path=artifact_path(str(ROOT/'local/season-simulation/result-turn-320.png')))
        page.set_viewport_size({'width':1280,'height':1000});slider.focus();slider.press('ArrowRight');expect(slider).to_have_value('600');expect(dialog.locator('.contest-simulation-controls output')).to_have_text('600');previous_result=dialog.locator('.contest-simulation-output').inner_html();slider.fill('10000');dialog.locator('.contest-simulation-controls .primary').click();dialog.get_by_role('button',name='停止',exact=True).click();expect(dialog.locator('.simulation-selected-panel>[role="status"]')).to_have_text('模拟已停止');expect(dialog.locator('.contest-simulation-controls .primary')).to_be_enabled();assert dialog.locator('.contest-simulation-output').inner_html()==previous_result
        slider.fill('600')
        page.locator('.season-memory-slot-pick').last.click();page.locator('.contest-memory-option[aria-disabled="false"] .contest-memory-choose').first.click();page.locator('.season-simulate').click();expect(dialog.locator('.simulation-selected-panel>[role="status"]')).to_have_text('已完成 600 次模拟',timeout=120000);expect(dialog.locator('.simulation-save-status')).to_have_text('已保存到此舞台的模拟历史。')
        # 错误路径也使用真实 Worker，不用静态占位分数冒充模拟。
        broken=copy.deepcopy(request);broken['cards'][0]['record']['name']='synthetic-unmapped-card'
        page.evaluate('''async request=>{const {createContestSimulationPanel}=await import('./ui/contest-simulation-result.mjs');const stage={kind:'contest',seasonNumber:53,stageNumber:1};const panel=createContestSimulationPanel({getInput:()=>({request,stage}),stage,onRestore:()=>false});panel.element.id='error-simulation-result';document.body.append(panel.element);panel.update({stage,available:true,signature:'broken'});window.errorSimulationPanel=panel;panel.element.querySelector('.season-simulate').click();}''',broken)
        failure=page.locator('#error-simulation-result');expect(failure.locator('[role="alert"]')).to_be_visible(timeout=120000);assert failure.locator('[data-score]').count()==0;assert 'synthetic-unmapped-card' in failure.inner_text();page.evaluate('''async()=>{const {simulationHistory}=await import('./application/contest-simulation-history.mjs');const entry=(await simulationHistory(document.querySelector('#profile').value))[0];window.errorSimulationPanel.restoreState({runs:'500',entry,signature:'previous'});window.errorSimulationPanel.element.querySelector('.season-simulate').click();}''');expect(failure.locator('.simulation-run-error [role="alert"]')).to_be_visible(timeout=120000);expect(failure.locator('[data-score="mean"]')).to_be_visible();page.evaluate('window.errorSimulationPanel.dispose();window.errorSimulationPanel.element.remove()')
        # 刷新后仍能从舞台入口查看历史，不要求先选择回忆或再次模拟。
        page.reload(wait_until='networkidle');expect(page.locator('#season-simulation-page')).to_be_visible(timeout=60000)
        page.locator('#season-simulation-open').click();select_season(page,'contest:pvp_rate_config-53');page.locator('[data-stage-id="contest:pvp_rate_config-53:0"]').click();page.get_by_role('tab',name='模拟历史',exact=True).click()
        expect(dialog.locator('.simulation-history-entry')).to_have_count(2);assert dialog.locator('.simulation-history-count').count()==0;expect(dialog.get_by_role('button',name='载入编组至自选模拟',exact=True).first).to_have_class('primary')
        # 分位数及两端刻度与实际保存的模拟样本一致；同舞台历史沿用共同刻度。
        expected_history=page.evaluate('''async()=>{const {simulationHistory}=await import('./application/contest-simulation-history.mjs');const entries=await simulationHistory(document.querySelector('#profile').value),ids=[...document.querySelectorAll('.simulation-history-entry')].map(e=>e.dataset.historyId),shown=entries.filter(e=>ids.includes(e.id));return {minimum:Math.min(...shown.map(e=>e.result.minimum)),maximum:Math.max(...shown.map(e=>e.result.maximum)),rows:shown.map(e=>({id:e.id,scores:e.result.scores,mean:e.result.mean,minimum:e.result.minimum,maximum:e.result.maximum}))}}''')
        for record in expected_history['rows']:
            row=dialog.locator(f'.simulation-history-entry[data-history-id="{record["id"]}"]')
            for key,fraction in [('p25',.25),('p75',.75)]:
                values=record['scores'];position=(len(values)-1)*fraction;left=int(position);value=values[left]+(values[min(left+1,len(values)-1)]-values[left])*(position-left)
                assert abs(float(row.locator(f'[data-metric="{key}"] strong').inner_text().replace(',',''))-value)<=.5
            assert all('.' not in value for value in row.locator('.simulation-history-scores strong').all_text_contents())
            assert [float(value.replace(',','')) for value in row.locator('.simulation-history-scale span').all_text_contents()]==[record['minimum'],record['maximum']]
        history_rows=dialog.locator('.simulation-history-entry')
        by_id={record['id']:record for record in expected_history['rows']}
        def metrics(record):
            scores=record['scores'];position=(len(scores)-1)*.75;left=int(position)
            return {'mean':record['mean'],'median':statistics.median(scores),'p75':scores[left]+(scores[min(left+1,len(scores)-1)]-scores[left])*(position-left)}
        for baseline_index in [0,1]:
            history_rows.nth(baseline_index).get_by_role('button',name='设为基准',exact=True).click();baseline=history_rows.nth(baseline_index);other=history_rows.nth(1-baseline_index);expect(baseline.locator('.simulation-history-baseline-label')).to_have_text('比较基准');expect(baseline.locator('[data-delta]')).to_have_count(0)
            baseline_metrics=metrics(by_id[baseline.get_attribute('data-history-id')]);other_metrics=metrics(by_id[other.get_attribute('data-history-id')])
            assert other.locator('.simulation-history-deltas small').all_text_contents()==['平均值','中位数','P75']
            for key in ['mean','median','p75']:
                displayed=other.locator(f'[data-delta="{key}"] strong').inner_text();assert int(displayed.replace(',',''))==math.floor(other_metrics[key]-baseline_metrics[key]+.5)
            expect(other.locator('.simulation-history-comparison-note')).to_contain_text('模拟次数不同');assert '比赛倍率不同' not in other.inner_text()
        history_rows.last.get_by_role('button',name='取消基准',exact=True).click();expect(dialog.locator('[data-delta]')).to_have_count(0);history_rows.last.get_by_role('button',name='设为基准',exact=True).click()
        for width in [1280,375,320]:
            page.set_viewport_size({'width':width,'height':1100});entry=dialog.locator('.simulation-history-entry').first;expect(entry.locator('.loadout-library-preview')).to_be_visible();expect(entry.locator('.loadout-library-memory')).to_have_count(2)
            expect(entry.locator('.loadout-library-cards .support-skill-thumbnail')).to_have_count(len(request['cards'])*2);expect(entry.locator('.simulation-history-range')).to_be_visible();expect(entry.locator('.simulation-history-scores>span')).to_have_count(5)
            expect(entry.locator('.simulation-history-heading>.comparison-score')).to_be_visible()
            assert '÷ 2 + 0.25 ×' in entry.locator('.comparison-score strong').get_attribute('title') and '− 0.25 ×' in entry.locator('.comparison-score strong').get_attribute('title')
            assert entry.locator('.simulation-history-scores small').all_text_contents()==['平均值','中位数','标准差','P25','P75']
            assert entry.locator('.simulation-history-identity').evaluate("e=>e.children[0].tagName==='TIME'&&e.children[1].classList.contains('simulation-history-face')&&e.children[2].textContent.includes('次模拟')")
            assert '赛季' not in entry.locator('.simulation-history-heading').inner_text() and '舞台' not in entry.locator('.simulation-history-heading').inner_text()
            assert entry.locator('.simulation-history-loadout>summary').count()==0;assert entry.evaluate('e=>e.scrollWidth<=e.clientWidth')
            assert entry.evaluate("e=>getComputedStyle(e).backgroundColor!=='rgba(0, 0, 0, 0)'&&getComputedStyle(e).borderRadius==='10px'")
            preview=entry.locator('.loadout-library-preview').bounding_box();result=entry.locator('.simulation-history-result').bounding_box()
            if width>=700:assert result['x']>=preview['x']+preview['width']
            else:assert result['y']>=preview['y']+preview['height']
            entry.screenshot(path=artifact_path(str(ROOT/f'local/season-simulation/history-card-{width}.png')))
        page.set_viewport_size({'width':1280,'height':1000})
        dialog.locator('.simulation-history-entry').first.get_by_role('button',name='查看结果',exact=True).click();expect(dialog.locator('[data-score="mean"] strong')).to_be_visible()
        page.get_by_role('tab',name='模拟历史',exact=True).click();dialog.locator('.simulation-history-entry').first.get_by_role('button',name='载入编组至自选模拟',exact=True).click();expect(dialog).to_be_visible();expect(page.locator('.season-simulate')).to_be_enabled();expect(page.locator('.contest-memory-capacity')).to_have_count(2)
        page.get_by_role('tab',name='模拟历史',exact=True).click();entry=dialog.locator('.simulation-history-entry').last;entry.get_by_role('button',name='删除',exact=True).click();entry.get_by_role('button',name='确认删除',exact=True).click();expect(dialog.locator('.simulation-history-entry')).to_have_count(1);expect(dialog.locator('[data-delta]')).to_have_count(0);expect(dialog.locator('.simulation-history-baseline-label')).to_have_count(0)
        # 各舞台只展示自己的历史，切换及删除不会混入其他舞台记录。
        contest_history_id=dialog.locator('.simulation-history-entry').get_attribute('data-history-id')
        select_season(page,'event:1:1');page.locator('.season-stage-tab').first.click();page.get_by_role('tab',name='自选编组模拟',exact=True).click()
        for index in range(2):
            page.locator('.season-memory-slot-pick').nth(index).click();page.locator('.contest-memory-choose:enabled').first.click()
        for key in ['vocal','dance','visual']:page.locator('#season-manual-'+key).fill('100')
        page.locator('#contest-simulation-runs').fill('100');page.locator('.season-simulate').click();expect(dialog.locator('.simulation-save-status')).to_have_text('已保存到此舞台的模拟历史。',timeout=120000)
        page.get_by_role('tab',name='模拟历史',exact=True).click();expect(dialog.locator('.simulation-history select')).to_have_count(0);expect(dialog.locator('.simulation-history-entry')).to_have_count(1)
        event_history_id=dialog.locator('.simulation-history-entry').get_attribute('data-history-id');assert event_history_id!=contest_history_id
        page.get_by_role('tab',name='自选编组模拟',exact=True).click();page.locator('#season-manual-vocal').fill('120');page.locator('.season-simulate').click();expect(dialog.locator('.simulation-save-status')).to_have_text('已保存到此舞台的模拟历史。',timeout=120000);page.get_by_role('tab',name='模拟历史',exact=True).click();expect(dialog.locator('.simulation-history-entry')).to_have_count(2)
        dialog.locator('.simulation-history-entry').last.get_by_role('button',name='设为基准',exact=True).click();latest=dialog.locator('.simulation-history-entry').first;expect(latest.locator('.simulation-history-comparison-note')).to_have_text('比赛倍率不同（本次 / 基准）：Vo 120% / 100%。');latest.get_by_role('button',name='删除',exact=True).click();latest.get_by_role('button',name='确认删除',exact=True).click();expect(dialog.locator('.simulation-history-entry')).to_have_count(1)
        select_season(page,'contest:pvp_rate_config-53');page.locator('.season-stage-tab').first.click();page.get_by_role('tab',name='模拟历史',exact=True).click()
        expect(dialog.locator('.simulation-history-entry')).to_have_count(1);expect(dialog.locator('.simulation-history-entry')).to_have_attribute('data-history-id',contest_history_id)
        entry=dialog.locator('.simulation-history-entry');entry.get_by_role('button',name='删除',exact=True).click();entry.get_by_role('button',name='确认删除',exact=True).click();expect(dialog.locator('.simulation-history-entry')).to_have_count(0)
        select_season(page,'event:1:1');page.locator('.season-stage-tab').first.click();page.get_by_role('tab',name='模拟历史',exact=True).click()
        expect(dialog.locator('.simulation-history-entry')).to_have_count(1);expect(dialog.locator('.simulation-history-entry')).to_have_attribute('data-history-id',event_history_id)
        assert not errors,errors;assert not uploads,uploads;assert not any('gktools.ris.moe' in value for value in requests)
        browser.close()
    print('真实 Worker 舞台模拟：按需加载、主／副编组与附魔、500 次结果、100～10000 次滑条、默认折叠与实际卡图、容量、统计排序、历史刷新／载入／删除、取消、错误阻断、窄屏和无上传检查通过。')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8080/');args=parser.parse_args();check(args.url)
