"""通过实际页面验证共用悬停延迟与点击即时打开。"""
from playwright.sync_api import sync_playwright,expect


def check():
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('http://127.0.0.1:18765/',wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        button=page.locator('.memory-card .support-reward-trigger').first;button.scroll_into_view_if_needed();page.mouse.move(0,0)
        button.hover();page.wait_for_timeout(250);assert page.locator('.support-reward-popover:popover-open').count()==0
        page.mouse.move(0,0);page.wait_for_timeout(650);assert page.locator('.support-reward-popover:popover-open').count()==0
        button.hover();page.wait_for_timeout(250);assert page.locator('.support-reward-popover:popover-open').count()==0
        expect(page.locator('.support-reward-popover:popover-open')).to_be_visible(timeout=1500);page.keyboard.press('Escape');page.mouse.move(0,0)
        button.click();assert page.locator('.support-reward-popover:popover-open').count()==1;page.keyboard.press('Escape');page.mouse.move(0,0)
        button.hover();page.wait_for_timeout(200);page.keyboard.press('Escape');page.wait_for_timeout(650);assert page.locator('.support-reward-popover:popover-open').count()==0
        page.mouse.move(0,0);page.locator('#filter-toggle').click();page.locator('#inheritance-skill-open').click();choice=page.locator('#selection-picker-list .selection-filter-choice').first;choice.hover();page.wait_for_timeout(250);assert page.locator('.selection-card-preview-popover:popover-open').count()==0
        expect(page.locator('.selection-card-preview-popover:popover-open')).to_be_visible(timeout=1500);page.locator('#selection-picker-cancel').click();page.wait_for_timeout(650);assert page.locator('.support-reward-popover:popover-open').count()==0
        assert not errors,errors;browser.close()
    print('扫过及移出不触发、停留后打开、点击即时打开、Escape 取消等待和选择列表共用延迟验证通过。')


if __name__=='__main__':check()
