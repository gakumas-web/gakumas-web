"""用合成账号验证两类回忆的精简标签导出、账号隔离、真实下载及窄屏入口。"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from browser_artifacts import artifact_path
from browser_static import ROOT, fixtures

ACCOUNT = 'synthetic-custom-tag-export'
OTHER_ACCOUNT = 'synthetic-custom-tag-other'
SELECTION_ACCOUNT = 'synthetic-custom-tag-selection-only'
EMPTY_ACCOUNT = 'synthetic-custom-tag-empty'
PRIMARY_TAG = '完整标签导出回归'
SECONDARY_TAG = '共同保留标签'
SELECTION_TAG = '选拔专用标签'
UNUSED_TAG = '未使用标签'
ORPHAN_TAG = '孤儿关联标签'
OTHER_TAG = '其他账号专用标签'
TARGET_COUNT = 55
SELECTION_COUNT = 4
ARTIFACTS = ROOT/'local/checks/custom-tag-export-compact-20261018'


def memory_key(row, kind):
    identity = row['userMemoryId'] if kind == 'memories' else 'selection:'+row['userSelectionMemoryId']
    return hashlib.sha256(identity.encode()).hexdigest()


def account_documents(account=ACCOUNT, selection_only=False):
    documents = fixtures()
    base = documents['capture']['memories'][0]
    rows = []
    for index in range(TARGET_COUNT+3):
        row = copy.deepcopy(base)
        row.update(userMemoryId=f'{account}-memory-{index:03}', memoryTagId='synthetic-game-tag',
                   isProtected=index % 7 == 0, vocal=100+index, inheritCount=index,
                   shotTime=1700000000000+index, produceCardPhaseType=2,
                   produceCard={'id': 'synthetic-card', 'upgradeCount': 2,
                                'customizes': [{'id': 'synthetic-customize', 'customizeCount': 3}]},
                   abilities=[{'id': 'synthetic-ability', 'level': 4}],
                   examBattleProduceCards=[{'id': 'synthetic-battle-card', 'upgradeCount': 1, 'customizes': []}],
                   examBattleProduceItemIds=['synthetic-battle-item'],
                   unitCharacters=[{'characterId': base['characterId'], 'liveCostumeId': 'synthetic-costume',
                                    'liveCostumeHeadId': 'synthetic-costume-head'}])
        if index % 3 != 2:
            row['isInUse'] = index % 3 == 0
        rows.append(row)
    documents['capture'].update(memories=rows, count=len(rows))
    selection_base = documents['selection']['selectionMemories'][0]
    selection_rows = []
    for index in range(SELECTION_COUNT+2):
        row = copy.deepcopy(selection_base)
        row.update(userSelectionMemoryId=f'{account}-selection-{index:03}', memoryTagId='synthetic-selection-game-tag',
                   assetId='synthetic-selection-asset', produceId='synthetic-produce', researchId='synthetic-research',
                   idolCardSkinId='synthetic-skin', grade=9, idolCardLevelLimitRank=2, idolCardPotentialRank=3,
                   vocal=100+index, dance=200+index, visual=300+index, star=5000+index,
                   vocalGrowthRatePermil=110, danceGrowthRatePermil=120, visualGrowthRatePermil=130,
                   clearedTime=1700000000000+index, lastUsedTime=1700000010000+index,
                   isProtected=index % 2 == 0, isPrimaStella=index % 2 == 1,
                   produceCards=[{'id': 'synthetic-selection-card', 'upgradeCount': 2, 'fromMemory': True,
                                  'customizes': [{'id': 'synthetic-selection-customize', 'customizeCount': 4}]}],
                   produceItems=[{'id': 'synthetic-selection-item', 'triggerCount': 2, 'reactionCount': 3}],
                   produceCustomizeItems=[{'id': 'synthetic-selection-custom-item', 'triggerCount': 4, 'reactionCount': 5}])
        selection_rows.append(row)
    documents['selection'].update(selectionMemories=selection_rows, count=len(selection_rows))
    documents.pop('selectiondetail')
    for document in documents.values():
        document.update(publicUserId=account, captured_at='2026-10-16T00:00:00.123456789Z')
    documents['selection']['captured_at'] = '2026-10-16T00:01:00.987654321Z'
    if selection_only:
        documents.pop('capture')
    return documents


def write_account(parent, name, documents):
    folder = parent/name
    for kind, document in documents.items():
        target = folder/kind/'snapshot.json'
        target.parent.mkdir(parents=True)
        target.write_text(json.dumps(document), encoding='utf-8')
    return folder


def expected_rows(documents, assignments, kind):
    source = 'capture' if kind == 'memories' else 'selection'
    return sorted((dict(key=memory_key(row, kind), customTags=sorted(assignments[memory_key(row, kind)]))
                   for row in documents.get(source, {}).get(kind, []) if memory_key(row, kind) in assignments),
                  key=lambda row: row['key'])


def check_download(document, documents, assignments, account):
    assert document['format'] == 'gakumas-custom-tag-export'
    assert document['schema_version'] == 1
    assert document['publicUserId'] == account
    assert isinstance(document['exported_at'], str) and document['exported_at']
    assert set(document) == {'format', 'schema_version', 'publicUserId', 'exported_at', 'sources',
                             'memories', 'selectionMemories'}
    assert document['sources'] == {
        'memories': {'captured_at': documents['capture']['captured_at'],
                     'identity_type': 'userMemoryId-sha256'} if 'capture' in documents else None,
        'selectionMemories': {'captured_at': documents['selection']['captured_at'],
                             'identity_type': 'selection-prefixed-userSelectionMemoryId-sha256'},
    }
    for kind in ['memories', 'selectionMemories']:
        assert sorted(document[kind], key=lambda row: row['key']) == expected_rows(documents, assignments[kind], kind)
        assert all(set(row) == {'key', 'customTags'} for row in document[kind])
    serialized = json.dumps(document, ensure_ascii=False)
    for private in [UNUSED_TAG, ORPHAN_TAG, '"userMemoryId"', '"userSelectionMemoryId"', 'favorites',
                    'ordinal', 'fingerprint', 'selectionDetails', 'auth']:
        assert private not in serialized, private


def open_account(page):
    page.locator('#data-open').click()
    expect(page.locator('#data-dialog')).to_be_visible()
    button = page.locator('#export-custom-tags')
    expect(button).to_be_visible()
    assert button.locator('xpath=ancestor::section').count() > 0
    assert page.locator('#custom-tag-export-status').locator('xpath=ancestor::section').count() > 0
    return button


def close_account(page):
    page.locator('#close-data').click()
    expect(page.locator('#data-dialog')).not_to_be_visible()


def download_export(page, name):
    button = open_account(page)
    expect(button).to_be_enabled()
    with page.expect_download() as event:
        button.click()
    target = artifact_path(ARTIFACTS/f'{name}.json')
    event.value.save_as(str(target))
    expect(page.locator('dialog[open]')).to_have_count(1)
    expect(page.locator('#data-dialog')).to_be_visible()
    close_account(page)
    return json.loads(target.read_text(encoding='utf-8'))


def expand_filters(page):
    if page.locator('#filter-toggle').get_attribute('aria-expanded') != 'true':
        page.locator('#filter-toggle').click()


def assign_tags(page, account, ordinary_count, selection_count, other=False):
    return page.evaluate('''async ({account,ordinaryCount,selectionCount,primary,secondary,selectionTag,orphan,other})=>{
      const {profileData}=await import('./application/storage.mjs');
      const {PersonalLibrary}=await import('./application/personal-library.mjs');
      const profile='account-'+account,stored=await profileData(profile),library=new PersonalLibrary(profile);library.load();
      const memories=stored.ordinary?.snapshot?.memories??[];
      const selected=stored.selection?.snapshot?.selectionMemories??[];
      const result={memories:{},selectionMemories:{}};
      if(!other&&memories.length&&!library.data.memories[memories[0].key]?.includes(primary))throw Error('真实标签操作未持久化');
      const known=[primary,secondary,selectionTag,orphan];
      for(const name of known)if(!library.data.tags.includes(name))library.rename(null,name);
      for(const [index,memory] of memories.slice(0,ordinaryCount).entries()){
        const tags=other?[primary]:index===0?[primary]:index%2?[secondary]:[primary,secondary];
        library.assign('memories',memory.key,tags);result.memories[memory.key]=tags;
      }
      for(const [index,memory] of selected.slice(0,selectionCount).entries()){
        const tags=other?[primary]:index===0?[selectionTag]:[secondary,selectionTag];
        library.assign('selectionMemories',memory.key,tags);result.selectionMemories[memory.key]=tags;
      }
      library.assign('memories','a'.repeat(64),[orphan]);
      library.assign('selectionMemories','b'.repeat(64),[orphan]);
      if(memories.length)library.favorite('memories',memories.at(-1).key,true);
      if(selected.length)library.favorite('selectionMemories',selected.at(-1).key,true);
      library.favorite('idolCards','synthetic-favorite-only',true);
      return result;
    }''', {'account': account, 'ordinaryCount': ordinary_count, 'selectionCount': selection_count,
            'primary': OTHER_TAG if other else PRIMARY_TAG, 'secondary': SECONDARY_TAG,
            'selectionTag': SELECTION_TAG, 'orphan': ORPHAN_TAG, 'other': other})


def import_account(page, folder, account):
    page.locator('#account-directory-files').set_input_files(str(folder))
    expect(page.locator('#profile')).to_have_value('account-'+account, timeout=60000)


def check(url):
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='custom-tag-export-', dir=ROOT/'local') as temporary, sync_playwright() as driver:
        temporary = Path(temporary)
        documents = account_documents()
        other_documents = account_documents(OTHER_ACCOUNT)
        selection_documents = account_documents(SELECTION_ACCOUNT, selection_only=True)
        folders = {account: write_account(temporary, account, values) for account, values in [
            (ACCOUNT, documents), (OTHER_ACCOUNT, other_documents), (SELECTION_ACCOUNT, selection_documents),
            (EMPTY_ACCOUNT, account_documents(EMPTY_ACCOUNT))]}
        browser = driver.chromium.launch(headless=True)
        try:
            context = browser.new_context(accept_downloads=True, viewport={'width': 1440, 'height': 1000})
            page = context.new_page()
            errors, uploads, downloads = [], [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            context.on('request', lambda request: uploads.append(request.url) if request.post_data else None)
            page.on('download', lambda download: downloads.append(download))
            page.goto(url, wait_until='networkidle')
            expect(open_account(page)).to_be_disabled()
            close_account(page)
            import_account(page, folders[ACCOUNT], ACCOUNT)
            expect(page.locator('#list .memory-card')).to_have_count(40, timeout=60000)
            expect(page.locator('#next')).to_be_enabled()

            # 创建标签及第一条关联经过真实界面，其余批量关联复用生产应用模块。
            open_account(page)
            page.locator('#manage-tags').click()
            for name in [PRIMARY_TAG, SECONDARY_TAG, SELECTION_TAG, UNUSED_TAG, ORPHAN_TAG]:
                page.locator('#tag-name').fill(name)
                page.locator('#tag-submit').click()
            page.locator('#close-tags').click()
            close_account(page)
            page.locator('#list .memory-card').first.locator('.edit-custom-tags').click()
            page.locator('#list .memory-card').first.locator('.inline-tag-editor').get_by_role('button', name=PRIMARY_TAG, exact=True).click()
            page.keyboard.press('Escape')
            expect(page.locator('#list .memory-card').first.locator('.custom-tag-name')).to_have_text(PRIMARY_TAG)
            assignments = assign_tags(page, ACCOUNT, TARGET_COUNT, SELECTION_COUNT)
            page.reload(wait_until='networkidle')
            expect(page.locator('#list .memory-card')).to_have_count(40, timeout=60000)
            page.locator('#next').click()
            expect(page.locator('#list .memory-card')).to_have_count(18)
            page.locator('#previous').click()
            page.locator('#search').fill(next(iter(assignments['memories']))[:8])
            expect(page.locator('#list .memory-card')).to_have_count(1)
            expand_filters(page)
            page.locator('#custom-tag-filter').select_option('__untagged__')
            expect(page.locator('#list .memory-card')).to_have_count(0)
            ordinary_export = download_export(page, 'ordinary-filtered')
            check_download(ordinary_export, documents, assignments, ACCOUNT)
            assert OTHER_TAG not in json.dumps(ordinary_export, ensure_ascii=False)

            # 切换到选拔回忆及非回忆页签，仍导出当前账号两类回忆的全部标签关联。
            page.locator('[data-tab="selectionMemories"]').click()
            page.locator('#search').fill('synthetic-no-matching-selection')
            expand_filters(page)
            page.locator('#custom-tag-filter').select_option('__untagged__')
            expect(page.locator('#list .selection-memory-card')).to_have_count(0)
            selection_export = download_export(page, 'selection-filtered')
            check_download(selection_export, documents, assignments, ACCOUNT)
            page.locator('[data-tab="idolCards"]').click()
            cards_export = download_export(page, 'idol-cards-tab')
            check_download(cards_export, documents, assignments, ACCOUNT)

            # 两种语言、两种手机宽度下，账号面板中的按钮和状态均可访问且无横向溢出。
            for language in ['zh-CN', 'ja']:
                page.locator('#language').select_option(language)
                for width in [360, 390]:
                    page.set_viewport_size({'width': width, 'height': 900})
                    button = open_account(page)
                    expect(button).to_be_enabled()
                    button.scroll_into_view_if_needed()
                    expect(button).to_be_in_viewport()
                    expect(page.locator('#custom-tag-export-status')).to_be_visible()
                    page.locator('#data-dialog').screenshot(path=artifact_path(ARTIFACTS/f'{language}-{width}.png'))
                    geometry = page.locator('#data-dialog').evaluate('''dialog=>({
                      left:dialog.getBoundingClientRect().left,right:dialog.getBoundingClientRect().right,
                      overflow:dialog.scrollWidth>dialog.clientWidth,
                      bodyOverflow:document.documentElement.scrollWidth>innerWidth,
                      buttonRight:dialog.querySelector('#export-custom-tags').getBoundingClientRect().right
                    })''')
                    assert geometry['left'] >= 0 and geometry['right'] <= width+1, geometry
                    assert geometry['buttonRight'] <= width+1, geometry
                    assert not geometry['overflow'] and not geometry['bodyOverflow'], geometry
                    close_account(page)
            page.set_viewport_size({'width': 1440, 'height': 1000})
            page.locator('#language').select_option('zh-CN')

            import_account(page, folders[OTHER_ACCOUNT], OTHER_ACCOUNT)
            expect(open_account(page)).to_be_disabled()
            close_account(page)
            other_assignments = assign_tags(page, OTHER_ACCOUNT, 2, 1, other=True)
            page.reload(wait_until='networkidle')
            other_export = download_export(page, 'other-account')
            check_download(other_export, other_documents, other_assignments, OTHER_ACCOUNT)
            assert PRIMARY_TAG not in json.dumps(other_export, ensure_ascii=False)
            page.locator('#profile').select_option('account-'+ACCOUNT)
            check_download(download_export(page, 'account-restored'), documents, assignments, ACCOUNT)

            # 仅选拔快照的账号也可导出；有库存和标签定义但没有标记的账号保持禁用。
            import_account(page, folders[SELECTION_ACCOUNT], SELECTION_ACCOUNT)
            only_assignments = assign_tags(page, SELECTION_ACCOUNT, 0, 3, other=True)
            page.reload(wait_until='networkidle')
            only_export = download_export(page, 'selection-only-account')
            check_download(only_export, selection_documents, only_assignments, SELECTION_ACCOUNT)
            assert only_export['memories'] == []
            import_account(page, folders[EMPTY_ACCOUNT], EMPTY_ACCOUNT)
            page.evaluate('''async account=>{
              const {PersonalLibrary}=await import('./application/personal-library.mjs');
              const library=new PersonalLibrary('account-'+account);library.load();library.rename(null,'未使用标签');
            }''', EMPTY_ACCOUNT)
            page.reload(wait_until='networkidle')
            before = len(downloads)
            expect(open_account(page)).to_be_disabled()
            page.locator('#export-custom-tags').evaluate('(button)=>button.click()')
            assert len(downloads) == before == 6, len(downloads)
            close_account(page)
            assert not errors, errors
            assert not uploads, uploads
            (ARTIFACTS/'result.json').write_text(json.dumps({
                'ordinaryTargets': TARGET_COUNT, 'selectionTargets': SELECTION_COUNT,
                'downloads': len(downloads), 'realUiTagAssignment': True, 'minimalRecords': True,
                'unaffectedBy': ['pagination', 'search', 'customTagFilter', 'currentTab'],
                'accountIsolation': True, 'selectionOnlyAccount': True, 'emptyTaggedDisabled': True,
                'languages': ['zh-CN', 'ja'], 'widths': [360, 390], 'pageErrors': errors, 'uploads': uploads,
            }, ensure_ascii=False, indent=2), encoding='utf-8')
        finally:
            browser.close()
    print('自定义标签真实关联、两类回忆精简标签下载、跨分页/筛选/页签、账号隔离、仅选拔账号、空标记禁用及中日窄屏检查通过。')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:18765/')
    check(parser.parse_args().url)
