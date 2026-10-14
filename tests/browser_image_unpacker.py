"""通过真实模块 Worker 验证图片解包结果和损坏包拒绝，不依赖图片构建工具。"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright


def check(url):
    fixture=json.loads((Path(__file__).parent/'contracts/image-delivery-v1.json').read_text())
    pack=fixture['versions']['one']['baseline']['packages'][0]
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page();workers=[];errors=[]
        page.on('worker',lambda worker:workers.append(worker.url))
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url,wait_until='networkidle')
        result=page.evaluate('''async ({pack,encoded})=>{
            const {unpackImageBaseAsync}=await import('./application/image-unpacker.mjs');
            const {contentHash}=await import('./domain/content-contract.mjs');
            const bytes=()=>Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),progress=[];
            const entries=await unpackImageBaseAsync(bytes(),pack,value=>progress.push(value));
            const objects={};for(const [key,blob] of entries)objects[key]={bytes:blob.size,sha256:await contentHash(await blob.arrayBuffer())};
            const damaged=bytes();damaged[0]^=1;let error;
            try{await unpackImageBaseAsync(damaged,pack);}catch(e){error=e.message;}
            return {objects,progress,error};
        }''',{'pack':pack,'encoded':fixture['packages'][pack['url']]})
        assert result['objects']==pack['objects'],result
        assert result['progress'][-1]==len(pack['objects']),result
        assert result['error']=='image_hash_mismatch',result
        assert sum(url.endswith('/application/image-unpacker-worker.mjs') for url in workers)>=2,workers
        assert not errors,errors
        browser.close()
    print('真实 Worker 解包、逐对象哈希、进度回传及损坏包拒绝通过。',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
