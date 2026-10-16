"""通过真实导入、列表、详情和刷新验证合成状态标签，不读取真实账号。"""
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect
from browser_artifacts import artifact_path
from browser_static import ROOT, fixtures


def check_badges(scope, available, inherited, in_use, protected, language='zh-CN'):
    labels = ('合成可能', '合成済み', 'ロック済み') if language == 'ja' else ('可合成', '已合成', '已锁定')
    hints = (('素材メモリーを消費し、同ランクのスキルカードと入れ替え可能。回数制限あり',
              'スキルカード入れ替え済み。他のスキルカードは入れ替え不可',
              'コンテスト・アイドルへの道などの編成で使用中', 'ロックで保護されているため削除不可')
             if language == 'ja' else
             ('消耗素材回忆，置换同阶技能卡，次数有限', '已置换技能卡，不能再置换其他技能卡',
              '已编入比赛、偶像之路等卡组', '已加锁保护，无法移除'))
    for selector, count, label, hint in [('.memory-can-inherit', available, labels[0], hints[0]),
                                        ('.memory-inherited', inherited, labels[1], hints[1]),
                                        ('.badge.in-use', in_use, '使用中', hints[2]),
                                        ('.badge.protection', protected, labels[2], hints[3])]:
        badge = scope.locator(selector)
        expect(badge).to_have_count(count)
        if count:
            expect(badge).to_be_visible()
            expect(badge).to_have_text(label)
            expect(badge).to_have_attribute('title', hint)
            expect(badge).to_have_attribute('aria-description', hint)
    if in_use and protected:
        styles = scope.locator('.badge.in-use, .badge.protection').evaluate_all('''nodes => nodes.map(node => {
            const style = getComputedStyle(node);
            return ['color', 'backgroundColor', 'borderColor', 'fontSize', 'fontWeight'].map(key => style[key]);
        })''')
        assert styles[0] == styles[1], styles
        expect(scope.locator('.badge.in-use svg')).to_be_visible()
        assert scope.locator('.badge.in-use svg').inner_html() != scope.locator('.badge.protection svg').inner_html()


def check(url):
    docs = fixtures()
    base = dict(docs['capture']['memories'][0])
    base.pop('isInUse', None)
    cards = [base['produceCard']]
    cases = [('available', {'inheritCount': 0, 'examBattleProduceCards': cards, 'isInUse': True, 'isProtected': True}, 1, 0, 1, 1),
             ('used', {'inheritCount': 2, 'examBattleProduceCards': cards, 'isInUse': False, 'isProtected': True}, 0, 1, 0, 1),
             ('unknown', {'examBattleProduceCards': cards, 'isProtected': False}, 0, 0, 0, 0),
             ('training', {'inheritCount': 0, 'examBattleProduceCards': [], 'isInUse': True, 'isProtected': False}, 0, 0, 1, 0)]
    docs['capture']['memories'] = [{**base, 'userMemoryId': 'synthetic-inherit-' + name, **fields} for name, fields, *_ in cases]
    docs['capture']['count'] = len(cases)
    with TemporaryDirectory(dir=ROOT/'local', prefix='memory-inherit-') as temporary, sync_playwright() as p:
        folder = Path(temporary)
        for name, document in docs.items():
            file = folder/name/'snapshot.json'
            file.parent.mkdir(parents=True)
            file.write_text(json.dumps(document), encoding='utf-8')
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1280, 'height': 1000})
        errors, uploads = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.context.on('request', lambda request: uploads.append((request.method, request.url)) if request.method not in ('GET', 'HEAD') or request.post_data else None)
        page.goto(url, wait_until='networkidle')
        page.locator('#account-directory-files').set_input_files(str(folder))
        for refreshed in [False, True]:
            if refreshed:
                page.reload(wait_until='networkidle')
            expect(page.locator('#inventory')).to_be_visible(timeout=60000)
            for name, _, count, used, in_use, protected in cases:
                key = hashlib.sha256(('synthetic-inherit-' + name).encode()).hexdigest()
                row = page.locator(f'.memory-row[data-memory-key="{key}"]')
                row.evaluate("node => node.scrollIntoView({block: 'center', behavior: 'instant'})")
                expect(row.locator('.memory-detail-open')).to_be_visible()
                check_badges(row, count, used, in_use, protected)
                row.locator('.memory-detail-open').click()
                check_badges(page.locator('#detail-content'), count, used, in_use, protected)
                page.locator('#close-detail').click()
        for width in [1280, 375]:
            page.set_viewport_size({'width': width, 'height': 1000})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert page.locator('.memory-row').evaluate_all('nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)')
            assert page.locator('.memory-card-status').evaluate_all('nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)')
            page.locator('#list').screenshot(path=artifact_path(ROOT/f'local/checks/memory-in-use-list-{width}.png'))
            key = hashlib.sha256(b'synthetic-inherit-available').hexdigest()
            page.locator(f'.memory-row[data-memory-key="{key}"] .memory-detail-open').click()
            detail = page.locator('#detail-content')
            check_badges(detail, 1, 0, 1, 1)
            assert detail.evaluate('node => node.scrollWidth <= node.clientWidth + 1')
            assert detail.locator('.memory-detail-summary').evaluate('node => node.scrollWidth <= node.clientWidth + 1')
            page.locator('#detail-dialog').screenshot(path=artifact_path(ROOT/f'local/checks/memory-in-use-detail-{width}.png'))
            page.locator('#close-detail').click()
        page.locator('#language').select_option('ja')
        for name, _, count, used, in_use, protected in cases:
            key = hashlib.sha256(('synthetic-inherit-' + name).encode()).hexdigest()
            row = page.locator(f'.memory-row[data-memory-key="{key}"]')
            row.evaluate("node => node.scrollIntoView({block: 'center', behavior: 'instant'})")
            expect(row.locator('.memory-detail-open')).to_be_visible()
            check_badges(row, count, used, in_use, protected, 'ja')
            row.locator('.memory-detail-open').click()
            check_badges(page.locator('#detail-content'), count, used, in_use, protected, 'ja')
            page.locator('#close-detail').click()
        assert not errors and not uploads, (errors, uploads)
        browser.close()
    print('合成次数与使用中状态真实导入、刷新保留；中日文列表与详情区分使用中、已锁定及未知；1280／375px 无溢出、无上传和页面错误。')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    check(parser.parse_args().url)
