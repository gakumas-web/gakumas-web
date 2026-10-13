"""用合成库存验证额外 P 道具名额、降级清理和自选添加入口。"""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import fixtures,ROOT


def check(url):
    with sync_playwright() as p,TemporaryDirectory(prefix='item-limits-',dir=ROOT/'local') as tmp:
        browser=p.chromium.launch();page=browser.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#season-simulation-open')).to_be_enabled(timeout=60000);page.locator('#season-simulation-open').click();page.locator('.simulation-mode-tabs [data-mode=optimization]').click();panel=page.locator('#contest-optimization')
        expect(panel.locator('.contest-capacity-ranges>summary')).to_have_text('评级与卡组容量区间、附魔次数和 P 道具个数');expect(panel.locator('.contest-item-limit-table tbody tr')).to_have_text(['SS+ 及以下2 种','SSS 及以上3 种']);expect(panel).not_to_contain_text('第二张不保证继承')
        grade=panel.locator('[data-optimization-grade="0"]');grade.select_option('14');items=[]
        for index in [1,2,3]:
            panel.locator(f'[data-optimization-item="{index}"]').click();choice=page.locator('.optimization-picker [data-choice-id]').first;items.append(choice.get_attribute('data-choice-id'));choice.click()
        assert len(set(items))==3
        fixed=panel.locator('[data-optimization-item="0"]').get_attribute('title');grade.select_option('13');expect(panel.locator('[data-optimization-item="3"]')).to_be_hidden();expect(panel.locator('[data-optimization-item="0"]')).to_have_attribute('title',fixed)
        grade.select_option('14');expect(panel.locator('[data-optimization-item="3"]')).to_be_visible();expect(panel.locator('[data-optimization-item="3"]')).to_have_attribute('title','额外 P 道具 3')
        panel.locator('[data-optimization-grade="1"]').select_option('9');expect(panel.locator('[data-optimization-item="3"]')).to_be_visible()
        panel.locator('[data-slot="0"] .season-memory-slot-pick').click();exclusive=page.locator('.optimization-picker [aria-pressed=true]').get_attribute('data-choice-id');page.locator('.optimization-picker').get_by_role('button',name='关闭',exact=True).click()
        setup=page.evaluate('''async id=>{const c=await import('./domain/catalog.mjs'),data=await(await fetch('./resources/preview-account.json')).json(),capture=data.documents.find(doc=>doc.idolCards),choice=c.contestCustomizationCatalog().cards.find(card=>card.id===id),held=capture.idolCards.find(card=>card.idolCardId===choice.idolCardId);return {held,characterId:choice.metadata.ownerCharacterId,planType:({Plan1:2,Plan2:3,Plan3:4})[choice.metadata.plan],fixed:c.progressionInfo('idol',held).changes.find(row=>row.beforeItem).beforeItem};}''',exclusive)
        docs=fixtures();capture=docs['capture'];memory=capture['memories'][0];memory.update(characterId=setup['characterId'],idolCardId=setup['held']['idolCardId'],grade=13,planType=setup['planType'],produceCard={'id':exclusive,'upgradeCount':0,'customizes':[]},examBattleProduceCards=[{'id':exclusive,'upgradeCount':0,'customizes':[]}],examBattleProduceItemIds=[setup['fixed'],*items[:2]]);capture['memories']=[memory];capture['count']=1;capture['idolCards']=[setup['held']]
        folder=Path(tmp)/'account'
        def import_fixture():
            for name,data in docs.items():
                file=folder/name/'snapshot.json';file.parent.mkdir(parents=True,exist_ok=True);file.write_text(json.dumps(data))
            page.locator('#account-directory-files').set_input_files(str(folder));expect(page.locator('#season-simulation-open')).to_be_enabled(timeout=60000);page.locator('#season-simulation-open').click();page.locator('.simulation-mode-tabs [data-mode=selected]').click();page.locator('.simulation-selected-panel [data-slot="0"] .season-memory-slot-pick').click();page.locator('#contest-memory-picker [data-memory-key]').first.click();page.locator('[data-customize-memory="0"]').click()
        import_fixture();expect(page.locator('[data-add-item]')).to_have_count(0)
        memory['grade']=14;import_fixture();expect(page.locator('[data-add-item]')).to_be_visible()
        assert not errors,errors;browser.close()
    print('P 道具名额表、主评级 2/3 槽切换、降级清理、副评级独立、专属不占名额及自选添加入口，通过。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
