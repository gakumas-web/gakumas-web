"""用合成账号验证卡片内标签连续编辑、关闭及保存失败反馈。"""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from browser_artifacts import artifact_path
from browser_custom_tag_export import account_documents, import_account, write_account
from browser_static import ROOT
from browser_tag_updates import close_editor, open_editor, toggle_tag, wait_catalog

ACCOUNT = 'synthetic-inline-tags'
OTHER_ACCOUNT = 'synthetic-inline-tags-other'
TAGS = ['継承候補', '周回用', '选拔候选', '窄屏标签名称用于检查完整显示与按钮换行']
ARTIFACTS = ROOT/'local/checks/inline-tags'


def chip_names(container):
    return container.locator('.custom-tag-name').all_text_contents()


def assert_saved(page, kind, key, tags, account=ACCOUNT):
    saved = page.evaluate('''({account,kind,key})=>{
      const data=JSON.parse(localStorage.getItem('gakumas-web:library:account-'+account));
      return data[kind][key]??[];
    }''', {'account': account, 'kind': kind, 'key': key})
    assert sorted(saved) == sorted(tags), saved


def create_tags(page):
    page.locator('#data-open').click()
    page.locator('#manage-tags').click()
    for name in TAGS:
        page.locator('#tag-name').fill(name)
        page.locator('#tag-submit').click()
        expect(page.locator('#tag-list [data-tag]').filter(has_text=name)).to_have_count(1)
    page.locator('#close-tags').click()
    page.locator('#close-data').click()


