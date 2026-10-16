"""通过真实推荐表单与 Worker 验证属性加减、倍率反推、体力保留和响应式布局。"""
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
        # 共用构建函数后，两个原生说明仍支持键盘展开，并保留各自正文。
        for selector in ['.season-stage-guide','.simulation-score-help']:
            disclosure=page.locator(selector);summary=disclosure.locator(':scope > summary')
            expect(disclosure).to_have_count(1);expect(summary.locator('svg[aria-hidden=true] path')).to_have_count(1)
            summary.focus();page.keyboard.press('Enter');expect(disclosure).to_have_attribute('open','')
            expect(disclosure.locator(':scope > :not(summary)').first).to_be_visible()
            summary.click();expect(disclosure).not_to_have_attribute('open','')
        for index in [0,1]:
            panel.locator(f'[data-slot="{index}"] .season-memory-slot-pick').click();page.locator(f'.optimization-picker [data-choice-id="{request["cards"][0]["reference"]["id"]}"]').click();page.locator('.optimization-picker-confirm').click()
            panel.locator(f'[data-optimization-grade="{index}"]').select_option('15')
        expect(panel.locator('[data-optimization-attribute]')).to_have_count(4)
        expect(panel.locator('[data-optimization-custom-count],[data-optimization-custom-cards]')).to_have_count(0)
        expect(panel.locator('.recommendation-character-count')).to_have_text('1')
        expect(panel.locator('.optimization-total > p:visible')).to_have_count(1)
        heading=panel.locator('.optimization-attributes-heading')
        expect(heading).to_have_count(1)
        expect(heading.locator(':scope > span')).to_have_text(['属性','属性值','当前倍率'])
        expect(panel.locator('.optimization-multiplier small')).to_have_count(0)
        expect(panel.locator('.optimization-multiplier-empty:visible')).to_have_count(3)
        expect(panel.locator('[data-attribute="stamina"] .optimization-multiplier')).to_have_count(0)
        expect(panel.locator('[data-optimization-multiplier]:visible')).to_have_count(0)
        expect(panel.locator('input[data-optimization-slider]')).to_have_count(0)
        expect(panel.locator('.optimization-total-heading .optimization-autofill')).to_have_count(1)
        expect(panel.locator('.optimization-total-heading .optimization-autofill-undo')).to_have_count(1)
        footer=panel.locator('.optimization-total-footer')
        expect(footer).to_have_count(1)
        expect(footer.locator('.optimization-autofill-notice')).to_have_count(1)
        help_toggle=footer.locator('button.optimization-input-help-toggle')
        help_panel=footer.locator('div.optimization-input-help.info-disclosure')
        expect(help_toggle).to_have_count(1)
        expect(help_panel).to_have_count(1)
        expect(help_toggle).to_contain_text('填写说明')
        expect(help_toggle).to_have_attribute('aria-expanded','false')
        help_id=help_panel.get_attribute('id');assert help_id and help_toggle.get_attribute('aria-controls')==help_id
        for key,deltas,min_value in [('vocal',['-100','-10','10','100'],'0'),('dance',['-100','-10','10','100'],'0'),('visual',['-100','-10','10','100'],'0'),('stamina',['-1','1'],'1')]:
            field=panel.locator(f'.optimization-field[data-attribute="{key}"]');input_field=field.locator('input[data-optimization-attribute]')
            expect(field.locator('.optimization-attribute-control')).to_have_count(1)
            expect(input_field).to_have_count(1);expect(input_field).to_have_attribute('min',min_value);expect(input_field).to_have_value('')
            assert field.locator('button[data-optimization-delta]').evaluate_all('nodes=>nodes.map(node=>node.dataset.optimizationDelta)')==deltas
            for delta in deltas:
                expect(field.locator(f'button[data-optimization-delta="{delta}"]')).to_have_count(1)
            for delta in deltas:
                if delta.startswith('-'):expect(field.locator(f'button[data-optimization-delta="{delta}"]')).to_be_disabled()
        vocal_field=panel.locator('.optimization-field[data-attribute="vocal"]');vocal_input=panel.locator('[data-optimization-attribute="vocal"]')
        vocal_field.locator('button[data-optimization-delta="10"]').click();expect(vocal_input).to_have_value('10')
        vocal_input.press('ArrowUp');expect(vocal_input).to_have_value('11')
        vocal_input.press('ArrowDown');expect(vocal_input).to_have_value('10')
        vocal_field.locator('button[data-optimization-delta="-100"]').click();expect(vocal_input).to_have_value('0')
        for delta in ['-100','-10']:expect(vocal_field.locator(f'button[data-optimization-delta="{delta}"]')).to_be_disabled()
        vocal_input.fill('6001');expect(vocal_input).to_have_value('6001')
        vocal_field.locator('button[data-optimization-delta="100"]').click();expect(vocal_input).to_have_value('6101')
        vocal_field.locator('button[data-optimization-delta="-10"]').focus();page.keyboard.press('Enter');expect(vocal_input).to_have_value('6091')
        expect(panel.locator('[data-optimization-multiplier="vocal"]')).to_be_visible()
        vocal_input.fill('');expect(vocal_input).to_have_value('');expect(panel.locator('[data-optimization-multiplier]:visible')).to_have_count(0)
        stamina_input=panel.locator('[data-optimization-attribute="stamina"]');stamina_field=panel.locator('.optimization-field[data-attribute="stamina"]')
        stamina_field.locator('button[data-optimization-delta="1"]').click();expect(stamina_input).to_have_value('1');expect(stamina_field.locator('button[data-optimization-delta="-1"]')).to_be_disabled()
        stamina_input.fill('');expect(stamina_input).to_have_value('')
        expect(help_panel).to_be_hidden()
        help_toggle.focus();page.keyboard.press('Enter')
        expect(help_toggle).to_have_attribute('aria-expanded','true');expect(help_panel).to_be_visible()
        expect(help_panel.locator('p').first).to_be_visible()
        expect(help_panel).to_contain_text('体力保持不变')
        help_toggle.click();expect(help_toggle).to_have_attribute('aria-expanded','false');expect(help_panel).to_be_hidden()
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
        # 先完成空体力的失焦校验，避免校验信息触发滚动后点击落在旧坐标。
        stamina.fill('');button.focus();button.click();expect(button).to_be_enabled();expect(stamina).to_have_value('')
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
        vocal_field.locator('button[data-optimization-delta="10"]').click()
        panel.locator('.optimization-autofill-undo').click()
        expect(panel.locator('[data-optimization-attribute="vocal"]')).to_have_value('133')
        for key in ['dance','visual']:
            expect(panel.locator(f'[data-optimization-attribute="{key}"]')).to_have_value('1')
        expect(stamina).to_have_value('77')
        expect(panel.locator('.optimization-autofill-notice')).to_be_hidden()
        assert page.evaluate('optimizationMessages.some(row=>row.mode==="suggest-parameters")')
        assert not page.evaluate('optimizationMessages.some(row=>row.mode?.startsWith("session-"))')
        button.click();expect(button).to_be_enabled()
        expect(panel.locator('[data-optimization-multiplier="vocal"]')).to_be_visible()
        # 调整一项时，其余倍率不能清空或重绘，正常计算也不能推动页脚。
        stable={key:panel.locator(f'[data-optimization-multiplier="{key}"]').inner_text() for key in ['dance','visual']}
        stable_inputs={key:panel.locator(f'[data-optimization-attribute="{key}"]').input_value() for key in stable}
        footer_offset=panel.locator('.optimization-total-footer').evaluate('e=>e.getBoundingClientRect().top-e.closest(".optimization-total").getBoundingClientRect().top')
        page.evaluate("""()=>{window.untouchedMultiplierMutations=[];window.multiplierObserver=new MutationObserver(records=>untouchedMultiplierMutations.push(...records.map(record=>record.type)));for(const key of ['dance','visual'])multiplierObserver.observe(document.querySelector(`[data-optimization-multiplier="${key}"]`).parentElement,{attributes:true,childList:true,characterData:true,subtree:true});}""")
        vocal_field.locator('button[data-optimization-delta="10"]').click()
        expect(panel.locator('.optimization-multiplier-status')).to_be_hidden()
        for key,value in stable.items():
            expect(panel.locator(f'[data-optimization-multiplier="{key}"]')).to_be_visible()
            expect(panel.locator(f'[data-optimization-multiplier="{key}"]')).to_have_text(value)
        assert abs(panel.locator('.optimization-total-footer').evaluate('e=>e.getBoundingClientRect().top-e.closest(".optimization-total").getBoundingClientRect().top')-footer_offset)<1
        expect(panel.locator('[data-optimization-multiplier="vocal"]')).to_be_visible()
        saved_vocal=vocal_input.input_value();vocal_input.fill('')
        expect(panel.locator('[data-optimization-multiplier="vocal"]')).to_be_hidden()
        expect(panel.locator('[data-optimization-multiplier]:visible')).to_have_count(2)
        vocal_input.fill(saved_vocal);expect(panel.locator('[data-optimization-multiplier="vocal"]')).to_be_visible()
        for key,value in stable_inputs.items():expect(panel.locator(f'[data-optimization-attribute="{key}"]')).to_have_value(value)
        assert page.evaluate('untouchedMultiplierMutations')==[]
        page.evaluate('multiplierObserver.disconnect()')
        count=page.evaluate('optimizationMessages.filter(row=>row.mode==="multipliers").length')
        stamina.fill('78');expect(panel.locator('.optimization-total')).to_have_attribute('aria-busy','false')
        expect(panel.locator('[data-optimization-multiplier]:visible')).to_have_count(3)
        page.wait_for_timeout(250)
        assert page.evaluate('optimizationMessages.filter(row=>row.mode==="multipliers").length')==count
        stamina.fill('77')
        # 快速连续修改不同属性，取消前一请求后也要补齐所有待算项。
        vocal_input.fill('124');panel.locator('[data-optimization-attribute="dance"]').fill('125')
        for key in ['vocal','dance']:expect(panel.locator(f'[data-optimization-multiplier="{key}"]')).to_be_visible()
        preview_params={key:int(panel.locator(f'[data-optimization-attribute="{key}"]').input_value()) for key in ['vocal','dance','visual','stamina']}
        preview_expected=page.evaluate("""async request=>{const {previewContestMultipliers}=await import('./domain/contest-engine-runner.mjs');return previewContestMultipliers({...request,supportBonus:0.001});}""",{**request,'params':preview_params})
        for key in ['vocal','dance']:
            actual=float(panel.locator(f'[data-optimization-multiplier="{key}"]').inner_text().removesuffix('%'))
            assert abs(actual-preview_expected[key]*100)<0.051,(key,actual,preview_expected)
        expect(panel.locator('[data-optimization-multiplier="visual"]')).to_have_text(stable['visual'])
        # 只注入预览消息传输失败，重试和新输入仍执行正式 Worker 计算。
        page.evaluate('''()=>{const Native=Worker;window.previewFault=false;window.previewFaultDelay=250;window.previewFaultSent=false;window.previewFaultDelivered=false;
          window.Worker=class extends Native{postMessage(value,...rest){if(value.mode==='multipliers'&&window.previewFault){window.previewFault=false;window.previewFaultSent=true;setTimeout(()=>{this.dispatchEvent(new ErrorEvent('error',{message:'synthetic multiplier transport failure',cancelable:true}));window.previewFaultDelivered=true;},window.previewFaultDelay);return;}super.postMessage(value,...rest);}};
        }''')
        vocal=panel.locator('[data-optimization-attribute="vocal"]');preview_status=panel.locator('.optimization-multiplier-status')
        page.evaluate('previewFault=true');vocal.fill('125')
        expect(preview_status).to_be_hidden()
        expect(panel.locator('[data-optimization-multiplier="vocal"]')).to_be_hidden()
        expect(panel.locator('[data-optimization-multiplier]:visible')).to_have_count(2)
        expect(preview_status).to_contain_text('倍率暂未计算成功',timeout=15000)
        expect(vocal).to_have_value('125');expect(panel.locator('[data-optimization-multiplier]:visible')).to_have_count(2)
        preview_status.get_by_role('button',name='重试倍率计算').click()
        expect(panel.locator('[data-optimization-multiplier="vocal"]')).to_be_visible();expect(preview_status).to_be_hidden()
        page.evaluate('previewFault=true;previewFaultDelay=600;previewFaultSent=false;previewFaultDelivered=false');vocal.fill('126')
        page.wait_for_function('()=>previewFaultSent');vocal.fill('127')
        expect(panel.locator('[data-optimization-multiplier="vocal"]')).to_be_visible()
        latest=panel.locator('[data-optimization-multiplier="vocal"]').inner_text()
        page.wait_for_function('()=>previewFaultDelivered');expect(preview_status).to_be_hidden()
        expect(panel.locator('[data-optimization-multiplier="vocal"]')).to_have_text(latest)
        # 大属性产生较长的真实倍率，窄屏不能挤压输入文字或触控区域。
        for key in ['vocal','dance','visual']:panel.locator(f'[data-optimization-attribute="{key}"]').fill('9999')
        expect(panel.locator('[data-optimization-multiplier]:visible')).to_have_count(3)
        geometry=[]
        for width in [1280,390,375,360,320]:
            page.set_viewport_size({'width':width,'height':1000})
            assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth')
            assert button.evaluate('button=>button.getBoundingClientRect().width>0')
            assert panel.locator('.optimization-attributes').evaluate('''element=>{
                const mobile=innerWidth<=599,fields=[...element.children].filter(child=>child.matches('.optimization-field')),heading=element.querySelector(':scope > .optimization-attributes-heading'),headingCells=heading?[...heading.children]:[],controls=fields.map(field=>field.querySelector('.optimization-attribute-control').getBoundingClientRect()),inputs=fields.map(field=>field.querySelector('input[data-optimization-attribute]').getBoundingClientRect());
                return headingCells.length===3&&controls.slice(0,3).every(rect=>Math.abs(rect.left-controls[0].left)<1&&Math.abs(rect.right-controls[0].right)<1)&&inputs.every((rect,index)=>!index||rect.top>=inputs[index-1].bottom)&&fields.slice(0,3).every(field=>{
                    const input=field.querySelector('input[data-optimization-attribute]').getBoundingClientRect(),control=field.querySelector('.optimization-attribute-control').getBoundingClientRect(),output=field.querySelector('output').getBoundingClientRect(),label=field.querySelector('label').getBoundingClientRect(),value=field.querySelector('[data-optimization-multiplier]'),fontSize=parseFloat(getComputedStyle(value).fontSize);
                    const layout=mobile?output.bottom<=control.top&&label.bottom<=control.top&&output.left>=label.right&&getComputedStyle(heading).display==='none':output.left>=control.right-1&&output.top>=control.top-1&&output.bottom<=control.bottom+1&&Math.abs(output.left-headingCells[2].getBoundingClientRect().left)<1;
                    return layout&&fontSize>=16&&input.left>=control.left-1&&input.right<=control.right+1;
                });
            }''')
            dimensions=panel.locator('.optimization-attributes .optimization-field').evaluate_all('''fields=>fields.map(field=>{
                const input=field.querySelector('input'),style=getComputedStyle(input),context=document.createElement('canvas').getContext('2d');context.font=style.font;
                const value=field.querySelector('[data-optimization-multiplier]'),range=document.createRange();if(value)range.selectNodeContents(value);
                return {attribute:field.dataset.attribute,buttons:[...field.querySelectorAll('button')].map(button=>{const rect=button.getBoundingClientRect();return {width:rect.width,height:rect.height};}),inputFits:context.measureText(input.value||input.placeholder).width<=input.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),multiplierFits:!value||range.getBoundingClientRect().width<=value.parentElement.clientWidth+1,overflow:field.scrollWidth>field.clientWidth};
            })''')
            assert all(row['inputFits'] and row['multiplierFits'] and not row['overflow'] for row in dimensions),(width,dimensions)
            if width<=599:assert all(button['width']>=44 and button['height']>=44 for row in dimensions for button in row['buttons']),(width,dimensions)
            geometry.append({'viewport':width,'fields':dimensions})
            notice=footer.locator('.optimization-autofill-notice')
            expect(notice).to_be_visible();expect(help_toggle).to_be_visible();expect(help_toggle).to_have_attribute('aria-expanded','false')
            closed=footer.evaluate('''element=>{const footer=element.getBoundingClientRect(),notice=element.querySelector('.optimization-autofill-notice').getBoundingClientRect(),toggle=element.querySelector('button.optimization-input-help-toggle').getBoundingClientRect(),relative=rect=>[rect.left-footer.left,rect.top-footer.top,rect.right-footer.left,rect.bottom-footer.top];return {footer:[footer.left,footer.top,footer.right,footer.bottom],notice:relative(notice),toggle:relative(toggle),overflow:element.scrollWidth<=element.clientWidth};}''')
            assert closed['overflow'] and abs(closed['toggle'][1]-closed['notice'][1])<1 and closed['notice'][0]>=-1 and closed['toggle'][2]<=closed['footer'][2]-closed['footer'][0]+1,(width,closed)
            help_toggle.click();expect(help_toggle).to_have_attribute('aria-expanded','true');expect(help_panel).to_be_visible()
            opened=footer.evaluate('''element=>{const footer=element.getBoundingClientRect(),notice=element.querySelector('.optimization-autofill-notice').getBoundingClientRect(),toggle=element.querySelector('button.optimization-input-help-toggle').getBoundingClientRect(),help=element.querySelector('.optimization-input-help').getBoundingClientRect(),relative=rect=>[rect.left-footer.left,rect.top-footer.top,rect.right-footer.left,rect.bottom-footer.top];return {footer:[footer.left,footer.top,footer.right,footer.bottom],notice:relative(notice),toggle:relative(toggle),help:relative(help),overflow:element.scrollWidth<=element.clientWidth};}''')
            assert opened['overflow'] and abs(opened['toggle'][0]-closed['toggle'][0])<1 and abs(opened['toggle'][1]-closed['toggle'][1])<1 and abs(opened['notice'][1]-opened['toggle'][1])<1 and opened['help'][1]>=max(opened['notice'][3],opened['toggle'][3])-1 and opened['help'][0]>=-1 and opened['help'][2]<=opened['footer'][2]-opened['footer'][0]+1,(width,closed,opened)
            panel.locator('.optimization-total').screenshot(path=artifact_path(str(ROOT/'local/optimization-autofill'/f'attributes-help-{width}.png')))
            help_toggle.click();expect(help_toggle).to_have_attribute('aria-expanded','false');expect(help_panel).to_be_hidden()
            panel.locator('.optimization-total').screenshot(path=artifact_path(str(ROOT/'local/optimization-autofill'/f'attributes-{width}.png')))
            if width==1280:panel.locator('.optimization-composition').screenshot(path=artifact_path(str(ROOT/'local/optimization-autofill/attributes-context-1280.png')))
        artifact_path(ROOT/'local/checks/review067-followup/optimization-attributes-geometry.json').write_text(json.dumps(geometry,ensure_ascii=False,indent=2)+'\n')
        assert not errors and not uploads,(errors,uploads)
        browser.close()
    print('真实 Worker 倍率计算、加减输入、参考填入与撤销、体力保留及 1280／390／375／360／320px 布局、触控尺寸与数值显示检查通过，无数据上传。')


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);check(parser.parse_args().url)
