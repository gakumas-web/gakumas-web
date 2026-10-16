"""通过正式编组库入口验证独立文件的跨账号导入及生命周期隔离。"""
import argparse
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect
from browser_artifacts import artifact_path
from browser_static import ROOT, fixtures, ACCOUNT
from browser_simulation_helpers import select_season


def check(url):
    request = json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['customized']
    with TemporaryDirectory(dir=ROOT/'local', prefix='portable-loadouts-') as temporary, sync_playwright() as driver:
        browser = driver.chromium.launch()
        page = browser.new_page(viewport={'width': 1280, 'height': 1100}, accept_downloads=True)
        errors, uploads = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: uploads.append(request.url) if request.post_data else None)
        page.goto(url, wait_until='networkidle')
        identity = page.evaluate('''async id=>{const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');const {idolInfo}=await import('./domain/catalog.mjs');return idolInfo({idolCardId:id});}''', request['cards'][0]['record']['definition']['originIdolCardId'])
        docs = fixtures()
        base = docs['capture']['memories'][0]
        memories = []
        for index in range(2):
            memory = copy.deepcopy(base)
            memory.update(userMemoryId=f'synthetic-portable-{index}', idolCardId=request['cards'][0]['record']['definition']['originIdolCardId'], characterId=identity['characterId'], planType=2, **request['params'], produceCard=request['cards'][0]['reference'], examBattleProduceCards=[entry['reference'] for entry in request['cards']], examBattleProduceItemIds=[entry['id'] for entry in request['items']])
            memories.append(memory)
        docs['capture'].update(memories=memories, count=2)
        docs['capture']['idolCards'][0]['idolCardId'] = memories[0]['idolCardId']
        def import_account(account):
            target = Path(temporary)/account
            for name, document in docs.items():
                value = copy.deepcopy(document)
                value['publicUserId'] = account
                path = target/name/'snapshot.json'
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(value))
            page.locator('#account-directory-files').set_input_files(str(target))
            expect(page.locator('#profile')).to_have_value('account-'+account)
            expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        def workspace():
            page.locator('[data-tab="seasonSimulation"]').click()
            select_season(page, 'contest:pvp_rate_config-53')
            page.locator('.season-stage-tab').first.click()
            page.locator('.simulation-mode-tabs [data-mode="selected"]').click()
        def pick():
            for index in range(2):
                page.locator('.season-memory-slot-pick:visible').nth(index).click()
                page.locator('.contest-memory-choose:enabled').first.click()
        def save(name):
            page.locator('.season-loadout-save').click()
            page.locator('#loadout-library-name').fill(name)
            page.locator('.loadout-library-name-form').get_by_role('button', name='保存', exact=True).click()
            expect(page.locator('.loadout-library-status')).to_have_text('编组已保存。')
            page.locator('#contest-loadout-library .dialog-head button').click()
        def count(profile):
            return page.evaluate("async profile=>(await(await import('./application/storage.mjs')).savedSimulationLoadouts(profile)).length", profile)
        import_account(ACCOUNT)
        workspace()
        pick()
        save('portable-one')
        # 遍历实际公开目录，覆盖赛季和活动摘要的可导出性。
        roundtrip = page.evaluate('''async profile=>{const {savedSimulationLoadouts}=await import('./application/storage.mjs'),{contestCatalog}=await import('./domain/catalog.mjs'),{createLoadoutPackage}=await import('./application/contest-loadout-package.mjs');const [source]=await savedSimulationLoadouts(profile);const stages=contestCatalog().choices;for(const stage of stages)createLoadoutPackage([{...source,stage}]);return {count:stages.length,kinds:[...new Set(stages.map(stage=>stage.kind))]};}''', 'account-'+ACCOUNT)
        assert roundtrip['count'] > 0 and 'contest' in roundtrip['kinds'] and 'event' in roundtrip['kinds']
        save('portable-two')
        source_profile = 'account-'+ACCOUNT
        page.locator('.season-loadout-library-open').click()
        library = page.locator('#contest-loadout-library')
        library.get_by_role('button', name='已保存', exact=True).click()
        expect(library.locator('.loadout-library-entry')).to_have_count(2)
        library.get_by_role('button', name='全选已保存编组', exact=True).click()
        expect(library.locator('.loadout-library-export-selection input:checked')).to_have_count(2)
        with page.expect_download() as download:
            library.get_by_role('button', name='导出所选编组', exact=True).click()
        package_path = Path(temporary)/'loadouts.json'
        download.value.save_as(str(package_path))
        data = json.loads(package_path.read_text())
        assert len(data['entries']) == 2 and data['exportMetadata']['contentVersion']
        text = json.dumps(data)
        assert all(private not in text for private in ['publicUserId', 'profile', 'lifecycleId', 'userMemoryId', 'synthetic-portable', 'simulationRuns'])
        library.locator('.dialog-head button').click()
        target_account = 'synthetic-portable-target'
        target_profile = 'account-'+target_account
        import_account(target_account)
        workspace()
        pick()
        save('keep-existing')
        existing = page.evaluate("async profile=>(await(await import('./application/storage.mjs')).savedSimulationLoadouts(profile))[0]", target_profile)
        page.locator('.season-loadout-library-open').click()
        library.get_by_role('button', name='已保存', exact=True).click()
        library.locator('#loadout-library-import-file').set_input_files(str(package_path))
        preview = library.locator('.loadout-library-import-preview')
        expect(preview).to_contain_text('确认后新增 2 个编组，不覆盖现有编组。')
        expect(preview).to_contain_text('导入目标：')
        assert count(target_profile) == 1
        for width in [1280, 360]:
            page.set_viewport_size({'width': width, 'height': 1000})
            assert library.evaluate('element=>element.scrollWidth<=element.clientWidth')
            library.screenshot(path=artifact_path(f'local/checks/nextsteps-20261016/loadout-library-zh-{width}.png'))
        preview.screenshot(path=artifact_path('local/checks/nextsteps-20261016/loadout-import-preview.png'))
        preview.get_by_role('button', name='确认导入', exact=True).click()
        expect(library.locator('.loadout-library-status')).to_have_text('已新增 2 个编组，现有编组未覆盖。')
        assert count(target_profile) == 3 and count(source_profile) == 2
        entries = page.evaluate("async profile=>(await(await import('./application/storage.mjs')).savedSimulationLoadouts(profile))", target_profile)
        assert next(entry for entry in entries if entry['id'] == existing['id']) == existing
        assert len({entry['id'] for entry in entries}) == 3
        library.locator('.loadout-library-entry').filter(has_text='portable-one').get_by_role('button', name='载入编组', exact=True).click()
        expect(library).not_to_be_visible()
        expect(page.locator('.season-memory-board')).to_have_count(2)
        page.locator('.season-loadout-library-open').click()
        library.get_by_role('button', name='已保存', exact=True).click()
        bad = Path(temporary)/'bad.json'
        malformed = copy.deepcopy(data)
        malformed['entries'][1]['loadout']['memories'][0]['vocal'] = 9007199254740992
        bad.write_text(json.dumps(malformed))
        library.locator('#loadout-library-import-file').set_input_files(str(bad))
        expect(library.locator('.loadout-library-status')).to_have_text('编组文件格式无效或版本不受支持，未导入任何编组。')
        expect(library.locator('.loadout-library-import-preview')).not_to_be_visible()
        assert count(target_profile) == 3
        library.locator('#loadout-library-import-file').set_input_files(str(package_path))
        expect(library.locator('.loadout-library-import-preview')).to_be_visible()
        page.evaluate("window.oldImportConfirm=document.querySelector('.loadout-library-import-preview .primary')")
        # 真实账号切换销毁旧控制器，迟到的确认不能写入旧账号或新账号。
        library.locator('.dialog-head button').click()
        page.locator('#profile').select_option(source_profile)
        expect(page.locator('#profile')).to_have_value(source_profile)
        page.evaluate('window.oldImportConfirm.click()')
        assert count(target_profile) == 3 and count(source_profile) == 2
        workspace()
        page.locator('#language').select_option('ja')
        page.locator('.season-loadout-library-open').click()
        library.locator('.loadout-library-tabs button').nth(1).click()
        library.locator('#loadout-library-import-file').set_input_files(str(package_path))
        expect(library.locator('.loadout-library-import-preview')).to_contain_text('編成の読み込みプレビュー')
        expect(library.locator('.loadout-library-import-preview .primary')).to_be_enabled()
        for width in [1280, 360]:
            page.set_viewport_size({'width': width, 'height': 1000})
            assert library.evaluate('element=>element.scrollWidth<=element.clientWidth')
            assert library.locator('.loadout-library-package-actions').evaluate('element=>element.scrollWidth<=element.clientWidth')
            library.screenshot(path=artifact_path(f'local/checks/nextsteps-20261016/loadout-library-ja-{width}.png'))
        assert count(source_profile) == 2
        assert not errors and not uploads, (errors, uploads)
        browser.close()
    print('独立编组文件多选导出、跨账号预览确认、不覆盖、实际载入、坏文件整批拒绝和账号切换隔离通过。')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:18765/')
    check(parser.parse_args().url)
