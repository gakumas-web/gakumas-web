"""验证图鉴稀有度图标筛选、页间隔离与五页清空操作的统一间距。"""
import argparse
import json
from playwright.sync_api import sync_playwright, expect
from browser_artifacts import artifact_path

TABS = [('memories', '回忆', 'reset-filters'), ('selectionMemories', '选拔回忆', 'reset-selection-filters'), ('idolCards', '偶像卡', 'reset-idol-filters'), ('supportCards', '支援卡', 'reset-support-filters'), ('idolCardSkins', '主题装扮', 'reset-skin-filters')]


def open_tab(page, tab, title):
    page.locator(f'[data-tab={tab}]').click()
    # 分类资料可能异步准备；先等待目标页完成渲染，再读取该页的展开状态。
    expect(page.locator('#section-title')).to_have_text(title, timeout=60000)
    expect(page.locator('#shared-search')).to_be_visible(timeout=60000)
    if page.locator('#filter-toggle').get_attribute('aria-expanded') != 'true':
        page.locator('#filter-toggle').click()
    expect(page.locator('#advanced-filters')).to_be_visible()


def measure_footer(page, reset):
    return page.locator('#'+reset).evaluate('''button=>{
        const footer=button.parentElement, panel=footer.parentElement;
        const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
        const prior=[...panel.children].filter(e=>e!==footer&&(e.compareDocumentPosition(footer)&Node.DOCUMENT_POSITION_FOLLOWING)&&visible(e));
        const last=prior.at(-1),leaves=prior.flatMap(e=>[...e.querySelectorAll('button,select,input,[role=status],.selection-selected-list')]).filter(e=>visible(e)&&e.getBoundingClientRect().height>0);
        const bottom=Math.max(...leaves.map(e=>e.getBoundingClientRect().bottom)),line=footer.getBoundingClientRect().top;
        return {above:line-bottom,below:button.getBoundingClientRect().top-line-1,border:getComputedStyle(footer).borderTopWidth,blockGap:line-last.getBoundingClientRect().bottom};
    }''')


def check_icon_alignment(page, group):
    # 按实际绘制比例检查高度，避免相同 img 外框掩盖 object-fit 的缩小。
    icons=group.locator('.rarity-symbol img').evaluate_all('''images=>images.map(image=>{
        const rect=image.getBoundingClientRect(),button=image.closest('button').getBoundingClientRect();
        const scale=Math.min(rect.width/image.naturalWidth,rect.height/image.naturalHeight);
        return {height:image.naturalHeight*scale,center:rect.y+rect.height/2-button.y-button.height/2,
            ratio:rect.width/rect.height,naturalRatio:image.naturalWidth/image.naturalHeight};
    })''')
    assert len(icons)==3,icons
    assert max(x['height'] for x in icons)-min(x['height'] for x in icons)<.1,icons
    assert max(x['center'] for x in icons)-min(x['center'] for x in icons)<.1,icons
    assert all(abs(x['ratio']-x['naturalRatio'])<.01 for x in icons),icons


def check_card_actions(page):
    # 收藏与分享不能因卡片的文字字号不同而改变图标尺寸或点击区域。
    values=page.locator('#list .card-social-actions').first.evaluate('''group=>
        ['.favorite-button','.share-button'].map(selector=>{
            const button=group.querySelector(selector),icon=button.querySelector('svg');
            const box=button.getBoundingClientRect(),rect=icon.getBoundingClientRect();
            return {width:box.width,height:box.height,iconWidth:rect.width,iconHeight:rect.height,center:rect.y+rect.height/2};
        })''')
    assert all(x['iconWidth']==18 and x['iconHeight']==18 for x in values),values
    assert all(abs(values[0][key]-values[1][key])<.1 for key in ['width','height','center']),values


