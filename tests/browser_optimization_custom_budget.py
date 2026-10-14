"""通过真实表单与 Worker 验证自定义搜索参数、校验和预设切换。"""
from browser_artifacts import artifact_path

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import fixtures, ROOT
from browser_simulation_helpers import select_season


def check(url):
    request=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['requests'][0]
    with TemporaryDirectory(prefix='optimization-account-',dir=ROOT/'local') as tmp,sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        # 旁观正式 Worker 消息，不改写搜索、评分或返回结果。
        page.add_init_script('''Object.defineProperty(navigator,'hardwareConcurrency',{value:8});window.optimizationMessages=[];window.optimizationPrivate=false;window.activeOptimizationWorkers=0;const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.optimizationWorker=String(args[0]).endsWith('contest-simulation-worker.mjs');if(this.optimizationWorker)window.activeOptimizationWorkers++;}postMessage(value,...args){window.optimizationMessages.push({mode:value.mode,runs:value.runs,stage:value.request?.stage?.id,baseline:value.request?.baseline,defaultCards:value.request?.defaultCards?.map(card=>card.reference.id),cards:value.request?.cards?.map(card=>card.reference.id)});if(/publicUserId|userMemoryId|synthetic-static-private-account/.test(JSON.stringify(value)))window.optimizationPrivate=true;super.postMessage(value,...args);}terminate(){if(!this.ended){this.ended=true;if(this.optimizationWorker)window.activeOptimizationWorkers--;}super.terminate();}};''')
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
        advanced=panel.locator('.optimization-advanced');advanced.locator('summary').click()
        strength=panel.locator('#optimization-strength');inputs=panel.locator('[data-optimization-budget]')
        expect(strength.locator('option')).to_have_text(['标准','极致','自定义'])
        expect(panel.locator('.optimization-custom-budget')).not_to_be_visible()
        presets=page.evaluate("async()=> (await import('./application/contest-optimization-client.mjs')).OPTIMIZATION_BUDGETS")
        strength.select_option('deep');expect(advanced.locator('summary')).to_contain_text('极致')
        strength.select_option('custom');expect(inputs).to_have_count(12)
        for key,value in presets['deep'].items():expect(panel.locator(f'[data-optimization-budget="{key}"]')).to_have_value(str(value))
        error=panel.locator('#optimization-budget-error');start=panel.locator('.optimization-start')
        for field,value in [('population',''),('samples','10001'),('generations','1.5'),('polishRounds','-1')]:
            target=panel.locator(f'[data-optimization-budget="{field}"]');original=target.input_value()
            target.fill(value);expect(error).to_be_visible();expect(start).to_be_disabled();target.fill(original)
            expect(error).not_to_be_visible()
        panel.locator('[data-optimization-budget="reviewRuns"]').fill('1')
        expect(error).to_have_text('加测后模拟次数不能小于初筛模拟次数。')
        strength.select_option('standard');expect(error).not_to_be_visible();expect(start).to_be_enabled()
        strength.select_option('custom');expect(error).to_be_visible()
        budget={'population':4,'generations':2,'samples':2,'polishParents':1,'polishNeighbors':2,'polishRounds':1,'polishRuns':2,'reviewCandidates':3,'screenRuns':3,'reviewRuns':4,'finalCandidates':2,'finalRuns':5}
        for key,value in budget.items():panel.locator(f'[data-optimization-budget="{key}"]').fill(str(value))
        expect(error).not_to_be_visible();expect(start).to_be_enabled()
        panel.locator('[data-optimization-budget="finalCandidates"]').fill('4')
        expect(error).to_have_text('最终编组数不能超过候选编组数。')
        panel.locator('[data-optimization-budget="finalCandidates"]').fill('2')
        strength.select_option('deep');expect(panel.locator('.optimization-custom-budget')).not_to_be_visible()
        strength.select_option('custom')
        for key,value in budget.items():expect(panel.locator(f'[data-optimization-budget="{key}"]')).to_have_value(str(value))
        for width in [1280,320]:
            page.set_viewport_size({'width':width,'height':1000})
            assert advanced.evaluate('element=>element.scrollWidth<=element.clientWidth')
            advanced.screenshot(path=artifact_path(str(ROOT/f'local/optimization-autofill/custom-budget-{width}.png')))
        page.set_viewport_size({'width':1280,'height':1000})
        page.evaluate('optimizationMessages=[]');start.click()
        expect(panel.locator('.optimization-entry')).to_have_count(2,timeout=120000)
        expect(panel.locator('.optimization-error')).to_be_empty()
        messages=page.evaluate('optimizationMessages')
        batches=[row for row in messages if row['mode']=='batch-scores']
        finals=[row for row in messages if row['mode']=='session-start']
        assert any(row['runs']==2 for row in batches),batches
        assert any(row['runs']==3 for row in batches),batches
        assert len(finals)==2 and all(row['runs']==5 for row in finals),finals
        page.wait_for_function('activeOptimizationWorkers===0',timeout=15000)
        # 舞台重绘会重建配置表单，自定义数值应随当前配置一起保留。
        other=page.locator(f'.season-stage-tab:not([data-stage-id="{setup["stageId"]}"])').first
        other.click();page.locator(f'.season-stage-tab[data-stage-id="{setup["stageId"]}"]').click()
        expect(panel.locator('#optimization-strength')).to_have_value('custom')
        for key,value in budget.items():expect(panel.locator(f'[data-optimization-budget="{key}"]')).to_have_value(str(value))
        assert not errors and not uploads,(errors,uploads)
        assert not page.evaluate('optimizationPrivate')
        browser.close()
    print('标准／极致／自定义、参数校验与保留、窄屏，以及正式 Worker 的搜索、复筛和最终复评次数均通过。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);check(parser.parse_args().url)
