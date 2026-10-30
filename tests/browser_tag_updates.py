"""验证真实标签操作局部更新，保留卡片、图片、详情与滚动状态。"""
import argparse
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from browser_artifacts import artifact_path
from browser_custom_tag_export import account_documents, write_account, import_account
from browser_static import ROOT

ACCOUNT = 'synthetic-tag-updates'
TAG = '待退役'
SECOND = '局部更新核对'


def wait_catalog(page, scope):
    # 主资料首次载入本来就需要刷新页面；测量标签时先排除这项独立更新。
    page.wait_for_function('''async scope => {
      const {loadingMetrics}=await import('./application/loading-metrics.mjs');
      return loadingMetrics().runs.findLast(run=>run.name==='view'&&run.view===scope)?.outcome==='ready';
    }''', arg=scope)
    if scope == 'memories':
        expect(page.locator('#inheritance-skill-open')).to_be_enabled(timeout=60000)
    page.evaluate('''() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))''')


def open_editor(container):
    container.locator('.edit-custom-tags').click()
    expect(container.locator('.edit-custom-tags')).to_have_attribute('aria-expanded', 'true')
    editor = container.locator('.inline-tag-editor')
    expect(editor).to_be_visible()
    return editor


def close_editor(page, container):
    page.keyboard.press('Escape')
    expect(container.locator('.inline-tag-editor')).not_to_be_visible()
    expect(container.locator('.edit-custom-tags')).to_have_attribute('aria-expanded', 'false')
    expect(container.locator('.edit-custom-tags')).to_be_focused()


def toggle_tag(editor, name, assigned=True):
    option = editor.get_by_role('button', name=name, exact=True)
    expect(option).to_have_class(re.compile(r'\binline-tag-option\b'))
    option.click()
    expect(option).to_have_attribute('aria-pressed', str(assigned).lower())


def capture(page):
    page.evaluate('''() => {
      const list=document.querySelector('#list');
      window.tagUpdateProbe={cards:[...list.children],rendered:[...list.children].filter(card=>!card.classList.contains('deferred-entry')),images:[...list.children].slice(0,2).flatMap(card=>[...card.querySelectorAll('img')]),
        detail:document.querySelector('#detail-content').firstElementChild,scroll:scrollY,started:performance.now(),removed:0,fullRenderStacks:[]};
      const replace=list.replaceChildren;
      list.replaceChildren=function(...nodes){window.tagUpdateProbe.fullRenderStacks.push(new Error().stack);return replace.apply(this,nodes);};
      window.tagUpdateObserver=new MutationObserver(records=>{for(const record of records)window.tagUpdateProbe.removed+=record.removedNodes.length;});
      window.tagUpdateObserver.observe(list,{childList:true});
    }''')


def measured(page, name, results, baseline, preserve=True):
    result = page.evaluate('''() => {
      const probe=window.tagUpdateProbe;window.tagUpdateObserver.disconnect();delete document.querySelector('#list').replaceChildren;
      return {cards:probe.cards.length,retained:probe.cards.filter(card=>card.isConnected).length,
        rendered:probe.rendered.length,renderedRetained:probe.rendered.filter(card=>card.isConnected).length,
        firstTwoRetained:probe.cards.slice(0,2).every(card=>card.isConnected),imagesRetained:probe.images.every(image=>image.isConnected),
        detailRetained:!probe.detail||probe.detail.isConnected,removed:probe.removed,scrollDelta:scrollY-probe.scroll,
        elapsedMs:Math.round(performance.now()-probe.started),fullRenderStacks:probe.fullRenderStacks};
    }''')
    results[name] = result
    if not baseline and preserve:
        assert result['firstTwoRetained'], (name, result)
        assert result['imagesRetained'], (name, result)
        assert result['detailRetained'], (name, result)
        # 离屏占位节点正常补齐不算重绘；所有已渲染卡片必须保持原节点。
        assert result['renderedRetained'] == result['rendered'], (name, result)
        assert abs(result['scrollDelta']) <= 1, (name, result)


