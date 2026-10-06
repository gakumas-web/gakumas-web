"""从真实静态构建验证等待反馈、偏好隔离、Ending 三态和旧用途包失效后的刷新。"""
import argparse
import base64
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from PIL import Image
from playwright.sync_api import sync_playwright, expect
from test_content_install import fixture, build, ROOT
from prepare_locks import prepare
from browser_static import fixtures, ACCOUNT


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def end_headers(self):
        self.send_header('Cache-Control','no-store');super().end_headers()


def check(browser_path=None):
    (ROOT/'local').mkdir(exist_ok=True)
    with TemporaryDirectory(dir=ROOT/'local', prefix='review-browser-') as temp:
        root=Path(temp)
        server=ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(root)))
        thread=Thread(target=server.serve_forever, daemon=True);thread.start()
        origin=f'http://127.0.0.1:{server.server_port}'
        try:
            sample=json.loads((ROOT/'tests/contracts/image-delivery-v1.json').read_text())
            source=root/'source';(source/'objects').mkdir(parents=True)
            for version,color in [('one','red'),('two','blue')]:
                index=json.loads(json.dumps(sample['versions']['one']))
                index['version']=version;index['cdn_base_url']=origin+'/source/'
                for pack in index['baseline']['packages']:
                    raw=base64.b64decode(sample['packages'][pack['url']]);name=pack['sha256']+'.tar.gz'
                    (source/name).write_bytes(raw);pack['url']=origin+'/source/'+name
                image=io.BytesIO();Image.new('RGB',(32,64),color).save(image,'WEBP');raw=image.getvalue();sha=hashlib.sha256(raw).hexdigest()
                (source/'objects'/(sha+'.webp')).write_bytes(raw)
                index['files']['images/img_review_full.webp']={'sha256':sha,'bytes':len(raw)};index['cdn_objects']=[sha+'.webp']
                face=io.BytesIO();Image.new('RGB',(24,24),'green').save(face,'WEBP');face_bytes=face.getvalue();face_sha=hashlib.sha256(face_bytes).hexdigest()
                (source/'objects'/(face_sha+'.webp')).write_bytes(face_bytes)
                index['files']['images/img_sd_hski_face-00.webp']={'sha256':face_sha,'bytes':len(face_bytes)};index['cdn_objects'].append(face_sha+'.webp')
                fixture(root,version,index,characters={'test':'合成角色','hski':'合成咲季'});prepare(root/version,root/('locks-'+version))
                build(root/version/'dist',root/('locks-'+version)/'asset-lock.json',root/('locks-'+version)/'content-lock.json',mirror_images=True)
            site=root/'live'/'dist';site.parent.mkdir();(root/'one'/'dist').rename(site)
            url=origin+'/live/dist/'
            with sync_playwright() as driver:
                browser=driver.chromium.launch(headless=True,**({'executable_path':browser_path} if browser_path else {}))
                context=browser.new_context(has_touch=True);page=context.new_page();errors=[];requests=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                context.on('request',lambda request:requests.append((request.url,request.method,request.post_data)))
                held=[];pattern='**/content/releases/one/catalog.json'
                context.route(pattern,lambda route:held.append(route))
                page.goto(url,wait_until='domcontentloaded')
                expect(page.locator('#resource-status')).to_be_visible()
                expect(page.locator('#image-notice')).to_contain_text('公开资料')
                expect(page.locator('#empty-import-account')).to_be_enabled()
                # 阻断实际资料文件，验证全局入口能恢复。
                expect(page.locator('#resource-content-status')).to_contain_text(re.compile('下载|校验'))
                held[0].fulfill(status=503,body='unavailable')
                context.unroute(pattern)
                expect(page.locator('#resource-content-retry')).to_be_visible()
                page.locator('#resource-content-retry').click()
                expect(page.locator('#image-notice')).to_contain_text('当前所需图片已准备好',timeout=20000)
                assert page.evaluate("document.querySelector('#resource-content-progress').value===document.querySelector('#resource-content-progress').max")
                account=root/'account'
                for name,document in fixtures().items():
                    if name=='capture':document['memories'][0]['examBattleProduceCards']=[document['memories'][0]['produceCard']]
                    target=account/name/'snapshot.json';target.parent.mkdir(parents=True);target.write_text(json.dumps(document))
                page.locator('#account-directory-files').set_input_files(str(account))
                expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
                # 对本地偏好边界逐项恢复，账号和导出入口始终可用。
                cases=['{','null','[]',json.dumps({'views':None}),json.dumps({'tab':'retired','views':{'achievements':{'query':[],'page':'bad'}}})]
                for raw in cases:
                    page.evaluate("args=>localStorage.setItem('gakumas-web:view:'+args.profile,args.raw)",{'profile':'account-'+ACCOUNT,'raw':raw})
                    page.reload(wait_until='networkidle')
                    expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
                    expect(page.locator('#message')).to_contain_text('视图偏好已恢复默认')
                    expect(page.locator('[data-tab="memories"]')).to_have_attribute('aria-pressed','true')
                page.locator('#data-open').click();page.locator('#export-account-package').click()
                with page.expect_download() as download:page.locator('#package-download').click()
                backup=root/'recovered-account.json';download.value.save_as(str(backup));assert backup.stat().st_size>0
                page.locator('#close-data').click()
                # 新账号导入同样经过偏好归一化，再切回原账号。
                second=ACCOUNT+'-second';second_folder=root/'account-second'
                for name,document in fixtures().items():
                    document['publicUserId']=second;target=second_folder/name/'snapshot.json';target.parent.mkdir(parents=True);target.write_text(json.dumps(document))
                page.evaluate("profile=>localStorage.setItem('gakumas-web:view:account-'+profile,'{')",second)
                page.locator('#account-directory-files').set_input_files(str(second_folder))
                expect(page.locator('#profile')).to_have_value('account-'+second)
                page.locator('#profile').select_option('account-'+ACCOUNT)
                expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
                # 快速切页只结算最后一次前台请求，并提供起止时间。
                page.locator('[data-tab="idolCards"]').click();page.locator('[data-tab="achievements"]').click()
                page.evaluate("async()=>{window.reviewMetrics=(await import('./application/loading-metrics.mjs')).loadingMetrics;}")
                page.wait_for_function("()=>window.reviewMetrics().runs.some(row=>row.name==='view'&&row.view==='achievements'&&row.outcome==='ready')")
                timing=page.evaluate("async()=>{const {loadingMetrics}=await import('./application/loading-metrics.mjs');return loadingMetrics().runs.filter(row=>row.name==='view');}")
                assert timing and all(row['durationMs']==row['endedAt']-row['startedAt'] for row in timing if 'endedAt' in row)
                page.locator('[data-tab="memories"]').click()
                tables=json.loads((ROOT/'tests/fixtures/public-data/ending-bonuses.json').read_text())['tables']
                observed=page.evaluate("""async tables=>{
                  const {endingBonusReference}=await import('./domain/ending-bonuses.mjs');
                  const {endingBadges,endingRewardCard}=await import('./ui/ending-rewards.mjs');
                  const unknown=endingBonusReference(tables,'hski'),missing=endingBonusReference(tables,'hski',{trueEndProduceTypes:[]});
                  const card=endingRewardCard(unknown);card.id='ending-review';document.body.append(card);
                  return {unknown:[...endingBadges(unknown).children].map(node=>node.dataset.recorded),missing:[...endingBadges(missing).children].map(node=>node.dataset.recorded),text:card.textContent};
                }""",tables)
                assert observed['unknown']==['unknown']*3 and observed['missing']==['not-recorded']*3
                assert '奖励参考' in observed['text']
                expect(page.locator('#ending-review button button')).to_have_count(0)
                trigger=page.locator('#ending-review .ending-state-trigger').first
                trigger.focus();trigger.press('Enter');expect(trigger).to_have_attribute('aria-expanded','true')
                page.keyboard.press('Escape');expect(trigger).to_have_attribute('aria-expanded','false')
                trigger.tap();expect(trigger).to_have_attribute('aria-expanded','true');page.keyboard.press('Escape')
                assert '未导入' in trigger.get_attribute('aria-label')
                # 角色占位只占 32px，天然小于 32px 的图标也不放大；图像到达不重建库存。
                page.evaluate("""async()=>{
                  const {illustration}=await import('./ui/illustrations.mjs');
                  const frame=illustration(undefined,'角色占位','idol-full',{characterId:'hski'});frame.id='character-fallback-review';document.body.append(frame);
                }""")
                page.wait_for_function("()=>{const image=document.querySelector('#character-fallback-review .character-fallback-icon');return image&&!image.hidden&&image.naturalWidth===24;}")
                icon=page.locator('#character-fallback-review .character-fallback-icon')
                assert icon.evaluate("node=>getComputedStyle(node).objectFit==='scale-down'&&node.getBoundingClientRect().width<=32&&node.getBoundingClientRect().height<=32")
                for width in [360,390]:
                    page.set_viewport_size({'width':width,'height':812})
                    page.evaluate("document.documentElement.style.fontSize='200%'")
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.evaluate("document.documentElement.style.fontSize=''")
                page.locator('#character-fallback-review').evaluate('(node)=>node.remove()')
                page.locator('#language').select_option('ja');page.set_viewport_size({'width':375,'height':812})
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.locator('#language').select_option('zh-CN');page.locator('#ending-review').evaluate('(node)=>node.remove()')
                # 无新增图片、缩略图就绪、完整图片就绪三态保持同一库存节点、选择和数值。
                page.locator('#list .pick input').check()
                page.evaluate("""()=>{window.reviewRow=document.querySelector('#list [data-memory-key]');window.scrollTo(0,100);window.reviewBusiness=()=>({key:window.reviewRow.dataset.memoryKey,same:document.querySelector('#list [data-memory-key]')===window.reviewRow,stats:window.reviewRow.querySelector('.memory-card-stats').textContent,selected:window.reviewRow.querySelector('.pick input').checked,count:document.querySelectorAll('#list [data-memory-key]').length,scroll:scrollY,query:document.querySelector('#search').value});}""")
                no_images=page.evaluate('()=>window.reviewBusiness()')
                page.evaluate("""async()=>{const {illustration}=await import('./ui/illustrations.mjs');const image=illustration('img_review_full.webp','合成卡面','idol-art',{characterId:'hski'});image.id='business-image';document.body.append(image);}""")
                page.wait_for_function("()=>{const image=document.querySelector('#business-image>img');return image&&!image.hidden&&image.src.startsWith('blob:')&&image.naturalWidth===32;}")
                partial_images=page.evaluate('()=>window.reviewBusiness()')
                page.evaluate("async()=>{const {imageManager}=await import('./resources.mjs');await imageManager.complete();}")
                all_images=page.evaluate('()=>window.reviewBusiness()')
                assert no_images==partial_images==all_images and all_images['selected'] and all_images['same']
                page.locator('#business-image').evaluate('(node)=>node.remove()')
                page.evaluate("async()=>{const {imageManager}=await import('./resources.mjs');await imageManager.clear();}")
                page.reload(wait_until='networkidle')
                expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
                # 注入真实 IndexedDB 事务中止，核对对象和分段标记不会部分提交。
                transaction_result=page.evaluate("""async()=>{
                  const {createImageStore}=await import('./application/image-store.mjs');const store=createImageStore();
                  await store.put('retained',new Blob(['ok']));const original=IDBDatabase.prototype.transaction;
                  let injected=false,rejected=false;
                  IDBDatabase.prototype.transaction=function(...args){const tx=original.apply(this,args);if(!injected&&this.name==='gakumas-public-images'&&args[1]==='readwrite'){injected=true;queueMicrotask(()=>tx.abort());}return tx;};
                  try{await store.pack('aborted',new Map([['aborted-object',new Blob(['no'])]]));}catch{rejected=true;}finally{IDBDatabase.prototype.transaction=original;}
                  return {rejected,objectMissing:await store.get('aborted-object')===undefined,markerMissing:await store.meta('pack:aborted')===undefined,retained:await (await store.get('retained')).text()};
                }""")
                assert transaction_result=={'rejected':True,'objectMissing':True,'markerMissing':True,'retained':'ok'}
                # 浏览器真实配额拒绝：仍走生产存储事务，不伪造存储回执。
                quota_context=driver.chromium.launch_persistent_context(str(root/'quota-profile'),headless=True,**({'executable_path':browser_path} if browser_path else {}))
                quota_page=quota_context.new_page();quota_page.goto(url,wait_until='networkidle')
                quota_page.evaluate("async()=>{const {createImageStore}=await import('./application/image-store.mjs');await createImageStore().put('retained',new Blob(['ok']));}")
                cdp=quota_context.new_cdp_session(quota_page);cdp.send('Storage.overrideQuotaForOrigin',{'origin':origin,'quotaSize':1})
                try:
                    quota=quota_page.evaluate("""async()=>{const {createImageStore}=await import('./application/image-store.mjs');const store=createImageStore();let error;try{await store.put('quota-probe',new Blob([new Uint8Array(2*1024*1024)]));await store.put('quota-probe-next',new Blob([new Uint8Array(32*1024*1024)]));}catch(caught){error=caught.name;}return {error,retained:await (await store.get('retained')).text()};}""")
                    assert quota['retained']=='ok' and quota.get('error') in (None,'QuotaExceededError')
                    quota_verified=quota.get('error')=='QuotaExceededError'
                    quota_state=cdp.send('Storage.getUsageAndQuota',{'origin':origin})
                    if not quota_verified:assert quota_state['overrideActive'] and quota_state['usage']>quota_state['quota']
                finally:cdp.send('Storage.overrideQuotaForOrigin',{'origin':origin});cdp.detach();quota_context.close()
                # 两个标签页共用实际数据库，关闭一个页面不影响另一个页面继续读取。
                peer=context.new_page();peer.goto(url,wait_until='networkidle')
                peer.evaluate("""async()=>{const {createImageStore}=await import('./application/image-store.mjs');await createImageStore().put('peer-probe',new Blob(['shared']));}""")
                peer.close()
                assert page.evaluate("""async()=>{const {createImageStore}=await import('./application/image-store.mjs');return (await createImageStore().get('peer-probe')).text();}""")=='shared'
                # 两次真实构建的原图与用途包哈希不同；旧页尚未请求这一张原图。
                before=len(requests);site.rename(root/'previous');(root/'two'/'dist').rename(site)
                page.evaluate("""async()=>{const {assetURL}=await import('./resources.mjs');const image=new Image();image.src=assetURL('img_review_full.webp');document.body.append(image);}""")
                expect(page.locator('#image-notice')).to_contain_text('图片文件不存在')
                expect(page.locator('#resource-refresh')).to_be_visible()
                assert any('/image-files/' in address for address,_,_ in requests[before:])
                page.locator('#resource-refresh').click();page.wait_for_load_state('networkidle')
                expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
                expect(page.locator('#content-version')).to_contain_text('two')
                page.evaluate("""async()=>{const {assetURL}=await import('./resources.mjs');const image=new Image();image.id='new-art';image.src=assetURL('img_review_full.webp');document.body.append(image);}""")
                page.wait_for_function("()=>document.querySelector('#new-art').src.startsWith('blob:')&&document.querySelector('#new-art').naturalWidth===32")
                upgrade_context=browser.new_context();upgrade_a=upgrade_context.new_page();upgrade_b=upgrade_context.new_page()
                for tab in [upgrade_a,upgrade_b]:
                    tab.goto(url,wait_until='networkidle')
                    tab.evaluate("async()=>{const {createImageStore}=await import('./application/image-store.mjs');window.upgradeStore=createImageStore();await window.upgradeStore.get('probe');}")
                upgraded=upgrade_b.evaluate("""()=>new Promise((resolve,reject)=>{const request=indexedDB.open('gakumas-public-images',2);let blocked=false;const timer=setTimeout(()=>reject(new Error('upgrade-blocked')),3000);request.onblocked=()=>{blocked=true;};request.onerror=()=>{clearTimeout(timer);reject(request.error);};request.onsuccess=()=>{clearTimeout(timer);request.result.close();resolve(!blocked);};})""")
                assert upgraded;upgrade_context.close()
                assert not errors,errors
                assert all(method in ('GET','HEAD') and not body for _,method,body in requests)
                context.close();browser.close()
            return {'slow_content_visible':True,'content_retry':True,'preference_recovery_keeps_account':True,'recovery_export_and_account_switch':True,'view_timing':True,'keyboard_touch_ending':True,'character_icon_not_enlarged':True,'text_zoom':True,'transaction_abort_atomic':True,'real_quota_error':quota_verified,'quota_override_enforced':quota_verified,'two_tabs_shared_cache':True,'versionchange_closes_old_connections':True,'image_states_preserve_business_selection_scroll':True,'ending_unknown':True,'mobile_japanese':True,'two_build_stale_pack_refresh':True,'no_upload':True,'page_errors':len(errors)}
        finally:
            server.shutdown();server.server_close();thread.join()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--browser');args=parser.parse_args()
    print(json.dumps(check(args.browser),ensure_ascii=False))
