"""使用最新内容的默认赛季，验证三个舞台的实际 Worker 倍率与参考属性。"""
import argparse
from playwright.sync_api import sync_playwright, expect


def check(url):
    with sync_playwright() as driver:
        browser=driver.chromium.launch();page=browser.new_page();errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click()
        expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab=seasonSimulation]').click()
        expect(page.locator('.season-stage-tab')).to_have_count(3,timeout=60000)
        season=page.locator('#season-select').inner_text()
        for index in range(3):
            page.locator('.season-stage-tab').nth(index).click();page.locator('[data-mode=optimization]').click()
            expect(page.locator('.optimization-fields')).to_be_enabled(timeout=30000)
            fill=page.locator('.optimization-autofill');expect(fill).to_be_enabled()
            for key in ['vocal','dance','visual']:page.locator(f'[data-optimization-attribute="{key}"]').fill('1500')
            expect(page.locator('[data-optimization-multiplier]:visible')).to_have_count(3,timeout=30000)
            page.locator('[data-optimization-attribute=stamina]').fill('77');fill.click()
            expect(page.locator('.optimization-autofill-notice')).to_be_visible(timeout=30000)
            expect(page.locator('[data-optimization-attribute=stamina]')).to_have_value('77')
            expect(page.locator('[data-optimization-multiplier]:visible')).to_have_count(3,timeout=30000)
            assert all(float(value.rstrip('%'))>0 for value in page.locator('[data-optimization-multiplier]').all_text_contents())
        assert not errors,errors;browser.close()
    print(season+'：三个舞台的倍率计算、参考属性填入和体力保留通过。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);check(parser.parse_args().url)
