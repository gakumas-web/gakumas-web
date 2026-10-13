"""实际启动便携服务，核对本机监听、模块类型、分段读取及端口占用反馈。"""
import argparse
import json
import queue
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path


def request(url,method='GET',headers=None):
    try:
        with urllib.request.urlopen(urllib.request.Request(url,method=method,headers=headers or {}),timeout=10) as response:
            return response.status,dict(response.headers),response.read()
    except urllib.error.HTTPError as error:
        return error.code,dict(error.headers),error.read()


def smoke(launcher,site=None):
    command=[str(Path(launcher).resolve()),'--port','0','--no-browser']
    if site:command+=['--directory',str(Path(site).resolve())]
    with tempfile.TemporaryDirectory(prefix='portable-cwd-') as cwd:
        process=subprocess.Popen(command,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8')
        lines=queue.Queue();thread=threading.Thread(target=lambda:[lines.put(line) for line in process.stdout],daemon=True);thread.start()
        try:
            deadline=time.monotonic()+30;url=None
            while time.monotonic()<deadline:
                try:line=lines.get(timeout=.2)
                except queue.Empty:
                    if process.poll() is not None:raise AssertionError('便携服务未能启动')
                    continue
                if line.startswith('READY '):url=line[6:].strip();break
            assert url and url.startswith('http://127.0.0.1:'),'未获得本机服务地址'
            status,_,body=request(url+'__portable__/health');assert status==200 and json.loads(body)['application']=='gakumas-web-portable'
            status,_,body=request(url);assert status==200 and b'<!doctype html>' in body.lower()
            status,headers,body=request(url+'app.mjs');assert status==200 and headers['Content-Type'].startswith('text/javascript')
            assert request(url+'app.mjs',headers={'Range':'bytes=0-15'})[0]==206
            assert request(url,'POST')[0]==405
            assert request(url,headers={'Host':'untrusted.example'})[0]==403
            assert request(url+'application/')[0]==404
            assert request(url+'../README.txt')[0]==404
            assert request(url+'app.mjs','HEAD')[2]==b''
            port=url.split(':')[-1].strip('/')
            occupied=[str(Path(launcher).resolve()),'--port',port,'--no-browser']
            if site:occupied+=['--directory',str(Path(site).resolve())]
            conflict=subprocess.run(occupied,cwd=cwd,capture_output=True,timeout=10)
            assert conflict.returncode!=0,'端口占用未阻止第二个服务'
            print('便携服务验证通过：实际启动、exe 相邻目录／显式目录、本机地址、模块 MIME、分段请求、拒绝写入及端口占用。')
        finally:
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()
            thread.join(timeout=5)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--launcher',type=Path);parser.add_argument('--site',type=Path);parser.add_argument('--package',type=Path);args=parser.parse_args()
    if args.package:
        with tempfile.TemporaryDirectory(prefix='portable-unpack-') as directory:
            with zipfile.ZipFile(args.package) as archive:archive.extractall(directory)
            launchers=list(Path(directory).glob('*/gakumas-web.exe'));assert len(launchers)==1
            smoke(launchers[0])
    elif args.launcher:smoke(args.launcher,args.site)
    else:parser.error('需要 --launcher 或 --package')
