"""纯静态发布验收：合成账号导入、六页签、加密备份及请求隐私边界。"""

import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ACCOUNT = 'synthetic-static-private-account'
PASSWORD = 'synthetic-only-password-2026'


def fixtures():
    catalog = json.loads((ROOT/'tests/fixtures/public-data/idols.json').read_text(encoding='utf-8'))
    idol = catalog['cards'][0]
    character = idol.get('characterId', 'hski')
    card = {'id': 'synthetic-skill', 'upgradeCount': 0, 'customizes': []}
    memory = {'userMemoryId': 'synthetic-memory', 'characterId': character, 'idolCardId': idol['id'],
              'memoryTagId': '', 'shotTime': 0, 'isProtected': False, 'grade': 1,
              'planType': 2, 'power': 1234, 'vocal': 100, 'dance': 200, 'visual': 300, 'stamina': 40,
              'produceCard': card, 'produceCardPhaseType': 1, 'abilities': [],
              'examBattleProduceCards': [], 'examBattleProduceItemIds': [], 'unitCharacters': [], 'researchId': 'synthetic-event'}
    ordinary = {'format': 'gakumas-capture', 'schema_version': 1, 'source': 'user_get', 'publicUserId': ACCOUNT,
                'captured_at': '2026-01-01T00:00:00Z', 'count': 1, 'memories': [memory],
                'idolCards': [{'idolCardId': idol['id'], 'levelLimitRank': 0, 'potentialRank': 0, 'idolCardSkinId': '', 'primaStellaUpgradedTime': 0}],
                'items': [], 'idolCardSkins': [], 'supportCards': [], 'characters': [], 'achievements': []}
    selected = dict.fromkeys(['memoryTagId', 'assetId', 'produceId', 'idolCardSkinId', 'researchId'], '')
    selected.update(dict.fromkeys(['grade', 'idolCardLevelLimitRank', 'idolCardPotentialRank', 'star',
                                  'vocalGrowthRatePermil', 'danceGrowthRatePermil', 'visualGrowthRatePermil', 'clearedTime', 'lastUsedTime'], 0))
    selected.update(userSelectionMemoryId='synthetic-selection', characterId=character, idolCardId=idol['id'],
                    planType=2, vocal=100, dance=200, visual=300, stamina=40,
                    isProtected=False, isPrimaStella=False, produceCards=[], produceItems=[], produceCustomizeItems=[])
    selection = {'format': 'gakumas-capture', 'schema_version': 1, 'source': 'selection_memory_list', 'publicUserId': ACCOUNT,
                 'captured_at': ordinary['captured_at'], 'count': 1, 'selectionMemories': [selected], 'eventExpiredSelectionMemoryIds': []}
    detail = {'format': 'gakumas-capture', 'schema_version': 1, 'source': 'selection_memory_get', 'publicUserId': ACCOUNT,
              'captured_at': ordinary['captured_at'], 'userSelectionMemoryId': 'synthetic-selection', 'memories': [], 'supportCards': []}
    return {'capture': ordinary, 'selection': selection, 'selectiondetail': detail}


def check_achievement_signatures(page):
    # 检查真实渲染路径，避免把角色对象误当成资源名后生成 undefined 地址。
    result = page.evaluate('''async () => {
        const {assetURL} = await import('./resources.mjs');
        const {characterInfo} = await import('./domain/catalog.mjs');
        const images = [...document.querySelectorAll('.character-signature')];
        return Promise.all(images.map(async image => {
            const id = image.closest('[data-character-portal]').dataset.characterPortal;
            const expected = assetURL(characterInfo(id).signature);
            const probe = new Image();
            probe.src = image.src;
            try { await probe.decode(); } catch { return false; }
            return image.src === expected && probe.naturalWidth > 0;
        }));
    }''')
    assert result and all(result), '角色签名路径或图片解码失败'


def check_achievement_gallery_images(page):
    # 直接检查页面图片，不用额外 Image 请求掩盖懒加载没有触发的问题。
    expect(page.locator('.character-gallery')).to_be_visible(timeout=15000)
    # 批量 decode() 在图片已完成加载时也可能拒绝；等待实际元素的加载状态，仍要求全部立即加载。
    page.wait_for_function('''() => {
        const images = [...document.querySelectorAll('.character-gallery img, .character-quick-nav img')];
        return images.length > 0 && images.every(image =>
            image.loading === 'eager' && image.complete && image.naturalWidth > 0 && !image.hidden);
    }''',timeout=15000)


