"""通过内置预览验证模拟附魔加减、次数上限、取消与应用。"""
from browser_simulation_helpers import select_season
from playwright.sync_api import sync_playwright, expect


def check(url):
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        page.locator('#season-simulation-open').click();select_season(page,'contest:pvp_rate_config-53');page.locator('[data-stage-id="contest:pvp_rate_config-53:0"]').click();page.get_by_role('tab',name='自选编组模拟',exact=True).click();page.locator('.season-memory-slot-pick').first.click();page.locator('.contest-memory-option').first.locator('.contest-memory-choose').click();page.locator('[data-customize-memory="0"]').click()
        board=page.locator('[data-memory-index="0"]');before=board.locator('[data-config-id]').evaluate_all('(nodes)=>nodes.map(e=>[e.dataset.configId,e.textContent])')
        def open_editor():
            board.locator('[data-edit-card="2"]').click();expect(page.locator('#contest-loadout-editor')).to_be_visible();page.locator('#contest-loadout-owned').uncheck()
        open_editor();page.locator('#contest-loadout-enhanced').check()
        candidate=page.evaluate('''async()=>{const {cardCustomizations,supportSkillVisual}=await import('./domain/catalog.mjs');return [...document.querySelectorAll('.contest-loadout-choice[data-choice-kind="cards"]')].map(node=>({id:node.dataset.choiceId,data:cardCustomizations({id:node.dataset.choiceId,upgradeCount:1,customizes:[]})})).find(row=>row.data?.maximum>1&&row.data.options.length>1&&row.data.options.every(option=>option.levels[0]?.level===1)&&['damage','block'].some(key=>JSON.stringify(supportSkillVisual({id:row.id,upgradeCount:1,customizes:[]})[key])!==JSON.stringify(supportSkillVisual({id:row.id,upgradeCount:1,customizes:[{id:row.data.options[0].id,customizeCount:1}]})[key])));}''')
        assert candidate
        def select():page.locator(f'.contest-loadout-choice[data-choice-id="{candidate["id"]}"] > input').check()
        select();panel=page.locator('.contest-inline-customizer')
        expect(panel.locator('.contest-customizer-stepper')).to_have_count(len(candidate['data']['options']))
        assert panel.locator('input[type=checkbox]').count()==0
        for _ in range(candidate['data']['maximum']):
            available=panel.locator('[data-step="1"]:enabled')
            if not available.count():break
            available.first.click()
        values=list(map(int,panel.locator('output').all_text_contents()));assert sum(values)==candidate['data']['maximum'];assert panel.locator('[data-step="1"]:enabled').count()==0
        panel.locator('[data-step="-1"]:enabled').first.click();assert sum(map(int,panel.locator('output').all_text_contents()))==sum(values)-1
        assert page.locator('.contest-clear-customizations,.contest-customizer-header').count()==0
        page.locator(f'.contest-loadout-choice:not([data-choice-id="{candidate["id"]}"]) > input').first.check();select();assert all(value=='0' for value in panel.locator('output').all_text_contents());assert panel.locator('[data-step="-1"]:enabled').count()==0
        panel.locator('[data-step="1"]:enabled').first.click()
        art=page.locator(f'.contest-loadout-choice[data-choice-id="{candidate["id"]}"] .contest-loadout-art');expect(art.locator('.selection-custom-count')).to_have_text('1');art.hover();popup=page.locator('#'+art.get_attribute('aria-controls'));expect(popup.locator('.support-skill-description')).to_be_visible();assert popup.locator('input,.contest-customizer-stepper').count()==0;expect(page.locator('.contest-selected-card .selection-custom-count')).to_have_text('1')
        # 已构建的浮层、候选缩略图和当前预览必须随附魔加减一起更新。
        def check_linked_values():
            expected=page.evaluate('''async id=>{const {skillThumbnailFor}=await import('./ui/illustrations.mjs');const customizes=[...document.querySelectorAll('.contest-customizer-stepper')].map(row=>({id:row.dataset.customizeId,customizeCount:Number(row.querySelector('output').value)})).filter(row=>row.customizeCount);const node=skillThumbnailFor({id,upgradeCount:1,customizes});return ['.support-skill-damage','.support-skill-block'].map(selector=>node.querySelector(selector)?.textContent??null);}''',candidate['id'])
            for locator in [art,page.locator('.contest-selected-card'),popup.locator('.support-skill-artwork')]:
                assert locator.evaluate("node=>['.support-skill-damage','.support-skill-block'].map(selector=>node.querySelector(selector)?.textContent??null)")==expected
            return expected
        changed=check_linked_values();panel.locator('[data-step="-1"]:enabled').first.click();plain=check_linked_values();assert changed!=plain
        panel.locator('[data-step="1"]:enabled').first.click();assert check_linked_values()==changed
        page.locator('#contest-loadout-editor .dialog-head button').click();assert board.locator('[data-config-id]').evaluate_all('(nodes)=>nodes.map(e=>[e.dataset.configId,e.textContent])')==before
        open_editor();page.locator('#contest-loadout-enhanced').check();select();panel.locator('[data-step="1"]:enabled').first.click()
        page.locator('#contest-loadout-enhanced').uncheck();assert panel.locator('output').count()==0 or all(value=='0' for value in panel.locator('output').all_text_contents())
        page.locator('#contest-loadout-enhanced').check();panel.locator('[data-step="1"]:enabled').first.click()
        for width in [1280,375]:
            page.set_viewport_size({'width':width,'height':1000 if width==1280 else 850});assert page.locator('#contest-loadout-editor').evaluate('e=>e.scrollWidth<=e.clientWidth');expect(panel).to_be_visible();expect(page.locator('.contest-loadout-footer .primary')).to_be_visible();assert panel.locator('xpath=..').get_attribute('class')=='contest-loadout-footer contest-card-footer'
            if width==375:assert page.locator('.contest-loadout-footer .primary').bounding_box()['y']>=panel.bounding_box()['y']+panel.bounding_box()['height']
            page.locator('#contest-loadout-editor').screenshot(path=f'local/ui-visual-refinement/contest-customizer-{width}.png')
        page.locator('.contest-loadout-footer .primary').click();expect(page.locator('#contest-loadout-editor')).not_to_be_visible();expect(board.locator(f'[data-config-id="{candidate["id"]}"] .selection-custom-count').last).to_have_text('1');
        # 用同一个实际编辑器验证未强化卡打开后直接应用不会被悄悄强化。
        page.evaluate('''async id=>{const {contestCustomizationCatalog}=await import('./domain/catalog.mjs'),{openContestLoadoutEditor}=await import('./ui/contest-loadout-editor.mjs'),{prepareSnapshot}=await import('./domain/model.mjs');const data=await(await fetch('./resources/preview-account.json')).json(),snapshot=await prepareSnapshot(data.documents.find(d=>d.source==='user_get'));const memory=snapshot.memories.find(m=>m.key===document.querySelector('[data-memory-index="0"] .season-memory-board').dataset.memoryKey);window.linkedOriginal={id,upgradeCount:0,customizes:[]};openContestLoadoutEditor({catalog:contestCustomizationCatalog(),memory,memoryIndex:0,slotIndex:2,current:window.linkedOriginal,onApply:value=>window.linkedApplied=value});}''',candidate['id'])
        expect(page.locator('#contest-loadout-enhanced')).not_to_be_checked();page.locator('.contest-loadout-footer .primary').click()
        assert page.evaluate('JSON.stringify(window.linkedOriginal)===JSON.stringify(window.linkedApplied)')
        assert not errors and not uploads,(errors,uploads);browser.close()
    print('附魔短名称、加减与上限、换卡清空、强化重置、取消隔离、应用及桌面/窄屏布局验证通过。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
