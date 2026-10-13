"""验证满级预览首次安装、旧经验补齐、公开上限变化及其他数据隔离。"""
from playwright.sync_api import sync_playwright,expect


def check(url):
 with sync_playwright() as p:
  browser=p.chromium.launch();page=browser.new_page();errors=[];uploads=[];downloads=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.on('request',lambda request:(uploads.append(request.url) if request.post_data else None,downloads.append(request.url) if 'preview-account.json' in request.url else None))
  page.goto(url,wait_until='networkidle');assert not downloads
  page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000)
  cap=page.evaluate("async()=>{await(await import('./application/master-loader.mjs')).loadMaster('account');return(await import('./domain/catalog.mjs')).accountProducerLevelCap();}")
  expect(page.locator('#profile option:checked')).to_contain_text(f'PLv.{cap["level"]}')
  page.locator('[data-tab="seasonSimulation"]').click();page.locator('[data-mode="optimization"]').click();expect(page.locator('.optimization-start')).to_be_enabled(timeout=60000)
  before=page.evaluate('''async()=>{
   const storage=await import('./application/storage.mjs'),libraryModule=await import('./application/personal-library.mjs'),profile='account-synthetic-preview-account',stored=await storage.profileData(profile);
   const library=new libraryModule.PersonalLibrary(profile);library.load();library.commit({...library.data,tags:[...library.data.tags,'经验补齐保留测试']});library.favorite('memories',stored.ordinary.snapshot.memories[0].key,true);
   const old=structuredClone(stored.ordinary.snapshot);delete old.producerExp;await storage.saveAccountDirectory(profile,{snapshot:old});
   const data=await(await fetch('./resources/preview-account.json')).json(),raw=structuredClone(data.documents.find(doc=>doc.source==='user_get'));raw.publicUserId='synthetic-level-other';raw.producerExp=40;const other=await(await import('./domain/model.mjs')).prepareSnapshot(raw);await storage.saveAccountDirectory('account-synthetic-level-other',{snapshot:other});
   const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(v=>v.toString(16).padStart(2,'0')).join('');
   return {ordinary:await digest(old),selection:await digest(stored.selection),history:await digest(await storage.snapshotHistory(profile)),library:localStorage.getItem(libraryModule.libraryKey(profile)),other:await digest(await storage.profileData('account-synthetic-level-other'))};
  }''')
  page.reload(wait_until='networkidle');expect(page.locator('#profile option:checked')).to_contain_text(f'PLv.{cap["level"]}',timeout=60000)
  after=page.evaluate('''async()=>{
   const storage=await import('./application/storage.mjs'),m=await import('./application/personal-library.mjs'),profile='account-synthetic-preview-account',stored=await storage.profileData(profile),ordinary=structuredClone(stored.ordinary.snapshot),exp=ordinary.producerExp;delete ordinary.producerExp;
   const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(v=>v.toString(16).padStart(2,'0')).join('');
   return {exp,ordinary:await digest(ordinary),selection:await digest(stored.selection),history:await digest(await storage.snapshotHistory(profile)),library:localStorage.getItem(m.libraryKey(profile)),other:await digest(await storage.profileData('account-synthetic-level-other'))};
  }''')
  assert after.pop('exp')==cap['totalExp'];assert after==before
  # 在隔离浏览器内安装更高的公开等级表，验证同步依据是表而非固定常量。
  future=page.evaluate('''async()=>{
   const channel=await(await fetch('./content/channel.json')).json(),part=await(await fetch('./content/releases/'+channel.version+'/progression.json')).json(),rows=structuredClone(part.progression.tables.ProducerLevel),last=rows.at(-1),next={level:last.level+1,totalExp:last.totalExp+10000};rows.push(next);
   const catalog=await import('./domain/catalog.mjs');catalog.installMaster({tables:Object.fromEntries(['ProduceCard','ProduceItem','MemoryAbility','ProduceSkill','ProduceEffect','ProduceExamEffect'].map(name=>[name,[]])),progression:{tables:{ProducerLevel:rows}}});const {ensurePreviewProducerExp}=await import('./application/preview-account.mjs');const changed=await ensurePreviewProducerExp(),again=await ensurePreviewProducerExp();const stored=await(await import('./application/storage.mjs')).profileData('account-synthetic-preview-account');return {changed,again,actual:stored.ordinary.snapshot.producerExp,expected:next.totalExp,level:catalog.accountProducerLevel(stored.ordinary.snapshot.producerExp),expectedLevel:next.level};
  }''')
  assert future['changed'] and not future['again'];assert future['actual']==future['expected'] and future['level']==future['expectedLevel'];assert not errors,errors;assert not uploads,uploads;browser.close()
 print('预览首次满级、旧档案补经验、标签收藏与选拔/历史/其他账号保留、上限增长及重复同步幂等，通过。')


if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
