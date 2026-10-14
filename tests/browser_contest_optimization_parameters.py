"""核对文字双行选择、实际引擎倍率预览、清空与快速输入以及窄屏布局。"""
from browser_artifacts import artifact_path
from playwright.sync_api import sync_playwright,expect
from browser_static import ROOT
from browser_simulation_helpers import select_season


def check(url):
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#season-simulation-open')).to_be_enabled(timeout=60000);page.locator('#season-simulation-open').click();expect(page.locator('.simulation-mode-tabs')).to_be_visible(timeout=60000)
        setup=page.evaluate('''async()=>{const c=await import('./domain/catalog.mjs'),stage=c.contestCatalog().choices.find(row=>row.preset?.id===184);return {season:'contest:'+stage.season.id,id:stage.id};}''');select_season(page,setup['season']);page.locator(f'.season-stage-tab[data-stage-id="{setup["id"]}"]').click();page.locator('.simulation-mode-tabs [data-mode=optimization]').click();panel=page.locator('#contest-optimization')
        expect(panel.locator('[data-optimization-multiplier]')).to_have_count(3)
        params={'vocal':1954,'dance':1116,'visual':2385,'stamina':42}
        def expected(values):
            return page.evaluate('''async params=>{const {previewContestMultipliers}=await import('./domain/contest-engine-runner.mjs'),{createContestSimulationRequest}=await import('./domain/contest-engine-request.mjs'),c=await import('./domain/catalog.mjs'),data=await(await fetch('./resources/preview-account.json')).json(),supportCards=data.documents.find(doc=>doc.supportCards).supportCards,stage=c.contestCatalog().choices.find(row=>row.preset?.id===184),request=createContestSimulationRequest([{...params,examBattleProduceCards:[],examBattleProduceItemIds:[]}],stage,supportCards);const result=await previewContestMultipliers(request);return Object.fromEntries(Object.entries(result).map(([key,value])=>[key,`属性倍率：${Number((value*100).toFixed(1))}%`]));}''',values)
        for key,value in params.items():panel.locator(f'[data-optimization-attribute="{key}"]').fill(str(value))
        for key,value in expected(params).items():expect(panel.locator(f'[data-optimization-multiplier="{key}"]')).to_have_text(value,timeout=30000)
        for width in [1280,375]:
            page.set_viewport_size({'width':width,'height':1000});rows=panel.locator('.optimization-role').all();assert (rows[1].bounding_box()['y']>=rows[0].bounding_box()['y']+rows[0].bounding_box()['height'] if width<600 else abs(rows[1].bounding_box()['y']-rows[0].bounding_box()['y'])<2);assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth');panel.screenshot(path=artifact_path(str(ROOT/'local/ui-visual-refinement'/f'optimization-parameters-{width}.png')))
        vocal=panel.locator('[data-optimization-attribute=vocal]');vocal.fill('2500');vocal.fill('1800');params['vocal']=1800
        expect(panel.locator('[data-optimization-multiplier=vocal]')).to_have_text(expected(params)['vocal'],timeout=30000)
        vocal.fill('');expect(panel.locator('[data-optimization-multiplier=vocal]')).to_have_text('属性倍率：待计算');expect(panel.locator('[data-optimization-multiplier=dance]')).to_have_text(expected(params)['dance'],timeout=30000)
        panel.locator('[data-slot="0"] .season-memory-slot-pick').click();expect(page.locator('.optimization-picker')).to_be_visible();page.locator('.optimization-picker').get_by_role('button',name='取消',exact=True).click();assert not errors,errors;browser.close()
    print('实际倍率预览、空白与快速输入、专属卡图选择和桌面／手机布局，通过。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
