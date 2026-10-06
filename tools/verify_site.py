"""对最终 Pages 入口验证基础小包、缓存复用、卡图分级与状态界面。"""
import argparse,datetime,json,re,hashlib,urllib.request
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url',required=True)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--expected-commit')
args=parser.parse_args();url=args.url.rstrip('/')+'/'
with urllib.request.urlopen(url+'release.json',timeout=30) as response:release_bytes=response.read()
release=json.loads(release_bytes)
captured_at=datetime.datetime.now(datetime.timezone.utc).isoformat()
if args.expected_commit:assert release.get('source_commit')==args.expected_commit, '发布提交不匹配'
assert release['version']==json.loads((root/'package.json').read_text())['version']
for name in ['app.mjs','ui/card-rewards.mjs','application/image-manager.mjs','application/content-manager.mjs','application/loading-metrics.mjs','application/view-state.mjs','resources.mjs','ui/illustrations.mjs','ui/ending-rewards.mjs','ui/image-loading.mjs','ui/content-controls.mjs','style.css','startup.js']:
 assert release['files'][name]==hashlib.sha256((root/name).read_bytes()).hexdigest(), '线上程序身份尚未更新: '+name
for name in ['ui/card-rewards.mjs','application/content-manager.mjs']:
 with urllib.request.urlopen(url+name,timeout=30) as response:
  assert hashlib.sha256(response.read()).hexdigest()==release['files'][name], '线上脚本与发布清单不一致: '+name
with sync_playwright() as driver:
 browser=driver.chromium.launch(headless=True);context=browser.new_context();page=context.new_page();requests=[];failures=[];errors=[]
 context.on('request',lambda r:requests.append((r.url,r.method,bool(r.post_data))))
 page.on('requestfailed',lambda r:failures.append({'url':r.url,'failure':r.failure}))
 page.on('pageerror',lambda error:errors.append(str(error)))
 response=page.goto(url,wait_until='domcontentloaded',timeout=60000);assert response.status==200
 expect(page.locator('#empty-import-account')).to_be_enabled(timeout=60000)
 page.evaluate("""async()=>{window.onlineImages=(await import('./resources.mjs')).imageManager;window.onlineConfig=(await import('./image-config.mjs')).imageConfig;window.onlineContent=(await import('./application/content-manager.mjs')).contentManager;}""")
 page.wait_for_function("()=>onlineContent.status().phase==='ready'&&onlineImages.status().phase==='ready'&&onlineImages.status().total>0&&onlineImages.status().completed===onlineImages.status().total",timeout=120000)
 initial=page.evaluate("({status:onlineImages.status(),groups:Object.fromEntries(onlineConfig.loadingPlan.packages.map(pack=>[pack.url.split('/').at(-1),pack.group])),core:onlineConfig.loadingPlan.groups.find(group=>group.group==='core')})")
 image_requests=lambda:[address for address,_,_ in requests if '/image-files/' in address]
 first=list(image_requests());assert len(first)==initial['core']['packages'] and all(initial['groups'][address.rsplit('/',1)[-1]]=='core' for address in first)
 expect(page.locator('#startup-status')).to_be_hidden();expect(page.locator('#resource-toggle')).to_have_attribute('aria-expanded','false')
 expect(page.locator('#resource-complete')).to_contain_text('MiB')
 page.reload(wait_until='networkidle',timeout=60000)
 page.evaluate("""async()=>{window.onlineImages=(await import('./resources.mjs')).imageManager;window.onlineConfig=(await import('./image-config.mjs')).imageConfig;}""")
 page.wait_for_function("()=>onlineImages.status().phase==='ready'&&onlineImages.status().total>0&&onlineImages.status().completed===onlineImages.status().total",timeout=60000)
 assert len(image_requests())==len(first)
 name=page.evaluate("Object.keys(onlineConfig.loadingPlan.thumbnails).find(name=>name.includes('cidol-'))")
 dimensions={};phases=[['core']*len(first)]
 for kind,variant in [('thumbnail','idol-art'),('full','idol-full')]:
  group=page.evaluate("({name,kind})=>{const logical=kind==='thumbnail'?onlineConfig.loadingPlan.thumbnails[name]:name;const key=onlineConfig.loadingPlan.files[logical].sha256+'.webp';return onlineConfig.loadingPlan.packages.find(pack=>pack.objects[key]).group;}",{'name':name,'kind':kind})
  before=len(image_requests())
  page.evaluate("""async({name,kind,variant})=>{const {illustration}=await import('./ui/illustrations.mjs');const node=illustration(name.split('/')[1],'公开图片验证',variant);node.id='online-'+kind;document.body.append(node);}""",{'name':name,'kind':kind,'variant':variant})
  img=page.locator('#online-'+kind+' img');expect(img).to_have_attribute('src',re.compile('^blob:'),timeout=120000)
  dimensions[kind]=img.evaluate('async image=>{await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};}')
  groups=[initial['groups'][address.rsplit('/',1)[-1]] for address in image_requests()[before:]]
  assert groups==[group],groups;phases.append(groups)
 assert max(dimensions['thumbnail'].values())<=384 and max(dimensions['full'].values())>384
 page.evaluate("document.querySelector('#online-thumbnail').remove();document.querySelector('#online-full').remove()")
 assert page.evaluate("async()=>{const {WEB_VERSION}=await import('./application/version.mjs');return WEB_VERSION;}")==json.loads((root/'package.json').read_text())['version'].split('-')[0]
 page.evaluate("""async()=>{const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('catalog');const {illustration}=await import('./ui/illustrations.mjs');const node=illustration(undefined,'角色占位验证','idol-art',{characterId:'hski'});node.id='online-placeholder';document.body.append(node);}""")
 icon=page.locator('#online-placeholder .character-fallback-icon');expect(icon).to_have_attribute('src',re.compile('^blob:'),timeout=120000)
 placeholder=icon.evaluate("async image=>{await image.decode();const box=image.getBoundingClientRect();return {width:box.width,height:box.height,fit:getComputedStyle(image).objectFit,naturalWidth:image.naturalWidth};}")
 assert placeholder['width']<=32 and placeholder['height']<=32 and placeholder['fit']=='scale-down'
 page.locator('#online-placeholder').evaluate('(node)=>node.remove()')
 page.set_viewport_size({'width':375,'height':812});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not failures,failures
 assert not errors,errors
 assert all(method in ('GET','HEAD') and not body and urlsplit(address).netloc==urlsplit(url).netloc for address,method,body in requests if address.startswith(('https://','http://')))
 result={'captured_at':captured_at,'entry_url':url,'release_sha256':hashlib.sha256(release_bytes).hexdigest(),'source_commit':release.get('source_commit'),'build_run_id':release.get('build_run_id'),'browser_version':browser.version,'cache_scenarios':['fresh-context','reload-same-context'],'program_version':release['version'],'character_placeholder':placeholder,'core_objects':initial['status']['completed'],'core_bytes':initial['core']['bytes'],'initial_image_requests':len(first),'reload_image_requests':0,'download_groups':phases,'dimensions':dimensions,'same_origin_only':True,'page_errors':errors,'request_failures':failures,'mobile_overflow':False,'startup_and_collapsed_status':True}
 args.output.parent.mkdir(parents=True,exist_ok=True)
 args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(result,ensure_ascii=False));context.close();browser.close()
