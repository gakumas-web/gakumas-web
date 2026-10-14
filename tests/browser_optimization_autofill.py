"""通过真实推荐表单与 Worker 验证倍率反推、体力保留和双屏宽布局。"""
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
        expect(panel.locator('.optimization-total > p:visible')).to_have_count(1)
        expect(panel.locator('.optimization-multiplier small')).to_have_text(['当前倍率']*3)
        expect(panel.locator('.optimization-multiplier-empty:visible')).to_have_count(3)
        expect(panel.locator('[data-attribute="stamina"] .optimization-multiplier')).to_have_count(0)
        expect(panel.locator('[data-optimization-multiplier]:visible')).to_have_count(0)
        help_panel=panel.locator('.optimization-input-help')
        expect(help_panel).not_to_have_attribute('open','')
        help_panel.locator('summary').focus();page.keyboard.press('Enter')
        expect(help_panel.locator('p').first).to_be_visible()
        expect(help_panel).to_contain_text('体力保持不变')
        help_panel.locator('summary').click()
        for width in [1280,320]:
            page.set_viewport_size({'width':width,'height':1000})
            expect(panel.locator('[data-optimization-attribute="vocal"]')).to_have_attribute('placeholder','未填写')
            assert panel.locator('.optimization-total').evaluate('e=>e.scrollWidth<=e.clientWidth')
            panel.locator('.optimization-total').screenshot(path=artifact_path(str(ROOT/'local/optimization-autofill'/f'attributes-empty-{width}.png')))
        page.set_viewport_size({'width':1280,'height':1000})
        panel.locator('[data-optimization-attribute="vocal"]').fill('123')
        expect(panel.locator('[data-optimization-multiplier="vocal"]')).to_be_visible()
        expect(panel.locator('[data-optimization-multiplier="dance"],[data-optimization-multiplier="visual"]')).to_have_count(2)
        expect(panel.locator('[data-optimization-multiplier]:visible')).to_have_count(1)
        panel.locator('[data-optimization-attribute="vocal"]').fill('')
        expect(panel.locator('[data-optimization-multiplier]:visible')).to_have_count(0)
        for key,value in request['params'].items():panel.locator(f'[data-optimization-attribute="{key}"]').fill(str(value))
        button=panel.locator('.optimization-autofill')
        expect(button).to_have_text('填入参考属性');expect(button).to_be_enabled()
        expected=page.evaluate('''async request=>{
          const {suggestContestParameters}=await import('./domain/contest-engine-runner.mjs');
          return suggestContestParameters({...request,supportBonus:0.001});
        }''',request)
        stamina=panel.locator('[data-optimization-attribute="stamina"]')
        stamina.fill('');button.click();expect(button).to_be_enabled();expect(stamina).to_have_value('')
        expect(panel.locator('.optimization-autofill-notice')).to_be_visible()
        for key,value in expected['params'].items():
            expect(panel.locator(f'[data-optimization-attribute="{key}"]')).to_have_value(str(value))
        stamina.fill('77')
        for key in ['vocal','dance','visual']:panel.locator(f'[data-optimization-attribute="{key}"]').fill('1')
        button.click();expect(button).to_be_enabled();expect(stamina).to_have_value('77')
        for key,value in expected['params'].items():
            expect(panel.locator(f'[data-optimization-attribute="{key}"]')).to_have_value(str(value))
            expect(panel.locator(f'[data-optimization-multiplier="{key}"]')).to_have_text(f"{expected['multipliers'][key]*100:g}%")
        if expected['limited']:expect(panel.locator('.optimization-autofill-notice')).to_contain_text('超过舞台可达上限')
        else:expect(panel.locator('.optimization-autofill-notice')).to_have_text('已填入参考属性，体力未变。')
        panel.locator('[data-optimization-attribute="vocal"]').fill('123')
        panel.locator('.optimization-autofill-undo').click()
        expect(panel.locator('[data-optimization-attribute="vocal"]')).to_have_value('123')
        for key in ['dance','visual']:expect(panel.locator(f'[data-optimization-attribute="{key}"]')).to_have_value('1')
        expect(stamina).to_have_value('77')
        expect(panel.locator('.optimization-autofill-notice')).to_be_hidden()
        assert page.evaluate('optimizationMessages.some(row=>row.mode==="suggest-parameters")')
        assert not page.evaluate('optimizationMessages.some(row=>row.mode?.startsWith("session-"))')
        button.click();expect(button).to_be_enabled()
        expect(panel.locator('[data-optimization-multiplier="vocal"]')).to_be_visible()
        for width in [1280,375,320]:
            page.set_viewport_size({'width':width,'height':1000})
            assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth')
            assert button.evaluate('button=>button.getBoundingClientRect().width>0')
            assert panel.locator('.optimization-attributes').evaluate('''element=>{
                const fields=[...element.children],inputs=fields.map(field=>field.querySelector('input').getBoundingClientRect());
                return inputs.every(rect=>Math.abs(rect.left-inputs[0].left)<1)&&inputs.every((rect,index)=>!index||rect.top>=inputs[index-1].bottom)&&fields.slice(0,3).every(field=>{
                    const input=field.querySelector('input').getBoundingClientRect(),output=field.querySelector('output').getBoundingClientRect();
                    return output.left>=input.right&&output.top>=input.top-1&&output.bottom<=input.bottom+1;
                });
            }''')
            assert panel.locator('.optimization-autofill-notice').evaluate('element=>element.getBoundingClientRect().top>=element.previousElementSibling.getBoundingClientRect().bottom')
            panel.locator('.optimization-total').screenshot(path=artifact_path(str(ROOT/'local/optimization-autofill'/f'attributes-{width}.png')))
            if width==1280:panel.locator('.optimization-composition').screenshot(path=artifact_path(str(ROOT/'local/optimization-autofill/attributes-context-1280.png')))
        assert not errors and not uploads,(errors,uploads)
        browser.close()
    print('真实 Worker 按当前舞台和支援反推三维；空白及已有体力均保留；上限提示、右上角按钮和双屏宽检查通过，无数据上传。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);check(parser.parse_args().url)
