"""从真实静态入口验证资料热更新、失败保留、离线恢复与账号隔离。"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from test_content_install import fixture,build,install,ROOT
from browser_static import fixtures,ACCOUNT


class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass


def check(browser_path=None):
    with TemporaryDirectory(dir=ROOT/'local',prefix='content-browser-') as temp:
        root=Path(temp);site=root/'dist';build(site)
        one,bundle=fixture(root,'one');install(site,one)
        two,_=fixture(root,'two',changed='catalog');three,_=fixture(root,'three',changed='effects')
        server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(root)))
        thread=Thread(target=server.serve_forever,daemon=True);thread.start()
        # 子目录同时验证模块相对路径、内容频道及离线导入没有逃逸站点根。
        url=f'http://127.0.0.1:{server.server_port}/dist/'
        try:
            with sync_playwright() as driver:
                browser=driver.chromium.launch(headless=True,**({'executable_path':browser_path} if browser_path else {}))
                context=browser.new_context();page=context.new_page();errors=[];requests=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                context.on('request',lambda request:requests.append((request.url,request.method,request.post_data)))
                page.goto(url,wait_until='networkidle')
                page.locator('#data-open').click();expect(page.locator('#content-version')).to_contain_text('one')
                page.locator('#close-data').click()
                account=root/'account'
                for name,document in fixtures().items():
                    target=account/name/'snapshot.json';target.parent.mkdir(parents=True);target.write_text(json.dumps(document))
                page.locator('#account-directory-files').set_input_files(str(account))
                expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
                page.locator('#data-open').click()
                request_start=len(requests)
                install(site,two)
                page.locator('#content-check').click()
                expect(page.locator('#content-apply')).to_be_visible()
                expect(page.locator('#content-version')).to_contain_text('one')
                expect(page.locator('#content-status')).to_contain_text('two')
                downloaded=[urlsplit(value[0]).path.rsplit('/',1)[-1] for value in requests[request_start:] if '/releases/two/' in value[0]]
                assert sorted(downloaded)==['catalog.json','manifest.json'],downloaded
                page.locator('#content-apply').click();page.wait_for_load_state('networkidle')
                page.locator('#data-open').click();expect(page.locator('#content-version')).to_contain_text('two')
                expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
                # 公共图片清理不能删除当前账号；使用独立数据库的合成对象验证。
                await_marker=page.evaluate("""async()=>{const {createImageStore}=await import('./application/image-store.mjs');await createImageStore().put('synthetic-public-object',new Blob(['synthetic']));return true;}""")
                assert await_marker
                page.once('dialog',lambda dialog:dialog.accept())
                with page.expect_navigation(wait_until='networkidle'):
                    page.locator('#image-clear').click()
                expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
                assert page.evaluate("""async()=>{const {createImageStore}=await import('./application/image-store.mjs');return !await createImageStore().get('synthetic-public-object');}""")
                page.locator('#data-open').click()
                # 发布后模拟分包损坏，浏览器必须拒绝它并保留已验证版本。
                install(site,three)
                (site/'content/releases/three/effects.json').write_text('broken')
                page.locator('#content-check').click()
                expect(page.locator('#content-status')).to_contain_text('已有资料仍可使用')
                expect(page.locator('#content-version')).to_contain_text('two')
                expect(page.locator('#content-apply')).to_be_hidden()
                context.route('**/content/channel.json',lambda route:route.abort())
                page.reload(wait_until='networkidle');page.locator('#data-open').click()
                expect(page.locator('#content-version')).to_contain_text('two')
                expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
                page.locator('#content-file').set_input_files(str(bundle))
                expect(page.locator('#content-apply')).to_be_visible()
                page.locator('#content-apply').click();page.wait_for_load_state('networkidle')
                page.locator('#data-open').click();expect(page.locator('#content-version')).to_contain_text('one')
                expect(page.locator('#content-status')).to_contain_text('本地导入')
                expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
                assert not errors,errors
                for request_url,method,body in requests:
                    assert method in ('GET','HEAD') and not body
                    assert ACCOUNT not in request_url
                    target=urlsplit(request_url)
                    assert target.netloc==urlsplit(url).netloc and target.path.startswith('/dist/')
                browser.close()
            return {'content_format':1,'changed_parts_downloaded':['catalog.json'],'unchanged_parts_reused':5,'online_update':True,'failed_update_keeps_cache':True,'offline_cache':True,'local_bundle_import':True,
                    'account_preserved':True,'subdirectory':True,'inventory_uploads':0,'page_errors':0}
        finally:
            server.shutdown();server.server_close();thread.join()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--browser')
    args=parser.parse_args();print(json.dumps(check(args.browser),ensure_ascii=False))
