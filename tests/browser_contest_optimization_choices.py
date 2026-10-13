"""通过内置合成预览核对偶像卡计数、切换隔离、评级提示与图片选择入口。"""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]

def check(url):
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#season-simulation-open')).to_be_enabled(timeout=60000)
        page.locator('#season-simulation-open').click();tabs=page.locator('.simulation-mode-tabs');expect(tabs).to_be_visible(timeout=60000)
        expect(tabs.locator('[data-mode=optimization]')).to_have_text('自定义推荐编组模拟');tabs.locator('[data-mode=optimization]').click();panel=page.locator('#contest-optimization')
        expected=page.evaluate('''async()=>{
          const c=await import('./domain/catalog.mjs'),data=await(await fetch('./resources/preview-account.json')).json(),stage=c.contestCatalog().choices.find(row=>row.id===document.querySelector('.season-stage-tab[aria-selected=true]').dataset.stageId),plan=stage.planType.replace('ProducePlanType_','');
          const counts={};for(const card of new Map(data.documents.find(doc=>Array.isArray(doc.idolCards)).idolCards.map(card=>[card.idolCardId,card])).values()){const info=c.idolInfo(card);if(info.cardResolved&&(plan==='Common'||info.plan===plan))counts[info.characterId]=(counts[info.characterId]??0)+1;}return counts;
        }''')
        actual=panel.locator('.recommendation-character').evaluate_all('nodes=>Object.fromEntries(nodes.map(node=>[node.dataset.characterId,Number(node.querySelector(".recommendation-character-count").textContent)]))')
        assert actual==expected and len(actual)>1
        panel.locator('[data-optimization-attribute=vocal]').fill('1999')
        for button in panel.locator('.recommendation-character').all()[:3]:
            character=button.get_attribute('data-character-id');button.click();expect(button).to_have_attribute('aria-checked','true')
            panel.locator('[data-slot="0"] .season-memory-slot-pick').click();dialog=page.locator('.optimization-picker');expect(dialog).to_be_visible()
            ids=dialog.locator('[data-choice-id]').evaluate_all('nodes=>nodes.map(node=>node.dataset.choiceId)')
            owners=page.evaluate('''async ids=>{const c=await import('./domain/catalog.mjs');return c.contestCustomizationCatalog().cards.filter(card=>ids.includes(card.id)).map(card=>card.metadata.ownerCharacterId);}''',ids)
            assert ids and owners and all(owner==character for owner in owners)
            chosen=dialog.locator('[data-choice-id]').last.get_attribute('data-choice-id');dialog.locator('[data-choice-id]').last.click();dialog.locator('.optimization-picker-confirm').click();expect(panel.locator('[data-optimization-attribute=vocal]')).to_have_value('1999')
            expected_item=page.evaluate('''async id=>{const c=await import('./domain/catalog.mjs'),data=await(await fetch('./resources/preview-account.json')).json(),choice=c.contestCustomizationCatalog().cards.find(card=>card.id===id),held=data.documents.find(doc=>Array.isArray(doc.idolCards)).idolCards.find(card=>card.idolCardId===choice.idolCardId),item=c.progressionInfo('idol',held).changes.find(row=>row.beforeItem).beforeItem;return c.itemRewardInfo(item).name;}''',chosen)
            expect(panel.locator('[data-optimization-item="0"]')).to_be_enabled();assert expected_item in panel.locator('[data-optimization-item="0"]').get_attribute('aria-label')
        panel.locator('.optimization-help>summary').click();rules=panel.locator('.contest-customization-table');before=rules.inner_text();grade=panel.locator('[data-optimization-grade="0"]');grade.select_option('9');assert rules.inner_text()==before;grade.select_option('15')
        expect(rules.locator('[data-rank="A+"]')).to_have_text('A+ 及以下———')
        expect(rules.locator('tbody tr')).to_have_count(5)
        expect(rules.locator('[data-rank="S"]')).to_have_text('S0～1 张0～1 张0～1 张')
        expect(rules.locator('[data-rank="SSS"]')).to_contain_text('1～2 张')
        expect(rules.locator('[data-rank="SSS+"]')).to_have_text('SSS+～S5 及以上（暂定）1 张1 张2 张')
        expect(panel.locator('.optimization-rule-hint')).to_have_count(0)
        expect(grade.locator('option[value="19"]')).to_have_count(0)
        expect(panel.locator('.recommendation-algorithm>summary')).to_have_text('推荐算法')
        expect(panel.locator('.contest-capacity-ranges>summary')).to_have_text('评级与卡组容量区间、附魔次数和 P 道具个数')
        for settings in panel.locator('.optimization-role-settings').all():
            expect(settings).not_to_contain_text('卡组容量');expect(settings).not_to_contain_text('附魔上限')
        expect(panel.get_by_role('link',name='附魔规则来源')).to_have_count(0)
        panel.locator('.contest-capacity-ranges>summary').click()
        for width in [1280,375]:
            page.set_viewport_size({'width':width,'height':1000});assert panel.evaluate('node=>node.scrollWidth<=node.clientWidth');panel.screenshot(path=str(ROOT/'local/ui-visual-refinement'/f'optimization-redesign-{width}.png'))
        assert not errors,errors;browser.close()
    print('偶像卡按计划去重计数、角色切换与卡槽隔离、总属性保留、自动评级规则及双屏宽检查通过。')

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
