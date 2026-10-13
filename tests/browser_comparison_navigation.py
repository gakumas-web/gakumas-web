"""通过完整应用验证比较基准可见性及导入、收藏、筛选、阵容跳转和刷新恢复。"""
import argparse
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import ROOT,fixtures


def check(url,account=None):
    with TemporaryDirectory(dir=ROOT/'local',prefix='comparison-navigation-') as temporary,sync_playwright() as p:
        folder=Path(temporary)/'account'
        if account:
            folder=Path(account)
        else:
            docs=fixtures();original=docs['capture']['memories'][0];rows=[]
            for i in range(4):
                row=copy.deepcopy(original);row.update(userMemoryId=f'synthetic-compare-{i}',vocal=100+i*20,power=1200+i*100,examBattleProduceCards=[row['produceCard']]);rows.append(row)
            docs['capture'].update(memories=rows,count=4)
            support=json.loads((ROOT/'tests/fixtures/public-data/supports.json').read_text())['cards'][0]['id']
            docs['capture']['supportCards']=[{'supportCardId':support,'level':10,'levelLimitRank':0,'stockQuantity':0,'createdTime':0}]
            docs['selectiondetail']['supportCards']=[{'number':1,'supportCardId':support,'level':20,'levelLimitRank':1,'isRental':False,'produceSkills':[],'eventDetailIds':[]}]
            for name,document in docs.items():
                target=folder/name/'snapshot.json';target.parent.mkdir(parents=True);target.write_text(json.dumps(document))
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:uploads.append(r.url) if r.post_data else None)
        page.goto(url,wait_until='networkidle');page.locator('#account-directory-files').set_input_files(str(folder))
        expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        page.locator('[data-tab="memories"]').click()
        row=page.locator('.memory-card:has(.pick)').first;key=row.get_attribute('data-memory-key');favorite=row.locator('.favorite-button');favorite.click();expect(favorite).to_have_attribute('aria-pressed','true')
        if page.locator('#filter-toggle').get_attribute('aria-expanded')=='false':page.locator('#filter-toggle').click()
        before=page.locator('#count-memories').inner_text()
        page.locator('#inheritance-skill-open').click();page.locator('#selection-picker-list input:not(:disabled)').first.check();page.locator('#selection-picker-confirm').click()
        page.locator('#reset-filters').click();expect(page.locator('#count-memories')).to_have_text(before)
        page.locator('#filter-undo').click();expect(page.locator('#inheritance-skill-list .selection-filter-choice')).to_have_count(1)
        page.locator('#reset-filters').click()
        for i in range(4):page.locator('.memory-card .pick input').nth(i).check()
        page.locator('#compare').click();expect(page.locator('#compare-dialog')).to_be_visible()
        original=page.locator('.comparison-table thead .comparison-memory-column').all_text_contents()
        for width in [390,360,320,1440]:
            page.set_viewport_size({'width':width,'height':900})
            for base in ['1','2','3','0']:
                page.locator('#comparison').evaluate('e=>{e.scrollLeft=0;e.scrollTop=100}')
                page.locator('#compare-base').select_option(base)
                if width<600:
                    expect(page.locator('.comparison-table')).not_to_be_visible()
                    pairs=page.locator('.comparison-summary-pair');expect(pairs).to_have_count(3)
                    assert [pair.get_attribute('data-target-index') for pair in pairs.all()]==[str(i) for i in range(4) if str(i)!=base]
                    bounds=page.locator('#comparison').evaluate('''e=>{const box=e.getBoundingClientRect();return {min:box.left+e.clientLeft,max:box.left+e.clientLeft+e.clientWidth,top:e.scrollTop,headers:[...e.querySelectorAll('.comparison-summary-table thead th:not(:first-child)')].map(cell=>({left:cell.getBoundingClientRect().left,right:cell.getBoundingClientRect().right}))}}''')
                    assert bounds['top']==0 and all(cell['left']>=bounds['min']-2 and cell['right']<=bounds['max']+2 for cell in bounds['headers']),(width,base,bounds)
                    if not account:
                        for pair in pairs.all():
                            target=int(pair.get_attribute('data-target-index'));row=pair.locator('[data-compare-field="vocal"]')
                            expect(row.locator('td .comparison-stat-value')).to_have_text([str(100+int(base)*20),str(100+target*20)])
                            difference=(target-int(base))*20;expect(row.locator('.comparison-delta')).to_have_text(f'{difference:+d}')
                            expect(row.locator('.comparison-delta')).to_have_attribute('data-direction','up' if difference>0 else 'down')
                    # 卡组横移只作用于配置区，属性摘要仍保持完整同屏。
                    page.locator('.comparison-config-scroll').evaluate('e=>e.scrollLeft=e.scrollWidth')
                    assert page.locator('.comparison-mobile-summary').evaluate('e=>e.getBoundingClientRect().right<=innerWidth')
                else:
                    expect(page.locator('.comparison-mobile-summary')).not_to_be_visible()
                    bounds=page.locator('#comparison').evaluate('''e=>{const box=e.getBoundingClientRect(),base=e.querySelector('.comparison-table thead .comparison-base-column').getBoundingClientRect(),label=e.querySelector('.comparison-table thead th').getBoundingClientRect();return {left:base.left,right:base.right,min:box.left+e.clientLeft+label.width,max:box.left+e.clientLeft+e.clientWidth,top:e.scrollTop}}''')
                    assert bounds['left']>=bounds['min']-2 and bounds['right']<=bounds['max']+2 and bounds['top']==0,(width,base,bounds)
                current=page.locator('.comparison-table thead .comparison-memory-column').all_text_contents()
                assert [text.replace('基准','') for text in current]==[text.replace('基准','') for text in original]
                page.locator('#differences-only').check()
                if width<600 and not account:
                    expect(page.locator('.comparison-summary-pair [data-compare-field="vocal"]')).to_have_count(3)
                    expect(page.locator('.comparison-summary-pair [data-compare-field="grade"]')).to_have_count(0)
                page.locator('#differences-only').uncheck()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        # 比较结束后回到原应用，再走实际阵容链接及浏览器持久化恢复。
        page.locator('#close-compare').click();page.locator('[data-tab="selectionMemories"]').click();page.locator('.selection-details-button').first.click();page.locator('.selection-detail-support-card').first.click()
        expect(page.locator('#section-title')).to_have_text('支援卡');page.locator('[data-tab="memories"]').click();expect(page.locator('#section-title')).to_have_text('回忆')
        page.reload(wait_until='networkidle');expect(page.locator('#count-memories')).to_have_text(before,timeout=30000)
        expect(page.locator(f'[data-memory-key="{key}"] .favorite-button')).to_have_attribute('aria-pressed','true')
        assert not errors,errors;assert not uploads,uploads;browser.close()
    print('完整应用流程及 320/360/390px 基准/候选摘要、差值与差异筛选和 1440px 比较基准可见性通过；收藏刷新后保留，无异常或数据上传。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8080/');parser.add_argument('--account',type=Path)
    args=parser.parse_args();check(args.url,args.account)
