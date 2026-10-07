"""回归检查培养阵容跳转支援卡后，手动页签导航不会被旧链接拉回。"""
import argparse
import json
from tempfile import TemporaryDirectory
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_static import fixtures, ROOT


def check(url):
    documents = fixtures()
    support_id = json.loads((ROOT/'tests/fixtures/public-data/supports.json').read_text())['cards'][0]['id']
    documents['capture']['supportCards'] = [{'supportCardId': support_id, 'level': 10, 'levelLimitRank': 0, 'stockQuantity': 0, 'createdTime': 0}]
    documents['selectiondetail']['supportCards'] = [{'number': 1, 'supportCardId': support_id, 'level': 20,
        'levelLimitRank': 1, 'isRental': False, 'produceSkills': [], 'eventDetailIds': []}]
    with TemporaryDirectory(dir=ROOT/'local', prefix='catalog-navigation-') as temporary, sync_playwright() as driver:
        folder = Path(temporary)/'account'
        for name, document in documents.items():
            target = folder/name/'snapshot.json'; target.parent.mkdir(parents=True)
            target.write_text(json.dumps(document))
        browser = driver.chromium.launch()
        page = browser.new_page(); errors = []; uploads = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: uploads.append(request.url) if request.post_data else None)
        page.goto(url, wait_until='networkidle')
        page.locator('#account-directory-files').set_input_files(str(folder))
        expect(page.locator('#inventory')).to_be_visible(timeout=30000)
        for clear_filters in [False, True]:
            page.locator('[data-tab="selectionMemories"]').click()
            page.locator('.selection-details-button').first.click()
            page.locator('.selection-detail-support-card').click()
            expect(page.locator('#section-title')).to_have_text('支援卡')
            expect(page.locator('#search')).to_have_value(support_id)
            assert 'level=20' in page.url
            if clear_filters:
                page.locator('#search-clear').click()
                expect(page.locator('#search')).to_have_value('')
            for tab, title in [('memories', '回忆'), ('idolCards', '偶像卡'), ('selectionMemories', '选拔回忆')]:
                page.locator(f'[data-tab="{tab}"]').click()
                expect(page.locator('#section-title')).to_have_text(title, timeout=5000)
                assert '#' not in page.url
        assert not errors, errors
        assert not uploads, uploads
        browser.close()
    print('培养阵容支援卡跳转、直接切换页签、清除筛选后切换页签均通过；无脚本异常或数据上传。')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8080/')
    check(parser.parse_args().url)
