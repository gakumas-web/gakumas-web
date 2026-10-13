"""通过实际导入和资料加载验证赛季入口、舞台筛选、模拟入口及窄屏布局。"""
import argparse
from browser_simulation_helpers import select_season
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import fixtures,ROOT


def check(url,account=None):
    with TemporaryDirectory(dir=ROOT/'local',prefix='season-browser-') as temporary,sync_playwright() as p:
        folder=Path(temporary)/'account'
        if account:folder=Path(account)
        else:
            docs=fixtures();docs['capture']['idolCards'][0]['levelLimitRank']=3;template=docs['capture']['memories'][0];rows=[]
            for plan in [2,3,4]:
                for i in range(5):
                    row=copy.deepcopy(template);row.update(userMemoryId=f'synthetic-season-{plan}-{i}',planType=plan,vocal=1300+i*100,dance=1500+i*50,visual=1700+i*30,examBattleProduceCards=[row['produceCard']]);rows.append(row)
            docs['capture'].update(memories=rows,count=len(rows))
            for name,doc in docs.items():
                file=folder/name/'snapshot.json';file.parent.mkdir(parents=True);file.write_text(json.dumps(doc))
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:uploads.append(r.url) if r.post_data else None)
        page.goto(url,wait_until='networkidle');expect(page.locator('#season-simulation-open')).to_be_disabled()
        page.locator('#account-directory-files').set_input_files(str(folder));expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        expect(page.locator('#navigation #season-simulation-open')).to_be_enabled()
        for width in [1440,800,390,360,320]:
            page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.locator('#search').fill('synthetic-no-match-season-isolation')
        expect(page.locator('#list [data-memory-key]')).to_have_count(0)
        page.locator('#season-simulation-open').click();expect(page.locator('#season-simulation-page')).to_be_visible(timeout=30000)
        assert page.locator('#season-use-filters').count()==0
        assert page.locator('#season-select').count()==1 and page.locator('#season-stage').count()==0
        for stage in ['0','1','2']:
            select_season(page,'contest:pvp_rate_config-53')
            assert page.locator('.season-stage-tab').count()==3
            option=page.locator(f'[data-stage-id="contest:pvp_rate_config-53:{stage}"]')
            assert option.locator('.contest-stage-plan').inner_text()
            assert option.locator('.contest-criteria-labels').inner_text().count('%')==3
            assert option.evaluate('e=>e.scrollHeight<=e.clientHeight+1'), '舞台选项未容纳完整比例及回合信息'
            option.click()
            page.locator('.season-memory-slot-pick').first.click()
            assert page.locator('.contest-memory-option').count()>0
            assert page.locator('.contest-memory-option .memory-inheritance, .contest-memory-option .memory-abilities, .contest-memory-option .entry-date, .contest-memory-card-name small, .contest-memory-card-name > span').count()==0
            assert page.locator('#contest-memory-character [role="radio"] .filter-face').count()>0
            expected_plan=page.evaluate('''async stage=>{const {contestCatalog}=await import('./domain/catalog.mjs');return {ProducePlanType_Plan1:'2',ProducePlanType_Plan2:'3',ProducePlanType_Plan3:'4'}[contestCatalog().choices.find(value=>value.id==='contest:pvp_rate_config-53:'+stage).planType]}''',stage)
            assert page.locator('#contest-memory-plan button').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.plan)')==[expected_plan]
            expect(page.locator('#contest-memory-plan [aria-checked="true"]')).to_have_attribute('data-plan',expected_plan)
            assert page.locator('.contest-memory-divider').count()==1
            assert page.locator('.contest-memory-option .memory-card-stats').count()>0
            assert page.locator('.contest-memory-option').first.locator('.memory-skill-strip').count()==1
            assert page.locator('.season-candidate-multiplier').first.inner_text().endswith('%')
            page.locator('.contest-memory-option').first.locator('.contest-memory-choose').click()
            expect(page.locator('.season-memory-slot-pick').first).to_be_focused()
            assert page.locator('.season-memory-board').count()==1
            expect(page.locator('.season-team-name > span')).to_have_text(__import__('re').compile(r'^【.+】$'))
            assert '符合舞台计划：' not in page.locator('#season-simulation-page').inner_text()
            if not account:
                page.wait_for_function("async id=>{const {idolInfo}=await import('./domain/catalog.mjs');const {assetURL}=await import('./resources.mjs');const image=document.querySelector('.season-team-idol-art > img');return image.complete&&!image.hidden&&image.naturalWidth>0&&image.src===assetURL(idolInfo({idolCardId:id,levelLimitRank:3}).image,true)}",arg=docs['capture']['idolCards'][0]['idolCardId'])
        expect(page.locator('.season-common-deck')).to_be_visible();assert page.locator('.season-common-cards .support-reward-trigger').count()>=8
        assert page.locator('.season-stage-reference > details > summary').all_text_contents()==['基础规则','属性评分曲线']
        page.locator('.season-basic-rules summary').click();assert page.locator('.season-basic-values dd').count()==4
        page.locator('.season-score-curve > summary').click();assert page.locator('.season-curve-values').count()==0
        assert page.locator('.season-curve-chart polyline').count()==3
        table=page.evaluate("""async()=>{const {contestCatalog}=await import('./domain/catalog.mjs');return contestCatalog().choices.find(stage=>stage.id==='contest:pvp_rate_config-53:3').curve.slice(0,2).map(row=>[row.parameter,...['vocal','dance','visual'].map(key=>row[key+'Permil']/1000)])}""")
        for parameter in [table[1][0],round((table[0][0]+table[1][0])/2)]:
            page.locator('.season-curve-parameter').evaluate('(e,value)=>{e.value=value;e.dispatchEvent(new Event("input",{bubbles:true}))}',parameter)
            actual=page.locator('.season-curve-readings strong').all_text_contents()
            ratio=(parameter-table[0][0])/(table[1][0]-table[0][0])
            for index,value in enumerate(actual):assert abs(float(value[1:])-(table[0][index+1]+ratio*(table[1][index+1]-table[0][index+1])))<0.001

        assert page.locator('.season-stage-tabs').count()==1
        assert page.locator('.season-memory-slot-pick').count()==2
        page.locator('.season-memory-slot-pick').first.click()
        assert page.locator('#contest-memory-character button, #contest-memory-plan button').evaluate_all('(nodes)=>nodes.every(node=>[...node.childNodes].every(child=>child.nodeType!==3||!child.textContent.trim())&&!node.querySelector("span:not(.illustration):not(.art-fallback):not(.filter-symbol):not(.contest-filter-all)"))')
        plans=page.locator('#contest-memory-plan button').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.plan).filter(Boolean)')
        assert len(plans)==1
        for plan in plans:
            page.locator(f'#contest-memory-plan [data-plan="{plan}"]').click()
            expect(page.locator('#contest-memory-plan [aria-checked="true"]')).to_have_attribute('data-plan',plan)
            expected={'2':['','parameter','lesson'],'3':['','aggressive','review'],'4':['','concentration','fullPower']}[plan]
            assert page.locator('#contest-memory-flow button:visible').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.flow)')==expected
            expect(page.locator('#contest-memory-flow [aria-checked="true"]')).to_have_attribute('data-flow','')
            page.locator(f'#contest-memory-flow [data-flow="{expected[1]}"]').click()
            assert all(value==plan for value in page.locator('.contest-memory-option').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.plan)'))
        page.locator('#contest-memory-flow [data-flow=""]').click()
        character=page.locator('.contest-memory-option').first.get_attribute('data-character')
        page.locator(f'#contest-memory-character [data-character-id="{character}"]').click()
        assert page.locator('#contest-memory-character [aria-checked="true"]').count()==1
        assert all(value==character for value in page.locator('.contest-memory-option').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.character)'))
        flows=page.locator('.contest-memory-option').first.get_attribute('data-flows').split()
        if flows and page.locator(f'#contest-memory-flow [data-flow="{flows[0]}"]:visible').count():
            page.locator(f'#contest-memory-flow [data-flow="{flows[0]}"]').click()
            assert all(flows[0] in value.split() for value in page.locator('.contest-memory-option').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.flows)'))
        page.locator('#contest-memory-flow button:visible').last.click()
        if not page.locator('.contest-memory-option').count():expect(page.locator('.contest-memory-options .empty-result')).to_be_visible()
        page.locator('#contest-memory-flow [data-flow=""]').click()
        page.locator('#season-memory-sort').select_option('vocal')
        values=page.locator('.season-attribute-value[data-attribute="vocal"] .season-candidate-multiplier').all_text_contents();numbers=[float(value[:-1]) for value in values if value.endswith('%')];assert numbers==sorted(numbers,reverse=True)
        selected_character=page.locator('.contest-memory-option').first.get_attribute('data-character')
        selected_keys={page.locator('.contest-memory-option').first.get_attribute('data-memory-key')}
        selected_stats=[page.locator('.contest-memory-option').first.locator('.season-attribute-value > strong').all_text_contents()]
        page.locator('.contest-memory-option').first.locator('.contest-memory-choose').click()
        main_items=page.locator('.season-team-items [data-config-id]').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.configId)')
        for i in range(1,2):
            page.locator('.season-memory-slot-pick').nth(i).click()
            expect(page.locator('#contest-memory-character')).to_have_attribute('aria-disabled','true')
            expect(page.locator('#contest-memory-character [aria-checked="true"]')).to_have_attribute('data-character-id',selected_character)
            assert all(value==selected_character for value in page.locator('.contest-memory-option').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.character)'))
            options=page.locator('.contest-memory-option').evaluate_all('(nodes)=>nodes.map(e=>({key:e.dataset.memoryKey,disabled:e.getAttribute("aria-disabled")==="true"}))')
            assert all(value['disabled']==(value['key'] in selected_keys) for value in options)
            choice=page.locator('.contest-memory-option[aria-disabled="false"]').first
            selected_keys.add(choice.get_attribute('data-memory-key'));selected_stats.append(choice.locator('.season-attribute-value > strong').all_text_contents());choice.locator('.contest-memory-choose').click()
        assert page.locator('.season-slot-actions').count()==2
        assert page.locator('.season-memory-row .season-memory-board').count()==2
        assert page.locator('.season-team-summary').count()==1
        assert page.locator('.season-team-items [data-config-id]').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.configId)')==main_items
        retained=page.locator('.season-memory-row [data-retained="true"]').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.configId)')
        assert len(retained)==len(set(retained))
        assert page.locator('.season-memory-row [data-retained="false"] .season-duplicate-badge').count()>0
        assert page.locator('.season-board-stats').count()==1
        assert page.locator('.season-team-idol-art').count()==1
        for index,attribute in enumerate(['vocal','dance','visual']):
            expected=int(selected_stats[0][index].split()[-1])+int(selected_stats[1][index].split()[-1])//5
            expect(page.locator(f'.season-board-stat[data-attribute="{attribute}"] > strong')).to_have_text(str(expected))
        assert page.locator('.season-memory-row .support-skill-thumbnail').count()>0
        for width in [1440,390,320]:
            page.set_viewport_size({'width':width,'height':900})
            assert page.locator('#season-simulation-page').evaluate('e=>e.scrollWidth<=e.clientWidth')
            assert page.locator('.season-memory-slot-pick').first.evaluate('e=>e.offsetWidth===e.offsetHeight&&e.offsetWidth<=76')
            assert page.locator('.season-memory-row').evaluate_all('(rows)=>rows[1].getBoundingClientRect().top>=rows[0].getBoundingClientRect().bottom')
            page.locator('.season-memory-slot-pick').first.click()
            expect(page.locator('#contest-memory-character')).to_have_attribute('aria-disabled','true')
            expect(page.locator('#contest-memory-character [aria-checked="true"]')).to_have_attribute('data-character-id',selected_character)
            assert page.locator('#contest-memory-picker').evaluate('e=>e.scrollWidth<=e.clientWidth')
            page.keyboard.press('Escape');expect(page.locator('.season-memory-slot-pick').first).to_be_focused()
        page.locator('.season-slot-actions').last.locator('button').last.click()
        assert page.locator('.season-slot-actions').count()==1
        page.locator('.season-memory-slot-pick').first.click();expect(page.locator('#contest-memory-character')).to_have_attribute('aria-disabled','false');page.keyboard.press('Escape')
        page.locator('.season-memory-slot-pick').last.click();expect(page.locator('#contest-memory-character')).to_have_attribute('aria-disabled','true');page.locator('.contest-memory-option[aria-disabled="false"]').first.locator('.contest-memory-choose').click()
        expect(page.locator('.season-simulate')).to_have_text('模拟')
        page.locator('.season-simulate').click();expect(page.locator('#contest-simulation-result')).to_be_visible()
        expect(page.locator('#season-simulation-page')).to_be_visible();assert page.locator('dialog:modal').count()==0
        select_season(page,'contest:pvp_rate_config-53');expect(page.locator('.season-simulate')).to_be_enabled()
        page.locator('#season-activity-mode').check();page.locator('#season-select').click();assert page.locator('.season-picker-option[data-season-id^="event:"] .season-picker-stage').count()==24
        page.locator('.season-picker-option[data-season-id^="event:"]').first.click()
        expect(page.locator('.season-manual-multipliers')).to_be_visible()
        page.locator('.season-memory-slot-pick').first.click();page.locator('.contest-memory-option[aria-disabled="false"]').first.locator('.contest-memory-choose').click()
        expect(page.locator('.season-board-stat[data-attribute="vocal"] .season-board-multiplier')).to_have_text('—')
        page.locator('#season-manual-vocal').fill('1500')
        expect(page.locator('.season-board-stat[data-attribute="vocal"] .season-board-multiplier')).to_have_text('1500%')
        select_season(page,'contest:pvp_rate_config-53')
        page.locator('[data-tab="memories"]').click();expect(page.locator('#season-simulation-view')).to_be_hidden()
        expect(page.locator('#search')).to_have_value('synthetic-no-match-season-isolation')
        expect(page.locator('#list [data-memory-key]')).to_have_count(0)
        page.locator('[data-tab="selectionMemories"]').click();expect(page.locator('#season-simulation-open')).to_be_visible()
        page.locator('[data-tab="memories"]').click();page.locator('#language').select_option('ja');page.locator('#season-simulation-open').click();expect(page.locator('#season-simulation-page')).to_have_attribute('aria-label','シーズンシミュレーション')
        assert page.locator('#season-simulation-page').evaluate('e=>e.scrollWidth<=e.clientWidth')
        page.locator('#season-select').click();expect(page.locator('.season-picker-label')).to_have_text('ステージを選択')
        assert page.locator('#season-picker-popup').evaluate('e=>e.scrollWidth<=e.clientWidth')
        page.keyboard.press('Escape')
        page.locator('.season-memory-slot-pick').first.click();expect(page.locator('#contest-memory-picker-title')).to_have_text('メモリーを選択')
        assert page.locator('#contest-memory-picker').evaluate('e=>e.scrollWidth<=e.clientWidth')
        assert not errors,errors;assert not uploads,uploads;browser.close()
    print('赛季与舞台切换、活动独立倍率、库存筛选隔离、角色流派筛选、主副槽位、卡组与模拟入口、中日文窄屏验证通过；无数据上传。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8080/');parser.add_argument('--account',type=Path)
    args=parser.parse_args();check(args.url,args.account)
