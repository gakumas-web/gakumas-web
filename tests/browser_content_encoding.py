"""通过真实 HTTP 验证预压缩资料跨域读取、自动解压及生产内容管理器的哈希校验。"""
import argparse
from contextlib import ExitStack
from fnmatch import fnmatchcase
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]


def check(directory):
    config=json.loads((directory/'edgeone.json').read_text());requests=[]
    class DataHandler(SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
        def end_headers(self):
            for rule in config['headers']:
                if fnmatchcase(self.path,rule['source']):
                    for row in rule['headers']:self.send_header(row['key'],row['value'])
            super().end_headers()
        def do_GET(self):
            requests.append((self.path,self.headers.get('Origin')));super().do_GET()
    class WebHandler(SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path=="/probe.html":
                self.send_response(200);self.send_header("Content-Type","text/html");self.end_headers();self.wfile.write(b"<!doctype html><title>Content check</title>");return
            super().do_GET()
    with ExitStack() as stack:
        origins=[]
        for handler,folder in [(DataHandler,directory),(WebHandler,ROOT)]:
            server=ThreadingHTTPServer(('127.0.0.1',0),partial(handler,directory=str(folder)))
            thread=Thread(target=server.serve_forever,daemon=True);thread.start()
            stack.callback(thread.join);stack.callback(server.server_close);stack.callback(server.shutdown)
            origins.append(f'http://127.0.0.1:{server.server_port}')
        with sync_playwright() as driver:
            browser=driver.chromium.launch();page=browser.new_page()
            # 使用无脚本的测试页面作为来源，导入实际生产模块。
            page.goto(origins[1]+'/probe.html')
            result=page.evaluate('''async channelURL=>{
              const {createContentManager}=await import('/application/content-manager.mjs');
              const manager=createContentManager({channelURL});await manager.initialize();
              for(const scope of ['catalog','effects','abilities','progression','achievements'])await manager.take(scope);
              return manager.status();
            }''',origins[0]+'/channel.json')
            browser.close()
        assert result['phase']=='ready' and result['cached'] and not result['error'],result
        assert len(requests)==8 and all(origin==origins[1] for _,origin in requests),requests
    print(json.dumps({'version':result['version'],'decoded_bytes':result['bytes'],'cross_origin_requests':len(requests),'hashes_verified':True},ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--directory',type=Path,required=True)
    check(parser.parse_args().directory.resolve())
