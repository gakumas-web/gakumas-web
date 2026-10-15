"""验证仅改变展示状态的开关保留列表节点、焦点与页码。"""
import argparse
from playwright.sync_api import sync_playwright,expect


def remember(page,selector):
    page.evaluate('selector=>{window.toggleNodes=[...document.querySelectorAll(selector)]}',selector)
    assert page.evaluate('toggleNodes.length>0')


def retained(page):
    assert page.evaluate('toggleNodes.every(node=>node.isConnected)')


def check(url):
    with sync_playwright() as driver:
        browser=driver.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click()
        expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        page.locator('[data-tab=idolCards]').click();expect(page.locator('.idol-card-art-options input').first).to_be_visible(timeout=60000)
        page.wait_for_load_state('networkidle')
        remember(page,'#list .idol-card:not(.deferred-entry)')
        switch=page.locator('.idol-card-art-options input').first;switch.click();expect(switch).to_be_focused();retained(page)
        favorite=page.locator('#list .favorite-button').first;favorite.click();expect(favorite).to_be_focused();retained(page)
        page.locator('[data-tab=selectionMemories]').click();expect(page.locator('.selection-loadout > summary').first).to_contain_text('已持有',timeout=60000)
        page.locator('#next').click();page.wait_for_load_state('networkidle')
        before=page.locator('#page-number').inner_text();assert not before.startswith('1 /')
        remember(page,'#list .selection-memory-card:not(.deferred-entry),#list .selection-artwork img')
        collapsed=page.locator('#selection-loadout-collapsed')
        collapsed.uncheck();expect(collapsed).to_be_focused();retained(page);expect(page.locator('#page-number')).to_have_text(before)
        expect(page.locator('#list .selection-loadout').first).to_have_attribute('open','')
        collapsed.check();expect(collapsed).to_be_focused();retained(page);expect(page.locator('#page-number')).to_have_text(before)
        expect(page.locator('#list .selection-loadout').first).not_to_have_attribute('open','')
        page.reload(wait_until='networkidle');expect(collapsed).to_be_checked(timeout=60000);expect(page.locator('#page-number')).to_have_text(before)
        page.locator('[data-tab=seasonSimulation]').click();expect(page.locator('#contest-simulation-result-title')).to_be_visible(timeout=60000)
        remember(page,'#season-simulation-page img');page.get_by_role('checkbox',name='模拟开启多核加速').click();retained(page)
        assert not errors,errors;browser.close()
    print('偶像卡面、收藏、多核开关保持局部更新；选拔默认折叠保留图片、焦点与第二页，并持久保存。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);check(parser.parse_args().url)
