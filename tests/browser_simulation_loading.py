"""暂缓真实公开资料响应，检查窄屏加载提示与模拟入口的就绪边界。"""
import argparse
import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.async_api import async_playwright,expect
from browser_static import fixtures,ROOT,ACCOUNT
from browser_artifacts import artifact_path


async def check(url):
    with TemporaryDirectory(prefix='loading-account-',dir=ROOT/'local') as temporary:
        folder=Path(temporary)/'account'
        for name,data in fixtures().items():
            path=folder/name/'snapshot.json';path.parent.mkdir(parents=True);path.write_text(json.dumps(data))
        async with async_playwright() as p:
            browser=await p.chromium.launch(headless=True);page=await browser.new_page(viewport={'width':360,'height':800});uploads=[]
            held=asyncio.Event();released=asyncio.Event()
            async def hold(route):
                held.set();await released.wait();await route.continue_()
            page.on('request',lambda r:uploads.append(r.url) if r.post_data or ACCOUNT in r.url else None)
            await page.context.route('**/progression.json*',hold)
            await page.goto(url,wait_until='domcontentloaded');await expect(page.locator('#account-directory-files')).to_be_enabled(timeout=30000)
            await page.locator('#account-directory-files').set_input_files(str(folder));await expect(page.locator('#inventory')).to_be_visible(timeout=60000)
            await page.locator('[data-tab=seasonSimulation]').click();await expect(page.locator('#content-readiness')).to_be_visible(timeout=30000)
            await asyncio.wait_for(held.wait(),30)
            assert await page.locator('.optimization-start:visible:enabled,.season-simulate:visible:enabled').count()==0
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            await page.screenshot(path=artifact_path(str(ROOT/'local/checks/review-066-followup/loading-360.png')))
            released.set()
            await expect(page.locator('.simulation-mode-tabs')).to_be_visible(timeout=60000);await expect(page.locator('#content-readiness')).to_be_hidden()
            assert not uploads,uploads
            await browser.close()
    print('360px 真实资料等待期间没有可操作的模拟按钮；恢复响应后正常进入，未发现横向溢出或账号上传。')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);asyncio.run(check(parser.parse_args().url))
