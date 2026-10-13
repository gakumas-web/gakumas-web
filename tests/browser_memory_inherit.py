"""通过真实导入、列表、详情和刷新验证可合成标签，不读取真实账号。"""
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect
from browser_static import ROOT, fixtures


def check(url):
    docs = fixtures()
    base = docs['capture']['memories'][0]
    cards = [base['produceCard']]
    cases = [('available', {'inheritCount': 0, 'examBattleProduceCards': cards}, 1),
             ('used', {'inheritCount': 1, 'examBattleProduceCards': cards}, 0),
             ('unknown', {'examBattleProduceCards': cards}, 0),
             ('training', {'inheritCount': 0, 'examBattleProduceCards': []}, 0)]
    docs['capture']['memories'] = [{**base, 'userMemoryId': 'synthetic-inherit-' + name, **fields} for name, fields, _ in cases]
    docs['capture']['count'] = len(cases)
    with TemporaryDirectory(dir=ROOT/'local', prefix='memory-inherit-') as temporary, sync_playwright() as p:
        folder = Path(temporary)
        for name, document in docs.items():
            file = folder/name/'snapshot.json'
            file.parent.mkdir(parents=True)
            file.write_text(json.dumps(document))
        browser = p.chromium.launch()
        page = browser.new_page()
        errors, uploads = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: uploads.append(request.url) if request.post_data else None)
        page.goto(url, wait_until='networkidle')
        page.locator('#account-directory-files').set_input_files(str(folder))
        for refreshed in [False, True]:
            if refreshed:
                page.reload(wait_until='networkidle')
            expect(page.locator('#inventory')).to_be_visible(timeout=60000)
            for name, _, count in cases:
                key = hashlib.sha256(('synthetic-inherit-' + name).encode()).hexdigest()
                row = page.locator(f'.memory-row[data-memory-key="{key}"]')
                expect(row).to_be_visible()
                expect(row.locator('.memory-can-inherit')).to_have_count(count)
                if count:
                    expect(row.locator('.memory-can-inherit')).to_have_text('可合成')
                row.locator('.memory-detail-open').click()
                expect(page.locator('#detail-content .memory-can-inherit')).to_have_count(count)
                page.locator('#close-detail').click()
        assert not errors and not uploads, (errors, uploads)
        browser.close()
    print('合成次数真实导入与刷新保留；列表及详情仅对有考试卡组且次数为零显示标签；无上传。')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    check(parser.parse_args().url)
