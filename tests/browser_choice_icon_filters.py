"""通过真实账号导入验证五类选择列表的图标筛选、候选范围和多选回执。"""
from browser_artifacts import artifact_path
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import fixtures,ROOT


def check(url='http://127.0.0.1:8080/'):
    with TemporaryDirectory(dir=ROOT/'local',prefix='choice-icons-') as temporary,sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle')
        data=page.evaluate('''async()=>{
          const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');
          const {contestCustomizationCatalog}=await import('./domain/catalog.mjs');const catalog=contestCustomizationCatalog();
          const cards=['SSR','SR','R','N'].map(rarity=>catalog.cards.find(value=>value.metadata.source==='common'&&value.metadata.plan==='Plan1'&&value.metadata.rarity===rarity));
          cards.push(catalog.cards.find(value=>value.metadata.source==='common'&&value.metadata.plan==='Plan2'&&value.metadata.rarity==='SR'));
          const items=['SSR','SR'].map(rarity=>catalog.items.find(value=>value.metadata.source==='support'&&value.metadata.rarity===rarity));
          return {cards,items};
        }''')
        docs=fixtures();base=docs['capture']['memories'][0];rows=[]
        for index,card in enumerate(data['cards']):
            row=copy.deepcopy(base);row.update(userMemoryId=f'icons-{index}',produceCard=card['versions'][0],examBattleProduceCards=[card['versions'][0]],examBattleProduceItemIds=[item['id'] for item in data['items']]);rows.append(row)
        docs['capture'].update(memories=rows,count=len(rows))
        docs['selection']['selectionMemories'][0].update(produceCards=[dict(card['versions'][0],fromMemory=False) for card in data['cards']],produceItems=[{'id':item['id'],'triggerCount':0,'reactionCount':0} for item in data['items']])
        for name,doc in docs.items():
            target=Path(temporary)/'account'/name/'snapshot.json';target.parent.mkdir(parents=True);target.write_text(json.dumps(doc))
        page.locator('#account-directory-files').set_input_files(str(Path(temporary)/'account'));expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        if page.locator('#filter-toggle').get_attribute('aria-expanded')=='false':page.locator('#filter-toggle').click()
        for tab,opener,kind,selected_list in [('memories','inheritance-skill-open','inheritance','inheritance-skill-list'),('memories','memory-skill-open','card','memory-skill-list'),('memories','memory-item-open','item','memory-item-list'),('selectionMemories','selection-skill-open','card','selection-skill-list'),('selectionMemories','selection-item-open','item','selection-item-list')]:
            page.locator(f'[data-tab="{tab}"]').click()
            if page.locator('#filter-toggle').get_attribute('aria-expanded')=='false':page.locator('#filter-toggle').click()
            page.locator('#'+opener).click();expect(page.locator('#selection-picker')).to_be_visible()
            assert page.locator('.selection-choice-icon-filters [role="radiogroup"]').count()==3
            assert page.locator('.selection-picker-filters select:visible, #contest-loadout-enhanced, #contest-loadout-owned').count()==0
            if kind=='card':
                expect(page.locator('#selection-picker-show-n')).not_to_be_checked();expect(page.locator('#selection-picker-rarity-icons [data-value="N"]')).not_to_be_visible()
                page.locator('#selection-picker-show-n').check();page.locator('#selection-picker-rarity-icons [data-value="N"]').click()
                assert page.locator('#selection-picker-list .selection-filter-choice').count()==1
                page.locator('#selection-picker-show-n').uncheck();expect(page.locator('#selection-picker-rarity-icons [data-value=""]')).to_have_attribute('aria-checked','true')
            else:assert page.locator('#selection-picker-show-n').count()==0
            if kind=='inheritance':
                page.locator('#selection-picker-plan-icons [data-value="Plan2"]').click()
                keys=page.locator('#selection-picker-list input').evaluate_all('(nodes)=>nodes.map(e=>e.value)')
                assert keys and all(json.loads(key)[0]==data['cards'][-1]['id'] for key in keys)
                metadata=data['cards'][-1]['metadata'];flow=metadata['flows'][0] if metadata['flows'] else 'unclassified'
                page.locator(f'#selection-picker-flow-icons [data-value="{flow}"]').click()
                assert page.locator('#selection-picker-list input').count()==len(keys)
                page.locator('#selection-picker-plan-icons [data-value=""]').click()
                page.locator('#selection-picker-flow-icons [data-value=""]').click()
            page.locator('#selection-picker-rarity-icons [data-value="SR"]').click()
            available=page.locator('#selection-picker-list .selection-filter-choice')
            keys=available.evaluate_all('(nodes)=>nodes.map(e=>e.dataset.value)');assert keys
            records=data['items'] if kind=='item' else data['cards']
            expected={record['id'] for record in records if record['metadata']['rarity']=='SR'}
            assert all((json.loads(key)[0] if kind!='item' else key) in expected for key in keys)
            # 通过正式候选范围确认已选条件，并检查重新打开后依旧勾选。
            available.first.locator('input').check()
            if page.locator('.support-reward-popover:popover-open').count():page.keyboard.press('Escape')
            page.locator('#selection-picker-confirm').click();expect(page.locator('#'+selected_list+' button')).to_have_count(1)
            page.locator('#'+opener).click();expect(page.locator('#selection-picker-list input:checked')).to_have_count(1)
            for width in [390,320]:
                page.set_viewport_size({'width':width,'height':1000});assert page.locator('#selection-picker').evaluate('e=>e.scrollWidth<=e.clientWidth')
                if width==390:
                    page.wait_for_function('''()=>[...document.querySelectorAll('.selection-choice-icon-filters img')].every(image=>image.complete&&image.naturalWidth>0)''')
                    page.screenshot(path=artifact_path(str(ROOT/f'local/season-simulation/shared-choice-{opener}-390.png')))
            page.set_viewport_size({'width':1280,'height':1000});page.locator('#selection-picker-clear').click();page.locator('#selection-picker-confirm').click()
        assert not errors,errors;assert not uploads,uploads;browser.close()
    print('五类技能／道具选择：图标筛选、实际候选范围、N 显示、多选确认与清空、重开状态、窄屏及无上传检查通过。')

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8080/');check(parser.parse_args().url)
