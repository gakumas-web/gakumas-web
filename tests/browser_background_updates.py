"""验证账号导入等待及后台分包完成时保留已就绪的列表、图片、筛选和详情。"""
import argparse
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from browser_artifacts import artifact_path
from browser_custom_tag_export import account_documents, write_account, import_account
from browser_static import ROOT
from browser_tag_updates import wait_catalog

ACCOUNT = 'synthetic-background-updates'
OTHER_ACCOUNT = 'synthetic-background-updates-other'
TAG = '后台更新保留标签'
PRODUCER_EXP = 100000

# 仅暂挂真实文件读取和正式 Worker 已产生的完成消息，保留实际解析及校验结果。
BOUNDARY_PROBE = '''() => {
  const NativeWorker=window.Worker,nativeText=File.prototype.text;
  const probe=window.backgroundProbe={gate:localStorage.getItem('synthetic-background-gate'),held:[],requests:[],fileGate:false,fileHeld:[],fileReads:0,actualFileReads:0};
  probe.armFile=()=>{probe.fileGate=true;};
  probe.releaseFile=()=>{probe.fileGate=false;for(const resolve of probe.fileHeld.splice(0))resolve();};
  File.prototype.text=async function(...args){
    if(probe.fileGate&&this.name==='snapshot.json'){
      probe.fileReads++;await new Promise(resolve=>probe.fileHeld.push(resolve));
    }
    const value=await nativeText.apply(this,args);probe.actualFileReads++;return value;
  };
  probe.arm=hash=>{if(probe.held.length)throw Error('Unreleased content completion');probe.gate=hash;};
  probe.release=async()=>{
    probe.gate=null;const queued=probe.held.splice(0);
    for(const {worker,event,handler} of queued)handler.call(worker,event);
    await new Promise(resolve=>setTimeout(resolve,0));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return queued.map(({request,event})=>({...request,complete:event.data.complete}));
  };
  window.Worker=class extends NativeWorker {
    constructor(...args){
      super(...args);this.contentWorker=String(args[0]).includes('content-processing-worker.mjs');this.contentRequests=new Map();
      super.addEventListener('message',event=>{
        const handler=this.backgroundHandler;if(!handler)return;
        const request=this.contentRequests.get(event.data.id);
        if(request&&event.data.chunk)request.chunks++;
        // 缓存未命中的 value:undefined 必须立即透传，才能继续执行正式 parse 请求。
        if(request&&event.data.complete===true&&['cached','parse'].includes(request.kind)&&request.hash===probe.gate){
          probe.held.push({worker:this,event,handler,request});return;
        }
        handler.call(this,event);
      });
    }
    set onmessage(handler){this.backgroundHandler=handler;}
    get onmessage(){return this.backgroundHandler;}
    postMessage(value,...args){
      if(this.contentWorker){
        const request={kind:value.kind,hash:value.args?.hash??null,chunks:0};
        this.contentRequests.set(value.id,request);probe.requests.push(request);
      }
      return super.postMessage(value,...args);
    }
  };
}'''


def public_hashes(page):
    return page.evaluate('''async()=>{
      const {contentConfig}=await import('./content-config.mjs'),{appURL}=await import('./resources.mjs');
      const {contentManager}=await import('./application/content-manager.mjs');await contentManager.initialize();
      const errors=[];
      for(const source of [contentConfig.bootstrapChannelURL,contentConfig.channelURL].filter(Boolean)){
        try{
          const channelURL=new URL(source,appURL('')),channelResponse=await fetch(channelURL);
          if(!channelResponse.ok)throw Error('Public channel unavailable');
          const channel=await channelResponse.json(),manifestResponse=await fetch(new URL(channel.manifest,channelURL));
          if(!manifestResponse.ok)throw Error('Public manifest unavailable');
          const manifest=await manifestResponse.json();
          if(manifest.version!==contentManager.status().version)continue;
          return Object.fromEntries(['progression','achievements','abilities'].map(scope=>[scope,manifest.files[scope+'.json'].sha256]));
        }catch(error){errors.push(error.message);}
      }
      throw Error('No public manifest matches active content: '+errors.join('; '));
    }''')


def capture(page):
    page.evaluate('''()=>{
      const list=document.querySelector('#list');
      window.backgroundDOM={list,cards:[...list.children].filter(node=>!node.classList.contains('deferred-entry')),
        images:[...list.querySelectorAll('img')],chips:[...document.querySelectorAll('#active-filters .filter-chip')],
        detail:document.querySelector('#detail-content').firstElementChild,removed:0};
      window.backgroundObserver=new MutationObserver(records=>{
        for(const record of records)backgroundDOM.removed+=record.removedNodes.length;
      });
      backgroundObserver.observe(list,{childList:true});
    }''')


