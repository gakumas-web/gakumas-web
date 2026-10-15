"""通过实际页面验证装扮卡面局部更新、偏好持久化，以及编组倍率的属性色。"""
import argparse
import json
from playwright.sync_api import sync_playwright, expect
from browser_artifacts import artifact_path
from browser_simulation_helpers import select_season


def remember_images(page, skin_id):
    page.evaluate('''id=>{
      window.skinRows=[...document.querySelectorAll('#list .skin-card:has(.skin-art-open)')];
      window.otherSkinImages=skinRows.filter(row=>row.dataset.skinId!==id).flatMap(row=>[...row.querySelectorAll('img')]).map(image=>({image,src:image.getAttribute('src')}));
    }''', skin_id)


def assert_images_retained(page):
    result=page.evaluate('''()=>({rows:skinRows.length,retainedRows:skinRows.filter(row=>row.isConnected).length,
      otherImages:otherSkinImages.length,retainedImages:otherSkinImages.filter(({image,src})=>image.isConnected&&(src.includes('#resource=')||image.getAttribute('src')===src)).length})''')
    assert result['rows']>1 and result['rows']==result['retainedRows'],result
    assert result['otherImages']>0 and result['otherImages']==result['retainedImages'],result
    return result


def check(url):
    results=[]
    with sync_playwright() as driver:
        browser=driver.chromium.launch()
        for width in [1280,375]:
            page=browser.new_page(viewport={'width':width,'height':1000})
            errors,uploads=[],[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
            page.goto(url,wait_until='networkidle')
            page.locator('#data-open').click();page.locator('#enable-preview-account').click()
            expect(page.locator('#inventory')).to_be_visible(timeout=60000)
            page.locator('[data-tab=idolCardSkins]').click()
            switch=page.locator('#list .skin-card input[role=switch]').first
            expect(switch).to_be_visible(timeout=60000);page.wait_for_load_state('networkidle')
            skin_id=switch.evaluate('e=>e.closest(".skin-card").dataset.skinId')
            card=page.locator(f'#list .skin-card[data-skin-id="{skin_id}"]')
            art=card.locator('.skin-art > img').first
            expect(art).to_be_visible(timeout=60000)
            original=art.get_attribute('src');checked=switch.is_checked()
            remember_images(page,skin_id)
            switch.click();expect(switch).to_be_checked(checked=not checked);expect(switch).to_be_focused()
            assert art.get_attribute('src')!=original
            results.append({'width':width,'list':assert_images_retained(page)})
            card.locator('.skin-art-open').click()
            dialog=page.locator('#idol-dialog');detail_switch=dialog.locator('input[role=switch]')
            expect(detail_switch).to_be_checked(checked=not checked)
            detail_switch.click();expect(detail_switch).to_be_focused();expect(switch).to_be_checked(checked=checked)
            expect(art).to_have_attribute('src',original)
            expect(dialog.locator('.skin-full > img').first).to_have_attribute('src',original)
            assert_images_retained(page)
            # 再次切换并刷新，确认局部更新仍保存偏好，而非只改变当前 DOM。
            detail_switch.click();expect(art).to_be_visible(timeout=60000)
            expected=art.evaluate("async image=>{const {imageConfig}=await import('./image-config.mjs');return Object.entries(imageConfig.imageURLs).find(([,url])=>url===image.src)[0]}")
            page.locator('#close-idol').click();page.wait_for_function('()=>!location.hash');page.reload(wait_until='networkidle')
            restored=page.locator(f'#list [data-skin-id="{skin_id}"] .skin-art > img').first
            expect(restored).to_be_visible(timeout=60000)
            assert restored.evaluate("async image=>{const {imageConfig}=await import('./image-config.mjs');return Object.entries(imageConfig.imageURLs).find(([,url])=>url===image.src)[0]}")==expected
            page.locator('[data-tab=seasonSimulation]').click()
            stage=page.evaluate("async()=>{const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');const {contestCatalog}=await import('./domain/catalog.mjs');const stage=contestCatalog().choices.find(row=>row.preset?.season===53&&row.preset?.stage===1);return {id:stage.id,season:'contest:'+stage.season.id}}")
            select_season(page,stage['season']);page.locator(f'.season-stage-tab[data-stage-id="{stage["id"]}"]').click()
            page.locator('[data-mode=optimization]').click()
            expect(page.locator('.optimization-fields')).to_be_enabled(timeout=30000)
            for key,color in [('vocal','rgb(173, 65, 103)'),('dance','rgb(51, 111, 192)'),('visual','rgb(140, 106, 23)')]:
                page.locator(f'[data-optimization-attribute="{key}"]').fill('1500')
                value=page.locator(f'[data-optimization-multiplier="{key}"]')
                expect(value).to_be_visible(timeout=30000);expect(value).to_have_css('color',color)
            expect(page.locator('.optimization-multiplier > small').first).to_have_css('color','rgb(100, 114, 138)')
            total=page.locator('.optimization-total')
            assert total.evaluate('e=>e.scrollWidth<=e.clientWidth')
            total.screenshot(path=artifact_path(f'local/skin-art/multipliers-{width}.png'))
            assert not errors and not uploads,(errors,uploads)
            page.close()
        browser.close()
    print(json.dumps(results,ensure_ascii=False))
    print('装扮列表与详情只同步当前卡面，保留其它图片、焦点和偏好；桌面与手机倍率颜色通过，无数据上传。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);check(parser.parse_args().url)
