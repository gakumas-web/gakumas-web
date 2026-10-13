"""通过内置预览与真实 Worker 验证任务反馈、推荐顺序和窄屏布局。"""
import argparse
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18766/');args=parser.parse_args()
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page(viewport={'width':1280,'height':1000});page.goto(args.url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab="seasonSimulation"]').click();expect(page.locator('.recommendation-character').first).to_be_visible(timeout=60000)
 for width in [1280,390,320]:
  page.set_viewport_size({'width':width,'height':1000});assert page.locator('.recommendation-count').bounding_box()['y']>page.locator('.recommendation-characters').bounding_box()['y'];assert page.locator('.recommendation-start').bounding_box()['y']>page.locator('.recommendation-count').bounding_box()['y']
 page.locator('.recommendation-start').click();expect(page.locator('.season-stage-tab').first.locator('.season-stage-task-status')).to_have_text('模拟中');page.locator('.season-stage-tab').nth(1).click();task=page.locator('.season-simulation-task');expect(task).to_have_count(1);expect(task).to_contain_text('推荐编组模拟');assert task.evaluate('e=>e.scrollWidth<=e.clientWidth');task.get_by_role('button',name='查看任务').click();expect(page.locator('.season-stage-tab').first).to_have_attribute('aria-selected','true');expect(page.locator('.recommendation-stop')).to_be_visible();page.locator('.season-stage-tab').nth(1).click();task.get_by_role('button',name='停止',exact=True).click();expect(task).to_have_count(0)
 page.locator('.season-stage-tab').first.click();expect(page.locator('.recommendation-status')).to_contain_text('推荐已停止');page.locator('.recommendation-character[data-character-id="hume"]').click();page.locator('.recommendation-start').click();page.locator('.season-stage-tab').nth(1).click();expect(task).to_contain_text('已完成',timeout=120000);task.get_by_role('button',name='查看任务').click();expect(page.locator('.recommendation-entry').first).to_be_visible();page.locator('.season-stage-tab').nth(1).click();expect(task).to_have_count(0)
 b.close()
print('推荐按钮顺序、窄屏布局、跨舞台任务查看/停止/完成提示通过。')
