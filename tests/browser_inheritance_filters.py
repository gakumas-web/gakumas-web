"""验证继承筛选开关的交集、保存恢复、清空和桌面／手机布局。"""
import argparse
import re
from playwright.sync_api import sync_playwright, expect
from browser_artifacts import artifact_path


def check(url):
    with sync_playwright() as driver:
        browser = driver.chromium.launch()
        page = browser.new_page(viewport={'width': 1280, 'height': 1000})
        errors, requests = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append((request.method, request.post_data)))
        page.goto(url, wait_until='networkidle')
        page.locator('#data-open').click()
        page.locator('#enable-preview-account').click()
        expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        expect(page.locator('#count-memories')).to_have_text(re.compile(r'^\d+$'), timeout=60000)
        counts = page.evaluate("""async()=>{
          const {workspaceData}=await import('./application/storage.mjs');
          const {snapshot}=await workspaceData(document.querySelector('#profile').value);
          const start=m=>m.produceCard&&m.produceCardPhaseType===1;
          const custom=m=>m.produceCard?.customizes?.some(value=>value.customizeCount>0);
          return {total:snapshot.memories.length,start:snapshot.memories.filter(start).length,
            custom:snapshot.memories.filter(custom).length,both:snapshot.memories.filter(m=>start(m)&&custom(m)).length};
        }""")
        assert 0 < counts['both'] <= min(counts['start'], counts['custom']) < counts['total']

        def count(value):
            expect(page.locator('#count-memories')).to_have_text(str(value) if value == counts['total'] else f"{value} / {counts['total']}")

        def expand():
            if page.locator('#filter-toggle').get_attribute('aria-expanded') != 'true':
                page.locator('#filter-toggle').click()

        expand()
        start = page.locator('#inheritance-start-only')
        custom = page.locator('#inheritance-customized-only')
        expect(start).not_to_be_checked()
        expect(custom).not_to_be_checked()
        start.check(); count(counts['start'])
        expect(start).to_be_focused()
        custom.check(); count(counts['both'])
        expect(page.locator('#active-filters [data-filter-key=inheritanceStartOnly]')).to_contain_text('仅显示开始时获得')
        expect(page.locator('#active-filters [data-filter-key=inheritanceCustomizedOnly]')).to_contain_text('仅显示已附魔')
        page.once('dialog', lambda dialog: dialog.accept('开局附魔'))
        page.locator('#save-view').click()
        page.reload(wait_until='networkidle')
        expect(start).to_be_checked(timeout=60000)
        expect(custom).to_be_checked()
        count(counts['both'])
        page.locator('#active-filters [data-filter-key=inheritanceStartOnly]').click()
        count(counts['custom'])
        expand()
        expect(start).not_to_be_checked()
        page.locator('#reset-filters').click()
        expect(custom).not_to_be_checked(); count(counts['total'])
        page.locator('#saved-view').select_option(label='开局附魔')
        expect(start).to_be_checked(); expect(custom).to_be_checked(); count(counts['both'])
        for width in [1280, 375]:
            page.set_viewport_size({'width': width, 'height': 1000})
            expand()
            for control in [start, custom]:
                expect(control).to_be_visible()
                box = control.locator('..').bounding_box()
                assert box and box['x'] >= 0 and box['x'] + box['width'] <= width
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.locator('#inheritance-expression').screenshot(path=str(artifact_path(f'local/checks/inheritance-filters-{width}.png')))
        assert not errors, errors
        assert all(method in ('GET', 'HEAD') and not body for method, body in requests)
        print('继承筛选：单项与交集、保存恢复、标签移除、清空、桌面和手机布局及只读请求均通过。')
        browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:18765/')
    check(parser.parse_args().url)
