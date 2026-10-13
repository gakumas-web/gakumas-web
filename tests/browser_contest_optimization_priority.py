"""通过公开合成预览验证默认稀有度／发行顺序、第二专属配对和手选保留。"""
from playwright.sync_api import sync_playwright,expect


def check(url):
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#season-simulation-open')).to_be_enabled(timeout=60000);page.locator('#season-simulation-open').click();expect(page.locator('.simulation-mode-tabs')).to_be_visible(timeout=60000)
        setup=page.evaluate('''async()=>{
          const {contentManager}=await import('./application/content-manager.mjs'),c=await contentManager.take('catalog'),data=await(await fetch('./resources/preview-account.json')).json(),owned=new Set(data.documents.find(doc=>doc.idolCards).idolCards.map(card=>card.idolCardId)),skins=new Map(c.idols.skins.map(skin=>[skin.id,skin])),ranks={IdolCardRarity_Ssr:3,IdolCardRarity_Sr:2,IdolCardRarity_R:1},api=await import('./domain/catalog.mjs');
          const candidates=c.idols.cards.filter(card=>owned.has(card.id)),time=card=>Number(skins.get(card.originalIdolCardSkinId)?.viewStartTime)||c.catalogMetadata.skinReleaseTimes[card.originalIdolCardSkinId]?.time||0;
          const paired=c.idolCardRelations.find(row=>row.secondProduceCardId&&owned.has(row.id)),target=candidates.find(card=>card.id===paired.id),stage=api.contestCatalog().choices.find(row=>row.planType===target.planType&&document.querySelector(`[data-stage-id="${row.id}"]`));
          const eligible=candidates.filter(card=>card.characterId===target.characterId&&card.planType===target.planType).sort((a,b)=>ranks[b.rarity]-ranks[a.rarity]||time(b)-time(a)||a.id.localeCompare(b.id)),best=c.idolCardRelations.find(row=>row.id===eligible[0].id);
          return {stage:stage.id,character:target.characterId,pair:paired,best};
        }''')
        page.locator(f'.season-stage-tab[data-stage-id="{setup["stage"]}"]').click();page.locator('.simulation-mode-tabs [data-mode=optimization]').click();panel=page.locator('#contest-optimization');panel.locator(f'.recommendation-character[data-character-id="{setup["character"]}"]').click()
        def selected(index):
            panel.locator(f'[data-slot="{index}"] .season-memory-slot-pick').click();dialog=page.locator('.optimization-picker');value=dialog.locator('[data-choice-id][aria-checked=true]').get_attribute('data-choice-id');dialog.get_by_role('button',name='取消',exact=True).click();return value
        assert selected(0)==setup['best']['produceCardId']
        assert selected(1)==(setup['best']['secondProduceCardId'] or setup['best']['produceCardId'])
        # 更换主卡时保留合法副卡；仅在副卡为空时使用明确的第二专属关系。
        panel.locator('[data-slot="0"] .season-memory-slot-pick').click();page.locator(f'.optimization-picker [data-choice-id="{setup["pair"]["produceCardId"]}"]').click();page.locator('.optimization-picker-confirm').click()
        assert selected(1)==(setup['best']['secondProduceCardId'] or setup['best']['produceCardId'])
        panel.locator('.optimization-exclusive-remove').nth(1).click()
        panel.locator('[data-slot="0"] .season-memory-slot-pick').click();page.locator('.optimization-picker-confirm').click()
        assert selected(1)==setup['pair']['secondProduceCardId']
        panel.locator('[data-slot="1"] .season-memory-slot-pick').click();page.locator(f'.optimization-picker [data-choice-id="{setup["pair"]["produceCardId"]}"]').click();page.locator('.optimization-picker-confirm').click()
        page.locator('#language').select_option('ja');expect(page.locator('#contest-optimization')).to_be_visible();page.locator('#language').select_option('zh-CN');expect(page.locator('#contest-optimization')).to_be_visible()
        assert selected(1)==setup['pair']['produceCardId']
        panel.locator('.recommendation-character[aria-checked=false]').first.click()
        current_character=panel.locator('.recommendation-character[aria-checked=true]').get_attribute('data-character-id');sub_id=selected(1)
        owner=page.evaluate('''async id=>{const c=await import('./domain/catalog.mjs');return c.contestCustomizationCatalog().cards.find(value=>value.id===id).metadata.ownerCharacterId;}''',sub_id)
        assert owner==current_character
        assert not errors,errors;browser.close()
    print('真实默认稀有度／发行排序、第一专属优先、主卡切换保留合法副卡、空槽自动第二专属、角色不兼容补选、语言切换保留手选，通过。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
