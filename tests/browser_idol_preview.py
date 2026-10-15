"""通过实际偶像卡页面验证培养步进器的范围、空值恢复与预览还原。"""
import argparse
from playwright.sync_api import sync_playwright,expect
from browser_artifacts import artifact_path
from browser_catalog_rarity import open_tab


def check(url):
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        open_tab(page,'idolCards','偶像卡');page.locator('#idol-immersive').uncheck()
        card=page.locator('#list .idol-card:has(.idol-preview-toggle)').first
        expect(card).to_be_visible(timeout=60000);card.locator('.idol-preview-toggle').click()
        controls=card.locator('.idol-preview-controls');expect(controls).to_be_visible()
        baseline={kind:card.locator(f'[data-stage-input="{kind}"]').input_value() for kind in ['rank','potential']}
        for kind in ['rank','potential']:
            field=card.locator(f'[data-stage-input="{kind}"]');maximum=int(field.get_attribute('max'));assert maximum>0
            buttons=card.locator(f'button[data-stage-kind="{kind}"]')
            assert buttons.evaluate_all('nodes=>nodes.map(node=>node.dataset.stageAction)')==['min','minus','plus','max']
            def action(name):return card.locator(f'[data-stage-kind="{kind}"][data-stage-action="{name}"]')
            if field.input_value()==str(maximum):action('min').click()
            action('max').click();expect(field).to_have_value(str(maximum));expect(action('max')).to_be_disabled();expect(action('plus')).to_be_disabled()
            action('minus').click();expect(field).to_have_value(str(maximum-1))
            if field.input_value()!='0':action('min').click()
            expect(field).to_have_value('0');expect(action('min')).to_be_disabled();expect(action('minus')).to_be_disabled()
            action('plus').focus();page.keyboard.press('Space');expect(field).to_have_value('1')
            for typed,expected in [(str(maximum+10),str(maximum)),('1.8','1'),('','1'),('-2','0')]:
                field.fill(typed);field.press('Tab');expect(field).to_have_value(expected)
                expect(card).to_have_attribute('data-preview-'+('rank' if kind=='rank' else 'potential'),expected)
            other='potential' if kind=='rank' else 'rank';expect(card.locator(f'[data-stage-input="{other}"]')).to_have_value(baseline[other])
            # 改成区别于持有值的阶段，确保还原操作确实经过共用控件的状态同步。
            if baseline[kind]=='0':action('max').click()
            card.locator('.idol-preview-reset').click()
            for key,value in baseline.items():expect(card.locator(f'[data-stage-input="{key}"]')).to_have_value(value)
            expect(card.locator('.idol-preview-reset')).to_be_disabled()
        for width in [1280,375,320]:
            page.set_viewport_size({'width':width,'height':1000})
            assert controls.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            controls.screenshot(path=artifact_path(f'local/idol-preview/controls-{width}.png'))
        assert not errors and not uploads,(errors,uploads);browser.close()
    print('培养预览 Min／Max、单步和键盘操作、范围约束、清空恢复、独立属性与还原及三种宽度通过。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);check(parser.parse_args().url)
