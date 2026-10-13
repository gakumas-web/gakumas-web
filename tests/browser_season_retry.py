"""验证赛季模块短暂加载失败后，重试会重新请求程序并保留本地预览账号。"""
from playwright.sync_api import sync_playwright,expect


def check(url):
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page();requests=[];errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        def fail_once(route):
            requests.append(route.request.url)
            if len(requests)==1:
                route.fulfill(status=503,content_type='text/javascript',body='')
            else:
                route.continue_()
        # 只注入一次边界故障；恢复后的模块和页面流程均使用正式入口。
        page.route('**/domain/contest-customization-rules.mjs',fail_once)
        page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#season-simulation-open')).to_be_enabled(timeout=60000)
        profile=page.locator('#profile').input_value();page.locator('#season-simulation-open').click();host=page.locator('#season-simulation-view');expect(host).to_contain_text('赛季资料加载失败')
        with page.expect_navigation(wait_until='networkidle'):
            host.get_by_role('button',name='重试',exact=True).click()
        expect(page.locator('#profile')).to_have_value(profile);expect(page.locator('#season-simulation-open')).to_be_enabled(timeout=60000);page.locator('#season-simulation-open').click()
        tabs=page.locator('.simulation-mode-tabs');expect(tabs).to_be_visible(timeout=60000);tabs.locator('[data-mode=optimization]').click();expect(page.locator('#contest-optimization')).to_be_visible();expect(page.locator('[data-optimization-grade="0"] option[value="15"]')).to_have_count(1)
        assert len(requests)==2 and not errors,(len(requests),errors)
        browser.close()
    print('一次模块加载失败 → 重试重新加载程序 → 保留账号并正常打开赛季与自定义推荐，通过。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
