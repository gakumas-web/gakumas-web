"""验证真实账号导入、转换采集基准、局部覆盖与再次导入；只使用合成账号。"""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright
from browser_artifacts import artifact_path
from browser_custom_tag_export import account_documents, write_account, import_account
from browser_static import ROOT

ACCOUNT = 'synthetic-captured-conversions'
OTHER = 'synthetic-captured-conversions-other'


def check(url):
    with TemporaryDirectory(prefix='captured-conversions-', dir=ROOT/'local') as temporary, sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors, uploads = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('request', lambda r: uploads.append(r.url) if r.post_data else None)
        page.goto(url, wait_until='networkidle')
        pairs = page.evaluate('''async()=>{
          await(await import('./application/master-loader.mjs')).loadMaster('seasonSimulation');
          return (await import('./domain/catalog.mjs')).contestCardConversions().slice(0,2);
        }''')
        assert len(pairs) == 2
        revision = 0

        def load(account, flags):
            nonlocal revision
            revision += 1
            docs = account_documents(account)
            docs['capture']['producerExp'] = 3281130
            docs['capture']['captured_at'] = f'2026-10-18T01:00:{revision:02d}Z'
            if flags is not None:
                docs['capture']['produceCardConversions'] = [
                    {key: row[key] for key in ['beforeProduceCardId', 'afterProduceCardId']} | {'enable': enabled}
                    for row, enabled in zip(pairs, flags)]
            folder = write_account(Path(temporary)/str(revision), account, docs)
            import_account(page, folder, account)
            page.locator('[data-tab="seasonSimulation"]').click()
            page.locator('.contest-card-conversions-open').first.click(timeout=60000)
            expect(page.locator('#contest-card-conversion-dialog')).to_be_visible()

        def row(index):
            return page.locator(f'#contest-card-conversion-dialog [data-conversion-id="{pairs[index]["beforeProduceCardId"]}"]')

        def selected(index, version):
            expect(row(index).locator(f'input[value="{version}"]')).to_be_checked()

        def close():
            page.locator('#contest-card-conversion-dialog').get_by_role('button', name='关闭', exact=True).click()

        def overrides(account=ACCOUNT):
            return page.evaluate("account=>JSON.parse(localStorage.getItem('gakumas-web:card-conversions:account-'+account)??'{}')", account)

        try:
            load(ACCOUNT, [False, True])
            selected(0, 'before'); selected(1, 'after')
            expect(page.locator('#contest-card-conversion-dialog')).to_contain_text('默认采用采集的游戏转换设置')
            row(0).locator('input[value="after"]').check()
            assert overrides() == {pairs[0]['beforeProduceCardId']: 'after'}
            close()
            load(ACCOUNT, [False, False])
            selected(0, 'after'); selected(1, 'before')
            assert overrides() == {pairs[0]['beforeProduceCardId']: 'after'}
            row(0).locator('input[value="before"]').check()
            assert overrides() == {}
            close()
            load(ACCOUNT, [True, False])
            selected(0, 'after'); selected(1, 'before')
            close()
            page.reload(wait_until='networkidle')
            page.locator('[data-tab="seasonSimulation"]').click()
            page.locator('.contest-card-conversions-open').first.click(timeout=60000)
            selected(0, 'after'); selected(1, 'before')
            close()
            load(OTHER, [False, True])
            selected(0, 'before'); selected(1, 'after')
            assert overrides(OTHER) == {}
            close()
            load(OTHER, [])
            selected(0, 'before'); selected(1, 'before')
            expect(page.locator('#contest-card-conversion-dialog')).to_contain_text('默认采用采集的游戏转换设置')
            close()
            load(OTHER, None)
            selected(0, 'after'); selected(1, 'after')
            expect(page.locator('#contest-card-conversion-dialog')).to_contain_text('尚未采集游戏转换设置')
            for width in [1440, 375]:
                page.set_viewport_size({'width': width, 'height': 1000})
                dialog = page.locator('#contest-card-conversion-dialog')
                assert dialog.evaluate('node=>node.scrollWidth<=node.clientWidth+1')
                dialog.screenshot(path=str(artifact_path(ROOT/f'local/checks/captured-card-conversions/dialog-{width}.png')))
            assert not errors and not uploads, (errors, uploads)
            result = {'importedDefaults': True, 'onlyEditedOverrideSaved': True, 'reimport': True,
                      'resumeFollowingCapture': True, 'reload': True, 'accountIsolation': True,
                      'emptyVsUnknown': True, 'pageErrors': errors, 'uploads': uploads}
            artifact_path(ROOT/'local/checks/captured-card-conversions/result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
            print(json.dumps(result, ensure_ascii=False))
        finally:
            browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:18765/')
    check(parser.parse_args().url)
