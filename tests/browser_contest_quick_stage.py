"""实际自选编组验证同计划跳转、草稿隔离、活动排除和模拟运行。"""
from browser_artifacts import artifact_path
import argparse
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import ROOT,fixtures
from browser_simulation_helpers import select_season


def check(url):
    request=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['customized']
    with TemporaryDirectory(dir=ROOT/'local',prefix='quick-stage-') as temporary,sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1100});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda value:uploads.append(value.url) if value.post_data else None);page.goto(url,wait_until='networkidle')
        def choose_season(season_id):
            page.locator('#season-select').scroll_into_view_if_needed();page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');select_season(page,season_id)
        identity=page.evaluate('''async id=>{const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');const {idolInfo}=await import('./domain/catalog.mjs');return idolInfo({idolCardId:id})}''',request['cards'][0]['record']['definition']['originIdolCardId'])
        docs=fixtures();base=docs['capture']['memories'][0];memories=[]
        for index in range(2):
            memory=copy.deepcopy(base);memory.update(userMemoryId=f'synthetic-quick-stage-{index}',idolCardId=request['cards'][0]['record']['definition']['originIdolCardId'],characterId=identity['characterId'],planType=2,**request['params'],produceCard=request['cards'][0]['reference'],examBattleProduceCards=[entry['reference'] for entry in request['cards']],examBattleProduceItemIds=[entry['id'] for entry in request['items']]);memories.append(memory)
        docs['capture'].update(memories=memories,count=2);docs['capture']['idolCards'][0]['idolCardId']=memories[0]['idolCardId']
        for name,document in docs.items():
            path=Path(temporary)/'account'/name/'snapshot.json';path.parent.mkdir(parents=True);path.write_text(json.dumps(document))
        page.locator('#account-directory-files').set_input_files(str(Path(temporary)/'account'));expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab="seasonSimulation"]').click();choose_season('contest:pvp_rate_config-53');page.locator('.season-stage-tab').first.click();page.get_by_role('tab',name='自选编组模拟',exact=True).click()
        jump=page.get_by_role('button',name='同计划其他舞台',exact=True);expect(jump.locator('span').first).to_have_text('---');expect(jump).to_be_disabled()
        for index in range(2):
            page.locator('.season-memory-slot-pick').nth(index).click();page.locator('.contest-memory-choose:enabled').first.click()
            if index==0:expect(jump).to_be_disabled()
        expect(jump).to_be_enabled()
        def choose_quick_stage(stage_id):
            jump.scroll_into_view_if_needed();page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');jump.click();popup=page.locator('.season-quick-stage-popup:popover-open');expect(popup).to_be_visible();popup.locator(f'[data-stage-id="{stage_id}"]').click()
        jump.focus();jump.press('ArrowDown');popup=page.locator('.season-quick-stage-popup:popover-open');expect(popup).to_be_visible();expect(popup.get_by_role('option').first).to_be_focused();page.keyboard.press('End');expect(popup.get_by_role('option').last).to_be_focused();page.keyboard.press('Escape');expect(jump).to_be_focused();expect(jump).to_have_attribute('aria-expanded','false')
        assert page.evaluate('''async()=>{const {contestCatalog}=await import('./domain/catalog.mjs');const catalog=contestCatalog().choices;return [...document.querySelectorAll('.season-quick-stage-option')].every(option=>{const stage=catalog.find(s=>s.id===option.dataset.stageId);return option.querySelector('.contest-turn-counts').textContent.includes(stage.turn+' 回合')&&['vocal','dance','visual'].every(type=>Math.abs(Number(option.querySelector('.contest-criteria-bar [data-attribute='+type+']').style.flexGrow)-stage.criteria[type])<.000001)&&option.querySelectorAll('.contest-criteria-labels>span').length===3;})}''')
        source_stage=page.locator('.season-stage-tab[aria-selected=true]').get_attribute('data-stage-id')
        options=page.evaluate('''async()=>{const {contestCatalog}=await import('./domain/catalog.mjs');const selected=document.querySelector('.season-stage-tab[aria-selected=true]').dataset.stageId,all=contestCatalog().choices,current=all.find(s=>s.id===selected),options=[...document.querySelectorAll('.season-quick-stage-option')].map(o=>all.find(s=>s.id===o.dataset.stageId));return {same:options.every(s=>s.kind==='contest'&&s.id!==selected&&s.planType===current.planType),target:options.find(s=>s.kind==='contest'&&s.seasonNumber===52)?.id,event:options.find(s=>s.kind==='event')?.id}}''')
        assert options['same'] and options['target'] and not options.get('event'),options
        page.locator('[data-customize-memory="0"]').click();page.locator('[data-memory-index="0"] [data-edit-card="2"]').click();page.locator('#contest-loadout-owned').uncheck()
        current_id=memories[0]['examBattleProduceCards'][2]['id'];page.locator(f'.contest-loadout-choice[data-source=common]:not([data-choice-id="{current_id}"])>input').first.check();page.locator('.contest-loadout-footer .primary').click()
        def board():return page.locator('.season-memory-board').evaluate_all("nodes=>nodes.map(n=>({key:n.dataset.memoryKey,cards:[...n.querySelectorAll('[data-config-id]')].map(c=>[c.dataset.configId,c.textContent])}))")
        original=board();choose_quick_stage(options['target']);expect(page.locator('.season-stage-tab[aria-selected=true]')).to_have_attribute('data-stage-id',options['target']);expect(page.get_by_role('tab',name='自选编组模拟',exact=True)).to_have_attribute('aria-selected','true');expect(jump.locator('span').first).to_have_text('---');assert board()==original
        page.locator('#contest-simulation-runs').fill('10000');page.locator('.season-simulate').click();expect(jump).to_be_disabled();page.locator('.contest-simulation-controls').get_by_role('button',name='停止',exact=True).click();expect(jump).to_be_enabled()
        page.locator('#contest-simulation-runs').fill('100');page.locator('.season-simulate').click();expect(page.locator('.simulation-save-status')).to_have_text('已保存到此舞台的模拟历史。',timeout=120000)
        expect(page.locator('.season-simulate')).to_be_enabled();saved_stage=page.evaluate('''async()=>{const {simulationHistory}=await import('./application/contest-simulation-history.mjs');return (await simulationHistory(document.querySelector('#profile').value))[0].stage.id}''');assert saved_stage==options['target']
        for width in [1280,375,320]:
            page.set_viewport_size({'width':width,'height':1000});controls=page.locator('.contest-simulation-controls');controls.scroll_into_view_if_needed();assert controls.evaluate('e=>e.scrollWidth<=e.clientWidth')
            button=page.locator('.season-simulate').bounding_box();dropdown=jump.bounding_box();assert dropdown['x']>=button['x']+button['width'],(width,button,dropdown)
            controls.screenshot(path=artifact_path(str(ROOT/f'local/season-simulation/quick-stage-{width}.png')))
            jump.click();popup=page.locator('.season-quick-stage-popup:popover-open');expect(popup).to_be_visible();bounds=popup.bounding_box();assert bounds['x']>=0 and bounds['x']+bounds['width']<=width;assert popup.evaluate('e=>e.scrollWidth<=e.clientWidth');popup.screenshot(path=artifact_path(str(ROOT/f'local/season-simulation/quick-stage-options-{width}.png')));page.keyboard.press('Escape')

        page.set_viewport_size({'width':1280,'height':1100});choose_season('contest:pvp_rate_config-53');page.locator('.season-stage-tab').first.click();assert board()==original
        page.locator('.season-memory-row').nth(1).locator('.season-slot-actions button').click();expect(jump).to_be_disabled();choose_season('contest:pvp_rate_config-52');page.locator(f'.season-stage-tab[data-stage-id="{options["target"]}"]').click();assert board()==original
        choose_season('event:1:1');page.locator('.season-stage-tab').first.click();page.get_by_role('tab',name='自选编组模拟',exact=True).click();expect(jump).to_have_count(0)
        for index in range(2):
            page.locator('.season-memory-slot-pick').nth(index).click();page.locator('.contest-memory-choose:enabled').first.click()
        expect(jump).to_have_count(0)
        choose_season('contest:pvp_rate_config-52');page.locator(f'.season-stage-tab[data-stage-id="{options["target"]}"]').click();expect(jump).to_be_enabled()
        assert board()==original;assert not errors and not uploads,(errors,uploads);browser.close()
    print('同计划快捷跳转、主副与自定义卡保留、原草稿隔离、模拟期间禁用、目标舞台真实模拟、排除活动舞台及窄屏布局通过。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
