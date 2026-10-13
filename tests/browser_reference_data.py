"""通过实际内容加载入口核对补充资料和玩家规则，不读取真实账号。"""
from playwright.sync_api import sync_playwright,expect

with sync_playwright() as p:
    browser=p.chromium.launch();page=browser.new_page();errors=[];uploads=[]
    page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
    page.goto('http://127.0.0.1:18765/',wait_until='networkidle')
    result=page.evaluate('''async()=>{
      const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('selectionMemories');
      const {contentManager}=await import('./application/content-manager.mjs');const catalog=await contentManager.take('catalog'),progression=await contentManager.take('progression');
      const {characterInfo,skinSortTimes}=await import('./domain/catalog.mjs'),{hifStarRules,contestCostRules}=await import('./domain/community-rules.mjs'),{selectionStarPotential}=await import('./domain/selection-memories.mjs'),{contestCardCost}=await import('./domain/contest-card-cost.mjs');
      const estimate=selectionStarPotential({star:810,produceItems:[{id:hifStarRules.item.id,triggerCount:16,reactionCount:16}]});
      return {color:characterInfo('hski').color,expectedColor:catalog.catalogMetadata.characterColors.hski,skinDates:[...skinSortTimes(catalog.idols.skins).values()].filter(row=>row.source!=='catalog').length,hif:estimate.final,cap:hifStarRules.finalCap,cost:contestCardCost({rarity:'ProduceCardRarity_Ssr',upgradeCount:1,definition:{unlockProducerLevel:3}}),expectedCost:progression.communityRules.contestCosts.rarities.SSR.upgraded,classification:contestCostRules.classification};
    }''')
    assert result['color']==result['expectedColor'] and result['skinDates']==11
    assert result['hif']==result['cap']==1335 and result['cost']==result['expectedCost']==204 and result['classification']=='player-inferred'
    page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab="selectionMemories"]').click();expect(page.locator('.selection-star').first).to_be_visible(timeout=60000)
    assert not errors,errors;assert not uploads,uploads;browser.close()
print('实际内容入口：印象色、11 条补充日期、HIF 上限、容量费用和选拔页面显示通过。')