def check(url):
    measurements=[]
    with sync_playwright() as driver:
        browser=driver.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1280,'height':1000})
        errors,uploads=[],[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle')
        page.locator('#data-open').click();page.locator('#enable-preview-account').click()
        expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        for kind,tab,title,rarity in [('idol','idolCards','偶像卡','SSR'),('support','supportCards','支援卡','SR')]:
            open_tab(page,tab,title)
            group=page.locator('#'+kind+'-rarity-chips')
            assert page.locator('#shared-search select[id$="-rarity"]').count()==0
            assert group.evaluate('(e)=>e.previousElementSibling.id')==kind+'-plan-chips'
            assert group.locator('button').count()==4
            group.get_by_role('button',name=rarity,exact=True).click()
            expect(group.get_by_role('button',name=rarity,exact=True)).to_have_attribute('aria-pressed','true')
            expect(page.locator('#'+kind+'-rarity')).to_have_value(rarity)
            expect(page.locator(f'#active-filters [data-filter-key={kind}Rarity]')).to_be_visible()
            expect(page.locator('#filter-toggle')).to_contain_text('1')
            print(tab+' 稀有度图标筛选生效',flush=True)
        page.reload(wait_until='networkidle')
        for kind,tab,title,rarity in [('idol','idolCards','偶像卡','SSR'),('support','supportCards','支援卡','SR')]:
            open_tab(page,tab,title)
            expect(page.locator('#'+kind+'-rarity')).to_have_value(rarity)
            expect(page.locator(f'#{kind}-rarity-chips button[data-value="{rarity}"]')).to_have_attribute('aria-pressed','true')
            page.locator('#filter-toggle').click()
            page.locator(f'#active-filters [data-filter-key={kind}Rarity]').click()
            expect(page.locator('#'+kind+'-rarity')).to_have_value('')
            page.locator('#filter-toggle').click()
            page.locator(f'#{kind}-rarity-chips button[data-value="SSR"]').click()
            page.locator(f'#{kind}-plan-chips button[data-value="Plan1"]').click()
            page.locator('#reset-'+kind+'-filters').click()
            expect(page.locator('#'+kind+'-rarity')).to_have_value('')
            expect(page.locator('#'+kind+'-plan')).to_have_value('')
            expect(page.locator(f'#{kind}-rarity-chips button[data-value=""]')).to_have_attribute('aria-pressed','true')
        for width in [1280,760,360]:
            page.set_viewport_size({'width':width,'height':1000})
            for tab,title,reset in TABS:
                open_tab(page,tab,title)
                expect(page.locator('#'+reset)).to_be_visible()
                measurement=measure_footer(page,reset)
                measurements.append({'width':width,'tab':tab,**measurement})
                print(json.dumps(measurements[-1],ensure_ascii=False),flush=True)
                assert measurement['border']=='1px' and abs(measurement['above']-12)<1 and abs(measurement['below']-12)<1,measurements[-1]
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                check_card_actions(page)
                if tab in ['idolCards','supportCards']:
                    group=page.locator('#'+('idol' if tab=='idolCards' else 'support')+'-rarity-chips')
                    expect(group).to_be_visible()
                    group.scroll_into_view_if_needed()
                    page.wait_for_function('''()=>[...document.querySelectorAll('.catalog-rarity-chips:not([hidden]) img')].every(e=>e.complete&&e.naturalWidth>0&&!e.hidden)''')
                    check_icon_alignment(page,group)
                    page.screenshot(path=artifact_path(f'local/checks/catalog-rarity/{tab}-{width}.png'))
        # 已选支援效果出现后，分隔线仍紧随最后一组实际组件。
        open_tab(page,'supportCards','支援卡')
        page.locator('#support-skills-open').click()
        choice=page.locator('.support-effect-choice input').first
        expect(choice).to_be_visible(timeout=30000);choice.check()
        page.locator('#selection-picker-confirm').click();expect(page.locator('#selection-picker')).to_be_hidden()
        expect(page.locator('#support-skills-list')).to_be_visible()
        selected=measure_footer(page,'reset-support-filters');assert abs(selected['above']-12)<1 and abs(selected['below']-12)<1,selected
        page.locator('#reset-support-filters').click()
        page.locator('#language').select_option('ja')
        for tab,title,kind in [('idolCards','アイドルカード','idol'),('supportCards','サポートカード','support')]:
            page.locator(f'[data-tab={tab}]').click()
            expect(page.locator('#'+kind+'-rarity-chips')).to_be_visible(timeout=30000)
            expect(page.locator('#'+kind+'-rarity-chips legend')).to_have_text('レアリティ')
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert not errors,errors
        assert not uploads,uploads
        artifact_path('local/checks/catalog-rarity/check.json').write_text(json.dumps({'measurements':measurements,'support_selected':selected,'page_errors':errors,'uploads':uploads},ensure_ascii=False,indent=2))
        browser.close()
    print('稀有度筛选、刷新恢复、页间隔离、移除与清空通过；五页分隔线上下各 12px，窄屏无溢出。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);check(parser.parse_args().url)
