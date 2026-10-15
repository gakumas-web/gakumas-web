"""用合成编组验证全局转换设置、限制卡排除与真实 Worker 模拟。"""
from browser_artifacts import artifact_path
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BEFORE = 'p_card-03-act-2_068'
AFTER = 'p_card-03-act-2_102'


def check(url):
    request = next(row for row in json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['requests'] if row['plan']=='anomaly')
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width':1280,'height':950})
        errors, uploads = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: uploads.append(request.url) if request.post_data else None)
        # 只旁观实际 Worker 入参；计算和返回消息全部由正式 Worker 完成。
        page.add_init_script('''window.workerInputs=[];const NativeWorker=Worker;window.Worker=class extends NativeWorker{postMessage(value,...args){if(value.request)window.workerInputs.push(structuredClone(value));super.postMessage(value,...args);}};''')
        page.goto(url, wait_until='networkidle')
        page.locator('#data-open').click()
        page.locator('#enable-preview-account').click()
        expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        page.locator('#season-simulation-open').click()
        page.wait_for_function("async()=>{const c=await import('./domain/catalog.mjs');return c.contestCardConversions().length===21&&c.contestCustomizationCatalog().cards.some(card=>card.id==='p_card-03-act-2_102');}",timeout=60000)

        def mount(level):
            page.evaluate('''async ({request,level})=>{
              const c=await import('./domain/catalog.mjs'),{createSeasonSimulation}=await import('./ui/season-simulation.mjs');
              window.switchSimulation?.dispose();document.querySelector('#season-simulation-page')?.remove();document.querySelector('#synthetic-switch-controls')?.remove();
              const stage=c.contestCatalog().choices.find(row=>row.preset?.id===request.stage.preset.id);
              const idolCardId=request.cards[0].record.definition.originIdolCardId,characterId=c.idolInfo({idolCardId}).characterId;
              const memories=[0,1].map(index=>({key:`synthetic-switch-${index}`,ordinal:index+1,characterId,idolCardId,planType:4,...request.params,power:5000,grade:10,produceCard:request.cards[0].reference,examBattleProduceItemIds:request.items.map(row=>row.id),examBattleProduceCards:[...request.cards.map(row=>structuredClone(row.reference)),{id:index?'p_card-03-act-2_102':'p_card-03-act-2_068',upgradeCount:0,customizes:[]}]}));
              let low=0,high=1000000000;while(low<high){const mid=Math.floor((low+high)/2);if(c.accountProducerLevel(mid)>=level)high=mid;else low=mid+1;}
              if(c.accountProducerLevel(low)!==level)throw Error('producer level mismatch');
              window.switchMemories=memories;window.originalSwitchMemories=JSON.stringify(memories);
              const state={stage,selected:memories,drafts:structuredClone(memories),editing:[false,false],manual:{},result:{mode:'selected',runs:'100',entry:null}};
              const simulation=createSeasonSimulation({profile:'account:synthetic-switch',memories,idolCards:[],supportCards:[],producerExp:low,initialState:{stage,stageStates:[[stage.id,state]]},onOpenMemory:()=>{}});
              window.switchSimulation=simulation;simulation.controls.id='synthetic-switch-controls';document.querySelector('#season-simulation-view').append(simulation.controls,simulation.element);
            }''', {'request':request,'level':level})

        def settings():
            page.locator('.contest-card-conversions-open').click()
            expect(page.locator('#contest-card-conversion-dialog')).to_be_visible()
            return page.locator(f'[data-conversion-id="{BEFORE}"]')

        def close_settings():
            page.locator('#contest-card-conversion-dialog').get_by_role('button', name='关闭', exact=True).click()

        def slot(identity):
            return page.locator(f'.season-memory-slots [data-config-id="{identity}"]')

        mount(57)
        expect(settings().locator('input[value=after]')).to_be_disabled()
        dialog=page.locator('#contest-card-conversion-dialog')
        expect(dialog.locator('.contest-conversion-options .support-skill-thumbnail')).to_have_count(42)
        expect(dialog.locator('#contest-conversion-enhanced')).to_be_checked()
        expect(dialog.locator('.support-skill-enhanced')).to_have_count(42)
        assert dialog.locator('.support-skill-symbols img').count()>0
        assert dialog.locator('.support-skill-cost img').count()>0
        expect(dialog.locator('.contest-conversion-heading>.contest-conversion-requirement')).to_have_count(21)
        dialog.locator('.contest-conversion-card').first.hover()
        expect(page.locator('.support-reward-popover:popover-open .support-skill-detail')).to_have_count(1)
        page.keyboard.press('Escape')
        page.mouse.move(0,0)
        dialog.locator('#contest-conversion-enhanced').check()
        expect(dialog.locator('.contest-conversion-card>[data-upgrade-count="1"]')).to_have_count(42)
        dialog.locator('#contest-conversion-enhanced').uncheck()
        close_settings()
        expect(slot(BEFORE)).to_have_attribute('data-retained','true')
        expect(slot(AFTER)).to_have_attribute('data-retained','false')
        expect(slot(AFTER)).to_contain_text('限制')
        mount(58)
        expect(settings().locator('input[value=after]')).to_be_checked()
        close_settings()
        expect(slot(BEFORE)).to_have_attribute('data-retained','false')
        expect(slot(AFTER)).to_have_attribute('data-retained','true')
        expect(page.locator('.season-simulate')).to_be_enabled()
        page.locator('.season-simulate').click()
        expect(page.locator('.simulation-result-overview')).to_be_visible(timeout=120000)
        expect(page.locator('.simulation-result-deck')).to_contain_text('限制')
        assert page.evaluate('workerInputs.length')>0
        assert page.evaluate('(before)=>workerInputs.every(row=>!row.request.cards.some(card=>card.reference.id===before))',BEFORE)
        assert page.evaluate('(after)=>workerInputs.some(row=>row.request.cards.some(card=>card.reference.id===after))',AFTER)
        settings().locator('input[value=before]').check()
        close_settings()
        expect(slot(BEFORE)).to_have_attribute('data-retained','true')
        expect(slot(AFTER)).to_have_attribute('data-retained','false')
        expect(page.locator('.simulation-stale-note')).to_be_visible()
        # 跨舞台共用设置，再回到原舞台，已有工作区也应即时刷新。
        tabs=page.locator('.season-stage-tab')
        original=page.locator('.season-stage-tab[aria-selected="true"]').get_attribute('data-stage-id')
        tabs.first.click()
        expect(settings().locator('input[value=before]')).to_be_checked()
        page.locator(f'[data-conversion-id="{BEFORE}"] input[value=after]').check()
        close_settings()
        page.locator(f'.season-stage-tab[data-stage-id="{original}"]').click()
        expect(slot(BEFORE)).to_have_attribute('data-retained','false')
        expect(slot(AFTER)).to_have_attribute('data-retained','true')
        page.get_by_role('tab',name='推荐编组模拟',exact=True).click()
        page.evaluate('workerInputs=[]')
        page.locator('.recommendation-start').click()
        expect(page.locator('.recommendation-entry')).to_have_count(2,timeout=180000)
        assert page.evaluate('workerInputs.length')>0
        assert page.evaluate('(before)=>workerInputs.every(row=>!row.request.cards.some(card=>card.reference.id===before))',BEFORE)
        expect(page.locator('.recommendation-entry').first).to_contain_text('限制')
        settings().locator('input[value=before]').check()
        for width in [1280,375]:
            page.set_viewport_size({'width':width,'height':950})
            dialog=page.locator('#contest-card-conversion-dialog')
            assert dialog.evaluate('element=>element.scrollWidth<=element.clientWidth')
            dialog.screenshot(path=artifact_path(str(ROOT/'local/ui-visual-refinement'/f'global-card-conversions-{width}.png')))
        close_settings()
        expect(page.locator('.recommendation-entry')).to_have_count(0)
        assert page.evaluate('JSON.stringify(switchMemories)===originalSwitchMemories')
        # 重建页面后读取真实 localStorage，验证同一账号偏好持久化。
        page.reload(wait_until='networkidle')
        page.locator('#season-simulation-open').click()
        page.wait_for_function("async()=>{const c=await import('./domain/catalog.mjs');return c.contestCardConversions().length===21&&c.contestCustomizationCatalog().cards.some(card=>card.id==='p_card-03-act-2_102');}",timeout=60000)
        mount(58)
        expect(settings().locator('input[value=before]')).to_be_checked()
        close_settings()
        page.get_by_role('tab',name='自选编组模拟',exact=True).click()
        page.locator('[data-customize-memory="0"]').click()
        page.locator('[data-memory-index="0"] [data-edit-card="6"]').click()
        expect(page.locator('#contest-loadout-editor')).to_be_visible()
        expect(page.locator('#contest-loadout-editor [data-conversion-id]')).to_have_count(0)
        expect(page.locator(f'.contest-loadout-choice[data-choice-id="{BEFORE}"]')).to_have_count(1)
        expect(page.locator(f'.contest-loadout-choice[data-choice-id="{AFTER}"]')).to_have_count(1)
        expect(page.locator(f'.contest-loadout-choice[data-choice-id="{AFTER}"]')).to_contain_text('限制')
        page.locator('#contest-loadout-editor').get_by_role('button',name='取消',exact=True).click()
        settings().locator('input[value=after]').check()
        close_settings()
        page.locator('[data-memory-index="0"] [data-edit-card="2"]').click()
        page.locator(f'.contest-loadout-choice[data-choice-id="{AFTER}"] [role="radio"]').click()
        page.locator('.contest-loadout-footer .primary').click()
        expect(page.locator('#contest-loadout-editor')).not_to_be_visible()
        expect(slot(BEFORE)).to_have_attribute('data-retained','false')
        expect(slot(BEFORE)).to_contain_text('限制')
        assert page.evaluate('JSON.stringify(switchMemories)===originalSwitchMemories')
        assert not errors, errors
        assert not uploads, uploads
        browser.close()
    print('全局入口、P57/P58、限制卡排除、真实自选/推荐 Worker、跨舞台同步、缓存失效、刷新恢复及原记录不变验证通过。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',default='http://127.0.0.1:18765/')
    check(parser.parse_args().url)
