"""同一份 Web 程序更新独立频道后补取 CDN，不访问跨域基础包，不复用旧缩略图。"""
from contextlib import ExitStack
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
from threading import Thread
from unittest.mock import patch
from PIL import Image
from playwright.sync_api import sync_playwright,expect
from test_image_plan import source_fixture
from test_content_install import fixture
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
import build as builder
from prepare_locks import prepare


def serve(root,requests):
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
        def end_headers(self):
            self.send_header('Access-Control-Allow-Origin','*');super().end_headers()
        def do_GET(self):
            requests.append((self.path,self.headers.get('Origin')))
            if self.path.startswith('/base/') and self.headers.get('Origin'):
                self.send_error(403);return
            super().do_GET()
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(root)));thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    return server,thread,f'http://127.0.0.1:{server.server_port}'


def check():
    with TemporaryDirectory(dir=ROOT/'local',prefix='hybrid-check-') as temporary,ExitStack() as stack:
        root=Path(temporary);source=root/'sources';source.mkdir();network=[];server,thread,origin=serve(source,network)
        stack.callback(thread.join);stack.callback(server.server_close);stack.callback(server.shutdown)
        base=source/'base';base.mkdir();index=source_fixture(base);index['cdn_base_url']=origin+'/'
        for pack in index['baseline']['packages']:pack['url']=origin+'/base/'+pack['sha256']+'.tar.gz'
        fixture(root,'one',index);first=root/'one';channel=source/'channel';(channel/'releases').mkdir(parents=True)
        shutil.copytree(first,channel/'releases/one')
        def point(version):
            raw=(channel/'releases'/version/'manifest.json').read_bytes();(channel/'channel.json').write_text(json.dumps({'format':'gakumas-content-channel','schema_version':1,'version':version,'manifest':f'releases/{version}/manifest.json','sha256':hashlib.sha256(raw).hexdigest()}))
        point('one')
        next_index=json.loads(json.dumps(index));next_index['version']='two';objects=source/'objects';objects.mkdir()
        original='images/img_general_cidol-test_0-full.webp';added='images/img_incremental.webp'
        for name,color in [(original,'blue'),(added,'green')]:
            out=io.BytesIO();Image.new('RGB',(24,24),color).save(out,format='WEBP');raw=out.getvalue();sha=hashlib.sha256(raw).hexdigest();next_index['files'][name]={'sha256':sha,'bytes':len(raw)};next_index['cdn_objects'].append(sha+'.webp');(objects/(sha+'.webp')).write_bytes(raw)
        fixture(root,'two',next_index);shutil.copytree(root/'two',channel/'releases/two')
        checkout=root/'checkout';checkout.mkdir()
        for name in ['index.html','style.css','startup.js','app.mjs','i18n.mjs','resources.mjs','image-config.mjs','content-config.mjs','LICENSE','THIRD_PARTY.md','package.json']:shutil.copyfile(ROOT/name,checkout/name)
        for name in builder.MODULE_DIRS:shutil.copytree(ROOT/name,checkout/name)
        (checkout/'resources').mkdir();(checkout/'resources/content-source.json').write_text(json.dumps({'channel_url':origin+'/channel/channel.json'}))
        locks=root/'locks';prepare(first,locks);site=root/'site/dist'
        with patch.object(builder,'ROOT',checkout):builder.build(site,locks/'asset-lock.json',locks/'content-lock.json',mirror_images=True)
        assert not any(path.startswith('/objects/') for path,_ in network)
        built=json.loads((site/'release.json').read_text())['files'];before={name:hashlib.sha256((site/name).read_bytes()).hexdigest() for name in built}
        site_requests=[];site_server,site_thread,site_origin=serve(root/'site',site_requests);stack.callback(site_thread.join);stack.callback(site_server.server_close);stack.callback(site_server.shutdown)
        with sync_playwright() as p:
            browser=p.chromium.launch();page=browser.new_page();browser_requests=[]
            page.on('request',lambda request:browser_requests.append((request.url,request.method,request.post_data)))
            page.goto(site_origin+'/dist/',wait_until='networkidle')
            page.evaluate('''async name=>{const {contentManager}=await import('./application/content-manager.mjs');await contentManager.initialize();const {assetURL}=await import('./resources.mjs');const image=document.createElement('img');image.id='probe';image.src=assetURL(name,true);document.body.append(image);localStorage.setItem('synthetic-preserved','yes');}''',Path(original).name)
            page.wait_for_function("()=>document.querySelector('#probe').naturalWidth===256")
            point('two');page.evaluate("async()=>{const {contentManager}=await import('./application/content-manager.mjs');await contentManager.refresh();if(contentManager.status().phase!=='update-ready')throw Error('未发现独立内容更新');}")
            page.reload(wait_until='networkidle')
            page.evaluate('''async names=>{const {contentManager}=await import('./application/content-manager.mjs');await contentManager.initialize();if(contentManager.status().version!=='two')throw Error('未切换资料');const {assetURL}=await import('./resources.mjs');for(const [i,name] of names.entries()){const image=document.createElement('img');image.id='hybrid-image-'+i;image.src=assetURL(name,true);document.body.append(image);}}''',[Path(original).name,Path(added).name])
            page.wait_for_function("()=>[...document.querySelectorAll('[id^=hybrid-image-]')].length===2&&[...document.querySelectorAll('[id^=hybrid-image-]')].every(image=>image.naturalWidth===24)")
            assert page.evaluate("localStorage.getItem('synthetic-preserved')")=='yes'
            assert not any('/base/' in url for url,_,_ in browser_requests)
            assert all(method=='GET' and body is None for _,method,body in browser_requests)
            assert len([path for path,origin_value in network if path.startswith('/objects/') and origin_value])==2
            browser.close()
        assert before=={name:hashlib.sha256((site/name).read_bytes()).hexdigest() for name in built}
    print('同一程序独立更新资料、基础图同源、两张增量图直连 CDN、换图不沿用旧缩略图及本地状态保留通过。')


if __name__=='__main__':check()
