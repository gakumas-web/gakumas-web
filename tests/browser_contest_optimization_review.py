"""验证评审调整后的配置摘要、原生输入校验、高级设置保留与响应式布局。"""
from pathlib import Path
from playwright.sync_api import sync_playwright,expect


def check(url,output=None):
 with sync_playwright() as p:
  browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':900});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000)
  page.locator('[data-tab="seasonSimulation"]').click();page.locator('[data-mode="optimization"]').click();panel=page.locator('#contest-optimization')
  expect(panel.locator('.recommendation-characters legend')).to_contain_text('模拟偶像：');expect(panel.locator('.optimization-exclusive-identity')).to_have_count(2)
  expect(panel.locator('.optimization-configuration')).to_contain_text('待填写或修正：Vo、Da、Vi、体力')
  panel.locator('.optimization-start').click();expect(panel.locator('[data-optimization-attribute=vocal]')).to_be_focused();expect(panel.locator('#optimization-error-vocal')).to_be_visible()
  for key,value in [('vocal','1999'),('dance','1800'),('visual','1700'),('stamina','40')]:panel.locator(f'[data-optimization-attribute={key}]').fill(value)
  expect(panel.locator('.optimization-configuration')).to_contain_text('配置完成');expect(panel.locator('#optimization-error-vocal')).to_be_hidden()
  advanced=panel.locator('.optimization-advanced');advanced.locator('summary').click();panel.locator('#optimization-strength').select_option('standard');panel.get_by_placeholder('留空时随机').fill('42');advanced.locator('summary').click()
  expect(advanced.locator('summary')).to_contain_text('标准');expect(advanced.locator('summary')).to_contain_text('种子 42')
  advanced.locator('summary').click();expect(panel.get_by_placeholder('留空时随机')).to_have_value('42');advanced.locator('summary').click()
  before=panel.locator('[data-optimization-attribute]').evaluate_all('nodes=>nodes.map(n=>n.value)');panel.locator('.recommendation-character[aria-checked=false]').first.click();assert panel.locator('[data-optimization-attribute]').evaluate_all('nodes=>nodes.map(n=>n.value)')==before;expect(panel.locator('.optimization-change-notice')).to_be_visible()
  page.wait_for_function("!document.querySelector('[data-optimization-multiplier=vocal]').textContent.includes('待计算')")
  for width in [1440,1280,768,390,360,320]:
   page.set_viewport_size({'width':width,'height':900});assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
   fields=panel.locator('.optimization-attributes>.optimization-field');assert abs(fields.nth(0).bounding_box()['y']-fields.nth(1).bounding_box()['y'])<2
   if output:output.mkdir(parents=True,exist_ok=True);panel.screenshot(path=str(output/f'configuration-{width}.png'))
  page.locator('#language').select_option('ja');assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
  if output:panel.screenshot(path=str(output/'configuration-ja-320.png'))
  assert not errors,errors;browser.close()
 print('配置摘要、字段定位、倍率说明、高级设置保留、角色切换及六种宽度/日文检查通过。')
