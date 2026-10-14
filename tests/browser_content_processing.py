"""验证真实 Worker 的内容合同校验、解析复用和错误回传。"""
import argparse
import json
from pathlib import Path
import subprocess
from playwright.sync_api import sync_playwright


def check(url):
    root=Path(__file__).resolve().parents[1]
    fixture=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {contentFixture} from './tests/fixtures/content.mjs';console.log(JSON.stringify(await contentFixture()));"],cwd=root,text=True))
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page();workers=[];errors=[]
        page.on('worker',lambda worker:workers.append(worker.url));page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url,wait_until='networkidle')
        result=page.evaluate('''async fixture=>{
            const {createContentProcessor}=await import('./application/content-processing.mjs');
            const processor=createContentProcessor(),manifest=await processor.validateBundle(fixture.bundle,'0.6.5');
            const hash=manifest.files['catalog.json'].sha256,part=await processor.parsePart(fixture.files['catalog.json'],hash);
            const cached=await processor.parsePart('',hash);
            const large={tables:{rows:Array.from({length:1800},(_,id)=>({id,text:'分包原文'.repeat(50),values:[id,null,false]}))},empty:[]};
            const text=JSON.stringify(large);
            const [streamed,parallel]=await Promise.all([processor.parsePart(text,'large-worker-fixture'),processor.parsePart('[0,null,false,{}]','parallel-worker-fixture')]);
            const reused=await processor.parsePart('','large-worker-fixture');
            const streamOK=JSON.stringify(streamed)===text&&JSON.stringify(reused)===text&&JSON.stringify(parallel)==='[0,null,false,{}]';
            const damaged=structuredClone(fixture.bundle);damaged.files['effects.json']+=' ';let error;
            try{await processor.validateBundle(damaged,'0.6.5');}catch(e){error=e.message;}
            return {version:manifest.version,part,cached,error,streamOK};
        }''',fixture)
        assert result['version']==fixture['manifest']['version']
        assert result['part']==json.loads(fixture['files']['catalog.json'])==result['cached']
        assert result['error']=='content_hash_mismatch',result
        assert result['streamOK'],result
        assert any(url.endswith('/application/content-processing-worker.mjs') for url in workers),workers
        assert not errors,errors;browser.close()
    print('真实内容 Worker 完整校验、已解析分包复用及损坏分包拒绝通过。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
