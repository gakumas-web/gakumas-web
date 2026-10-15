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
        page.add_init_script("window.activeSimulationWorkers=0;const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.simulation=String(args[0]).endsWith('/contest-simulation-worker.mjs');if(this.simulation)window.activeSimulationWorkers++;}terminate(){if(this.simulation&&!this.ended){this.ended=true;window.activeSimulationWorkers--;}super.terminate();}};");page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda value:uploads.append(value.url) if value.post_data else None);page.goto(url,wait_until='networkidle')
        def choose_season(season_id):
            page.locator('#season-select').scroll_into_view_if_needed();page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');select_season(page,season_id)
        identity=page.evaluate('''async id=>{const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');const {idolInfo}=await import('./domain/catalog.mjs');return idolInfo({idolCardId:id})}''',request['cards'][0]['record']['definition']['originIdolCardId'])
        docs=fixtures();base=docs['capture']['memories'][0];memories=[]
        for index in range(2):
            memory=copy.deepcopy(base);memory.update(userMemoryId=f'synthetic-quick-stage-{index}',idolCardId=request['cards'][0]['record']['definition']['originIdolCardId'],characterId=identity['characterId'],planType=2,**request['params'],produceCard=request['cards'][0]['reference'],examBattleProduceCards=[entry['reference'] for entry in request['cards']],examBattleProduceItemIds=[entry['id'] for entry in request['items']]);memories.append(memory)
        docs['capture'].update(memories=memories,count=2);docs['capture']['idolCards'][0]['idolCardId']=memories[0]['idolCardId']
        for name,document in docs.items():
            path=Path(temporary)/'account'/name/'snapshot.json';path.parent.mkdir(parents=True);path.write_text(json.dumps(document))
        page.locator('#account-directory-files').set_input_files(str(Path(temporary)/'account'));expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab="seasonSimulation"]').click();choose_season('contest:pvp_rate_config-53');page.locator('.season-stage-tab').first.click();page.locator('.simulation-mode-tabs [data-mode=selected]').click()
        jump=page.get_by_role('button',name='同计划其他舞台',exact=True);expect(jump.locator('span').first).to_have_text('---');expect(jump).to_be_disabled()
        for index in range(2):
            page.locator('.season-memory-slot-pick:visible').nth(index).click();page.locator('.contest-memory-choose:enabled').first.click()
            if index==0:expect(jump).to_be_disabled()
        expect(jump).to_be_enabled()
        def choose_quick_stage(stage_id):
            jump.scroll_into_view_if_needed();page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');jump.click();popup=page.locator('.season-quick-stage-popup:popover-open');expect(popup).to_be_visible();popup.locator(f'[data-stage-id="{stage_id}"]').click()
        jump.focus();jump.press('ArrowDown');popup=page.locator('.season-quick-stage-popup:popover-open');expect(popup).to_be_visible();expect(popup.get_by_role('option').first).to_be_focused();page.keyboard.press('End');expect(popup.get_by_role('option').last).to_be_focused();page.keyboard.press('Home');expect(popup.get_by_role('option').first).to_be_focused();page.keyboard.press('Escape');expect(jump).to_be_focused();expect(jump).to_have_attribute('aria-expanded','false')
        # 两个入口共用定位和键盘控制，保留各自选中项与窗口变化后的关闭行为。
        season_trigger=page.locator('#season-select');season_trigger.scroll_into_view_if_needed();page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');season_trigger.focus();season_trigger.press('ArrowDown');season_popup=page.locator('#season-picker-popup:popover-open')
        expect(season_popup.locator('[aria-selected=true]')).to_be_focused();page.keyboard.press('End');expect(season_popup.get_by_role('option').last).to_be_focused();page.keyboard.press('Home');expect(season_popup.get_by_role('option').first).to_be_focused();page.keyboard.press('Escape');expect(season_trigger).to_be_focused()
        for trigger,popup_selector in [(season_trigger,'#season-picker-popup'),(jump,'.season-quick-stage-popup')]:
            trigger.scroll_into_view_if_needed();page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
            trigger.click();expect(page.locator(popup_selector+':popover-open')).to_be_visible();page.set_viewport_size({'width':1279,'height':1100});expect(trigger).to_have_attribute('aria-expanded','false');expect(page.locator(popup_selector+':popover-open')).to_have_count(0);page.set_viewport_size({'width':1280,'height':1100})
        assert page.evaluate('''async()=>{const {contestCatalog}=await import('./domain/catalog.mjs');const catalog=contestCatalog().choices;return [...document.querySelectorAll('.season-quick-stage-option')].every(option=>{const stage=catalog.find(s=>s.id===option.dataset.stageId);return option.querySelector('.contest-turn-counts').textContent.includes(stage.turn+' 回合')&&['vocal','dance','visual'].every(type=>Math.abs(Number(option.querySelector('.contest-criteria-bar [data-attribute='+type+']').style.flexGrow)-stage.criteria[type])<.000001)&&option.querySelectorAll('.contest-criteria-labels>span').length===3;})}''')
        source_stage=page.locator('.season-stage-tab[aria-selected=true]').get_attribute('data-stage-id')
        options=page.evaluate('''async()=>{const {contestCatalog}=await import('./domain/catalog.mjs');const selected=document.querySelector('.season-stage-tab[aria-selected=true]').dataset.stageId,all=contestCatalog().choices,current=all.find(s=>s.id===selected),options=[...document.querySelectorAll('.season-quick-stage-option')].map(o=>all.find(s=>s.id===o.dataset.stageId));return {same:options.every(s=>s.kind==='contest'&&s.id!==selected&&s.planType===current.planType),target:options.find(s=>s.kind==='contest'&&s.seasonNumber===52)?.id,event:options.find(s=>s.kind==='event')?.id}}''')
        assert options['same'] and options['target'] and not options.get('event'),options
        page.locator('[data-customize-memory="0"]').click();page.locator('[data-memory-index="0"] [data-edit-card="2"]').click();page.locator('#contest-loadout-owned').uncheck()
        current_id=memories[0]['examBattleProduceCards'][2]['id'];page.locator(f'.contest-loadout-choice[data-source=common]:not([data-choice-id="{current_id}"]) [role="radio"]').first.click();page.locator('.contest-loadout-footer .primary').click()
        def board():return page.locator('.season-memory-board').evaluate_all("nodes=>nodes.map(n=>({key:n.dataset.memoryKey,cards:[...n.querySelectorAll('[data-config-id]')].map(c=>[c.dataset.configId,c.textContent])}))")
        original=board();choose_quick_stage(options['target']);expect(page.locator('.season-stage-tab[aria-selected=true]')).to_have_attribute('data-stage-id',options['target']);expect(page.locator('.simulation-mode-tabs [data-mode=selected]')).to_have_attribute('aria-selected','true');expect(jump.locator('span').first).to_have_text('---');expect(jump).to_be_focused();assert board()==original
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
        choose_season('event:1:1');page.locator('.season-stage-tab').first.click();page.locator('.simulation-mode-tabs [data-mode=selected]').click();expect(jump).to_have_count(0)
        for index in range(2):
            page.locator('.season-memory-slot-pick:visible').nth(index).click();page.locator('.contest-memory-choose:enabled').first.click()
        expect(jump).to_have_count(0)
        choose_season('contest:pvp_rate_config-52');page.locator(f'.season-stage-tab[data-stage-id="{options["target"]}"]').click();expect(jump).to_be_enabled()
        assert board()==original
        # 在真实浏览器中确认销毁同时解除触发器与全局监听，避免旧控制器干扰后续弹出层。
        lifecycle=page.evaluate('''async()=>{
            const {createListboxPopover}=await import('./ui/listbox-popover.mjs'),{el}=await import('./ui/dom.mjs');
            const host=el('div'),trigger=el('button','测试入口'),popup=el('div'),list=el('div'),option=el('button','测试选项');list.id='listbox-disposal-check';option.setAttribute('role','option');list.append(option);popup.append(list);host.append(trigger,popup);document.body.append(host);
            const control=createListboxPopover({button:trigger,popup,list,width:300,maxHeight:300});trigger.click();const opened=popup.matches(':popover-open');control.dispose();const closed=!popup.matches(':popover-open');trigger.click();const detached=!popup.matches(':popover-open');
            popup.showPopover();window.dispatchEvent(new Event('resize'));document.dispatchEvent(new Event('scroll'));const listenersRemoved=popup.matches(':popover-open');popup.hidePopover();host.remove();return {opened,closed,detached,listenersRemoved};
        }''')
        assert all(lifecycle.values()),lifecycle
        # 正式工作区必须把账号生命周期传给手动保存入口。
        page.locator('.season-loadout-save').click();page.locator('#loadout-library-name').fill('synthetic-lifecycle-loadout');page.locator('.loadout-library-name-form').get_by_role('button',name='保存',exact=True).click();expect(page.locator('.loadout-library-status')).to_have_text('编组已保存。');page.locator('#contest-loadout-library .dialog-head button').click()
        # 清理开始前必须终止真实 Worker；事务失败后恢复草稿，成功后不留模拟记录。
        profile=page.locator('#profile').input_value();before_cleanup=board()
        for fail in [True,False]:
            page.locator('#contest-simulation-runs').fill('10000');page.locator('.season-simulate').click();page.wait_for_function('activeSimulationWorkers>0')
            page.locator('#data-open').click();page.locator('#clear-account').click();expect(page.locator('#account-cleanup-confirmed')).to_be_enabled();page.locator('#account-cleanup-confirmed').check()
            page.evaluate("""fail=>{window.cleanupTransaction=IDBDatabase.prototype.transaction;window.cleanupWorkerCount=null;IDBDatabase.prototype.transaction=function(stores,mode,...args){const tx=window.cleanupTransaction.call(this,stores,mode,...args);if(mode==='readwrite'&&Array.from(stores).includes('profiles')&&Array.from(stores).includes('simulationRuns')){window.cleanupWorkerCount=window.activeSimulationWorkers;if(fail)queueMicrotask(()=>tx.abort());}return tx;};}""",fail)
            page.locator('#confirm-account-cleanup').click()
            if fail:
                expect(page.locator('#account-cleanup-dialog')).to_contain_text('清理失败');expect(page.locator('#cancel-account-cleanup')).to_be_enabled();page.locator('#cancel-account-cleanup').click();page.locator('#close-data').click()
                expect(page.locator('.season-simulate')).to_be_enabled();assert board()==before_cleanup
            else:
                expect(page.locator('#account-cleanup-dialog')).not_to_be_visible();expect(page.locator('#empty')).to_be_visible()
                assert page.evaluate("async profile=>{const s=await import('./application/storage.mjs');return !(await s.workspaceData(profile))&&(await s.simulationHistory(profile)).length===0;}",profile)
            assert page.evaluate('cleanupWorkerCount')==0
            page.evaluate('()=>{IDBDatabase.prototype.transaction=window.cleanupTransaction;}')
        assert not errors and not uploads,(errors,uploads);browser.close()
    print('同计划快捷跳转、主副与自定义卡保留、原草稿隔离、模拟期间禁用、目标舞台真实模拟、排除活动舞台及窄屏布局通过。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
