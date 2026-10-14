"""真实推荐验证分位数、结果卡片与跨偶像临时结果生命周期。"""
from browser_artifacts import artifact_path
import re

from playwright.sync_api import sync_playwright,expect
from browser_static import ROOT


def check(url):
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1100});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        # 只记录真实 Worker 返回的最终样本，用于独立核对页面分位数。
        page.add_init_script('''Object.defineProperty(navigator,'hardwareConcurrency',{value:8});window.finalSamples={};const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(this.mode==='session-finish'&&data.type==='result')window.finalSamples[this.sessionId]=data.result.scores;});}postMessage(value,...args){this.mode=value.mode;this.sessionId=value.sessionId;super.postMessage(value,...args);}};''')
        page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab="seasonSimulation"]').click();page.get_by_role('checkbox',name='模拟开启多核加速',exact=True).check()
        panel=page.locator('#contest-recommendations');summary=panel.locator('.recommendation-summary')
        def choose_count(count):
            choice=panel.locator('.recommendation-character').filter(has=page.locator('.recommendation-character-count',has_text=re.compile(f'^{count}$'))).first
            identity=choice.get_attribute('data-character-id');choice.click();return identity
        def run():
            panel.locator('.recommendation-start').click();expect(summary).to_contain_text('推荐 ',timeout=120000);expect(panel.locator('.recommendation-stop')).not_to_be_visible(timeout=120000)
            assert panel.locator('.recommendation-entry').count()>0
            return summary.inner_text(),panel.locator('.recommendation-entry').first.get_attribute('data-score')
        first=choose_count(2);first_result=run();expect(panel.locator('.recommendation-start')).to_have_text('开始搜索')
        samples=page.evaluate('window.finalSamples')
        for entry in panel.locator('.recommendation-entry').all():
            expect(entry.locator('[data-metric=deviation]')).to_be_visible();expect(entry.locator('.simulation-extra-metrics')).to_have_count(0)
            scores=samples[entry.get_attribute('data-main')+':'+entry.get_attribute('data-sub')]
            for key,fraction in [('p25',.25),('p75',.75)]:
                position=(len(scores)-1)*fraction;left=int(position);expected=scores[left]+(scores[min(left+1,len(scores)-1)]-scores[left])*(position-left)
                actual=float(entry.locator(f'.simulation-quartile-labels [data-quantile={key}]').inner_text().replace(',',''));assert abs(actual-expected)<=.5,(key,actual,expected)
            assert all(re.fullmatch(r'[\d,]+',value) for value in entry.locator('[data-metric] strong').all_text_contents())
            assert entry.locator('.recommendation-metrics [data-metric] small').all_text_contents()==['平均值','中位数','标准差']
            assert entry.locator('.recommendation-metrics [data-metric]').count()==3 and entry.locator('[data-metric=variance],[data-metric=downside]').count()==0
            expect(entry.locator('.recommendation-entry-identity .recommendation-run-count')).to_have_text(f'{len(scores)} 次模拟')
            assert '实际复评' not in entry.inner_text();assert entry.locator('.recommendation-entry-footer>span').count()==0
            expect(entry.locator('.recommendation-entry-face')).to_be_visible();expect(entry.locator('.recommendation-entry-heading>[data-metric=score]')).to_be_visible();assert entry.locator('.recommendation-item-row>small').count()==0
            expect(entry.locator('.loadout-library-preview')).to_be_visible();assert entry.locator('.recommendation-loadout').evaluate('e=>e.tagName')=='SECTION'
            assert entry.locator('.recommendation-entry-heading>span').count()==0
            for role,link in zip(['主回忆','副回忆'],entry.locator('.recommendation-memory-link').all()):
                expect(link).to_have_text(role);assert link.get_attribute('title')==role+' '+link.get_attribute('data-memory-key')[:8]
            scores=samples[entry.get_attribute('data-main')+':'+entry.get_attribute('data-sub')]
            assert [int(value.replace(',','')) for value in entry.locator('.simulation-history-scale span').all_text_contents()]==[min(scores),max(scores)]
            all_scores=[score for values in samples.values() for score in values];minimum=min(all_scores);maximum=max(all_scores)
            expected_left=(min(scores)-minimum)/(maximum-minimum)*100 if maximum!=minimum else 50
            assert abs(float(entry.locator('.history-whisker').evaluate('e=>parseFloat(e.style.left)'))-expected_left)<.0001
            score=entry.locator('[data-metric=score] strong');score.hover();formula=score.get_attribute('title');assert '下行波动' not in formula and '\n' not in formula
            assert re.fullmatch(r'[\d,]+',score.inner_text())
            assert re.fullmatch(r'\(\d+\.\d{2} \+ \d+\.\d{2}\) ÷ 2 \+ 0\.25 × \d+\.\d{2} − 0\.25 × \d+\.\d{2} ≈ \d+\.\d{2}',formula)
            mean,median,divisor,up_weight,upside,weight,downside,total=[float(v) for v in re.findall(r'-?\d+(?:\.\d+)?',formula)]
            assert abs((mean+median)/divisor+up_weight*upside-weight*downside-total)<=.011
            assert abs(int(score.inner_text().replace(',',''))-total)<=.51
        print('实际最终样本与 P25/P75 一致，综合分计算、短码与直接展示编组通过。',flush=True)
        # 主副回忆使用完整标识定位；返回模拟页仍保留本次推荐结果。
        for slot in range(2):
            link=panel.locator('.recommendation-entry').first.locator('.recommendation-memory-link').nth(slot);key=link.get_attribute('data-memory-key');link.click()
            expect(page.locator('[data-tab="memories"]')).to_have_attribute('aria-pressed','true');expect(page.locator('#list .memory-row')).to_have_count(1);expect(page.locator(f'#list [data-memory-key="{key}"]')).to_be_focused();expect(page.locator('#search')).to_have_value(key)
            page.locator('[data-tab="seasonSimulation"]').click();expect(summary).to_have_text(first_result[0])
        second=choose_count(4);expect(summary).not_to_be_visible();second_result=run();assert second!=first
        for identity,result in [(first,first_result),(second,second_result),(first,first_result)]:
            panel.locator(f'[data-character-id="{identity}"]').click();expect(summary).to_have_text(result[0]);assert panel.locator('.recommendation-entry').first.get_attribute('data-score')==result[1]
        panel.locator('.recommendation-start').click();panel.locator('.recommendation-stop').click();expect(panel.locator('.recommendation-status')).to_have_text('推荐已停止，保留上次完成结果。');expect(summary).to_have_text(first_result[0])
        page.locator('.season-stage-tab').nth(1).click();page.locator('.season-stage-tab').first.click();expect(summary).to_have_text(first_result[0])
        page.locator('[data-tab="memories"]').click();page.locator('[data-tab="seasonSimulation"]').click();expect(summary).to_have_text(first_result[0])
        page.locator('#language').select_option('ja');expect(panel.locator('.recommendation-entry')).to_have_count(2);page.locator('#language').select_option('zh-CN');expect(summary).to_have_text(first_result[0])
        panel.locator(f'[data-character-id="{second}"]').click();expect(summary).to_have_text(second_result[0]);panel.locator(f'[data-character-id="{first}"]').click()
        image_dir=ROOT/'local/recommendation-card-layout';image_dir.mkdir(parents=True,exist_ok=True)
        for width in [1280,768,375,320]:
            page.set_viewport_size({'width':width,'height':1100});entry=panel.locator('.recommendation-entry').first;entry.scroll_into_view_if_needed()
            page.wait_for_function("()=>[...document.querySelectorAll('.recommendation-entry:first-child .loadout-library-preview img')].every(i=>i.complete)")
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert entry.evaluate('e=>e.scrollWidth<=e.clientWidth')
            actions=entry.locator('.recommendation-entry-actions');footer=entry.locator('.recommendation-entry-footer');assert abs(actions.bounding_box()['x']-footer.bounding_box()['x'])<1
            metrics=entry.locator('.recommendation-metrics');preview=entry.locator('.loadout-library-preview');assert metrics.evaluate('e=>new Set([...e.children].map(n=>Math.round(n.getBoundingClientRect().top))).size')==1
            if width>=700:assert metrics.bounding_box()['x']>=preview.bounding_box()['x']+preview.bounding_box()['width']
            items=entry.locator('.loadout-library-items');cards=entry.locator('.loadout-library-cards').first
            if items.count():assert abs(items.bounding_box()['x']-cards.bounding_box()['x'])<1
            entry.screenshot(path=artifact_path(str(image_dir/f'card-{width}.png')))
        page.reload(wait_until='networkidle');expect(page.locator('#season-simulation-page')).to_be_visible(timeout=60000);expect(panel.locator('.recommendation-entry')).to_have_count(0);expect(summary).not_to_be_visible()
        assert not errors and not uploads,(errors,uploads);browser.close()
    print('两个偶像结果独立保留，停止、舞台、页签、语言切换及刷新清理通过，四种宽度截图已生成。',flush=True)


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