def measured(page, name, report, baseline, final=True):
    result = page.evaluate('''final=>{
      const probe=backgroundDOM;if(final)backgroundObserver.disconnect();
      return {cards:probe.cards.length,retainedCards:probe.cards.filter(node=>node.isConnected&&node.parentElement===probe.list).length,
        images:probe.images.length,imagesRetained:probe.images.every(node=>node.isConnected),
        chips:probe.chips.length,chipsRetained:probe.chips.every(node=>node.isConnected),
        hasDetail:Boolean(probe.detail),detailRetained:Boolean(probe.detail?.isConnected),removed:probe.removed};
    }''', final)
    report[name] = result
    # 基线只记录节点保留事实；输入锁定、真实结果和账号正确性仍须满足。
    if not baseline:
        assert result['cards'] > 0 and result['retainedCards'] == result['cards'], (name, result)
        assert result['images'] > 0 and result['imagesRetained'], (name, result)
        assert result['chips'] > 0 and result['chipsRetained'], (name, result)
        assert result['hasDetail'] and result['detailRetained'], (name, result)


def focus_memory(page):
    expect(page.locator('#list .memory-card').first).to_be_visible(timeout=60000)
    key = page.locator('#list .memory-card').first.get_attribute('data-memory-key')
    page.locator('#search').fill(key)
    expect(page.locator('#list .memory-card')).to_have_count(1)
    expect(page.locator('#active-filters .filter-chip')).to_have_count(1)
    page.locator('#list .memory-detail-open').click()
    expect(page.locator('#detail-dialog')).to_be_visible()
    return key


def library_state(page, account):
    return page.evaluate("account=>localStorage.getItem('gakumas-web:library:account-'+account)", account)


def check_import(page, temporary, report, baseline):
    folder = write_account(temporary, 'initial', account_documents(ACCOUNT))
    other = write_account(temporary, 'replacement', account_documents(OTHER_ACCOUNT))
    invalid = temporary/'invalid'/'capture'/'snapshot.json'
    invalid.parent.mkdir(parents=True)
    invalid.write_text('{invalid snapshot', encoding='utf-8')
    import_account(page, folder, ACCOUNT)
    expect(page.locator('#profile')).to_be_enabled(timeout=60000)
    wait_catalog(page, 'memories')
    page.locator('#data-open').click()
    page.locator('#manage-tags').click()
    page.locator('#tag-name').fill(TAG)
    page.locator('#tag-submit').click()
    page.locator('#close-tags').click()
    page.locator('#close-data').click()
    page.locator('#list .memory-card').first.locator('.edit-custom-tags').click()
    page.locator('#tags-dialog').get_by_role('checkbox', name=TAG, exact=True).check()
    page.locator('#close-tags').click()
    key = focus_memory(page)
    page.locator('#detail-content .edit-custom-tags').click()
    expect(page.locator('#tags-dialog')).to_be_visible()
    before = library_state(page, ACCOUNT)
    capture(page)
    actual_before = page.evaluate('backgroundProbe.actualFileReads')
    page.evaluate('()=>backgroundProbe.armFile()')
    page.locator('#account-directory-files').set_input_files(str(invalid.parent.parent))
    page.wait_for_function('()=>backgroundProbe.fileHeld.length===1')
    expect(page.locator('#profile')).to_be_disabled()
    measured(page, 'import_loading', report, baseline, final=False)

    # 直接触发保留节点的真实监听，防止仅靠禁用外观掩盖旧闭包仍可写入。
    page.locator('#list .favorite-button').evaluate('button=>button.onclick()')
    page.locator('#tags-dialog').get_by_role('checkbox', name=TAG, exact=True).evaluate('input=>{input.checked=!input.checked;input.onchange();}')
    page.locator('#close-tags').click()
    page.locator('#list .edit-custom-tags').evaluate('button=>button.onclick()')
    expect(page.locator('#tags-dialog')).not_to_be_visible()
    assert library_state(page, ACCOUNT) == before, '加载期间标签或收藏被写入'
    page.evaluate('()=>backgroundProbe.releaseFile()')
    expect(page.locator('#profile')).to_be_enabled(timeout=60000)
    expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
    expect(page.locator('#message')).to_contain_text('无法读取的 snapshot.json')
    measured(page, 'import_failed_restored', report, baseline)
    assert library_state(page, ACCOUNT) == before
    assert page.evaluate('backgroundProbe.actualFileReads') > actual_before

    import_account(page, other, OTHER_ACCOUNT)
    expect(page.locator('#profile')).to_be_enabled(timeout=60000)
    expect(page.locator('#message')).to_contain_text('账号目录已导入')
    expect(page.locator('#list .memory-card')).to_have_count(40, timeout=60000)
    assert page.locator('#list .memory-card').first.get_attribute('data-memory-key') != key
    expect(page.locator('#list .favorite-button').first).to_be_enabled()
    expect(page.locator('#list .edit-custom-tags').first).to_be_enabled()
    report['import_semantics'] = {'loading_writes_blocked': True, 'invalid_preserves_account': True,
                                  'replacement_account_ready': True, 'actual_file_reads': page.evaluate('backgroundProbe.actualFileReads')}


