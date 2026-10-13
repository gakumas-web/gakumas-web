"""用可区分的合成数值验证主副槽位与选择顺序无关。"""
from browser_simulation_helpers import select_season
import copy,json,sys
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'tests'))
from browser_static import fixtures
with TemporaryDirectory(dir=root/'local') as temp,sync_playwright() as p:
 docs=fixtures();base=docs['capture']['memories'][0];rows=[]
 for name,vo,da,vi,st,power,upgrade in [('main',1001,1101,1201,31,10000,0),('sub',2009,2109,2209,49,20000,1)]:
  row=copy.deepcopy(base);row.update(userMemoryId='synthetic-order-'+name,vocal=vo,dance=da,visual=vi,stamina=st,power=power,planType=2,examBattleProduceCards=[{'id':'synthetic-order-skill','upgradeCount':upgrade,'customizes':[{'id':'synthetic-order-custom','customizeCount':1}]}]);rows.append(row)
 docs['capture'].update(memories=rows,count=2);folder=Path(temp)/'account'
 for name,doc in docs.items():
  path=folder/name/'snapshot.json';path.parent.mkdir(parents=True);path.write_text(json.dumps(doc))
 b=p.chromium.launch();page=b.new_page(viewport={'width':1440,'height':1100});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('http://127.0.0.1:8080/',wait_until='networkidle');page.locator('#account-directory-files').set_input_files(str(folder));expect(page.locator('#inventory')).to_be_visible(timeout=60000);page.locator('#season-simulation-open').click();expect(page.locator('#season-simulation-page')).to_be_visible(timeout=30000)
 select_season(page,'contest:pvp_rate_config-53');page.locator('[data-stage-id="contest:pvp_rate_config-53:0"]').click()
 def choose(slot,number):
  page.locator('.season-memory-slot-pick').nth(slot).click();page.locator('.contest-memory-option').nth(number).locator('.contest-memory-choose').click()
 def verify():
  for attribute,value in [('vocal',1402),('dance',1522),('visual',1642),('stamina',40)]:expect(page.locator(f'.season-board-stat[data-attribute="{attribute}"] > strong')).to_have_text(str(value))
  expect(page.locator('.season-board-power > strong')).to_have_text('14000')
  expect(page.locator('.season-memory-row').nth(0).locator('[data-config-id="synthetic-order-skill"]')).to_have_attribute('data-retained','true')
  expect(page.locator('.season-memory-row').nth(1).locator('[data-config-id="synthetic-order-skill"]')).to_have_attribute('data-retained','false')
 for order in [(0,1),(1,0)]:
  for index in order:choose(index,index)
  verify();page.locator('.season-simulation-footer button').first.click()
 choose(1,1);expect(page.locator('.season-team-summary')).to_have_count(0);choose(0,0);verify()
 page.locator('.season-slot-actions').first.locator('button').click();expect(page.locator('.season-team-summary')).to_have_count(0);choose(0,0);verify()
 assert not errors,errors;b.close()
print('主先副后、副先主后、移除主卡再选：主卡附魔优先与四项属性贡献全部一致。')
