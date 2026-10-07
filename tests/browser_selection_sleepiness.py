"""检查培养阵容中移除眠气能力的缩略图，在首次加载和缓存命中时均可见。"""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect
from browser_static import ROOT, fixtures


def check(url):
    with TemporaryDirectory(dir=ROOT/'local', prefix='selection-sleepiness-') as temporary, sync_playwright() as driver:
        browser = driver.chromium.launch(); page = browser.new_page(); errors = []; uploads = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: uploads.append(request.url) if request.post_data else None)
        page.goto(url, wait_until='networkidle')
        ability = page.evaluate('''async ()=>{
            const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster();
            const {abilitySummaries}=await import('./domain/catalog.mjs');
            const {takeMaster}=await import('./application/master-prefetch.mjs');
            const input=await takeMaster('abilities');
            for(const row of input.tables.MemoryAbility){
                const ref={id:row.id,level:row.level};
                const parts=abilitySummaries({abilities:[ref]})[0]?.description.technical?.skill?.descriptions??[];
                const sleepy=parts.find(p=>p.targetId==='p_card-00-acc-0_002');
                if(sleepy&&parts.some(p=>p.targetId==='Label_ProduceCardPositionType_Lost'&&p.originProduceExamEffectId===sleepy.originProduceExamEffectId))return ref;
            }
            throw Error('公开资料缺少移除眠气能力');
        }''')
        documents = fixtures(); memory = documents['capture']['memories'][0]
        memory['abilities'] = [ability]
        documents['selectiondetail']['memories'] = [{'number': 1, 'isRental': False,
            'userMemoryId': memory['userMemoryId'], 'memory': memory, 'memoryAbilities': []}]
        folder = Path(temporary)/'account'
        for name, document in documents.items():
            target = folder/name/'snapshot.json'; target.parent.mkdir(parents=True)
            target.write_text(json.dumps(document))
        page.locator('#account-directory-files').set_input_files(str(folder))
        expect(page.locator('#inventory')).to_be_visible(timeout=30000)
        page.locator('[data-tab="selectionMemories"]').click()
        for cached in [False, True]:
            page.locator('.selection-details-button').first.click()
            icon = page.locator('.selection-details-dialog .ability-remove-card-icon .reward-art > img')
            expect(icon).to_have_count(1)
            page.wait_for_function("""()=>{const i=document.querySelector('.selection-details-dialog .ability-remove-card-icon .reward-art > img');return i&&i.complete&&i.naturalWidth>1&&!i.hidden&&!i.src.includes('#resource=')}""", timeout=15000)
            expect(icon).to_be_visible()
            expect(page.locator('.selection-details-dialog .ability-remove-card-icon .art-fallback')).to_be_hidden()
            page.locator('.selection-details-dialog .dialog-head > button').click()
        assert not errors, errors
        assert not uploads, uploads
        browser.close()
    print('培养阵容眠气图标首次显示与缓存后重开均通过；占位符已隐藏，无脚本异常或数据上传。')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--url', default='http://127.0.0.1:8080/')
    check(parser.parse_args().url)