def held_completion(page, hash_value):
    page.wait_for_function('hash=>backgroundProbe.held.some(row=>row.request.hash===hash)', arg=hash_value, timeout=60000)
    evidence = page.evaluate('''()=>backgroundProbe.held.map(({request,event})=>({...request,complete:event.data.complete}))''')
    assert evidence and all(row['complete'] and row['chunks'] > 0 for row in evidence), evidence
    return evidence


def check_progression(page, temporary, report, baseline):
    hashes = public_hashes(page)
    documents = account_documents(ACCOUNT)
    documents['capture']['producerExp'] = PRODUCER_EXP
    folder = write_account(temporary, 'producer-level', documents)
    page.evaluate('hash=>backgroundProbe.arm(hash)', hashes['progression'])
    import_account(page, folder, ACCOUNT)
    expect(page.locator('#profile')).to_be_enabled(timeout=60000)
    held = held_completion(page, hashes['progression'])
    wait_catalog(page, 'memories')
    expect(page.locator('#profile option:checked')).to_contain_text('PLv.未知')
    focus_memory(page)
    capture(page)
    delivered = page.evaluate('()=>backgroundProbe.release()')
    expect(page.locator('#profile option:checked')).to_contain_text(re.compile(r'PLv\.\d+'), timeout=60000)
    expected_level = page.evaluate('''async exp=>{
      const {accountProducerLevel}=await import('./domain/catalog.mjs');return accountProducerLevel(exp);
    }''', PRODUCER_EXP)
    assert isinstance(expected_level, int) and expected_level > 0, expected_level
    expect(page.locator('#profile option:checked')).to_contain_text(f'PLv.{expected_level}')
    measured(page, 'producer_level_ready', report, baseline)
    report['progression_semantics'] = {'held_actual_completions': held, 'delivered': delivered,
                                        'producer_exp': PRODUCER_EXP, 'producer_level': expected_level}


def check_late_achievements(page, temporary, report, baseline):
    hashes = public_hashes(page)
    folder = write_account(temporary, 'late-achievements', account_documents(ACCOUNT))
    import_account(page, folder, ACCOUNT)
    expect(page.locator('#profile')).to_be_enabled(timeout=60000)
    wait_catalog(page, 'memories')
    page.evaluate('hash=>backgroundProbe.arm(hash)', hashes['achievements'])
    page.locator('[data-tab="achievements"]').click()
    held = held_completion(page, hashes['achievements'])
    page.locator('[data-tab="memories"]').click()
    wait_catalog(page, 'memories')
    focus_memory(page)
    capture(page)
    delivered = page.evaluate('()=>backgroundProbe.release()')
    page.wait_for_function('''async()=>{
      const {masterReadyFor}=await import('./application/master-loader.mjs');return masterReadyFor('achievements');
    }''')
    page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    expect(page.locator('[data-tab="memories"]')).to_have_attribute('aria-pressed', 'true')
    measured(page, 'late_achievements_ready', report, baseline)
    report['achievements_semantics'] = {'held_actual_completions': held, 'delivered': delivered, 'current_tab': 'memories'}


def check_loading_locale(page, temporary, report, baseline):
    hashes = public_hashes(page)
    folder = write_account(temporary, 'loading-locale', account_documents(ACCOUNT))
    import_account(page, folder, ACCOUNT)
    expect(page.locator('#profile')).to_be_enabled(timeout=60000)
    wait_catalog(page, 'memories')
    page.evaluate('hash=>backgroundProbe.arm(hash)', hashes['achievements'])
    page.locator('[data-tab="achievements"]').click()
    held_completion(page, hashes['achievements'])
    page.locator('#language').select_option('ja')
    delivered = page.evaluate('()=>backgroundProbe.release()')
    expect(page.locator('[data-character-portal="hski"]')).to_be_visible(timeout=60000)
    expect(page.locator('#language')).to_have_value('ja')
    page.locator('[data-character-portal="hski"]').click()
    expect(page.locator('.character-detail-hero')).to_be_visible()
    expect(page.locator('.character-back')).not_to_have_text('返回角色一览')
    report['locale_semantics'] = {'delivered': delivered, 'new_language_receiver_ready': True}


