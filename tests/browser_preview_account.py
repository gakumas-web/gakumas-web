"""验证真实账号入口中的预览安装、标签编辑及与其他合成账号的隔离。"""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import fixtures,ROOT,ACCOUNT


def check(url):
    with TemporaryDirectory(dir=ROOT/'local',prefix='preview-account-test-') as temporary,sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[];downloads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:(uploads.append(request.url) if request.post_data else None,downloads.append(request.url) if 'preview-account.json' in request.url else None))
        page.goto(url,wait_until='networkidle');assert not downloads
        page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        expect(page.locator('#profile option:checked')).to_contain_text('预览账号');expect(page.locator('#count-memories')).to_have_text('877');assert len(downloads)==1
        page.locator('#data-open').click();expect(page.locator('#data-account-identity')).to_contain_text('预览账号');page.locator('#manage-tags').click();expect(page.locator('.tag-manager-row')).to_have_count(7)
        page.locator('#tag-name').fill('预览自建标签');page.locator('#tag-submit').click();expect(page.locator('.tag-manager-row')).to_have_count(8);page.locator('#close-tags').click();page.locator('#close-data').click()
        page.locator('.edit-custom-tags').first.click();page.get_by_role('checkbox',name='预览自建标签',exact=True).check();page.locator('#close-tags').click();expect(page.locator('.custom-tag-name').filter(has_text='预览自建标签').first).to_be_visible()
        for tab,title in [('memories','回忆'),('selectionMemories','选拔回忆'),('idolCards','偶像卡'),('supportCards','支援卡'),('idolCardSkins','主题装扮'),('achievements','成就')]:
            page.locator(f'[data-tab="{tab}"]').click()
            if tab=='achievements':expect(page.locator('#achievement-browser')).to_be_visible(timeout=30000)
            else:expect(page.locator('#section-title')).to_have_text(title)
            if tab=='selectionMemories':
                expect(page.locator('.selection-details-button').first).to_be_visible(timeout=30000);page.locator('.selection-details-button').first.click();expect(page.locator('.selection-detail-memory-card')).to_have_count(4);expect(page.locator('.selection-detail-support-card')).to_have_count(6);page.locator('.selection-details-dialog .dialog-head > button').click()
        page.reload(wait_until='networkidle');expect(page.locator('#profile option:checked')).to_contain_text('预览账号')
        for name,document in fixtures().items():
            file=Path(temporary)/'account'/name/'snapshot.json';file.parent.mkdir(parents=True);file.write_text(json.dumps(document))
        expect(page.locator('#import-account-directory')).to_be_enabled(timeout=30000)
        page.locator('#account-directory-files').set_input_files(str(Path(temporary)/'account'));expect(page.locator('#count-memories')).to_have_text('1',timeout=30000)
        page.locator('#data-open').click();page.locator('#manage-tags').click();expect(page.locator('.tag-manager-row')).to_have_count(0);page.locator('#close-tags').click()
        page.locator('#enable-preview-account').click();expect(page.locator('#profile option:checked')).to_contain_text('预览账号');assert len(downloads)==1
        page.locator('#data-open').click();page.locator('#manage-tags').click();expect(page.locator('.tag-manager-row')).to_have_count(8);expect(page.locator('[data-tag="预览自建标签"]')).to_be_visible();page.locator('#close-tags').click()
        for width in [1280,390]:
            page.set_viewport_size({'width':width,'height':1000});page.screenshot(path=str(ROOT/f'local/season-simulation/preview-account-{width}.png'))
        page.locator('#close-data').click();page.locator('#profile').select_option('account-'+ACCOUNT);expect(page.locator('#count-memories')).to_have_text('1',timeout=30000)
        assert not errors,errors;assert not uploads,uploads;browser.close()
    print('预览入口：按需读取、六页签、培养阵容、7 个初始标签、标签编辑、刷新／再次启用保留、其他账号隔离及无上传通过。')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8091/');args=parser.parse_args();check(args.url)
