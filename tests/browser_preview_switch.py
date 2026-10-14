"""从两份实际构建验证部署开关、数据文件缺席及已有预览数据保留。"""

import functools
import sys
import threading
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from build import build

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args):
        pass


def check():
    with TemporaryDirectory(dir=ROOT/'local',prefix='preview-switch-') as temporary:
        root=Path(temporary);build(root/'enabled'/'dist',preview_account=True);build(root/'disabled'/'dist')
        server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(root)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with sync_playwright() as p:
                browser=p.chromium.launch();page=browser.new_page();base=f'http://127.0.0.1:{server.server_port}';requests=[];errors=[]
                page.on('request',lambda request:requests.append(request.url));page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto(base+'/enabled/dist/',wait_until='networkidle');page.locator('#data-open').click();expect(page.locator('#preview-account-section')).to_be_visible();page.locator('#enable-preview-account').click();expect(page.locator('#profile option:checked')).to_have_text('预览账号',timeout=30000)
                page.goto(base+'/disabled/dist/',wait_until='networkidle');page.locator('#data-open').click();expect(page.locator('#preview-account-section')).not_to_be_visible();expect(page.locator('#profile option:checked')).to_have_text('未导入账号')
                blocked=page.evaluate("async()=>{try{await (await import('./application/preview-account.mjs')).installPreviewAccount();return false;}catch(error){return error.message.includes('未启用');}}")
                assert blocked;assert not any('/disabled/dist/resources/preview-account.json' in url for url in requests)
                assert page.request.get(base+'/disabled/dist/resources/preview-account.json').status==404
                count=page.evaluate("async()=>{const {profileData}=await import('./application/storage.mjs');return (await profileData('account-synthetic-preview-account')).ordinary.snapshot.memories.length;}")
                assert count==877
                page.goto(base+'/enabled/dist/',wait_until='networkidle');expect(page.locator('#profile option:checked')).to_contain_text('预览账号');assert not errors,errors;browser.close()
        finally:
            server.shutdown();server.server_close();thread.join()
    print('部署开关：开启入口可用，默认关闭无入口／无数据文件／安装入口拒绝，旧预览档案保留并可再次使用。')

if __name__=='__main__':
    check()
