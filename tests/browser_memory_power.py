"""通过真实导入与编辑验证综合值计算、还原、窄屏和库存隔离。"""
from browser_artifacts import artifact_path
from browser_simulation_helpers import select_season
import argparse
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import fixtures,ROOT


def check(url):
    with TemporaryDirectory(dir=ROOT/'local',prefix='contest-loadout-') as temporary,sync_playwright() as p:
        docs=fixtures();base=docs['capture']['memories'][0];docs['capture']['producerExp']=1000000000
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':1100});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle')
        data=page.evaluate('''async memory=>{
          const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');
          const {contestCustomizationCatalog,cardCustomizations,memoryExclusiveSkill,idolInfo,contestCatalog,contestFixedItemIds}=await import('./domain/catalog.mjs');
          const catalog=contestCustomizationCatalog(),plan=idolInfo(memory).plan,planType={Plan1:2,Plan2:3,Plan3:4}[plan];
          const allowed=value=>[plan,'Common'].includes(value.metadata.plan);
          const common=catalog.cards.filter(value=>value.metadata.source==='common'&&allowed(value));
          const support=catalog.cards.filter(value=>value.metadata.source==='support'&&allowed(value));
          const primary=memoryExclusiveSkill(memory).reference;
          const cards=[primary,support[0].versions[0],...common.slice(0,4).map(value=>value.versions[0])];
          const edited=common.find(value=>!cards.some(card=>card.id===value.id)&&value.versions.some(version=>version.upgradeCount===1&&cardCustomizations(version)?.maximum>0&&cardCustomizations(version)?.options.some(option=>option.levels.some(level=>level.level===1))));
          const exclusive=catalog.cards.find(value=>value.metadata.source==='idol'&&value.metadata.ownerCharacterId===memory.characterId&&allowed(value)&&value.idolCardId!==memory.idolCardId&&value.id!==primary.id);
          const items=catalog.items.filter(value=>allowed(value)&&value.metadata.use==='battle'&&value.metadata.source==='support');
          const fixed=catalog.items.find(value=>contestFixedItemIds({...memory,examBattleProduceItemIds:[value.id]}).has(value.id));
          const stage=contestCatalog().choices.find(value=>value.kind==='contest'&&value.planType==='ProducePlanType_'+plan);
          return {plan,planType,cards,edited,exclusive,fixed,items:items.slice(0,4),support:support.find(value=>value.id!==cards[1].id),stage:stage.id,illegalVersions:catalog.cards.some(value=>value.versions.some(version=>version.upgradeCount>1))};
        }''',base)
        assert data['edited'] and data['exclusive'] and data['support'] and data['fixed'] and len(data['items'])>=4
        assert not data['illegalVersions']
        assert docs['capture']['supportCards']==[] and data['support']['supportCardId']
        rows=[]
        for index in range(2):
            memory=copy.deepcopy(base);memory.update(userMemoryId=f'synthetic-custom-{index}',planType=data['planType'],grade=15,vocal=1300+index*100,dance=1400+index*100,visual=1500+index*100,examBattleProduceCards=data['cards'],examBattleProduceItemIds=[data['fixed']['id'],*[value['id'] for value in data['items'][:2]]])
            rows.append(memory)
        docs['capture'].update(memories=rows,count=2);folder=Path(temporary)/'account'
        for name,document in docs.items():
            file=folder/name/'snapshot.json';file.parent.mkdir(parents=True);file.write_text(json.dumps(document))
        page.locator('#account-directory-files').set_input_files(str(folder));expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        page.locator('#season-simulation-open').click();expect(page.locator('#season-simulation-page')).to_be_visible(timeout=30000)
        select_season(page,'contest:pvp_rate_config-53');page.locator(f'[data-stage-id="{data["stage"]}"]').click()
        def choose_memory(index):
            page.locator('.simulation-mode-tabs [data-mode="selected"]').click()
            page.locator('.season-memory-slot-pick').nth(index).click();page.locator('.contest-memory-option').nth(index).locator('.contest-memory-choose').click()
        choose_memory(0);choose_memory(1)
        assert page.locator('.season-team-items h4').count()==0
        expect(page.locator('.season-board-power > span')).to_have_text('综合值合计')
        assert '20%' in page.locator('.season-memory-results > p').first.inner_text()
        main=page.locator('[data-memory-index="0"]');sub=page.locator('[data-memory-index="1"]')
        page.locator('[data-customize-memory="0"]').click();assert main.locator('[data-edit-card]').count()==6
        assert page.locator('[data-edit-item]').count()==2
        assert page.locator('.season-item-slot[data-fixed="true"]').count()==1
        assert page.locator('.season-item-slot[data-fixed="true"] [data-edit-item]').count()==0
        assert page.locator('[data-add-item]').count()==1
        def edit_card(owner,index):
            page.locator(f'[data-memory-index="{owner}"] [data-edit-card="{index}"]').click();expect(page.locator('#contest-loadout-editor')).to_be_visible()
        def select_choice(value):
            if page.locator('#contest-loadout-search').count():page.locator('#contest-loadout-search').fill(value['name'])
            page.locator(f'.contest-loadout-choice[data-choice-id="{value["id"]}"] > input[type=checkbox]').check()
        def cancel():
            if page.locator('.support-reward-popover:popover-open').count():page.keyboard.press('Escape')
            page.keyboard.press('Escape');expect(page.locator('#contest-loadout-editor')).not_to_be_visible()
        def apply():
            if page.locator('.support-reward-popover:popover-open').count():page.keyboard.press('Escape')
            page.locator('.contest-loadout-footer .primary').click();expect(page.locator('#contest-loadout-editor')).not_to_be_visible()
        edit_card(0,0);page.locator('#contest-loadout-owned').uncheck()
        assert page.locator('.contest-loadout-choice').count()>0
        assert all(value=='idol' for value in page.locator('.contest-loadout-choice').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.source)'))
        select_choice(data['exclusive']);apply()
        expect(page.locator('.season-board-power > span')).to_have_text('综合值合计（计算值）')
        assert page.locator('.season-board-power > strong').inner_text() not in ['1480','未记录']
        expect(main.locator('[data-edit-card="0"]')).to_have_text('还原')
        main.locator('[data-edit-card="0"]').click()
        expect(page.locator('.season-board-power > span')).to_have_text('综合值合计')
        expect(page.locator('.season-board-power > strong')).to_have_text('1480')
        expect(main.locator('[data-edit-card="0"]')).to_have_text('槽位 1')
        page.locator('[data-add-item]').click();select_choice(data['items'][2]);apply()
        expect(page.locator('.season-board-power > span')).to_have_text('综合值合计（计算值）')
        assert page.locator('.season-board-power > strong').inner_text() not in ['1480','未记录']
        for width in [1280,375]:
            page.set_viewport_size({'width':width,'height':1000})
            assert page.locator('#season-simulation-page').evaluate('e=>e.scrollWidth<=e.clientWidth')
            page.locator('.season-team-preview').screenshot(path=artifact_path(str(ROOT/'local/memory-power'/f'calculated-{width}.png')))
        main.locator('.season-memory-reset').click()
        expect(page.locator('.season-board-power > span')).to_have_text('综合值合计')
        expect(page.locator('.season-board-power > strong')).to_have_text('1480')
        page.locator('[data-tab="memories"]').click()
        assert page.locator('.memory-card-power strong').all_text_contents()==['1234','1234']
        assert not errors and not uploads,(errors,uploads)
        browser.close()
    print('真实回忆采集值保留；改技能和 P 道具后显示计算值；还原恢复采集值；双屏宽无溢出且库存未改变、无上传。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);check(parser.parse_args().url)
