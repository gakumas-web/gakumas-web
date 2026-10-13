"""验证独立模拟页签的快捷带入、状态保留、账号隔离和单层选择器。"""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import fixtures,ROOT


def check(url):
    with TemporaryDirectory(dir=ROOT/'local',prefix='season-workspace-') as temp,sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle');expect(page.locator('[data-tab="seasonSimulation"]')).to_be_disabled();page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        source=page.locator('.memory-card').filter(has=page.locator('.memory-simulation-action')).first;key=source.get_attribute('data-memory-key');source.locator('.memory-simulation-action').click()
        expect(page.locator('[data-tab="seasonSimulation"]')).to_have_attribute('aria-pressed','true');expect(page.locator('#inventory')).not_to_be_visible();expect(page.locator('[data-memory-index="0"] .season-memory-board')).to_have_attribute('data-memory-key',key,timeout=60000);assert page.locator('dialog:modal').count()==0
        expect(page.locator('.season-rules-section')).to_be_visible();assert page.locator('.season-rules-section > summary').count()==0;expect(page.locator('#contest-simulation-runs')).to_have_value('500')
        page.locator('[data-customize-memory="0"]').click();page.locator('[data-memory-index="0"] [data-edit-card="2"]').click();assert page.locator('dialog:modal').count()==1;page.locator('#contest-loadout-owned').uncheck();page.locator('#contest-loadout-enhanced').check()
        candidate=page.evaluate('''async()=>{const {cardCustomizations}=await import('./domain/catalog.mjs');return [...document.querySelectorAll('.contest-loadout-choice[data-source="common"]')].map(e=>({id:e.dataset.choiceId,data:cardCustomizations({id:e.dataset.choiceId,upgradeCount:1,customizes:[]})})).find(row=>row.data?.options.length>0);}''');assert candidate
        page.locator(f'.contest-loadout-choice[data-choice-id="{candidate["id"]}"] > input').check();page.locator('.contest-inline-customizer [data-step="1"]:enabled').first.click();page.locator('.contest-loadout-footer .primary').click();assert page.locator('dialog:modal').count()==0
        board=page.locator('[data-memory-index="0"]');state=board.locator('[data-config-id]').evaluate_all('(nodes)=>nodes.map(e=>[e.dataset.configId,e.textContent])')
        page.locator('#contest-simulation-runs').fill('300');stage=page.locator('.season-stage-tab[aria-selected="true"]').get_attribute('data-stage-id')
        for tab in ['memories','supportCards','selectionMemories']:
            page.locator(f'[data-tab="{tab}"]').click();expect(page.locator('#season-simulation-view')).not_to_be_visible();page.locator('[data-tab="seasonSimulation"]').click();expect(page.locator('#season-simulation-view')).to_be_visible();assert page.locator('.season-stage-tab[aria-selected="true"]').get_attribute('data-stage-id')==stage;assert board.locator('[data-config-id]').evaluate_all('(nodes)=>nodes.map(e=>[e.dataset.configId,e.textContent])')==state;expect(page.locator('#contest-simulation-runs')).to_have_value('300')
        page.locator('#language').select_option('ja');expect(page.locator('#season-simulation-page')).to_have_attribute('aria-label','シーズンシミュレーション');expect(board.locator('.season-memory-board')).to_have_attribute('data-memory-key',key);expect(board.locator(f'[data-config-id="{candidate["id"]}"] .selection-custom-count').last).to_have_text('1');expect(page.locator('#contest-simulation-runs')).to_have_value('300');page.locator('#language').select_option('zh-CN');expect(page.locator('#season-simulation-page')).to_have_attribute('aria-label','赛季模拟')
        for width in [1280,375,320]:
            page.set_viewport_size({'width':width,'height':1000});page.locator('#season-select').scroll_into_view_if_needed();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(ROOT/f'local/ui-visual-refinement/season-workspace-{width}.png'),full_page=True)
        # 新账号的模拟区从空编组开始，不能复用上一账号的卡片或结果。
        documents=fixtures();folder=Path(temp)/'account'
        for name,document in documents.items():
            target=folder/name/'snapshot.json';target.parent.mkdir(parents=True);target.write_text(json.dumps(document))
        page.locator('#account-directory-files').set_input_files(str(folder));expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab="seasonSimulation"]').click();expect(page.locator('#season-simulation-page')).to_be_visible();expect(page.locator('.season-simulate')).to_be_disabled();expect(page.locator('.season-memory-board')).to_have_count(0);expect(page.locator('.contest-simulation-output [data-score]')).to_have_count(0)
        assert not errors,errors;assert not uploads,uploads;browser.close()
    print('独立页签、快捷带入、单层弹窗、跨页签草稿保留、语言切换、账号隔离和桌面/窄屏验证通过。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