def check_loading_account(page, temporary, report, baseline):
    hashes = public_hashes(page)
    first = write_account(temporary, 'first', account_documents(ACCOUNT))
    second = write_account(temporary, 'second', account_documents(OTHER_ACCOUNT))
    import_account(page, first, ACCOUNT)
    expect(page.locator('#profile')).to_be_enabled(timeout=60000)
    wait_catalog(page, 'memories')
    page.evaluate('hash=>backgroundProbe.arm(hash)', hashes['achievements'])
    page.locator('[data-tab="achievements"]').click()
    held_completion(page, hashes['achievements'])
    import_account(page, second, OTHER_ACCOUNT)
    expect(page.locator('#profile')).to_be_enabled(timeout=60000)
    wait_catalog(page, 'memories')
    page.locator('[data-tab="achievements"]').click()
    delivered = page.evaluate('()=>backgroundProbe.release()')
    expect(page.locator('[data-character-portal="hski"]')).to_be_visible(timeout=60000)
    expect(page.locator('#profile')).to_have_value('account-'+OTHER_ACCOUNT)
    report['account_semantics'] = {'delivered': delivered, 'new_account_receiver_ready': True}


def check_loading_memory_link(page, temporary, report, baseline):
    hashes = public_hashes(page)
    target_key = None
    for account in [ACCOUNT, OTHER_ACCOUNT]:
        folder = write_account(temporary, account, account_documents(account))
        import_account(page, folder, account)
        expect(page.locator('#profile')).to_be_enabled(timeout=60000)
        wait_catalog(page, 'memories')
        if account == ACCOUNT:
            target_key = page.locator('#list .memory-card').first.get_attribute('data-memory-key')
        page.locator('[data-tab="achievements"]').click()
        wait_catalog(page, 'achievements')
    # 保留两个账号已保存的成就页视图，重载后再从链接恢复普通回忆。
    page.evaluate('hash=>localStorage.setItem("synthetic-background-gate",hash)', hashes['abilities'])
    page.reload(wait_until='networkidle')
    expect(page.locator('#profile')).to_be_enabled(timeout=60000)
    wait_catalog(page, 'achievements')
    page.evaluate('hash=>history.replaceState(null,"",hash)', f'#memory={target_key}&account={ACCOUNT}')
    page.locator('#profile').select_option('account-'+ACCOUNT)
    held_completion(page, hashes['abilities'])
    expect(page.locator('#profile')).to_be_enabled(timeout=60000)
    expect(page.locator('[data-tab="memories"]')).to_have_attribute('aria-pressed', 'true')
    delivered = page.evaluate('()=>backgroundProbe.release()')
    expect(page.locator('#inheritance-skill-open')).to_be_enabled(timeout=60000)
    expect(page.locator('#list .memory-card')).to_have_count(1)
    expect(page.locator('#list .memory-card')).to_have_attribute('data-memory-key', target_key)
    expect(page.locator('#profile')).to_have_value('account-'+ACCOUNT)
    report['memory_link_semantics'] = {'delivered': delivered, 'restored_link_receiver_ready': True}


def check(url, baseline=False):
    report = {'url': url, 'baseline': baseline, 'cases': {}}
    (ROOT/'local').mkdir(exist_ok=True)
    with TemporaryDirectory(prefix='background-updates-', dir=ROOT/'local') as temporary, sync_playwright() as driver:
        browser = driver.chromium.launch(headless=True)
        try:
            for name, run in [('import', check_import), ('progression', check_progression),
                              ('late_achievements', check_late_achievements), ('loading_locale', check_loading_locale),
                              ('loading_account', check_loading_account), ('loading_memory_link', check_loading_memory_link)]:
                context = browser.new_context(viewport={'width': 1440, 'height': 1000})
                context.add_init_script('('+BOUNDARY_PROBE+')()')
                page = context.new_page()
                errors, uploads = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                context.on('request', lambda request: uploads.append(request.url) if request.method not in ['GET', 'HEAD'] or request.post_data else None)
                case = report['cases'][name] = {}
                try:
                    page.goto(url, wait_until='networkidle')
                    case_folder = Path(temporary)/name
                    case_folder.mkdir()
                    run(page, case_folder, case, baseline)
                    assert not errors, errors
                    assert not uploads, uploads
                    case.update(page_errors=errors, uploads=uploads)
                    page.screenshot(path=str(artifact_path(ROOT/f'local/checks/background-updates/{"before" if baseline else "after"}-{name}.png')))
                except Exception:
                    page.screenshot(path=str(artifact_path(ROOT/f'local/checks/background-updates/{name}-failure.png')))
                    raise
                finally:
                    context.close()
        finally:
            browser.close()
            artifact_path(ROOT/f'local/checks/background-updates/{"before" if baseline else "after"}.json').write_text(
                json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:18765/')
    parser.add_argument('--baseline', action='store_true')
    args = parser.parse_args()
    check(args.url, args.baseline)
