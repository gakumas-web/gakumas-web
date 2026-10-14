"""用公开合成预览验证专属附魔草稿、主副独立约束、评级降级及图片选择布局。"""
from browser_artifacts import artifact_path
from pathlib import Path
from playwright.sync_api import sync_playwright,expect


def check(url,output=None):
 errors=[]
 if output:output.mkdir(parents=True,exist_ok=True)
 with sync_playwright() as p:
  browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':950});page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('[data-tab="seasonSimulation"]').click();page.locator('[data-mode="optimization"]').click()
  setup=page.evaluate("""async()=>{const c=await import('./domain/catalog.mjs'),m=await import('./application/contest-optimization-input.mjs'),data=await(await fetch('./resources/preview-account.json')).json(),doc=data.documents.find(d=>Array.isArray(d.idolCards)),stage=c.contestCatalog().choices.find(r=>r.id===document.querySelector('.season-stage-tab[aria-selected=true]').dataset.stageId),context={stage,idolCards:doc.idolCards,supportCards:doc.supportCards,producerLevel:null,conversionRules:[]};for(const choice of m.optimizationChoiceCatalog(context).exclusive){if(m.optimizationExclusiveCustomizationLimit(context,{exclusiveId:choice.id,grade:15})<1)continue;for(const version of choice.versions){const custom=c.cardCustomizations({id:choice.id,upgradeCount:version.upgradeCount,customizes:[]});if(custom?.options.some(o=>o.levels.some(l=>l.level===1))){const {validateContestOptimizationOptions}=await import('./domain/contest-engine-runner.mjs');for(const option of custom.options.filter(o=>o.levels.some(l=>l.level===1))){const result=await validateContestOptimizationOptions([{key:'fixture',entry:c.contestSimulationReference('card',{id:choice.id,upgradeCount:version.upgradeCount,customizes:[{id:option.id,customizeCount:1}]})}]);if(!result.unsupported.length)return {id:choice.id,characterId:choice.metadata.ownerCharacterId,upgrade:version.upgradeCount};}}}}return null;}""")
  assert setup,'合成预览应存在已解锁附魔的专属技能'
  def assert_customization(index,count):
   badge=page.locator(f'.optimization-role [data-slot="{index}"] .season-memory-slot-pick>.selection-custom-count')
   if count:expect(badge).to_have_text(str(count))
   else:expect(badge).to_have_count(0)
   page.locator(f'.optimization-role [data-slot="{index}"] .season-memory-slot-pick').click()
   active=page.locator('.optimization-picker');assert sum(int(value) for value in active.locator('.contest-customizer-stepper output').all_text_contents())==count
   active.locator('.dialog-head button').click()
  page.locator(f'#contest-optimization .recommendation-character[data-character-id="{setup["characterId"]}"]').click();page.locator('[data-optimization-grade="0"]').select_option('15');page.locator('[data-optimization-grade="1"]').select_option('15')
  trigger=page.locator('.optimization-role [data-slot="0"] .season-memory-slot-pick');trigger.click();dialog=page.locator('.optimization-picker');dialog.locator(f'[data-choice-id="{setup["id"]}"]').click();page.keyboard.press('Escape');dialog.locator('#optimization-picker-enhanced').set_checked(setup['upgrade']>0)
  dialog.locator('.contest-customizer-stepper button[data-step="1"]:not(:disabled)').first.click();expect(dialog.locator('.contest-customizer-stepper.has-customization output')).to_have_text('1');expect(dialog.locator('.optimization-picker-confirm')).to_be_enabled()
  flow=dialog.locator('#optimization-picker-flow');flow.locator('button').last.click();expect(dialog.locator('.contest-customizer-stepper.has-customization output')).to_have_text('1');assert dialog.locator('.selection-source-column:visible').count()>0
  flow.locator('button[data-value=""]').click();enhanced=dialog.locator('#optimization-picker-enhanced');enhanced.set_checked(not (setup['upgrade']>0));expect(dialog.locator('.contest-customizer-stepper.has-customization')).to_have_count(0);enhanced.set_checked(setup['upgrade']>0);dialog.locator('.contest-customizer-stepper button[data-step="1"]:not(:disabled)').first.click()
  for width in [1280,375,320]:
   page.set_viewport_size({'width':width,'height':950});assert dialog.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
   if output:dialog.screenshot(path=artifact_path(str(output/f'exclusive-{width}.png')))
  dialog.locator('.optimization-picker-confirm').click();assert_customization(0,1)
  page.locator('.optimization-role [data-slot="1"] .season-memory-slot-pick').click();dialog=page.locator('.optimization-picker');dialog.locator(f'[data-choice-id="{setup["id"]}"]').click();page.keyboard.press('Escape');dialog.locator('#optimization-picker-enhanced').set_checked(setup['upgrade']>0);dialog.locator('.optimization-picker-confirm').click();assert_customization(1,0);assert_customization(0,1)
  page.locator('.optimization-role [data-slot="1"] .season-memory-slot-pick').click();dialog=page.locator('.optimization-picker');dialog.locator('.contest-customizer-stepper button[data-step="1"]:not(:disabled)').first.click();dialog.locator('.optimization-picker-confirm').click()
  trigger.click();dialog=page.locator('.optimization-picker');dialog.locator(f'[data-choice-id]:not([data-choice-id="{setup["id"]}"])').first.click();dialog.locator('.optimization-picker-confirm').click();assert_customization(1,1)
  trigger.click();dialog=page.locator('.optimization-picker');dialog.locator(f'[data-choice-id="{setup["id"]}"]').click();page.keyboard.press('Escape');dialog.locator('#optimization-picker-enhanced').set_checked(setup['upgrade']>0);dialog.locator('.contest-customizer-stepper button[data-step="1"]:not(:disabled)').first.click();dialog.locator('.optimization-picker-confirm').click()
  trigger.click();dialog=page.locator('.optimization-picker');dialog.locator('.contest-customizer-stepper button[data-step="-1"]:not(:disabled)').first.click();dialog.get_by_role('button',name='取消',exact=True).click();assert_customization(0,1)
  page.locator('[data-optimization-grade="0"]').select_option('9');expect(page.locator('.optimization-start')).to_be_disabled();expect(page.locator('.optimization-form')).to_contain_text('当前专属技能附魔不符合');assert_customization(0,1);page.locator('[data-optimization-grade="0"]').select_option('15')
  page.locator('#language').select_option('ja');assert_customization(0,1);page.locator('#language').select_option('zh-CN')
  page.locator('.optimization-items-open').click();dialog=page.locator('.optimization-picker');dialog.locator('[data-choice-id]').first.click();expect(page.locator('.support-reward-popover:popover-open .support-item-description')).to_be_visible();page.keyboard.press('Escape');assert dialog.evaluate('e=>e.scrollWidth<=e.clientWidth+1');dialog.get_by_role('button',name='清空选择').click();dialog.locator('.optimization-picker-confirm').click();expect(page.locator('[data-optimization-selected-item]')).to_have_count(0)
  assert not errors,errors;browser.close()
 print('专属技能确认/取消、同卡主副不同附魔、评级限制和语言保留、紧凑候选及三种宽度通过。')


if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');parser.add_argument('--output',type=Path);args=parser.parse_args();check(args.url,args.output)
