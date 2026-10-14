"""验证真实列表的视口构建、键盘入口、快速切页及窄屏；仅使用内置预览账号。"""
from browser_artifacts import artifact_path
import re
from playwright.sync_api import expect

TABS=['memories','selectionMemories','idolCards','supportCards','idolCardSkins']

def check_page(page,out):
    page.context.new_cdp_session(page).send('Emulation.setCPUThrottlingRate',{'rate':1})
    page.set_viewport_size({'width':1280,'height':900})
    page.evaluate("async tabs=>{const {loadMaster}=await import('./application/master-loader.mjs');for(const tab of tabs)await loadMaster(tab);await new Promise(requestAnimationFrame);}",TABS)
    for tab in TABS:
        print('检查列表：'+tab,flush=True)
        page.evaluate('window.scrollTo(0,0)')
        page.locator(f'[data-tab="{tab}"]').click()
        rows=page.locator('#list > article')
        assert rows.count()>8,tab
        assert 0<page.locator('#list > .deferred-entry').count()<rows.count(),tab
        # 选择占位节点与聚焦在同一任务执行，避免测试句柄被视口回调替换。
        result=page.evaluate("""()=>{
            const node=[...document.querySelectorAll('#list > .deferred-entry')].at(-1),index=[...node.parentElement.children].indexOf(node);
            const source=document.createElement('button');document.body.append(source);source.focus({preventScroll:true});node.focus({preventScroll:true});source.remove();
            const row=document.querySelector('#list').children[index];return {hydrated:!row.classList.contains('deferred-entry'),focused:row.contains(document.activeElement)};
        }""")
        assert result=={'hydrated':True,'focused':True},(tab,result)
        result=page.evaluate("""()=>{
            const node=document.querySelector('#list > .deferred-entry'),index=[...node.parentElement.children].indexOf(node);
            document.querySelector('#search').focus({preventScroll:true});node.focus({preventScroll:true});
            const row=document.querySelector('#list').children[index];return {hydrated:!row.classList.contains('deferred-entry'),focused:row.contains(document.activeElement)};
        }""")
        assert result=={'hydrated':True,'focused':True},(tab,result)
        for index in range(rows.count()):
            rows.nth(index).scroll_into_view_if_needed()
            expect(rows.nth(index)).not_to_have_class(re.compile(r'.*deferred-entry.*'),timeout=15000)
        assert not page.locator('#list > .deferred-entry').count(),tab
    # 快速切页取消旧页构建，不能把其他类型卡片补入当前列表。
    page.evaluate("()=>{for(const tab of ['memories','idolCards','selectionMemories','supportCards','memories'])document.querySelector('[data-tab=\"'+tab+'\"]').click();window.scrollTo(0,0);}")
    expect(page.locator('#list > article')).to_have_count(40)
    assert page.locator('#list > article:not(.memory-card)').count()==0
    first=page.locator('#list > article').first
    key=first.get_attribute('data-memory-key')
    page.locator('#search').fill(key)
    expect(page.locator('#list > article')).to_have_count(1)
    expect(page.locator('#list .memory-detail-open')).to_be_visible()
    page.locator('#list .memory-detail-open').click()
    page.locator('#close-detail').click()
    expect(page.locator('#list .memory-detail-open')).to_be_focused()
    page.locator('#search').fill('')
    expect(page.locator('#list > article')).to_have_count(40)
    page.locator('#next').click()
    assert page.locator('#list > article').first.get_attribute('data-memory-key')!=key
    page.locator('#previous').click()
    assert page.locator('#list > article').first.get_attribute('data-memory-key')==key
    page.set_viewport_size({'width':390,'height':844})
    page.evaluate('window.scrollTo(0,0)')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=artifact_path(str(out/'memory-mobile.png')),full_page=False)
    print('五类列表滚动补齐、双向键盘入口、切页取消、搜索、详情焦点、分页与窄屏通过。',flush=True)
