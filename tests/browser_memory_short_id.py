"""真实导入验证无编号的详情入口、完整标识复制及窄屏。"""
import copy
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import ROOT,fixtures


def check(url):
    docs=fixtures();base=docs['capture']['memories'][0]
    key=lambda name:hashlib.sha256(('synthetic-short-'+name).encode()).hexdigest()
    with TemporaryDirectory(dir=ROOT/'local',prefix='memory-short-id-') as temporary,sync_playwright() as p:
        browser=p.chromium.launch();context=browser.new_context(permissions=['clipboard-read','clipboard-write']);page=context.new_page();errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle')
        for index,names in enumerate([['a','b'],['c','a'],['b','a']]):
            data=copy.deepcopy(docs);data['capture']['captured_at']=f'2026-01-0{index+1}T00:00:00Z';data['capture']['memories']=[{**base,'userMemoryId':'synthetic-short-'+name} for name in names];data['capture']['count']=len(names)
            folder=Path(temporary)/str(index)
            for name,document in data.items():
                file=folder/name/'snapshot.json';file.parent.mkdir(parents=True);file.write_text(json.dumps(document))
            page.locator('#account-directory-files').set_input_files(str(folder));expect(page.locator('#inventory')).to_be_visible(timeout=60000)
            for name in names:
                row=page.locator(f'.memory-row[data-memory-key="{key(name)}"]');expect(row.get_by_role('button',name='详情',exact=True)).to_be_visible();assert key(name)[:8] not in row.locator('.memory-card-topline').inner_text()
            expect(page.locator('.memory-detail-open')).to_have_count(2)
        page.locator(f'.memory-row[data-memory-key="{key("a")}"] .memory-detail-open').click();expect(page.locator('#detail-title')).to_have_text('回忆 '+key('a')[:8])
        identifier=page.locator('.memory-identifier');identifier.locator('summary').click();expect(identifier.locator('code')).to_have_text(key('a'))
        identifier.get_by_role('button',name='复制完整标识').click();expect(identifier.get_by_role('status')).to_have_text('唯一标识已复制，可粘贴到搜索框');assert page.evaluate('navigator.clipboard.readText()')==key('a')
        for width in [1280,320]:
            page.set_viewport_size({'width':width,'height':1000});assert page.locator('#detail-content').evaluate('e=>e.scrollWidth<=e.clientWidth')
        page.locator('#close-detail').click();page.reload(wait_until='networkidle');expect(page.locator(f'.memory-row[data-memory-key="{key("a")}"] .memory-detail-open')).to_be_visible(timeout=60000)
        assert not errors and not uploads,(errors,uploads);browser.close()
    print('短码跨重排、移除返回及刷新稳定，真实详情与完整标识复制、窄屏和无上传检查通过。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
