"""验证专属道具说明、额外道具多选草稿与主回忆评级名额。"""
from browser_artifacts import artifact_path
from pathlib import Path
from playwright.sync_api import sync_playwright,expect


def check(url,output=None):
 with sync_playwright() as p:
  browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':950});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab="seasonSimulation"]').click();page.locator('[data-mode="optimization"]').click()
  panel=page.locator('#contest-optimization');fixed=panel.locator('[data-optimization-item="0"]');expect(fixed).to_be_enabled();fixed.evaluate("e=>e.scrollIntoView({block:'center',behavior:'instant'})");page.mouse.move(0,0);page.wait_for_timeout(600);fixed.hover();expect(page.locator('.support-reward-popover:popover-open .support-item-description')).to_be_visible();page.keyboard.press('Escape');page.keyboard.press('Escape')
  expect(panel.locator('.season-item-empty')).to_have_count(0);expect(panel.locator('.optimization-items-open')).to_have_count(1)
  panel.locator('[data-optimization-grade="0"]').select_option('15');panel.locator('.optimization-items-open').click();dialog=page.locator('.optimization-picker');choices=dialog.locator('[role=checkbox]');assert choices.count()>=4
  for index in range(3):choices.nth(index).click()
  expect(dialog.locator('.optimization-picker-count')).to_have_text('额外道具 3/3');expect(choices.nth(3)).to_have_attribute('aria-disabled','true')
  # 实际指针仍能查看效果，名额已满时不能把第四件加入草稿。
  choices.nth(3).click(force=True);expect(dialog.locator('[aria-checked=true]')).to_have_count(3);expect(page.locator('.support-reward-popover:popover-open .support-item-description')).to_be_visible();page.keyboard.press('Escape')
  dialog.get_by_role('button',name='取消',exact=True).click();expect(panel.locator('[data-optimization-selected-item]')).to_have_count(0)
  panel.locator('.optimization-items-open').click();dialog=page.locator('.optimization-picker');choices=dialog.locator('[role=checkbox]')
  for index in range(3):choices.nth(index).click()
  dialog.locator('.optimization-picker-confirm').click();expect(panel.locator('[data-optimization-selected-item]')).to_have_count(3);expect(panel.locator('.optimization-items-open')).to_be_focused()
  first=panel.locator('[data-optimization-selected-item]').first.get_attribute('data-optimization-selected-item')
  panel.locator('[data-optimization-grade="0"]').select_option('13');expect(panel.locator('[data-optimization-selected-item]')).to_have_count(2);expect(panel.locator('.optimization-change-notice')).to_contain_text('保留 2 个额外道具');assert panel.locator('[data-optimization-selected-item]').first.get_attribute('data-optimization-selected-item')==first
  panel.locator('[data-optimization-grade="1"]').select_option('9');expect(panel.locator('.optimization-items>h3')).to_contain_text('额外道具 2/2')
  panel.locator('.optimization-items-open').click();dialog=page.locator('.optimization-picker');dialog.locator('[aria-checked=true]').first.click();page.keyboard.press('Escape');expect(dialog.locator('[aria-disabled=true]')).to_have_count(0);dialog.locator('[role=checkbox][aria-checked=false]').last.click();expect(dialog.locator('.optimization-picker-count')).to_have_text('额外道具 2/2');page.keyboard.press('Escape')
  if output:output.mkdir(parents=True,exist_ok=True)
  for width in [1280,375,320]:
   page.set_viewport_size({'width':width,'height':950});assert dialog.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
   if output:dialog.screenshot(path=artifact_path(str(output/f'items-{width}.png')))
  dialog.locator('.optimization-picker-confirm').click();expect(panel.locator('[data-optimization-selected-item]')).to_have_count(2)
  page.locator('#language').select_option('ja');expect(page.locator('.optimization-items>h3')).to_contain_text('追加アイテム 2/2');page.locator('#language').select_option('zh-CN')
  if output:panel.locator('.optimization-items').screenshot(path=artifact_path(str(output/'items-form-320.png')))
  page.locator('.optimization-items-open').click();dialog=page.locator('.optimization-picker');dialog.get_by_role('button',name='清空选择').click();dialog.locator('.optimization-picker-confirm').click();expect(page.locator('[data-optimization-selected-item]')).to_have_count(0)
  assert not errors,errors;browser.close()
 print('专属效果、单入口多选、2/3名额、满额取消、草稿取消、降级保留、主副隔离及中日/三种宽度通过。')


if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');parser.add_argument('--output',type=Path);args=parser.parse_args();check(args.url,args.output)