def check(url, baseline=False):
    reports = {}
    with TemporaryDirectory(prefix='tag-updates-', dir=ROOT/'local') as temporary, sync_playwright() as driver:
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
                page.locator('#data-open').click()
                page.locator('#manage-tags').click()
                page.locator('#tag-name').fill(TAG)
                capture(page)
                page.locator('#tag-submit').click()
                expect(page.locator('#tag-list [data-tag]').first).to_have_attribute('data-tag', TAG)
                measured(page, 'create_tag', results, baseline)
                page.locator('#tag-name').fill(SECOND)
                page.locator('#tag-submit').click()
                page.locator('#close-tags').click()
                page.locator('#close-data').click()

                first = page.locator('#list .memory-card').first
                key = first.get_attribute('data-memory-key')
                editor = open_editor(first)
                capture(page)
                toggle_tag(editor, TAG)
                expect(first.locator('.custom-tag-name')).to_have_text(TAG)
                measured(page, 'ordinary_assign', results, baseline)
                page.screenshot(path=str(artifact_path(ROOT/f'local/checks/inline-tags/ordinary-expanded-{width}.png')), full_page=False)
                close_editor(page, first)

                capture(page)
                first.locator('.tag-chip-remove').click()
                expect(first.locator('.custom-tag-name')).to_have_count(0)
                measured(page, 'ordinary_remove', results, baseline)

                first.locator('.memory-detail-open').click()
                expect(page.locator('#detail-dialog')).to_be_visible()
                detail = page.locator('#detail-content')
                editor = open_editor(detail)
                capture(page)
                toggle_tag(editor, TAG)
                expect(page.locator('#detail-content .custom-tag-name')).to_have_text(TAG)
                measured(page, 'detail_assign', results, baseline)
                close_editor(page, detail)
                page.locator('#close-detail').click()

                page.locator('[data-tab="selectionMemories"]').click()
                expect(page.locator('#list .selection-memory-card')).to_have_count(6)
                wait_catalog(page, 'selectionMemories')
                selected = page.locator('#list .selection-memory-card').first
                editor = open_editor(selected)
                capture(page)
                toggle_tag(editor, SECOND)
                expect(selected.locator('.custom-tag-name')).to_have_text(SECOND)
                measured(page, 'selection_assign', results, baseline)
                page.screenshot(path=str(artifact_path(ROOT/f'local/checks/inline-tags/selection-expanded-{width}.png')), full_page=False)
                close_editor(page, selected)

                if not baseline:
                    # 标签成为搜索与筛选条件时，结果必须及时增删，不能只改卡片文字。
                    page.locator('[data-tab="memories"]').click()
                    if not page.locator('#custom-tag-filter').is_visible():
                        page.locator('#filter-toggle').click()
                    page.locator('#custom-tag-filter').select_option('__untagged__')
                    expect(page.locator(f'#list [data-memory-key="{key}"]')).to_have_count(0)
                    expect(page.locator('#count-memories')).to_have_text('57 / 58')
                    candidate = page.locator('#list .memory-card').first
                    candidate_key = candidate.get_attribute('data-memory-key')
                    editor = open_editor(candidate)
                    capture(page)
                    # 当前卡片会离开筛选结果，因此这里只检查结果成员，不再等待已移除的选项。
                    editor.get_by_role('button', name=TAG, exact=True).click()
                    expect(page.locator(f'#list [data-memory-key="{candidate_key}"]')).to_have_count(0)
                    expect(page.locator('#count-memories')).to_have_text('56 / 58')
                    measured(page, 'filtered_assignment', results, baseline, preserve=False)
                    expect(page.locator('.inline-tag-editor')).not_to_be_visible()
                    page.locator('#custom-tag-filter').select_option('')
                    page.locator('#search').fill(TAG)
                    expect(page.locator('#list .memory-card')).to_have_count(2)
                    first = page.locator('#list .memory-card').first
                    first.locator('.tag-chip-remove').click()
                    expect(page.locator('#list .memory-card')).to_have_count(1)
                    page.locator('#search').fill('')
                    expect(page.locator('#list .memory-card')).to_have_count(40)

                    # 刷新后检查真实本地持久化，两类回忆标签都不丢失。
                    page.reload(wait_until='networkidle')
                    expect(page.locator('#list .memory-card')).to_have_count(40, timeout=60000)
                    wait_catalog(page, 'memories')
                    page.locator('#search').fill(TAG)
                    expect(page.locator('#list .memory-card')).to_have_count(1)
                    page.locator('[data-tab="selectionMemories"]').click()
                    expect(page.locator('#list .selection-memory-card').first.locator('.custom-tag-name')).to_have_text(SECOND)
                    wait_catalog(page, 'selectionMemories')

                    # 管理标签的改名和删除同样走真实入口，影响关联及筛选但不重建无关卡片。
                    page.locator('#data-open').click()
                    page.locator('#manage-tags').click()
                    row = page.locator('#tag-list [data-tag]').filter(has_text=SECOND)
                    row.get_by_role('button', name='重命名', exact=True).click()
                    page.locator('#tag-name').fill('选拔改名标签')
                    capture(page)
                    page.locator('#tag-submit').click()
                    expect(page.locator('#list .selection-memory-card').first.locator('.custom-tag-name')).to_have_text('选拔改名标签')
                    measured(page, 'rename_tag', results, baseline)
                    row = page.locator('#tag-list [data-tag]').filter(has_text='选拔改名标签')
                    row.get_by_role('button', name='删除', exact=True).click()
                    capture(page)
                    row.get_by_role('button', name='删除', exact=True).click()
                    expect(page.locator('#list .selection-memory-card').first.locator('.custom-tag-name')).to_have_count(0)
                    measured(page, 'delete_tag', results, baseline)
                    page.locator('#close-tags').click()
                    page.locator('#close-data').click()

                screenshot = artifact_path(ROOT/f'local/checks/inline-tags/{"baseline" if baseline else "updates"}-{width}.png')
                page.screenshot(path=str(screenshot), full_page=False)
                assert not errors, errors
                assert not uploads, uploads
                reports[str(width)] = {'operations': results, 'page_errors': errors, 'uploads': uploads}
                context.close()
        finally:
            browser.close()
    report = artifact_path(ROOT/f'local/checks/inline-tags/{"baseline" if baseline else "updates"}.json')
    report.write_text(json.dumps({'url': url, 'baseline': baseline, 'viewports': reports}, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(reports, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:18765/')
    parser.add_argument('--baseline', action='store_true')
    args = parser.parse_args()
    check(args.url, args.baseline)
