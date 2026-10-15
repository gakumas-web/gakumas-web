"""通过真实静态入口与受控网络故障验证资料、图片两区的状态隔离。"""
import argparse
import asyncio
import json
import re
from playwright.async_api import Error, async_playwright, expect
from browser_artifacts import artifact_path


async def check(url):
    async with async_playwright() as driver:
        browser = await driver.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1280, 'height': 900})
        page = await context.new_page()
        errors, uploads, checks = [], [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        context.on('request', lambda request: uploads.append(request.url) if request.post_data else None)
        content_gate = asyncio.Event()
        async def fail_catalog(route):
            await content_gate.wait()
            await route.fulfill(status=503, body='unavailable')
        async def fail_image(route):
            await route.fulfill(status=503, body='unavailable')
        await context.route('**/catalog.json', fail_catalog)
        await context.route('**/image-files/**', fail_image)
        await page.goto(url, wait_until='domcontentloaded')
        await page.locator('#resources-open').click()
        await expect(page.locator('.content-management #resource-content-progress')).to_be_visible(timeout=30000)
        await expect(page.locator('#content-status')).to_contain_text(re.compile('下载|校验'))
        assert '公开资料' not in await page.locator('#image-notice').inner_text()
        content_gate.set()
        await expect(page.locator('.content-management #resource-content-retry')).to_be_visible(timeout=30000)
        await context.unroute('**/catalog.json', fail_catalog)
        await page.locator('#resource-content-retry').click()
        await expect(page.locator('#resource-content-retry')).to_be_hidden(timeout=60000)
        await expect(page.locator('.image-management #resource-retry')).to_be_visible(timeout=60000)
        await expect(page.locator('#resource-content-progress')).to_be_hidden()
        await expect(page.locator('#content-status')).not_to_contain_text('失败')
        await expect(page.locator('#image-notice')).to_contain_text(re.compile('失败|未完成'))
        checks.append('资料首次加载失败与恢复；图片独立失败，资料进度和重试不受影响')

        # 实际图片重试尚在等待响应时停止，再通过同一入口恢复。
        await context.unroute('**/image-files/**', fail_image)
        image_gate = asyncio.Event()
        image_stopped = False
        held_image_tasks = []
        async def hold_image(route):
            held_image_tasks.append(asyncio.current_task())
            await image_gate.wait()
            try:
                await route.continue_()
            except Error as error:
                # 页面中止可能先于路由释放；只接受这一已知取消回执。
                if not image_stopped or 'Route is already handled' not in str(error):
                    raise
        await context.route('**/image-files/**', hold_image)
        await page.locator('#resource-retry').click()
        await expect(page.locator('.image-management #resource-stop')).to_be_visible()
        image_stopped = True
        await page.locator('#resource-stop').click()
        await expect(page.locator('#image-notice')).to_contain_text('已停止')
        image_gate.set()
        await asyncio.gather(*held_image_tasks)
        await context.unroute('**/image-files/**', hold_image)
        await expect(page.locator('#resource-retry')).to_be_enabled()
        await page.locator('#resource-retry').click()
        await expect(page.locator('#image-notice')).to_contain_text('已请求的图片已准备好', timeout=60000)
        await expect(page.locator('#resource-retry')).to_be_hidden()
        checks.append('图片失败重试、停止、再次恢复；操作不依赖详情展开')

        # 图片已就绪时让资料检查失败，确认图片状态没有被覆盖。
        image_notice = await page.locator('#image-notice').inner_text()
        update_gate = asyncio.Event()
        async def fail_update(route):
            await update_gate.wait()
            await route.fulfill(status=503, body='unavailable')
        await context.route('**/content/channel.json', fail_update)
        await page.locator('#content-check').click()
        await expect(page.locator('#resource-content-progress')).to_be_visible()
        await expect(page.locator('#image-notice')).to_have_text(image_notice)
        await expect(page.locator('#resource-toggle')).to_have_attribute('aria-expanded', 'false')
        update_gate.set()
        await expect(page.locator('#resource-content-retry')).to_be_visible()
        await expect(page.locator('#image-notice')).to_have_text(image_notice)
        await expect(page.locator('#resource-retry')).to_be_hidden()
        await context.unroute('**/content/channel.json', fail_update)
        await page.locator('#resource-content-retry').click()
        await expect(page.locator('#resource-content-retry')).to_be_hidden()
        await expect(page.locator('#resource-content-progress')).to_be_hidden()
        checks.append('资料检查、失败与恢复不覆盖图片状态，也不展开图片详情')

        await page.locator('#content-file').set_input_files({'name': 'invalid.json', 'mimeType': 'application/json', 'buffer': b'{}'})
        await expect(page.locator('#content-status')).to_contain_text('内容包格式或校验不通过')
        await expect(page.locator('#image-notice')).to_have_text(image_notice)
        await page.locator('#content-check').click()
        await expect(page.locator('#content-status')).not_to_contain_text('内容包格式或校验不通过')
        await expect(page.locator('#content-check')).to_be_enabled()
        async with page.expect_download() as pending:
            await page.locator('#resource-diagnostics').click()
        download = await pending.value
        target = artifact_path('local/checks/resource-sections/diagnostics.json')
        await download.save_as(target)
        report = json.loads(target.read_text())
        assert report['format'] == 'gakumas-loading-diagnostics' and 'public_content' in report and 'images' in report
        checks.append('无效资料包提示限于资料区；底部诊断同时包含资料与图片')

        await page.locator('#close-resources').click()
        for locale in ['zh-CN', 'ja']:
            await page.locator('#language').select_option(locale)
            for width in [1280, 760, 360]:
                await page.set_viewport_size({'width': width, 'height': 900 if width == 1280 else 800})
                await page.locator('#resources-open').click()
                assert not await page.locator('#resources-dialog').evaluate('(d)=>d.scrollWidth>d.clientWidth||d.querySelector(".account-manager-body").scrollWidth>d.querySelector(".account-manager-body").clientWidth')
                assert await page.locator('.content-management #content-check,.image-management #image-clear,.resource-diagnostics-actions #resource-diagnostics').count() == 3
                await page.screenshot(path=artifact_path(f'local/checks/resource-sections/{locale}-{width}.png'))
                await page.locator('#close-resources').click()
                await expect(page.locator('#resources-open')).to_be_focused()
        assert not errors, errors
        assert not uploads, uploads
        artifact_path('local/checks/resource-sections/check.json').write_text(json.dumps({'checks': checks, 'locales': ['zh-CN', 'ja'], 'widths': [1280, 760, 360], 'page_errors': errors, 'uploads': uploads}, ensure_ascii=False, indent=2))
        await browser.close()
        print('\n'.join(checks))
        print('中日文桌面和窄屏检查通过，无页面异常或数据上传。')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    asyncio.run(check(parser.parse_args().url))
