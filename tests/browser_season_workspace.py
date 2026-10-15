"""验证独立模拟页签的快捷带入、状态保留、账号隔离和单层选择器。"""
from browser_artifacts import artifact_path
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
        def check_navigation(group,attribute,state='aria-checked'):
            original=group.locator(f'[{state}="true"]').get_attribute(attribute)
            buttons=group.locator('button:visible:enabled');buttons.first.focus()
            for direction,last in [('End',True),('ArrowRight',False),('ArrowLeft',True),('Home',False)]:
                page.keyboard.press(direction);target=buttons.last if last else buttons.first
                expect(target).to_be_focused();expect(target).to_have_attribute(state,'true')
                expect(group.locator('button:visible:enabled[tabindex="0"]')).to_have_count(1)
                expect(group.locator('button[hidden][tabindex="0"]')).to_have_count(0)
            group.locator(f'[{attribute}="{original}"]').click()
        check_navigation(page.locator('.season-stage-tabs'),'data-stage-id','aria-selected')
        expect(page.locator('[data-memory-index="0"] .season-memory-board')).to_have_attribute('data-memory-key',key)
        page.locator('.season-memory-slot-pick').first.click()
        check_navigation(page.locator('#contest-memory-character'),'data-character-id')
        check_navigation(page.locator('#contest-memory-plan'),'data-plan')
        check_navigation(page.locator('#contest-memory-flow'),'data-flow')
        plan=page.locator('#contest-memory-plan [aria-checked=true]').get_attribute('data-plan')
        assert plan in ['2','3','4']
        expect(page.locator('#contest-memory-plan button')).to_have_count(1)
        assert page.locator('.contest-memory-option').count()>0
        assert page.locator('.contest-memory-option').evaluate_all('(nodes)=>nodes.every(node=>node.dataset.plan===document.querySelector("#contest-memory-plan [aria-checked=true]").dataset.plan)')
        expected={'2':['','parameter','lesson'],'3':['','aggressive','review'],'4':['','concentration','fullPower']}[plan]
        assert page.locator('#contest-memory-flow button:visible').evaluate_all('(nodes)=>nodes.map(node=>node.dataset.flow)')==expected
        page.locator(f'#contest-memory-flow [data-flow="{expected[1]}"]').click()
        assert page.locator('.contest-memory-option').evaluate_all('(nodes)=>nodes.every(node=>node.dataset.flows.split(" ").includes(document.querySelector("#contest-memory-flow [aria-checked=true]").dataset.flow))')
        page.keyboard.press('Escape')
        page.locator('.season-memory-slot-pick').last.click()
        expect(page.locator('#contest-memory-character')).to_have_attribute('aria-disabled','true')
        expect(page.locator('#contest-memory-character button:enabled')).to_have_count(0)
        check_navigation(page.locator('#contest-memory-flow'),'data-flow');page.keyboard.press('Escape')
        modes=page.locator('.simulation-mode-tabs');check_navigation(modes,'data-mode','aria-selected')
        mode_key=modes.locator('[aria-selected=true]').get_attribute('data-mode');selected_mode=modes.locator(f'[data-mode="{mode_key}"]');selected_mode.focus()
        for direction in ['ArrowUp','ArrowDown']:
            page.keyboard.press(direction);expect(selected_mode).to_be_focused();expect(selected_mode).to_have_attribute('aria-selected','true')
        page.locator('[data-mode="recommended"]').click()
        recommendations=page.locator('#contest-recommendations');characters=recommendations.locator('.recommendation-characters')
        check_navigation(characters,'data-character-id')
        active_character=characters.locator('[aria-checked=true]').get_attribute('data-character-id')
        recommendations.locator('.recommendation-start').click()
        expect(characters.locator('button:enabled')).to_have_count(0)
        expect(characters.locator('[aria-checked=true]')).to_have_attribute('data-character-id',active_character)
        recommendations.locator('.recommendation-stop').click();expect(recommendations.locator('.recommendation-start')).to_be_enabled()
        check_navigation(characters,'data-character-id')
        page.locator('[data-mode="optimization"]').click()
        check_navigation(page.locator('#contest-optimization .recommendation-characters'),'data-character-id')
        page.locator('[data-mode="selected"]').click()
        expect(page.locator('[data-memory-index="0"] .season-memory-board')).to_have_attribute('data-memory-key',key)
        expect(page.locator('.season-rules-section')).to_be_visible();assert page.locator('.season-rules-section > summary').count()==0;expect(page.locator('#contest-simulation-runs')).to_have_value('500')
        page.locator('[data-customize-memory="0"]').click();page.locator('[data-memory-index="0"] [data-edit-card="2"]').click();assert page.locator('dialog:modal').count()==1;page.locator('#contest-loadout-owned').uncheck();page.locator('#contest-loadout-enhanced').check()
        candidate=page.evaluate('''async()=>{const {cardCustomizations}=await import('./domain/catalog.mjs');return [...document.querySelectorAll('.contest-loadout-choice[data-source="common"]')].map(e=>({id:e.dataset.choiceId,data:cardCustomizations({id:e.dataset.choiceId,upgradeCount:1,customizes:[]})})).find(row=>row.data?.options.length>0);}''');assert candidate
        page.locator(f'.contest-loadout-choice[data-choice-id="{candidate["id"]}"] [role="radio"]').click();page.locator('.contest-inline-customizer [data-step="1"]:enabled').first.click();page.locator('.contest-loadout-footer .primary').click();assert page.locator('dialog:modal').count()==0
        board=page.locator('[data-memory-index="0"]');state=board.locator('[data-config-id]').evaluate_all('(nodes)=>nodes.map(e=>[e.dataset.configId,e.textContent])')
        page.locator('#contest-simulation-runs').fill('300');stage=page.locator('.season-stage-tab[aria-selected="true"]').get_attribute('data-stage-id')
        for tab in ['memories','supportCards','selectionMemories']:
            page.locator(f'[data-tab="{tab}"]').click();expect(page.locator('#season-simulation-view')).not_to_be_visible();page.locator('[data-tab="seasonSimulation"]').click();expect(page.locator('#season-simulation-view')).to_be_visible();assert page.locator('.season-stage-tab[aria-selected="true"]').get_attribute('data-stage-id')==stage;assert board.locator('[data-config-id]').evaluate_all('(nodes)=>nodes.map(e=>[e.dataset.configId,e.textContent])')==state;expect(page.locator('#contest-simulation-runs')).to_have_value('300')
        page.locator('#language').select_option('ja');expect(page.locator('#season-simulation-page')).to_have_attribute('aria-label','シーズンシミュレーション');expect(board.locator('.season-memory-board')).to_have_attribute('data-memory-key',key);expect(board.locator(f'[data-config-id="{candidate["id"]}"] .selection-custom-count').last).to_have_text('1');expect(page.locator('#contest-simulation-runs')).to_have_value('300');page.locator('#language').select_option('zh-CN');expect(page.locator('#season-simulation-page')).to_have_attribute('aria-label','赛季模拟')
        # 从实际赛季目录核对两个入口的比例、顺序、标签和缺失资料提示。
        page.locator('#season-select').click()
        assert page.evaluate("""async()=>{
          const {contestCatalog}=await import('./domain/catalog.mjs'),{contestSeasonGroups}=await import('./domain/contest-simulation.mjs');
          const choices=contestCatalog().choices,groups=contestSeasonGroups(choices),attributes=['vocal','dance','visual'],short=['Vo','Da','Vi'];
          const matches=(node,stage)=>{
            if(!stage.criteria)return !node.querySelector('.contest-criteria-bar')&&node.textContent.includes('属性分配未收录');
            const bar=node.querySelector('.contest-criteria-bar'),labels=[...node.querySelectorAll('.contest-criteria-labels > span')];
            return bar?.getAttribute('aria-hidden')==='true'&&bar.children.length===3&&labels.length===3&&attributes.every((key,index)=>bar.children[index].dataset.attribute===key&&Math.abs(Number(bar.children[index].style.flexGrow)-stage.criteria[key])<.000001&&labels[index].textContent===`${short[index]} ${Number((stage.criteria[key]*100).toFixed(1))}%`);
          };
          const options=[...document.querySelectorAll('#season-picker-list > .season-picker-option')],tabs=[...document.querySelectorAll('.season-stage-tab')];
          return options.length>0&&tabs.length>0&&options.every(option=>{const group=groups.find(g=>g.id===option.dataset.seasonId),rows=[...option.querySelectorAll('.season-picker-stage')];return rows.length===group.stages.length&&rows.every((row,index)=>matches(row,group.stages[index]));})&&tabs.every(tab=>matches(tab,choices.find(stage=>stage.id===tab.dataset.stageId)));
        }""")
        page.keyboard.press('Escape')
        for width in [1280,375,320]:
            page.set_viewport_size({'width':width,'height':1000});page.locator('#season-select').scroll_into_view_if_needed();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=artifact_path(str(ROOT/f'local/ui-visual-refinement/season-workspace-{width}.png')),full_page=True)
            page.locator('#season-select').click();popup=page.locator('#season-picker-popup:popover-open');expect(popup).to_be_visible();assert popup.evaluate('e=>e.scrollWidth<=e.clientWidth+1');popup.screenshot(path=artifact_path(str(ROOT/f'local/ui-visual-refinement/season-criteria-{width}.png')));page.keyboard.press('Escape')
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
