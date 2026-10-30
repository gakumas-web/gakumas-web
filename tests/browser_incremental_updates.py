"""通过真实页面验证搜索、筛选、分页、收藏和成就操作的局部更新。"""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from browser_artifacts import artifact_path
from browser_custom_tag_export import account_documents, write_account, import_account
from browser_static import ROOT
from browser_tag_updates import wait_catalog

ACCOUNT = 'synthetic-incremental-updates'


def capture(page, selectors):
    page.evaluate('''selectors => {
      window.incrementalProbe={nodes:Object.fromEntries(Object.entries(selectors).map(([name,selector])=>[name,document.querySelector(selector)])),scroll:scrollY};
      for(const [name,node] of Object.entries(window.incrementalProbe.nodes))if(!node)throw Error('Missing probe: '+name);
    }''', selectors)


def verify(page, reports, name, baseline, retained=None):
    result = page.evaluate('''() => {
      const probe=window.incrementalProbe;
      return {retained:Object.fromEntries(Object.entries(probe.nodes).map(([name,node])=>[name,node.isConnected])),scrollDelta:scrollY-probe.scroll};
    }''')
    reports[name] = result
    if not baseline:
        for key in retained if retained is not None else result['retained']:
            assert result['retained'][key], (name, result)


def check(url, baseline=False):
    reports = {}
    with TemporaryDirectory(prefix='incremental-updates-', dir=ROOT/'local') as temporary, sync_playwright() as driver:
        folder = write_account(Path(temporary), ACCOUNT, account_documents(ACCOUNT))
        browser = driver.chromium.launch(headless=True)
        try:
            for width in [1440, 375]:
                context = browser.new_context(viewport={'width': width, 'height': 1000})
                page = context.new_page()
                errors, uploads, results = [], [], {}
                page.on('pageerror', lambda error: errors.append(str(error)))
                context.on('request', lambda request: uploads.append(request.url) if request.post_data else None)
                page.goto(url, wait_until='networkidle')
                import_account(page, folder, ACCOUNT)
                expect(page.locator('#list .memory-card')).to_have_count(40, timeout=60000)
                wait_catalog(page, 'memories')
                first = page.locator('#list .memory-card').first
                key = first.get_attribute('data-memory-key')
                card = f'#list [data-memory-key="{key}"]'
                controls = {'character_choice': '#memory-character-chips button', 'plan_choice': '#memory-plan-chips button'}
                capture(page, {**controls, 'card': card, 'image': card+' img'})
                page.locator('#search').fill(key)
                expect(page.locator('#list .memory-card')).to_have_count(1)
                verify(page, results, 'memory_search', baseline)
                capture(page, {**controls, 'card': card})
                page.locator('#search-clear').click()
                expect(page.locator('#list .memory-card')).to_have_count(40)
                verify(page, results, 'memory_search_clear', baseline)

                if not page.locator('#memory-plan-chips').is_visible():
                    page.locator('#filter-toggle').click()
                capture(page, {'character_choice': controls['character_choice'], 'card': card})
                page.locator('#memory-plan-chips button[data-value="2"]').click()
                expect(page.locator('#memory-plan-chips button[data-value="2"]')).to_have_attribute('aria-pressed', 'true')
                verify(page, results, 'memory_filter', baseline)
                capture(page, {'character_choice': controls['character_choice'], 'card': card})
                page.locator('#clear-active-filters').click()
                expect(page.locator('#memory-plan-chips button[data-value="2"]')).to_have_attribute('aria-pressed', 'false')
                verify(page, results, 'memory_filter_clear', baseline)

                capture(page, controls)
                page.locator('#next').click()
                expect(page.locator('#list .memory-card')).to_have_count(18)
                expect(page.locator('#page-number')).to_have_text('2 / 2 页')
                verify(page, results, 'memory_page', baseline)
                page.locator('#previous').click()
                expect(page.locator('#list .memory-card')).to_have_count(40)

                # 两张收藏进入收藏视图；取消一张时保留另一张，避免再次加载图片。
                cards = page.locator('#list .memory-card')
                cards.nth(0).locator('.favorite-button').click()
                cards.nth(1).locator('.favorite-button').click()
                second_key = cards.nth(1).get_attribute('data-memory-key')
                page.locator('#memory-favorites-only').check()
                expect(page.locator('#list .memory-card')).to_have_count(2)
                capture(page, {**controls, 'remaining_card': f'#list [data-memory-key="{second_key}"]'})
                page.locator('#list .memory-card').first.locator('.favorite-button').click()
                expect(page.locator('#list .memory-card')).to_have_count(1)
                verify(page, results, 'favorite_remove', baseline)
                page.locator('#memory-favorites-only').uncheck()

                for tab, attr, choice in [
                    ('selectionMemories', 'data-selection-key', '#selection-plan-chips button'),
                    ('idolCards', 'data-idol-id', '#idol-plan-chips button'),
                    ('supportCards', 'data-support-id', '#support-plan-chips button'),
                ]:
                    page.locator(f'[data-tab="{tab}"]').click()
                    wait_catalog(page, tab)
                    if tab != 'selectionMemories':
                        page.locator('#owned-only').click()
                    rows = page.locator('#list > article')
                    expect(rows.first).to_be_visible()
                    identifier = rows.first.get_attribute(attr)
                    selector = f'#list [{attr}="{identifier}"]'
                    count = rows.count()
                    capture(page, {'card': selector, 'image': selector+' img', 'choice': choice})
                    page.locator('#search').fill(identifier)
                    expect(rows).to_have_count(1)
                    verify(page, results, tab+'_search', baseline)
                    capture(page, {'card': selector, 'choice': choice})
                    page.locator('#search-clear').click()
                    expect(rows).to_have_count(count)
                    verify(page, results, tab+'_clear', baseline)

                page.locator('[data-tab="idolCardSkins"]').click()
                wait_catalog(page, 'idolCardSkins')
                page.locator('#owned-only').click()
                expect(page.locator('#list > article').first).to_be_visible()
                skin_key = page.locator('#list > article').first.get_attribute('data-skin-id')
                skin_selector = f'#list [data-skin-id="{skin_key}"]'
                skin_name = page.evaluate('''async id=>(await import('./domain/catalog.mjs')).skinInfo({idolCardSkinId:id}).name''', skin_key)
                capture(page, {'card': skin_selector, 'choice': '#skin-character-chips button'})
                page.locator('#search').fill(skin_name)
                expect(page.locator('#search-clear')).to_be_visible()
                page.wait_for_function('''() => document.querySelector('#count-idolCardSkins').textContent.includes('/')''')
                verify(page, results, 'skins_search', baseline)

                page.locator('[data-tab="achievements"]').click()
                wait_catalog(page, 'achievements')
                page.locator('[data-character-portal="hski"]').click()
                expect(page.locator('.character-detail-hero')).to_be_visible()
                ach = {'hero': '.character-detail-hero', 'hero_image': '.character-detail-hero img',
                       'navigation': '.character-quick-nav', 'ending': '.character-detail-endings',
                       'filter': '[data-achievement-filter="achievementState"]'}
                capture(page, ach)
                page.locator('[data-achievement-filter="achievementState"]').select_option('unachieved')
                expect(page.locator('[data-achievement-filter="achievementState"]')).to_have_value('unachieved')
                verify(page, results, 'achievement_state', baseline)
                capture(page, ach)
                page.locator('[data-achievement-filter="achievementSort"]').select_option('near')
                verify(page, results, 'achievement_sort', baseline)
                capture(page, ach)
                page.locator('#achievement-incomplete-first').click()
                expect(page.locator('#achievement-incomplete-first')).to_have_attribute('aria-checked', 'false')
                verify(page, results, 'achievement_priority', baseline)
                capture(page, ach)
                page.locator('[data-achievement-scope="card"]').click()
                expect(page.locator('[data-achievement-scope="card"]')).to_have_attribute('aria-pressed', 'true')
                verify(page, results, 'achievement_scope', baseline)
                # 角色和语言改变属于结构更新，必须显示新内容，不能误命中旧视图缓存。
                page.locator('[data-character-target="ttmr"]').click()
                expect(page.locator('[data-character-target="ttmr"]')).to_have_attribute('aria-current', 'true')
                expect(page.locator('.character-detail-title')).to_contain_text('月村')
                page.locator('#language').select_option('ja')
                expect(page.locator('.character-back')).not_to_have_text('返回角色一览')
                page.locator('#language').select_option('zh-CN')
                expect(page.locator('.character-back')).to_have_text('返回角色一览')

                screenshot = artifact_path(ROOT/f'local/checks/incremental-updates/{"before" if baseline else "after"}-{width}.png')
                page.screenshot(path=str(screenshot), full_page=False)
                assert not errors, errors
                assert not uploads, uploads
                reports[str(width)] = {'operations': results, 'page_errors': errors, 'uploads': uploads}
                context.close()
        finally:
            browser.close()
    report = artifact_path(ROOT/f'local/checks/incremental-updates/{"before" if baseline else "after"}.json')
    report.write_text(json.dumps({'url': url, 'baseline': baseline, 'viewports': reports}, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(reports, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:18765/')
    parser.add_argument('--baseline', action='store_true')
    args = parser.parse_args()
    check(args.url, args.baseline)
