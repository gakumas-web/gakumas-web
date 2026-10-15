"""通过正式导入入口验证槽位自定义、候选权限、附魔应用和原始回忆隔离。"""
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
        docs=fixtures();base=docs['capture']['memories'][0]
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
            memory=copy.deepcopy(base);memory.update(userMemoryId=f'synthetic-custom-{index}',planType=data['planType'],vocal=1300+index*100,dance=1400+index*100,visual=1500+index*100,examBattleProduceCards=data['cards'],examBattleProduceItemIds=[data['fixed']['id'],*[value['id'] for value in data['items'][:2]]])
            rows.append(memory)
        docs['capture'].update(memories=rows,count=2);folder=Path(temporary)/'account'
        for name,document in docs.items():
            file=folder/name/'snapshot.json';file.parent.mkdir(parents=True);file.write_text(json.dumps(document))
        page.locator('#account-directory-files').set_input_files(str(folder));expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        page.locator('#season-simulation-open').click();expect(page.locator('#season-simulation-page')).to_be_visible(timeout=30000)
        select_season(page,'contest:pvp_rate_config-53');page.locator(f'[data-stage-id="{data["stage"]}"]').click()
        def choose_memory(index):
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
            page.locator(f'.contest-loadout-choice[data-choice-id="{value["id"]}"] [role="radio"]').click()
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
        expect(main.locator('[data-edit-card="0"]')).to_have_text('还原')
        main.locator('[data-edit-card="0"]').click()
        expect(main.locator('[data-edit-card="0"]')).to_have_text('槽位 1')
        expect(main.locator('.season-memory-slot-pick')).to_have_attribute('data-config-id',data['cards'][0]['id'])
        page.evaluate('''async memory=>{
          const {contestCustomizationCatalog}=await import('./domain/catalog.mjs');
          const {openContestLoadoutEditor}=await import('./ui/contest-loadout-editor.mjs');
          const catalog=contestCustomizationCatalog(),scenarioItem=catalog.items.find(value=>value.metadata.source==='common');
          if(!scenarioItem)throw new Error('缺少剧本道具测试候选');
          openContestLoadoutEditor({catalog,memory,memoryIndex:0,slotIndex:1,kind:'item',current:scenarioItem.id,includeIdolItems:false,onApply:()=>{throw new Error('不应应用剧本道具')}});
        }''',rows[0])
        assert page.locator('.contest-loadout-choice[data-source="common"]').count()==0
        expect(page.locator('.contest-loadout-footer .primary')).to_be_disabled();cancel()
        edit_card(0,2)
        assert page.locator('.contest-loadout-groups .selection-source-column').count()>0
        assert page.locator('#contest-loadout-source, #contest-loadout-search, .contest-loadout-filters select').count()==0
        expect(page.locator('#contest-loadout-enhanced')).to_be_checked()
        expect(page.locator('#contest-loadout-owned')).to_be_checked()
        assert page.locator('#contest-loadout-rarity [data-value="LEGEND"]').count()==0
        assert '仅用于本次编组' not in page.locator('#contest-loadout-editor').inner_text()
        page.locator('#contest-loadout-flow [data-value="unclassified"]').click()
        assert page.evaluate('''async()=>{
          const {contestCustomizationCatalog}=await import('./domain/catalog.mjs');
          const catalog=contestCustomizationCatalog();
          const ids=[...document.querySelectorAll('.contest-loadout-choice')].map(node=>node.dataset.choiceId);
          return ids.length>0&&ids.every(id=>catalog.cards.find(value=>value.id===id).metadata.flows.length===0);
        }''')
        page.locator('#contest-loadout-flow [data-value=""]').click()
        assert page.locator('#contest-loadout-upgrade, .contest-loadout-inspector').count()==0
        assert all(value in ['Common',data['plan']] for value in page.locator('.contest-loadout-choice').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.plan)'))
        assert all(value=='common' for value in page.locator('.contest-loadout-choice').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.source)'))
        select_choice(data['edited']);cancel()
        assert main.locator(f'[data-config-id="{data["cards"][2]["id"]}"]').count()==1
        edit_card(0,2);select_choice(data['edited'])
        art=page.locator(f'.contest-loadout-choice[data-choice-id="{data["edited"]["id"]}"] .contest-loadout-art');art.hover()
        popup=page.locator('#'+art.get_attribute('aria-controls'));expect(popup).to_be_visible()
        assert popup.locator('[data-role="upgrade"]').count()==0
        expect(page.locator('#contest-loadout-enhanced')).to_be_checked()
        assert popup.locator('.contest-customization-options').count()==0
        custom=page.locator('.contest-inline-customizer [data-step="1"]:enabled').first
        custom.click();assert '1' in page.locator('.contest-inline-customizer output').all_text_contents()
        page.locator('#contest-loadout-enhanced').uncheck()
        assert art.locator('.support-skill-enhanced').count()==0
        assert page.locator(f'.contest-loadout-choice[data-choice-id="{data["edited"]["id"]}"] .selection-custom-count').count()==0
        page.locator('#contest-loadout-enhanced').check();assert art.locator('.support-skill-enhanced').count()==1
        art.hover();popup=page.locator('#'+art.get_attribute('aria-controls'));expect(popup).to_be_visible()
        custom=page.locator('.contest-inline-customizer [data-step="1"]:enabled').first;custom.click();apply()
        changed=main.locator(f'[data-config-id="{data["edited"]["id"]}"]');expect(changed).to_have_attribute('data-upgrade','1');expect(changed.locator('.selection-custom-count')).to_have_text('1')
        expect(main.locator('[data-edit-card="2"]')).to_be_focused()
        expect(sub.locator(f'[data-config-id="{data["cards"][2]["id"]}"]')).to_have_attribute('data-retained','true')
        edit_card(0,1)
        expect(page.locator('#contest-loadout-owned')).to_be_checked()
        assert page.locator(f'.contest-loadout-choice[data-choice-id="{data["support"]["id"]}"]').count()==0
        page.locator('#contest-loadout-owned').uncheck();select_choice(data['support'])
        page.locator('#contest-loadout-owned').check();expect(page.locator('.contest-loadout-footer .primary')).to_be_disabled()
        page.locator('#contest-loadout-owned').uncheck();select_choice(data['support'])
        expect(page.locator(f'.contest-loadout-choice[data-choice-id="{data["support"]["id"]}"]')).to_have_attribute('data-support-card-id',data['support']['supportCardId'])
        apply();assert main.locator(f'[data-config-id="{data["support"]["id"]}"]').count()==1
        page.locator('[data-customize-memory="1"]').click();assert sub.locator('[data-edit-card]').count()==6
        edit_card(1,0)
        assert all(value==base['characterId'] for value in page.locator('.contest-loadout-choice[data-source="idol"]').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.owner)'))
        assert page.locator(f'.contest-loadout-choice[data-choice-id="{data["exclusive"]["id"]}"]').count()==0
        page.locator('#contest-loadout-owned').uncheck();select_choice(data['exclusive']);apply();assert sub.locator(f'[data-config-id="{data["exclusive"]["id"]}"]').count()==1
        expect(sub.locator('.season-original-card .season-replacement-badge')).to_have_text('替换')
        edit_card(1,1);assert page.locator('.contest-loadout-choice[data-source="support"]').count()>0;cancel()
        edit_card(1,3);assert page.locator('.contest-loadout-choice[data-source="idol"], .contest-loadout-choice[data-source="support"]').count()==0;cancel()
        page.locator('[data-add-item]').click();expect(page.locator('.contest-loadout-footer .primary')).to_be_disabled()
        assert page.locator('#contest-loadout-search, .contest-loadout-filters select').count()==0
        assert page.locator('.contest-loadout-filters [role="radiogroup"]').count()==3
        for rarity in page.locator('#contest-loadout-rarity button').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.value).filter(Boolean)'):
            page.locator(f'#contest-loadout-rarity [data-value="{rarity}"]').click()
            assert page.evaluate('''async rarity=>{
              const {contestCustomizationCatalog}=await import('./domain/catalog.mjs');const items=contestCustomizationCatalog().items;
              const nodes=[...document.querySelectorAll('.contest-loadout-choice')];return nodes.length>0&&nodes.every(node=>items.find(item=>item.id===node.dataset.choiceId).metadata.rarity===rarity);
            }''',rarity)
        page.locator('#contest-loadout-rarity [data-value=""]').click()
        assert page.locator('.contest-loadout-choice:not([data-source="support"])').count()==0
        select_choice(data['items'][3]);apply()
        assert page.locator('[data-add-item]').count()==0
        assert page.locator('.season-team-items [data-config-id]').count()==4
        expect(page.locator('[data-edit-item="3"]')).to_have_text('还原')
        assert page.locator('[data-remove-item]').count()==0
        page.locator('[data-edit-item="3"]').click();assert page.locator('[data-add-item]').count()==1
        page.locator('[data-edit-item="1"]').click();assert page.locator('.contest-loadout-choice:not([data-source="support"])').count()==0
        select_choice(data['items'][2]);apply()
        assert page.locator(f'.season-team-items [data-config-id="{data["items"][2]["id"]}"]').count()==1
        expect(page.locator('.season-item-slot[data-item-slot="1"] .season-replacement-badge')).to_have_text('替换')
        for wrapper in [main.locator('.season-config-slot:has(.season-original-card)').first,sub.locator('.season-memory-slot'),page.locator('.season-item-slot[data-item-slot="1"]')]:
            assert wrapper.evaluate('e=>{const before=e.querySelector(".season-original-card").getBoundingClientRect(),after=e.querySelector(".season-card-replacement").getBoundingClientRect();return after.top>=before.bottom}'), '替换图没有显示在原图下方'
            assert wrapper.locator('.season-original-card button').first.evaluate('e=>Number(getComputedStyle(e).opacity)<1')

        expect(main.locator('[data-edit-card="2"]')).to_have_text('还原')
        main.locator('[data-edit-card="2"]').click()
        expect(main.locator('[data-edit-card="2"]')).to_have_text('槽位 3')
        assert main.locator(f'[data-config-id="{data["cards"][2]["id"]}"]').count()==1
        assert main.locator(f'[data-config-id="{data["support"]["id"]}"]').count()==1
        expect(page.locator('[data-edit-item="1"]')).to_have_text('还原')
        page.locator('[data-edit-item="1"]').click()
        expect(page.locator('[data-edit-item="1"]')).to_have_text('替换')
        assert page.locator(f'.season-team-items [data-config-id="{data["items"][0]["id"]}"]').count()==1
        assert sub.locator(f'[data-config-id="{data["exclusive"]["id"]}"]').count()==1
        expect(page.locator('.season-board-stat[data-attribute="vocal"] > strong')).to_have_text('1580')
        main.locator('.season-memory-reset').click();assert main.locator(f'[data-config-id="{data["cards"][2]["id"]}"]').count()==1
        assert page.locator(f'.season-team-items [data-config-id="{data["items"][0]["id"]}"]').count()==1
        sub.locator('.season-memory-reset').click();expect(sub.locator('.season-memory-slot-pick')).to_have_attribute('data-config-id',data['cards'][0]['id'])
        for width in [390,320]:
            page.set_viewport_size({'width':width,'height':950});assert page.locator('#season-simulation-page').evaluate('e=>e.scrollWidth<=e.clientWidth')
            edit_card(0,2);assert page.locator('#contest-loadout-editor').evaluate('e=>e.scrollWidth<=e.clientWidth');cancel()
        page.locator('[data-tab="memories"]').click();page.locator('#season-simulation-open').click();select_season(page,'contest:pvp_rate_config-53');page.locator(f'[data-stage-id="{data["stage"]}"]').click();choose_memory(0)
        assert page.locator(f'[data-memory-index="0"] [data-config-id="{data["cards"][2]["id"]}"]').count()==1
        assert page.locator('[data-customize-memory="0"]').get_attribute('aria-pressed')=='false'
        assert not errors,errors;assert not uploads,uploads;browser.close()
    print('槽位自定义：计划及来源权限、未持有专属、强化勾选与浮层附魔勾选、未持有支援、额外 P 道具三槽容量、原图淡化与替换标记、取消还原、原回忆隔离与窄屏均通过；无数据上传。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8080/');args=parser.parse_args();check(args.url)
