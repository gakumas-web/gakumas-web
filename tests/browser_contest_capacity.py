"""验证模拟编组单卡容量、标题合计及换卡后的超限提示。"""
from browser_artifacts import artifact_path
from browser_simulation_helpers import select_season
from playwright.sync_api import sync_playwright,expect


def check():
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('http://127.0.0.1:18765/',wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        page.locator('#season-simulation-open').click();select_season(page,'contest:pvp_rate_config-53');page.locator('[data-stage-id="contest:pvp_rate_config-53:0"]').click();page.get_by_role('tab',name='自选编组模拟',exact=True).click();page.locator('.season-memory-slot-pick').first.click()
        options=page.locator('.contest-memory-option');index=options.evaluate_all("nodes=>nodes.findIndex(e=>['SSS+','SSS','SS+','SS','S+','S','A+','A','B+','B'].includes(e.querySelector('.memory-card-grade')?.textContent))");assert index>=0
        options.nth(index).locator('.contest-memory-choose').click();board=page.locator('[data-memory-index="0"]');expect(board.locator('.season-card-capacity')).to_have_count(6);total=board.locator('.contest-memory-capacity-total');assert int(total.inner_text())==sum(map(int,board.locator('.season-card-capacity').all_text_contents()));assert '主回忆（' in board.locator('.contest-memory-capacity').inner_text();assert board.locator('.contest-memory-cost').count()==0
        page.locator('.season-memory-slot-pick').nth(1).click();page.locator('.contest-memory-option .contest-memory-choose:enabled').first.click();expect(page.locator('[data-memory-index="1"] .contest-memory-capacity')).to_contain_text('副回忆（')
        for width in [1280,375]:
            page.set_viewport_size({'width':width,'height':1000});assert page.locator('#season-simulation-page').evaluate('e=>e.scrollWidth<=e.clientWidth');board.screenshot(path=artifact_path(f'local/ui-visual-refinement/contest-capacity-{width}.png'))
        page.set_viewport_size({'width':1280,'height':1000});page.locator('[data-customize-memory="0"]').click()
        for slot in range(1,6):
            board.locator(f'[data-edit-card="{slot}"]').click();page.locator('#contest-loadout-owned').uncheck();page.locator('#contest-loadout-enhanced').check()
            ids=page.locator('.contest-loadout-choice[data-source="common"]').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.choiceId)')
            target=page.evaluate('''async ids=>{const {contestSimulationReference}=await import('./domain/catalog.mjs');const {contestCardCost}=await import('./domain/contest-card-cost.mjs');return ids.find(id=>contestCardCost(contestSimulationReference('card',{id,upgradeCount:1,customizes:[]}).record)===204);}''',ids);assert target
            page.locator(f'.contest-loadout-choice[data-choice-id="{target}"] [role="radio"]').click();page.locator('.contest-loadout-footer .primary').click()
        expect(total).to_have_text('1020');expect(total).to_have_class('contest-memory-capacity-total is-overflow');assert total.evaluate('e=>getComputedStyle(e).color')=='rgb(198, 40, 40)';assert int(total.evaluate('e=>getComputedStyle(e).fontWeight'))>=700
        board.screenshot(path=artifact_path('local/ui-visual-refinement/contest-capacity-overflow.png'))
        for slot in range(1,6):
            edit=board.locator(f'[data-edit-card="{slot}"]')
            if edit.get_attribute('data-action')=='restore':edit.click()
            edit.click();page.locator('#contest-loadout-owned').uncheck();page.locator('#contest-loadout-enhanced').check()
            ids=page.locator('.contest-loadout-choice[data-source="common"]').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.choiceId)')
            target=page.evaluate('''async ids=>{const {contestSimulationReference}=await import('./domain/catalog.mjs');const {contestCardCost}=await import('./domain/contest-card-cost.mjs');return ids.find(id=>contestCardCost(contestSimulationReference('card',{id,upgradeCount:1,customizes:[]}).record)===39);}''',ids);assert target
            page.locator(f'.contest-loadout-choice[data-choice-id="{target}"] [role="radio"]').click();page.locator('.contest-loadout-footer .primary').click()
        expect(total).to_have_text('195');expect(total).to_have_class('contest-memory-capacity-total is-underflow');assert total.evaluate('e=>getComputedStyle(e).color')=='rgb(36, 92, 189)';assert int(total.evaluate('e=>getComputedStyle(e).fontWeight'))>=700
        board.screenshot(path=artifact_path('local/ui-visual-refinement/contest-capacity-underflow.png'));assert not errors,errors;browser.close()
    print('主副标题容量、六张卡单卡容量、桌面/窄屏及实际换卡超限红色/不足蓝色粗体验证通过。')


if __name__=='__main__':check()