def check(url):
    reports = {}
    with TemporaryDirectory(prefix='inline-tags-', dir=ROOT/'local') as temporary, sync_playwright() as driver:
        folders = {account: write_account(Path(temporary), account, account_documents(account))
                   for account in [ACCOUNT, OTHER_ACCOUNT]}
        browser = driver.chromium.launch(headless=True)
        try:
            for width, language in [(1440, 'zh-CN'), (375, 'ja')]:
                context = browser.new_context(viewport={'width': width, 'height': 1000})
                page = context.new_page()
                errors, uploads = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                context.on('request', lambda request: uploads.append(request.url) if request.post_data else None)
                page.goto(url, wait_until='networkidle')
                import_account(page, folders[ACCOUNT], ACCOUNT)
                expect(page.locator('#list .memory-card')).to_have_count(40, timeout=60000)
                wait_catalog(page, 'memories')
                create_tags(page)
                page.locator('#language').select_option(language)
                wait_catalog(page, 'memories')

                first = page.locator('#list .memory-card').first
                second = page.locator('#list .memory-card').nth(1)
                key = first.get_attribute('data-memory-key')
                editor = open_editor(first)
                expect(page.locator('#tags-dialog')).not_to_be_visible()
                expect(editor.locator('.inline-tag-option').first).to_be_focused()
                expect(editor.locator('input,.inline-tag-header,.inline-tag-hint')).to_have_count(0)
                order = editor.locator('.inline-tag-option').all_text_contents()
                toggle_tag(editor, TAGS[0])
                toggle_tag(editor, TAGS[1])
                assert sorted(chip_names(first)) == sorted(TAGS[:2])
                assert editor.locator('.inline-tag-option').all_text_contents() == order
                assert_saved(page, 'memories', key, TAGS[:2])

                # 直接点下一张的编辑按钮，只保留新卡片编辑区；点卡片外面和 Esc 均可收起。
                open_editor(second)
                expect(first.locator('.edit-custom-tags')).to_have_attribute('aria-expanded', 'false')
                expect(page.locator('.inline-tag-editor:visible')).to_have_count(1)
                page.locator('#search').click()
                expect(page.locator('.inline-tag-editor:visible')).to_have_count(0)
                editor = open_editor(first)
                selected_order = editor.locator('.inline-tag-option').all_text_contents()
                assert set(selected_order[:2]) == set(TAGS[:2]), selected_order
                close_editor(page, first)

                # 删除标签一次点击即保存，不额外显示操作提示；需要时可直接重新点选。
                first.locator('.custom-tag').filter(has_text=TAGS[1]).locator('.tag-chip-remove').click()
                assert chip_names(first) == TAGS[:1]
                expect(first.locator('.tag-remove-confirm')).to_have_count(0)
                assert_saved(page, 'memories', key, TAGS[:1])
                expect(first.locator('.tag-change-feedback,.tag-undo-button')).to_have_count(0)
                editor = open_editor(first)
                toggle_tag(editor, TAGS[1])
                close_editor(page, first)
                assert sorted(chip_names(first)) == sorted(TAGS[:2])
                assert_saved(page, 'memories', key, TAGS[:2])

                first.locator('.memory-detail-open').click()
                detail = page.locator('#detail-content')
                editor = open_editor(detail)
                toggle_tag(editor, TAGS[2])
                assert sorted(chip_names(first)) == sorted(TAGS[:3])
                assert sorted(chip_names(detail)) == sorted(TAGS[:3])
                toggle_tag(editor, TAGS[1], assigned=False)
                expect(detail.locator('.tag-change-feedback,.tag-undo-button')).to_have_count(0)
                toggle_tag(editor, TAGS[1])
                expect(editor.get_by_role('button', name=TAGS[1], exact=True)).to_have_attribute('aria-pressed', 'true')
                close_editor(page, detail)
                expect(page.locator('#detail-dialog')).to_be_visible()
                open_editor(detail)
                page.locator('#detail-next').click()
                expect(page.locator('.inline-tag-editor:visible')).to_have_count(0)
                page.locator('#detail-prev').click()
                assert sorted(chip_names(detail)) == sorted(TAGS[:3])
                page.locator('#close-detail').click()

                # 只对当前合成账号的标签写入制造失败，验证生产保存路径不会误显示成功。
                editor = open_editor(first)
                page.evaluate('''account=>{
                  window.inlineTagOriginalSetItem=Storage.prototype.setItem;
                  Storage.prototype.setItem=function(key,value){
                    if(key==='gakumas-web:library:account-'+account)throw new DOMException('Synthetic quota failure','QuotaExceededError');
                    return window.inlineTagOriginalSetItem.call(this,key,value);
                  };
                }''', ACCOUNT)
                try:
                    editor.get_by_role('button', name=TAGS[3], exact=True).click()
                    expect(editor.locator('.inline-tag-error')).to_be_visible()
                    assert editor.locator('.inline-tag-error').inner_text().strip()
                    expect(editor.get_by_role('button', name=TAGS[3], exact=True)).to_have_attribute('aria-pressed', 'false')
                    assert sorted(chip_names(first)) == sorted(TAGS[:3])
                    assert_saved(page, 'memories', key, TAGS[:3])
                finally:
                    page.evaluate('''()=>{Storage.prototype.setItem=window.inlineTagOriginalSetItem;delete window.inlineTagOriginalSetItem;}''')
                toggle_tag(editor, TAGS[3])
                expect(editor.locator('.inline-tag-error')).not_to_be_visible()
                assert_saved(page, 'memories', key, TAGS)

                geometry = editor.evaluate('''editor=>({left:editor.getBoundingClientRect().left,
                  right:editor.getBoundingClientRect().right,overflow:editor.scrollWidth>editor.clientWidth,
                  bodyOverflow:document.documentElement.scrollWidth>innerWidth})''')
                assert geometry['left'] >= 0 and geometry['right'] <= width+1, geometry
                assert not geometry['overflow'] and not geometry['bodyOverflow'], geometry
                page.screenshot(path=str(artifact_path(ARTIFACTS/f'editor-{language}-{width}.png')), full_page=False)

                page.locator('[data-tab="selectionMemories"]').click()
                expect(page.locator('.inline-tag-editor:visible')).to_have_count(0)
                expect(page.locator('#list .selection-memory-card')).to_have_count(6)
                wait_catalog(page, 'selectionMemories')
                selected = page.locator('#list .selection-memory-card').first
                selection_key = selected.get_attribute('data-selection-key')
                editor = open_editor(selected)
                toggle_tag(editor, TAGS[0])
                toggle_tag(editor, TAGS[1])
                assert_saved(page, 'selectionMemories', selection_key, TAGS[:2])
                close_editor(page, selected)

                # 预先导入另一个合成账号，再从打开的编辑器直接切账号，避免沿用旧账号编辑状态。
                import_account(page, folders[OTHER_ACCOUNT], OTHER_ACCOUNT)
                page.locator('#profile').select_option('account-'+ACCOUNT)
                expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
                expect(page.locator('#list .selection-memory-card')).to_have_count(6)
                selected = page.locator('#list .selection-memory-card').first
                open_editor(selected)
                page.locator('#profile').select_option('account-'+OTHER_ACCOUNT)
                expect(page.locator('#profile')).to_have_value('account-'+OTHER_ACCOUNT)
                expect(page.locator('.inline-tag-editor:visible')).to_have_count(0)
                expect(page.locator('#list .custom-tag-name')).to_have_count(0)
                page.locator('[data-tab="selectionMemories"]').click()
                expect(page.locator('#list .selection-memory-card')).to_have_count(6)
                selected = page.locator('#list .selection-memory-card').first
                editor = open_editor(selected)
                expect(editor.locator('.inline-tag-option')).to_have_count(0)
                expect(editor.locator('.inline-tag-empty')).to_be_visible()
                close_editor(page, selected)
                page.locator('#profile').select_option('account-'+ACCOUNT)
                expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
                page.reload(wait_until='networkidle')
                expect(page.locator('#list .selection-memory-card').first.locator('.custom-tag-name')).to_have_count(2, timeout=60000)
                expect(page.locator('.inline-tag-editor:visible')).to_have_count(0)
                page.locator('[data-tab="memories"]').click()
                expect(page.locator('#list .memory-card').first.locator('.custom-tag-name')).to_have_count(4, timeout=60000)
                assert_saved(page, 'memories', key, TAGS)
                assert_saved(page, 'selectionMemories', selection_key, TAGS[:2])
                assert not errors, errors
                assert not uploads, uploads
                reports[str(width)] = {'language': language, 'continuousAssign': True, 'compactEditor': True,
                    'singleEditor': True, 'escapeFocus': True, 'outsideClose': True, 'silentRemoval': True,
                    'detailSync': True, 'storageFailureFeedback': True, 'accountIsolation': True,
                    'persistent': True, 'geometry': geometry, 'pageErrors': errors, 'uploads': uploads}
                context.close()
        finally:
            browser.close()
    artifact_path(ARTIFACTS/'interactions.json').write_text(json.dumps(
        {'url': url, 'viewports': reports}, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(reports, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:18765/')
    check(parser.parse_args().url)
