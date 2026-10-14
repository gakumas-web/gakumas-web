"""用合成账号经过真实入口验证遗传搜索、约束、取消及结果交接。"""
from browser_artifacts import artifact_path

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import fixtures,ROOT,ACCOUNT
from browser_simulation_helpers import select_season


def check(url):
    request=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['requests'][0]
    with TemporaryDirectory(prefix='optimization-account-',dir=ROOT/'local') as tmp,sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        # 旁观正式 Worker 消息，不改写搜索、评分或返回结果。
        page.add_init_script('''Object.defineProperty(navigator,'hardwareConcurrency',{value:8});window.optimizationMessages=[];window.optimizationPrivate=false;window.activeOptimizationWorkers=0;const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);window.activeOptimizationWorkers++;}postMessage(value,...args){window.optimizationMessages.push({mode:value.mode,stage:value.request?.stage?.id,baseline:value.request?.baseline,defaultCards:value.request?.defaultCards?.map(card=>card.reference.id),cards:value.request?.cards?.map(card=>card.reference.id)});if(/publicUserId|userMemoryId|synthetic-static-private-account/.test(JSON.stringify(value)))window.optimizationPrivate=true;super.postMessage(value,...args);}terminate(){if(!this.ended){this.ended=true;window.activeOptimizationWorkers--;}super.terminate();}};''')
        page.goto(url,wait_until='networkidle')
        setup=page.evaluate('''async request=>{
          const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');const c=await import('./domain/catalog.mjs');
          const id=request.cards[0].record.definition.originIdolCardId,stage=c.contestCatalog().choices.find(row=>row.preset?.id===request.stage.preset.id);
          let low=0,high=1000000000;while(low<high){const mid=Math.floor((low+high)/2);if(c.accountProducerLevel(mid)>=80)high=mid;else low=mid+1;}
          const support=c.contestCustomizationCatalog().cards.find(choice=>choice.metadata.source==='support'&&['Plan1','Common'].includes(choice.metadata.plan)&&c.contestOwnedSupportRewards([{supportCardId:choice.supportCardId,level:60}]).cards.has(choice.id));
          return {idolCardId:id,characterId:c.idolInfo({idolCardId:id}).characterId,producerExp:low,stageId:stage.id,season:'contest:'+stage.season.id,supportCardId:support?.supportCardId};
        }''',request)
        docs=fixtures();capture=docs['capture'];memory=capture['memories'][0];memory.update(characterId=setup['characterId'],idolCardId=setup['idolCardId'],grade=15,planType=2,**request['params'],produceCard=request['cards'][0]['reference'],examBattleProduceCards=[entry['reference'] for entry in request['cards']],examBattleProduceItemIds=[entry['id'] for entry in request['items']])
        capture['idolCards']=[dict(capture['idolCards'][0],idolCardId=setup['idolCardId'],levelLimitRank=3,potentialRank=2)];capture['producerExp']=setup['producerExp']
        capture['supportCards']=[{'supportCardId':setup['supportCardId'],'level':60,'levelLimitRank':4,'stockQuantity':0,'createdTime':0}] if setup['supportCardId'] else []
        docs['selection']['selectionMemories'][0].update(characterId=setup['characterId'],idolCardId=setup['idolCardId'])
        folder=Path(tmp)/'account'
        for name,data in docs.items():
            file=folder/name/'snapshot.json';file.parent.mkdir(parents=True);file.write_text(json.dumps(data))
        page.locator('#account-directory-files').set_input_files(str(folder));expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('#season-simulation-open').click();select_season(page,setup['season']);page.locator(f'.season-stage-tab[data-stage-id="{setup["stageId"]}"]').click()
        tabs=page.locator('.simulation-mode-tabs');assert tabs.locator('button').evaluate_all('nodes=>nodes.map(node=>node.dataset.mode)')==['recommended','optimization','selected','history']
        tabs.locator('[data-mode=optimization]').click();panel=page.locator('#contest-optimization');expect(panel).to_be_visible();expect(panel.locator('.optimization-start')).to_be_enabled()
        for index in [0,1]:
            panel.locator(f'[data-slot="{index}"] .season-memory-slot-pick').click();page.locator(f'.optimization-picker [data-choice-id="{request["cards"][0]["reference"]["id"]}"]').click();page.locator('.optimization-picker-confirm').click()
            panel.locator(f'[data-optimization-grade="{index}"]').select_option('15')
        expect(panel.locator('[data-optimization-attribute]')).to_have_count(4)
        expect(panel.locator('[data-optimization-custom-count],[data-optimization-custom-cards]')).to_have_count(0)
        expect(panel.locator('.recommendation-character-count')).to_have_text('1')
        for key,value in request['params'].items():panel.locator(f'[data-optimization-attribute="{key}"]').fill(str(value))
        expect(panel.locator('[data-optimization-item="0"]')).to_be_enabled();panel.locator('.optimization-advanced>summary').click();expect(panel.locator('#optimization-strength')).to_have_value('standard');assert panel.locator('#optimization-strength option').evaluate_all('nodes=>nodes.map(node=>node.value)')==['standard','deep','custom'];panel.locator('#optimization-strength').select_option('standard');panel.get_by_placeholder('留空时随机',exact=True).fill('12345')
        expect(panel.locator('#optimization-use-baseline,#optimization-rebuild-baseline')).to_have_count(0)
        for width in [1280,375]:
            page.set_viewport_size({'width':width,'height':1000});assert panel.evaluate('element=>element.scrollWidth<=element.clientWidth');panel.screenshot(path=artifact_path(str(ROOT/'local/ui-visual-refinement'/f'optimization-form-{width}.png')))
        page.set_viewport_size({'width':1280,'height':1000});panel.locator('.optimization-start').click();expect(panel.locator('.optimization-stop')).to_be_visible();tabs.locator('[data-mode=selected]').click();assert page.evaluate('activeOptimizationWorkers')>0;tabs.locator('[data-mode=optimization]').click()
        expect(panel.locator('.optimization-entry')).to_have_count(20,timeout=240000)
        assert page.evaluate('activeOptimizationWorkers')==0
        assert page.evaluate('optimizationMessages.some(row=>row.mode==="optimization-validate")')
        assert page.evaluate('optimizationMessages.every(row=>!row.baseline)')
        assert page.evaluate('optimizationMessages.some(row=>row.mode==="session-finish"&&!row.baseline)')
        assert page.evaluate('optimizationMessages.filter(row=>row.mode==="batch-scores").every(row=>row.defaultCards.length>0)')
        assert not page.evaluate('optimizationPrivate')
        expect(panel.locator('.optimization-error')).to_be_empty()
        profile=page.evaluate("async id=>{const {accountProfile}=await import('./domain/account.mjs');return accountProfile(id);}",ACCOUNT)
        # 通过保存后的正式记录核对双回忆约束和 P 道具，不以显示文案代替数据检查。
        panel.locator('.optimization-entry').first.get_by_role('button',name='保存编组',exact=True).click();page.locator('#loadout-library-name').fill('synthetic-optimized');page.locator('.loadout-library-name-form').get_by_role('button',name='保存',exact=True).click();expect(page.locator('.loadout-library-entry')).to_have_count(1)
        stored=page.evaluate('''async profile=>{const {savedSimulationLoadouts}=await import('./application/contest-saved-loadouts.mjs');const {contestSimulationReference,contestCustomizationCatalog,contestCardConversions}=await import('./domain/catalog.mjs');const {contestDeckCost}=await import('./domain/contest-card-cost.mjs');const entries=await savedSimulationLoadouts(profile);return entries[0].loadout.memories.map(memory=>({cards:memory.examBattleProduceCards,cost:contestDeckCost(memory.examBattleProduceCards.map(card=>contestSimulationReference('card',card))).total,items:memory.examBattleProduceItemIds}));}''',profile)
        assert len(stored)==2
        # 推荐展示和保存均复用回忆卡排序，附魔与强化记录随技能一起保留。
        assert page.evaluate('''async profile=>{
          const {savedSimulationLoadouts}=await import('./application/contest-saved-loadouts.mjs'),{sortedMemoryBattleCards}=await import('./domain/memories.mjs'),{loadoutPreview}=await import('./ui/contest-loadout-library.mjs');
          const [entry]=await savedSimulationLoadouts(profile);
          if(!entry.loadout.memories.every(memory=>JSON.stringify(memory.examBattleProduceCards)===JSON.stringify(sortedMemoryBattleCards(memory.examBattleProduceCards))))return false;
          const labels=root=>[...root.querySelectorAll('.loadout-library-cards')].map(row=>[...row.querySelectorAll('[aria-label]')].map(card=>card.getAttribute('aria-label')));
          const actual=labels(document.querySelector('.optimization-entry')),expected=labels(loadoutPreview(entry.loadout));
          return actual.length===2&&actual.every(row=>row.length>=6)&&JSON.stringify(actual)===JSON.stringify(expected);
        }''',profile)
        for memory in stored:
            assert len(memory['cards'])==6 and memory['cards'][0]['id']==request['cards'][0]['reference']['id']
            assert 546<=memory['cost']<=858
            assert sum(sum(custom['customizeCount'] for custom in card['customizes']) for card in memory['cards'])<=8
            assert sum(bool(card['customizes']) for card in memory['cards'])<=3
            assert not memory['cards'][0]['customizes']
        # 合成偶像为才能开花 2：专属道具应自动使用公开资料中的强化版本。
        assert stored[0]['items']==['pitem_00-1-001-1'] and stored[1]['items']==[]
        assert page.evaluate('''async profile=>{const {savedSimulationLoadouts}=await import('./application/contest-saved-loadouts.mjs');const [entry]=await savedSimulationLoadouts(profile);return entry.loadout.memories.every(memory=>{const ids=memory.examBattleProduceCards.map(card=>card.id);return new Set(ids).size===ids.length;});}''',profile)
        totals=page.evaluate('''async profile=>{const {savedSimulationLoadouts}=await import('./application/contest-saved-loadouts.mjs');const {contestMemoryTotals}=await import('./domain/contest-simulation.mjs');const [entry]=await savedSimulationLoadouts(profile);const values=contestMemoryTotals(entry.loadout.memories,{manualMultipliers:true});return Object.fromEntries(['vocal','dance','visual','stamina'].map(key=>[key,values[key]]));}''',profile)
        assert totals==request['params']
        # 固定公开原表系数独立复算，覆盖推荐结果保存的数值与来源标记。
        powers=page.evaluate('''async profile=>{
          const {savedSimulationLoadouts}=await import('./application/contest-saved-loadouts.mjs'),{contestSimulationReference}=await import('./domain/catalog.mjs');
          const [entry]=await savedSimulationLoadouts(profile);
          return entry.loadout.memories.map(memory=>{
            const cards=memory.examBattleProduceCards.reduce((sum,card)=>sum+contestSimulationReference('card',card).record.definition.evaluation,0),items=memory.examBattleProduceItemIds.reduce((sum,id)=>sum+contestSimulationReference('item',id).record.definition.evaluation,0),customs=memory.examBattleProduceCards.flatMap(card=>card.customizes).reduce((sum,value)=>sum+value.customizeCount,0);
            const expected=(memory.vocal+memory.dance+memory.visual)*3+memory.stamina*24+(cards+items)*3+customs*36;
            if(memory.power!==expected||memory.powerSource!=='calculated')throw new Error('推荐编组综合值或计算标记未保存');
            return expected;
          });
        }''',profile)
        page.locator('.contest-loadout-library').get_by_role('button',name='关闭',exact=True).click();panel.locator('.optimization-entry').first.get_by_role('button',name='载入编组至自选模拟',exact=True).click();expect(tabs.locator('[data-mode=selected]')).to_have_attribute('aria-selected','true');expect(page.locator('.season-memory-row[data-memory-index="0"] [data-config-id]')).to_have_count(6)
        expect(page.locator('.season-board-power > span')).to_have_text('综合值合计（计算值）')
        expect(page.locator('.season-board-power > strong')).to_have_text(str(powers[0]+powers[1]//5))
        tabs.locator('[data-mode=optimization]').click();expect(panel.locator('.optimization-entry')).to_have_count(20)
        for width in [1280,375]:
            page.set_viewport_size({'width':width,'height':1000});assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth');panel.locator('.optimization-entry').first.screenshot(path=artifact_path(str(ROOT/'local/ui-visual-refinement'/f'optimization-result-{width}.png')))
        panel.locator('[data-optimization-attribute=vocal]').fill(str(request['params']['vocal']+1));expect(panel.locator('.optimization-stale')).to_be_visible();page.evaluate('optimizationMessages=[]');panel.locator('.optimization-start').click();expect(panel.locator('.optimization-stop')).to_be_visible();page.wait_for_function('()=>optimizationMessages.some(row=>row.mode==="batch-scores")',timeout=60000);panel.locator('.optimization-stop').click();expect(panel.locator('.optimization-stop')).not_to_be_visible(timeout=10000);expect(panel.locator('.optimization-entry')).to_have_count(20);assert page.evaluate('activeOptimizationWorkers')==0;assert page.evaluate('optimizationMessages.every(row=>!row.baseline)')
        tabs.locator('[data-mode=selected]').click();page.locator('#contest-simulation-run-number').fill('100');page.locator('.season-simulate').click()
        expect(page.locator('.simulation-save-status')).to_have_text('已保存到此舞台的模拟历史。',timeout=60000)
        saved=page.evaluate("async profile=>{const {simulationHistory}=await import('./application/contest-simulation-history.mjs');return (await simulationHistory(profile)).map(row=>row.id);}",profile);assert len(saved)==1
        page.reload(wait_until='networkidle');expect(page.locator('#season-simulation-page')).to_be_visible(timeout=60000)
        assert page.evaluate("async profile=>{const {simulationHistory}=await import('./application/contest-simulation-history.mjs');const {savedSimulationLoadouts}=await import('./application/contest-saved-loadouts.mjs');return {history:(await simulationHistory(profile)).map(row=>row.id),loadouts:(await savedSimulationLoadouts(profile)).length,other:(await simulationHistory('account-synthetic-other')).length};}",profile)=={'history':saved,'loadouts':1,'other':0}
        assert not errors,errors;assert not uploads,uploads;browser.close()
    print('真实入口当前舞台遗传搜索、评级/附魔/专属/P 道具约束、停止保留结果、保存载入、双屏宽和隐私检查通过。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
