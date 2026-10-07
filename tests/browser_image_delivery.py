"""以真实静态入口、独立图片源和 IndexedDB 验证基础包首次下载及后续增量。"""
import argparse
import base64
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer, BaseHTTPRequestHandler
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from test_content_install import fixture, build, install, ROOT
from prepare_locks import prepare


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass


def check(browser_path=None):
    (ROOT/'local').mkdir(exist_ok=True)
    samples=json.loads((ROOT/'tests/contracts/image-delivery-v1.json').read_text())
    requested=[];blocked=set();payloads={}
    class Images(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            requested.append(self.path)
            assert 'Cookie' not in self.headers and 'Authorization' not in self.headers
            raw=payloads.get(self.path)
            self.send_response(503 if self.path in blocked else 200 if raw is not None else 404)
            self.send_header('Access-Control-Allow-Origin','*')
            self.send_header('Content-Type','application/octet-stream')
            self.end_headers()
            if self.path not in blocked and raw is not None:self.wfile.write(raw)
    images=ThreadingHTTPServer(('127.0.0.1',0),Images);image_thread=Thread(target=images.serve_forever,daemon=True);image_thread.start()
    image_origin=f'http://127.0.0.1:{images.server_port}'
    for url,value in samples['packages'].items():payloads['/release'+urlsplit(url).path]=base64.b64decode(value)
    for key,value in samples['objects'].items():payloads['/cdn/objects/'+key]=base64.b64decode(value)
    def index(name):
        value=json.loads(json.dumps(samples['versions'][name]));value['cdn_base_url']=image_origin+'/cdn/'
        for pack in value['baseline']['packages']:pack['url']=image_origin+'/release'+urlsplit(pack['url']).path
        return value
    site_server=None
    try:
        with TemporaryDirectory(dir=ROOT/'local',prefix='image-delivery-browser-') as temp:
            root=Path(temp);site=root/'dist'
            for version in ['one','two','three','multi']:fixture(root,version,index(version))
            prepare(root/'one',root/'locks')
            build(site,root/'locks/asset-lock.json',root/'locks/content-lock.json')
            site_server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(root)))
            site_thread=Thread(target=site_server.serve_forever,daemon=True);site_thread.start()
            url=f'http://127.0.0.1:{site_server.server_port}/dist/'
            def ready(page):
                expect(page.locator('#image-notice')).to_contain_text(re.compile('图片已保存到本机|已请求的图片已准备好'),timeout=20000)
            def show_image(page,name):
                return page.evaluate('''async name=>{
                    const {uiIconURL}=await import('./resources.mjs');const url=uiIconURL(name);
                    const image=new Image();image.src=url;await image.decode();return {url,width:image.naturalWidth};
                }''',name)
            def update(page,version):
                prepare(root/version,root/('locks-'+version),site=site)
                install(site,root/('locks-'+version)/'content-lock.json',asset_lock=root/('locks-'+version)/'asset-lock.json')
                page.locator('#content-check').click();expect(page.locator('#content-apply')).to_be_visible()
                page.locator('#content-apply').click();page.wait_for_load_state('networkidle')
                page.locator('#resources-open').click();ready(page)
            with sync_playwright() as driver:
                browser=driver.chromium.launch(headless=True,**({'executable_path':browser_path} if browser_path else {}))
                context=browser.new_context();page=context.new_page();errors=[];requests=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                context.on('request',lambda request:requests.append((request.url,request.method,request.post_data)))
                held=[]
                context.route(image_origin+'/**',lambda route:held.append(route))
                page.goto(url,wait_until='domcontentloaded')
                expect(page.locator('#content-version')).to_contain_text('one',timeout=20000)
                expect(page.locator('#empty-import-account')).to_be_enabled()
                expect(page.locator('#startup-status')).to_be_hidden()
                expect(page.locator('#image-notice')).to_contain_text('正在下载',timeout=20000)
                # 模拟冷缓存时保存地址与构造离屏节点，缓存就绪后才挂载。
                page.evaluate("""async()=>{
                    const {uiIconURL}=await import('./resources.mjs');
                    window.delayedIconURL=uiIconURL('first.png');
                    window.detachedIcon=new Image();detachedIcon.src=delayedIconURL;
                    window.clonedIcon=detachedIcon.cloneNode(true);clonedIcon.hidden=true;
                    window.detachedSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');
                    const icon=document.createElementNS(detachedSvg.namespaceURI,'image');icon.setAttribute('href',delayedIconURL);detachedSvg.append(icon);
                }""")
                for route in held:route.continue_()
                context.unroute(image_origin+'/**')
                page.locator('#resources-open').click();ready(page)
                first=show_image(page,'first.png');assert first['width']==1 and first['url'].startswith('blob:')
                page.evaluate("""()=>{
                    window.lateIcon=new Image();lateIcon.src=delayedIconURL;
                    document.body.append(detachedIcon,clonedIcon,lateIcon,detachedSvg);
                }""")
                page.wait_for_function("()=>[detachedIcon,clonedIcon,lateIcon].every(i=>i.src.startsWith('blob:')&&i.complete&&i.naturalWidth===1&&!i.hidden)&&detachedSvg.firstChild.getAttribute('href').startsWith('blob:')")
                page.evaluate('()=>{for(const node of [detachedIcon,clonedIcon,lateIcon,detachedSvg])node.remove()}')
                assert len(requested)==1 and requested[0].startswith('/release/one/')
                page.reload(wait_until='networkidle');page.locator('#resources-open').click();ready(page);assert len(requested)==1
                update(page,'two');assert len(requested)==2 and requested[-1].startswith('/cdn/objects/')
                assert show_image(page,'second.png')['width']==1
                update(page,'three');assert len(requested)==2
                fresh=browser.new_context();fresh_page=fresh.new_page();fresh_page.goto(url,wait_until='networkidle');fresh_page.locator('#resources-open').click();ready(fresh_page)
                assert len(requested)==3 and requested[-1].startswith('/release/three/');fresh.close()
                # 在新浏览器中模拟第二基础分段失败，点击重试复用第一分段。
                prepare(root/'multi',root/'locks-multi',site=site)
                install(site,root/'locks-multi/content-lock.json',asset_lock=root/'locks-multi/asset-lock.json')
                second_path=urlsplit(index('multi')['baseline']['packages'][1]['url']).path;blocked.add(second_path)
                retry_context=browser.new_context();retry_page=retry_context.new_page();retry_page.goto(url,wait_until='networkidle');retry_page.locator('#resources-open').click()
                expect(retry_page.locator('#image-retry')).to_be_visible(timeout=20000)
                retry_page.evaluate("""async()=>{const {uiIconURL}=await import('./resources.mjs');const {watchImage}=await import('./ui/image-loading.mjs');const image=new Image();image.id='failed-image-probe';watchImage(image,()=>{image.dataset.ready='true';},()=>{image.dataset.failed='true';});image.src=uiIconURL('second.png');document.body.append(image);}""")
                expect(retry_page.locator('#failed-image-probe')).to_have_attribute('data-failed','true')
                before=len(requested);blocked.clear();retry_page.locator('#image-retry').click();retry_page.wait_for_load_state('networkidle')
                ready(retry_page)
                expect(retry_page.locator('#failed-image-probe')).to_have_attribute('data-ready','true')
                assert requested[before:]==[second_path]
                assert show_image(retry_page,'second.png')['width']==1
                retry_context.close()
                assert not errors,errors
                assert all(method in ('GET','HEAD') and not body for _,method,body in requests)
                context.close()
                # 同源构建保持内容身份，并在子目录中镜像基础包与增量对象。
                mirror=root/'mirror'/'dist'
                build(mirror,root/'locks-two/asset-lock.json',root/'locks-two/content-lock.json',mirror_images=True)
                assert (mirror/'content/releases/two/assets-index.json').read_bytes()==(root/'two/assets-index.json').read_bytes()
                before=len(requested);same_origin=[]
                mirrored=browser.new_context();mirrored.on('request',lambda request:same_origin.append((request.url,request.method,request.post_data)))
                mirror_page=mirrored.new_page();mirror_page.on('pageerror',lambda error:errors.append(str(error)))
                mirror_page.goto(f'http://127.0.0.1:{site_server.server_port}/mirror/dist/',wait_until='networkidle')
                mirror_page.locator('#resources-open').click();ready(mirror_page)
                assert show_image(mirror_page,'second.png')['width']==1
                assert len(requested)==before
                downloads=[address for address,_,_ in same_origin if '/image-files/' in address]
                assert len(downloads)==1 and all('/mirror/dist/image-files/' in address for address in downloads)
                assert all((address.startswith('blob:') or urlsplit(address).netloc==f'127.0.0.1:{site_server.server_port}') and method in ('GET','HEAD') and not body for address,method,body in same_origin),same_origin
                mirror_page.reload(wait_until='networkidle');mirror_page.locator('#resources-open').click();ready(mirror_page)
                assert len([address for address,_,_ in same_origin if '/image-files/' in address])==1
                mirror_page.locator('#close-resources').click();mirror_page.set_viewport_size({'width':375,'height':812})
                mirror_page.locator('#language').select_option('ja')
                expect(mirror_page.locator('#image-notice')).to_contain_text('画像')
                assert mirror_page.evaluate('document.documentElement.scrollWidth<=innerWidth'), '移动端资源状态溢出'
                mirrored.close()
                failed=browser.new_context();failed.route('**/app.mjs',lambda route:route.abort())
                failed_page=failed.new_page();failed_page.goto(url,wait_until='networkidle')
                expect(failed_page.locator('#startup-status')).to_contain_text('启动失败')
                expect(failed_page.locator('#startup-status a')).to_have_attribute('href','./')
                failed.close()
                # 回源字节损坏必须停止，且保留此前成功产物。
                previous=(mirror/'release.json').read_bytes()
                first_path=urlsplit(index('two')['baseline']['packages'][0]['url']).path
                payloads[first_path]=b'broken'
                try:build(mirror,root/'locks-two/asset-lock.json',root/'locks-two/content-lock.json',mirror_images=True)
                except ValueError:pass
                else:raise AssertionError('损坏图片副本没有阻止构建')
                assert (mirror/'release.json').read_bytes()==previous
                assert not errors,errors
                browser.close()
            return {'initial_release_only':True,'reload_offline_images':True,'incremental_cdn_only':True,
                    'existing_client_skips_new_baseline':True,'new_client_uses_latest_baseline':True,
                    'segment_resume':True,'cross_origin':True,'same_origin_subpath':True,'content_before_images':True,'boot_failure':True,'mobile_japanese':True,'mirror_hash_failure_preserves_site':True,'decoded_images':True,'page_errors':len(errors)}
    finally:
        if site_server:site_server.shutdown();site_server.server_close();site_thread.join()
        images.shutdown();images.server_close();image_thread.join()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--browser');args=parser.parse_args()
    print(json.dumps(check(args.browser),ensure_ascii=False))
