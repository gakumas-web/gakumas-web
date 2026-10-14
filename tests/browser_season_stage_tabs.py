"""验证赛季及活动分组、三或五舞台页签、状态保留和响应式排列。"""
from browser_artifacts import artifact_path
from browser_simulation_helpers import select_season
from playwright.sync_api import sync_playwright,expect


def check(url):
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab="seasonSimulation"]').click();season=page.locator('#season-select');expect(season).to_be_visible(timeout=60000);select_season(page,'contest:pvp_rate_config-53')
        tabs=page.locator('.season-stage-tab');expect(tabs).to_have_count(3);assert page.locator('#season-simulation-title,.season-clear-selection').count()==0;assert page.locator('dialog:modal').count()==0
        assert page.locator('#navigation [data-tab]').evaluate_all('(nodes)=>nodes.slice(0,3).map(e=>e.dataset.tab)')==['memories','seasonSimulation','selectionMemories']
        assert season.locator('xpath=ancestor::section').get_attribute('id')=='season-picker-region'
        expect(page.locator('#season-activity-mode')).not_to_be_checked();expect(page.locator('.season-picker-label')).to_have_text('选择舞台');season.click();popup=page.locator('#season-picker-popup:popover-open');assert popup.locator('input').count()==0;assert popup.locator('[data-season-id^="event:"]').count()==0;assert popup.locator('[role=option]').evaluate_all('nodes=>nodes.every(e=>e.querySelectorAll(".season-picker-stage").length===3)');option=popup.locator('[data-season-id="contest:pvp_rate_config-53"]');expect(option.locator('.season-picker-plan')).to_have_count(3);expect(option.locator('.season-picker-stage')).to_have_count(3);expect(option.locator('.contest-criteria-bar')).to_have_count(3);expect(option.locator('strong')).to_have_text('赛季 53');page.keyboard.press('Escape');expect(popup).not_to_be_visible()
        states=[]
        for index in range(3):
            tabs.nth(index).click();page.get_by_role('tab',name='自选编组模拟',exact=True).click();expect(tabs.nth(index)).to_have_attribute('aria-selected','true');expect(page.locator('.season-simulate')).to_be_disabled();page.locator('.season-memory-slot-pick').first.click();assert page.locator('dialog:modal').count()==1;option=page.locator('.contest-memory-option').first;key=option.get_attribute('data-memory-key');option.locator('.contest-memory-choose').click();expect(page.locator('[data-memory-index="0"] .season-memory-board')).to_have_attribute('data-memory-key',key);page.locator('#contest-simulation-runs').fill(str((index+1)*100));states.append(key)
        for index,key in enumerate(states):
            tabs.nth(index).click();page.get_by_role('tab',name='自选编组模拟',exact=True).click();expect(page.locator('[data-memory-index="0"] .season-memory-board')).to_have_attribute('data-memory-key',key);expect(page.locator('#contest-simulation-runs')).to_have_value(str((index+1)*100))
        select_season(page,'contest:pvp_rate_config-52');page.get_by_role('tab',name='自选编组模拟',exact=True).click();expect(tabs).to_have_count(3);expect(page.locator('.season-simulate')).to_be_disabled();assert all(':pvp_rate_config-52:' in value for value in tabs.evaluate_all('(nodes)=>nodes.map(e=>e.dataset.stageId)'));select_season(page,'contest:pvp_rate_config-53');expect(page.locator('[data-memory-index="0"] .season-memory-board')).to_have_attribute('data-memory-key',states[0])
        tabs.first.focus();tabs.first.press('ArrowRight');expect(tabs.nth(1)).to_be_focused();expect(tabs.nth(1)).to_have_attribute('aria-selected','true')
        page.locator('[data-tab="memories"]').click();page.locator('[data-tab="seasonSimulation"]').click();expect(tabs.nth(1)).to_have_attribute('aria-selected','true');expect(page.locator('[data-memory-index="0"] .season-memory-board')).to_have_attribute('data-memory-key',states[1])
        page.locator('#language').select_option('ja');expect(page.locator('#season-simulation-page')).to_have_attribute('aria-label','シーズンシミュレーション');expect(tabs.nth(1)).to_have_attribute('aria-selected','true');tabs.nth(2).click();expect(page.locator('[data-memory-index="0"] .season-memory-board')).to_have_attribute('data-memory-key',states[2]);expect(page.locator('#contest-simulation-runs')).to_have_value('300');page.locator('#language').select_option('zh-CN')
        for width in [1280,375,320]:
            page.set_viewport_size({'width':width,'height':1000});season.scroll_into_view_if_needed();boxes=[tabs.nth(i).bounding_box() for i in range(3)]
            if width==1280:assert len({round(box['y']) for box in boxes})==1 and boxes[0]['x']<boxes[1]['x']<boxes[2]['x']
            else:assert len({round(box['x']) for box in boxes})==1 and boxes[0]['y']<boxes[1]['y']<boxes[2]['y']
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=artifact_path(f'local/ui-visual-refinement/season-stage-tabs-{width}.png'),full_page=True)
        season.click();popup=page.locator('#season-picker-popup:popover-open');expect(popup).to_be_visible();assert popup.evaluate('e=>e.scrollWidth<=e.clientWidth');box=popup.bounding_box();assert box['x']>=0 and box['x']+box['width']<=320;popup.screenshot(path=artifact_path('local/ui-visual-refinement/season-dropdown-320.png'));popup.locator('[data-season-id="contest:pvp_rate_config-1"]').click();expect(tabs).to_have_count(3);page.locator('#season-activity-mode').check();expect(page.locator('.season-manual-multipliers')).to_be_visible();season.click();popup=page.locator('#season-picker-popup:popover-open');assert popup.locator('input').count()==0;expect(popup.locator('[role=option]')).to_have_count(6);assert popup.locator('[role=option]').evaluate_all('nodes=>nodes.every(e=>e.dataset.seasonId.startsWith("event:")&&[3,5].includes(e.querySelectorAll(".season-picker-stage").length))');popup.locator('[role=option]').last.click();expect(tabs).to_have_count(5);season.click();popup=page.locator('#season-picker-popup:popover-open');assert popup.evaluate('e=>e.scrollWidth<=e.clientWidth');popup.screenshot(path=artifact_path('local/ui-visual-refinement/event-dropdown-320.png'));page.keyboard.press('Escape');
        assert tabs.locator('.contest-stage-identity>strong').all_text_contents()==['舞台 A','舞台 B','舞台 C','舞台 D','舞台 E']
        for index in range(5):
            tabs.nth(index).click();page.get_by_role('tab',name='自选编组模拟',exact=True).click();page.locator('#contest-simulation-runs').fill(str((index+1)*100));page.locator('#season-manual-vocal').fill(str(100+index))
        for index in range(5):
            tabs.nth(index).click();page.get_by_role('tab',name='自选编组模拟',exact=True).click();expect(page.locator('#contest-simulation-runs')).to_have_value(str((index+1)*100));expect(page.locator('#season-manual-vocal')).to_have_value(str(100+index))
        for width in [1280,1024,700,375,320]:
            page.set_viewport_size({'width':width,'height':1000});season.scroll_into_view_if_needed();boxes=[tabs.nth(i).bounding_box() for i in range(5)]
            if width>=700:assert len({round(box['y']) for box in boxes})==1 and all(boxes[i]['x']<boxes[i+1]['x'] for i in range(4))
            else:assert len({round(box['x']) for box in boxes})==1 and all(boxes[i]['y']<boxes[i+1]['y'] for i in range(4))
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert tabs.evaluate_all('(nodes)=>nodes.every(e=>e.scrollWidth<=e.clientWidth)');page.screenshot(path=artifact_path(f'local/ui-visual-refinement/event-five-stages-{width}.png'),full_page=True)
        tabs.first.focus();tabs.first.press('End');expect(tabs.last).to_be_focused();expect(tabs.last).to_have_attribute('aria-selected','true')
        select_season(page,'event:4:1');expect(tabs).to_have_count(3);expect(season).to_contain_text('さいごの文化祭')
        select_season(page,'event:1:1');expect(tabs).to_have_count(5);expect(page.locator('#contest-simulation-runs')).to_have_value('100')
        page.locator('#season-activity-mode').uncheck();expect(tabs).to_have_count(3);expect(season).to_have_attribute('data-value','contest:pvp_rate_config-1')
        assert not errors,errors;browser.close()
    print('赛季及活动分组、三/五舞台切换与状态保留、键盘导航、宽屏并排及窄屏单列验证通过。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
