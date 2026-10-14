"""用实际编组界面与 Worker 验证历史、手动保存、恢复和账号隔离。"""
from browser_artifacts import artifact_path
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import fixtures,ROOT
from browser_simulation_helpers import select_season


def check(url):
    request=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['customized']
    with TemporaryDirectory(dir=ROOT/'local',prefix='saved-loadout-') as temporary,sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda value:uploads.append(value.url) if value.post_data else None)
        page.goto(url,wait_until='networkidle')
        identity=page.evaluate('''async id=>{const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');const {idolInfo}=await import('./domain/catalog.mjs');return idolInfo({idolCardId:id})}''',request['cards'][0]['record']['definition']['originIdolCardId'])
        docs=fixtures();base=docs['capture']['memories'][0];memories=[]
        for index in range(2):
            memory=copy.deepcopy(base);memory.update(userMemoryId=f'synthetic-saved-{index}',idolCardId=request['cards'][0]['record']['definition']['originIdolCardId'],characterId=identity['characterId'],planType=2,**request['params'],produceCard=request['cards'][0]['reference'],examBattleProduceCards=[entry['reference'] for entry in request['cards']],examBattleProduceItemIds=[entry['id'] for entry in request['items']]);memories.append(memory)
        docs['capture'].update(memories=memories,count=2);docs['capture']['idolCards'][0]['idolCardId']=memories[0]['idolCardId']
        def import_docs(documents,folder):
            for name,document in documents.items():
                file=folder/name/'snapshot.json';file.parent.mkdir(parents=True);file.write_text(json.dumps(document))
            page.locator('#account-directory-files').set_input_files(str(folder));expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        import_docs(docs,Path(temporary)/'account');profile=page.locator('#profile').input_value()
        page.locator('[data-tab="seasonSimulation"]').click();page.get_by_role('tab',name='自选编组模拟',exact=True).click();select_season(page,'contest:pvp_rate_config-53');page.locator('.season-stage-tab').first.click();page.get_by_role('tab',name='自选编组模拟',exact=True).click();expect(page.locator('.season-loadout-save')).to_be_disabled()
        for index in range(2):
            page.locator('.season-memory-slot-pick').nth(index).click();page.locator('.contest-memory-choose:enabled').first.click()
        expect(page.locator('.season-loadout-save')).to_be_enabled()
        # 通过实际编辑器修改普通卡，确认恢复时仍有正确的还原依据。
        page.locator('[data-customize-memory="0"]').click();page.locator('[data-memory-index="0"] [data-edit-card="2"]').click()
        original=memories[0]['examBattleProduceCards'][2]['id'];page.locator('#contest-loadout-owned').uncheck()
        page.locator(f'.contest-loadout-choice[data-source="common"]:not([data-choice-id="{original}"]) > input').first.check();page.locator('.contest-loadout-footer .primary').click()
        def board():
            return page.locator('.season-memory-board [data-config-id]').evaluate_all('(nodes)=>nodes.map(e=>[e.dataset.configId,e.dataset.retained,e.textContent])')
        before=board();page.locator('.season-loadout-save').click();dialog=page.locator('#contest-loadout-library');expect(dialog).to_be_visible();assert page.locator('dialog:modal').count()==1
        def save_name(name):
            dialog.locator('#loadout-library-name').fill(name);dialog.locator('.loadout-library-name-form').get_by_role('button',name='保存',exact=True).click();expect(dialog.locator('.loadout-library-status')).to_have_text('编组已保存。')
        save_name('测试编组');expect(dialog.locator('.loadout-library-entry')).to_have_count(1)
        entry=dialog.locator('.loadout-library-entry');entry.locator('.loadout-library-keep').click();save_name('重命名编组');expect(entry.locator('strong')).to_have_text('重命名编组')
        for width in [1280,375,320]:
            page.set_viewport_size({'width':width,'height':1000});assert dialog.evaluate('e=>e.scrollWidth<=e.clientWidth');page.screenshot(path=artifact_path(f'local/ui-visual-refinement/saved-loadouts-{width}.png'),full_page=True)
        dialog.locator('.dialog-head button').click();page.reload(wait_until='networkidle');page.locator('[data-tab="seasonSimulation"]').click();page.get_by_role('tab',name='自选编组模拟',exact=True).click();expect(page.locator('.season-loadout-library-open')).to_be_visible(timeout=60000)
        page.locator('.season-loadout-library-open').click();dialog.locator('.loadout-library-tabs').get_by_role('button',name='已保存',exact=True).click();expect(dialog.locator('.loadout-library-entry')).to_have_count(1);dialog.locator('.loadout-library-load').click();expect(dialog).not_to_be_visible();assert board()==before
        page.locator('[data-customize-memory="0"]').click();expect(page.locator('[data-memory-index="0"] [data-edit-card="2"]')).to_have_text('还原')
        # 一次真实模拟完成后，无需点击保存即可在历史中找到编组。
        page.locator('#contest-simulation-runs').fill('100');page.locator('.season-simulate').click();expect(page.locator('.simulation-save-status')).to_have_text('已保存到此舞台的模拟历史。',timeout=120000)
        page.locator('.season-loadout-library-open').click();dialog.locator('.loadout-library-tabs').get_by_role('button',name='历史',exact=True).click();expect(dialog.locator('.loadout-library-entry')).to_have_count(1);dialog.locator('.loadout-library-keep').click();save_name('历史另存');expect(dialog.locator('.loadout-library-entry')).to_have_count(2)
        dialog.locator('.loadout-library-tabs').get_by_role('button',name='历史',exact=True).click();dialog.locator('.loadout-library-delete').click();dialog.locator('.loadout-library-delete').click();expect(dialog.locator('.loadout-library-entry')).to_have_count(0)
        dialog.locator('.loadout-library-tabs').get_by_role('button',name='已保存',exact=True).click();expect(dialog.locator('.loadout-library-entry')).to_have_count(2);dialog.locator('.dialog-head button').click()
        # 活动舞台的手动倍率随编组保存；载入时切换到记录中的舞台。
        select_season(page,'event:1:1');page.locator('.season-stage-tab').first.click();page.get_by_role('tab',name='自选编组模拟',exact=True).click()
        for index in range(2):
            page.locator('.season-memory-slot-pick').nth(index).click();page.locator('.contest-memory-choose:enabled').first.click()
        page.locator('#season-manual-vocal').fill('123');page.locator('#season-manual-dance').fill('234');page.locator('#season-manual-visual').fill('345');page.locator('.season-loadout-save').click();save_name('活动编组');dialog.locator('.dialog-head button').click()
        select_season(page,'contest:pvp_rate_config-53');page.locator('.season-loadout-library-open').click();dialog.locator('.loadout-library-tabs').get_by_role('button',name='已保存',exact=True).click();dialog.locator('.loadout-library-entry').filter(has_text='活动编组').locator('.loadout-library-load').click();expect(page.locator('#season-select')).to_have_attribute('data-value','event:1:1');expect(page.locator('#season-manual-vocal')).to_have_value('123');expect(page.locator('#season-manual-dance')).to_have_value('234');expect(page.locator('#season-manual-visual')).to_have_value('345')
        other=copy.deepcopy(docs)
        for document in other.values():document['publicUserId']='synthetic-loadout-other-account'
        import_docs(other,Path(temporary)/'other');page.locator('[data-tab="seasonSimulation"]').click();page.get_by_role('tab',name='自选编组模拟',exact=True).click();page.locator('.season-loadout-library-open').click();dialog.locator('.loadout-library-tabs').get_by_role('button',name='已保存',exact=True).click();expect(dialog.locator('.loadout-library-entry')).to_have_count(0);dialog.locator('.dialog-head button').click()
        page.locator('#profile').select_option(profile);page.locator('[data-tab="seasonSimulation"]').click();page.get_by_role('tab',name='自选编组模拟',exact=True).click();page.locator('.season-loadout-library-open').click();dialog.locator('.loadout-library-tabs').get_by_role('button',name='已保存',exact=True).click();expect(dialog.locator('.loadout-library-entry')).to_have_count(3)
        saved=dialog.locator('.loadout-library-entry').filter(has_text='重命名编组');saved.locator('.loadout-library-delete').click();saved.locator('.loadout-library-delete').click();expect(dialog.locator('.loadout-library-entry')).to_have_count(2)
        assert not errors,errors;assert not uploads,uploads;browser.close()
    print('手动保存、重命名、刷新恢复、自定义还原、真实模拟自动历史、历史另存、活动倍率、删除隔离、账号切换和窄屏检查通过。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
