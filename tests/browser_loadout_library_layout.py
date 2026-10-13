"""用合成编组验证组合筛选、弹窗排版与完整技能卡状态。"""
import json
from playwright.sync_api import sync_playwright,expect
from browser_static import ROOT


def check():
    request=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['customized']
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('http://127.0.0.1:18765/',wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab="seasonSimulation"]').click();expect(page.locator('.season-loadout-library-open')).to_be_visible(timeout=60000)
        # 仅为列表准备独立记录，筛选和预览均执行正式界面代码。
        page.evaluate('''async request=>{
          const {contestCatalog}=await import('./domain/catalog.mjs');const {createSavedLoadout,saveSimulationLoadout}=await import('./application/contest-saved-loadouts.mjs');
          const profile=document.querySelector('#profile').value;
          for(const [season,characterId,name] of [[53,'hski','咲季编组'],[52,'hski','咲季旧舞台'],[53,'ttmr','手毬编组']]){
            const stage=contestCatalog().choices.find(stage=>stage.id===`contest:pvp_rate_config-${season}:0`),memory={characterId,planType:2,...request.params,produceCard:request.cards[0].reference,examBattleProduceCards:request.cards.map(card=>card.reference),examBattleProduceItemIds:request.items.map(item=>item.id)};
            await saveSimulationLoadout(profile,createSavedLoadout({stage,loadout:{memories:[memory,memory],manual:{}}},name));
          }
        }''',request)
        page.locator('.season-loadout-library-open').click();dialog=page.locator('#contest-loadout-library');dialog.locator('.loadout-library-tabs').get_by_role('button',name='已保存',exact=True).click();expect(dialog.locator('.loadout-library-entry')).to_have_count(3)
        stage=dialog.get_by_role('combobox',name='舞台筛选',exact=True);idol=dialog.get_by_role('combobox',name='偶像筛选',exact=True)
        idol.select_option('hski');expect(dialog.locator('.loadout-library-entry')).to_have_count(2)
        stage.select_option(label='第 53 赛季 · 舞台 1');expect(dialog.locator('.loadout-library-entry')).to_have_count(1);expect(dialog.locator('.loadout-library-entry-identity>strong')).to_have_text('咲季编组')
        idol.select_option('ttmr');expect(dialog.locator('.loadout-library-entry-identity>strong')).to_have_text('手毬编组')
        stage.select_option(label='第 52 赛季 · 舞台 1');expect(dialog.get_by_text('没有符合筛选条件的编组。')).to_be_visible()
        stage.select_option('all');idol.select_option('all');expect(dialog.locator('.loadout-library-entry')).to_have_count(3)
        assert dialog.locator('.loadout-library-preview').evaluate_all('(nodes)=>nodes.every(e=>e.firstElementChild.matches(".loadout-library-items"))')
        count=sum(bool(card['reference']['customizes']) for card in request['cards'])*2*3
        expect(dialog.locator('.loadout-library-cards .selection-custom-count')).to_have_count(count)
        upgraded=sum(card['reference']['upgradeCount']>0 for card in request['cards'])*2*3
        expect(dialog.locator('.loadout-library-cards .memory-skill-hint[data-upgrade="1"]')).to_have_count(upgraded)
        customized=dialog.locator('.loadout-library-cards .support-reward-trigger').filter(has=page.locator('.selection-custom-count')).first
        customized.click();popover=page.locator('.support-reward-popover:popover-open');expect(popover).to_be_visible();assert '附魔' in popover.inner_text();page.keyboard.press('Escape')
        for width in [1280,375,320]:
            page.set_viewport_size({'width':width,'height':1000});assert dialog.evaluate('e=>e.scrollWidth<=e.clientWidth')
            assert dialog.locator('.loadout-library-cards>.support-reward-hint>.support-reward-trigger').evaluate_all("""nodes=>nodes.every(button=>{
                const bounds=button.getBoundingClientRect(),scale=bounds.width/64;
                const icons=[...button.querySelectorAll('.support-skill-symbols img,.support-skill-cost,.support-skill-block,.support-skill-enhanced,.selection-custom-count')];
                return icons.every(icon=>{const r=icon.getBoundingClientRect();return r.width<=17*scale+.1&&r.height<=17*scale+.1&&r.left>=bounds.left-.1&&r.right<=bounds.right+.1&&r.top>=bounds.top-.1&&r.bottom<=bounds.bottom+.1});
            })""")
            assert dialog.locator('.dialog-head').evaluate('(e)=>{const h=e.querySelector("h2").getBoundingClientRect(),p=e.querySelector("p").getBoundingClientRect();return p.top>=h.bottom&&p.bottom<=e.getBoundingClientRect().bottom}')
            if width==1280:
                assert dialog.locator('.loadout-library-toolbar').evaluate('(e)=>{const t=e.querySelector(".loadout-library-tabs").getBoundingClientRect(),f=e.querySelector(".loadout-library-filters").getBoundingClientRect();return f.left>=t.right&&Math.abs(f.top-t.top)<10}')
                assert dialog.locator('.loadout-library-entry-identity').evaluate_all('(nodes)=>nodes.every(e=>{const n=e.querySelector("strong").getBoundingClientRect(),s=e.querySelector("p").getBoundingClientRect();return n.left>s.right&&Math.abs(s.top-n.top)<5})')
            dialog.screenshot(path=f'local/ui-visual-refinement/loadout-library-layout-{width}.png')
        assert not errors,errors;browser.close()
    print('舞台与偶像组合筛选、标题提示位置、舞台名称同行、道具置顶、强化附魔与详情浮层、桌面及窄屏验证通过。')


if __name__=='__main__':check()
