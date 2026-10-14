"""使用内置预览验证大候选集的滚动、键盘、选择持久化与快速重开。"""
import argparse
import re

from playwright.sync_api import sync_playwright,expect


def check(url):
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':390,'height':844});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:uploads.append(request.method) if request.post_data else None)
        page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click()
        expect(page.locator('#list .memory-card').first).to_be_visible(timeout=60000)
        page.evaluate("async()=>{await (await import('./application/master-loader.mjs')).loadMaster('memories');await new Promise(requestAnimationFrame);}")
        assert page.locator('#selection-skill option').count()==0
        for opener in ['inheritance-skill-open','inheritance-ability-open','memory-skill-open']:
            if page.locator('#filter-toggle').get_attribute('aria-expanded')=='false':page.locator('#filter-toggle').click()
            page.locator('#'+opener).click()
            expect(page.locator('#selection-picker')).to_be_visible()
            inputs=page.locator('#selection-picker-list input');assert inputs.count()>200,opener
            assert page.locator('#selection-picker .picker-visual-pending').count()>100,opener
            last=page.locator('#selection-picker-list input:not(:disabled)').last
            last.focus();expect(last.locator('..')).not_to_have_class(re.compile('.*picker-visual-pending.*'));page.keyboard.press('Space');expect(last).to_be_checked()
            page.locator('#selection-picker-clear').click();expect(page.locator('#selection-picker-list input:checked')).to_have_count(0)
            last.check();page.locator('#selection-picker-confirm').click();expect(page.locator('#selection-picker')).not_to_be_visible()
            if opener=='inheritance-skill-open':
                # 保存的条件即使处于折叠状态，重载后也必须恢复名称、候选与筛选结果。
                count=page.locator('#count-memories').inner_text()
                page.locator('#filter-toggle').click();page.reload(wait_until='networkidle')
                expect(page.locator('#content-readiness')).not_to_be_visible(timeout=60000)
                expect(page.locator('#count-memories')).to_have_text(count)
                expect(page.locator('#active-filters [data-filter-key="skill"]')).to_have_count(1)
                expect(page.locator('#filter-toggle')).to_have_attribute('aria-expanded','false')
                page.locator('#filter-toggle').click()
            page.locator('#'+opener).click();expect(page.locator('#selection-picker-list input:checked')).to_have_count(1)
            page.locator('#selection-picker-cancel').click();page.locator('#clear-active-filters').click()
            # 原生 close 事件可能晚于再次打开；不能让旧清理回调取消新预览。
            page.evaluate("id=>{document.getElementById(id).click();document.getElementById('selection-picker').close();document.getElementById(id).click();}",opener)
            expect(page.locator('#selection-picker-list .picker-visual-pending')).not_to_have_count(inputs.count())
            first=page.locator('#selection-picker-list input:not(:disabled)').first;first.focus();expect(first.locator('..')).not_to_have_class(re.compile('.*picker-visual-pending.*'))
            page.locator('#selection-picker-cancel').click()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert not errors and not uploads,(errors,uploads);browser.close()
    print('大候选集屏幕外预览、键盘多选、清空、确认重开、快速关闭重开及无上传检查通过。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