def check(url, browser_path=None, content_bundle=None):
    origin = urlsplit(url)
    expected_origin = (origin.scheme, origin.netloc)
    requests, errors = [], []
    (ROOT/'local').mkdir(exist_ok=True)
    with TemporaryDirectory(prefix='static-browser-', dir=ROOT/'local') as temporary, sync_playwright() as driver:
        folder = Path(temporary)/'account'
        for name, document in fixtures().items():
            target = folder/name/'snapshot.json'
            target.parent.mkdir(parents=True)
            target.write_text(json.dumps(document), encoding='utf-8')
        browser = driver.chromium.launch(headless=True, **({'executable_path': browser_path} if browser_path else {}))
        try:
            context = browser.new_context(accept_downloads=True)
            context.add_init_script("""localStorage.setItem('memory-active-profile','main');
                localStorage.setItem('memory-workbench:main:stable','broken-legacy-note');""")
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            def request_seen(request):
                requests.append((request.url, request.method, request.post_data or ''))
            context.on('request', request_seen)
            # 外部图片不属于库存逻辑验收，避免测试依赖第三方可用性。
            def route_request(route):
                target = urlsplit(route.request.url)
                if (target.scheme, target.netloc) != expected_origin:
                    route.abort()
                else:
                    route.continue_()
            context.route('**/*', route_request)
            page.goto(url, wait_until='networkidle')
            if content_bundle:
                page.locator('#data-open').click()
                page.locator('#content-file').set_input_files(str(content_bundle))
                expect(page.locator('#content-version')).to_contain_text('当前资料版本',timeout=30000)
                page.locator('#close-data').click()
            expect(page.locator('#empty')).to_be_visible()
            expect(page.locator('#profile')).to_have_value('')
            expect(page.locator('#empty-import-account')).to_be_enabled()
            page.locator('#account-directory-files').set_input_files(str(folder))
            expect(page.locator('#message')).to_contain_text('账号目录已导入')
            expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
            for tab in ['memories', 'selectionMemories', 'idolCards', 'supportCards', 'idolCardSkins', 'achievements']:
                page.locator(f'[data-tab="{tab}"]').click()
                page.wait_for_load_state('networkidle')
                expect(page.locator(f'[data-tab="{tab}"]')).to_have_attribute('aria-pressed', 'true')
            check_achievement_gallery_images(page)
            check_achievement_signatures(page)
            page.reload(wait_until='networkidle')
            expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
            page.locator('#data-open').click()
            page.locator('#export-account-package').click()
            page.locator('#package-export-encrypted').check()
            page.locator('#package-password').fill(PASSWORD)
            page.locator('#package-password-confirm').fill(PASSWORD)
            with page.expect_download() as download:
                page.locator('#package-download').click()
            backup = Path(temporary)/'encrypted.json'
            download.value.save_as(str(backup))
            content = backup.read_bytes()
            assert ACCOUNT.encode() not in content and PASSWORD.encode() not in content
            if page.locator('#account-package-dialog').is_visible():
                page.locator('#close-package').click()
            page.locator('#clear-account').click()
            expect(page.locator('#account-cleanup-dialog')).to_be_visible()
            page.locator('#account-cleanup-confirmed').check()
            page.locator('#confirm-account-cleanup').click()
            expect(page.locator('#account-cleanup-dialog')).not_to_be_visible()
            expect(page.locator('#profile')).to_have_value('')
            assert page.evaluate("localStorage.getItem('memory-workbench:main:stable')") == 'broken-legacy-note'
            page.locator('#account-package-file').set_input_files(str(backup))
            expect(page.locator('#account-package-dialog')).to_be_visible()
            page.locator('#package-import-password').fill(PASSWORD)
            page.locator('#package-decrypt').click()
            expect(page.locator('#package-apply')).to_be_enabled()
            page.locator('#package-apply').click()
            expect(page.locator('#message')).to_contain_text('账号数据包已导入')
            assert PASSWORD not in page.evaluate('JSON.stringify(localStorage)')
            assert not errors, errors
            for request_url, method, body in requests:
                assert ACCOUNT not in request_url+body and PASSWORD not in request_url+body
                assert method in ('GET', 'HEAD'), '发现非静态请求'
                assert '/api/' not in request_url, '仍依赖运行时 API'
                target = urlsplit(request_url)
                if (target.scheme, target.netloc) == expected_origin:
                    assert target.path.startswith(origin.path), '资源逃逸部署子目录'
            resource_mode = page.evaluate("async () => (await import('./image-config.mjs')).imageConfig.mode")
            external_requests = sum((urlsplit(value).scheme, urlsplit(value).netloc) != expected_origin for value, _, _ in requests)
            if resource_mode == 'none':
                assert external_requests == 0, '默认或本地资源模式不应请求第三方图片'
            loaded = page.evaluate('performance.getEntriesByType("resource").filter(x=>x.name.includes("/content/releases/")&&x.name.endsWith(".json")).map(x=>({bytes:x.transferSize,duration:Math.round(x.duration)}))')
            return {'url': url, 'tabs': 6, 'account_import': True, 'encrypted_backup': True, 'account_cleanup_restore': True, 'legacy_storage_ignored': True,
                    'resource_mode': resource_mode, 'external_requests': external_requests, 'inventory_uploads': 0, 'page_errors': 0, 'static_requests': len(requests), 'master_requests': loaded}
        finally:
            browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8080/')
    parser.add_argument('--browser')
    parser.add_argument('--content-bundle',type=Path)
    args = parser.parse_args()
    print(json.dumps(check(args.url, args.browser, args.content_bundle), ensure_ascii=False))
