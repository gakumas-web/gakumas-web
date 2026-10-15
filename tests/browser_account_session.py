"""通过真实账号入口验证会话切换、失败保留、备份恢复与删除后的状态迁移。"""
import argparse
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect
from browser_static import fixtures,ROOT


def check(url):
    with TemporaryDirectory(dir=ROOT/'local',prefix='account-session-') as temporary,sync_playwright() as p:
        account_a='synthetic-session-a';account_b='synthetic-session-b';profile_a='account-'+account_a;profile_b='account-'+account_b
        folders={}
        for account in [account_a,account_b]:
            folder=Path(temporary)/account;folders[account]=folder
            for name,document in copy.deepcopy(fixtures()).items():
                document['publicUserId']=account
                target=folder/name/'snapshot.json';target.parent.mkdir(parents=True);target.write_text(json.dumps(document))
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle')
        def import_directory(account):
            page.locator('#account-directory-files').set_input_files(str(folders[account]));expect(page.locator('#profile')).to_be_enabled(timeout=60000)
            expect(page.locator('#profile')).to_have_value('account-'+account);expect(page.locator('#message')).to_contain_text('账号目录已导入')
        def switch(profile):
            page.locator('#profile').select_option(profile);expect(page.locator('#profile')).to_be_enabled(timeout=60000);expect(page.locator('#profile')).to_have_value(profile)
        def restore_backup(path):
            page.locator('#account-package-file').set_input_files(str(path));expect(page.locator('#package-import-password')).to_be_visible();page.locator('#package-import-password').fill('synthetic-session-password');page.locator('#package-decrypt').click();expect(page.locator('#package-apply')).to_be_enabled();page.locator('#package-apply').click();expect(page.locator('#message')).to_contain_text('账号数据包已导入');expect(page.locator('#profile')).to_be_enabled()
        def clear_current():
            page.locator('#data-open').click();page.locator('#clear-account').click();expect(page.locator('#account-cleanup-confirmed')).to_be_enabled();page.locator('#account-cleanup-confirmed').check();page.locator('#confirm-account-cleanup').click();expect(page.locator('#account-cleanup-dialog')).not_to_be_visible();expect(page.locator('#profile')).to_be_enabled()
        import_directory(account_a);expect(page.locator('#count-memories')).to_have_text('1',timeout=60000)
        # 同账号重导保留输入中的筛选，不依赖防抖保存是否已经完成。
        page.locator('#search').fill('query-a-no-results');import_directory(account_a);expect(page.locator('#search')).to_have_value('query-a-no-results');expect(page.locator('#count-memories')).to_have_text('0 / 1')
        page.locator('#data-open').click();page.locator('#manage-tags').click();page.locator('#tag-name').fill('账号 A 标签');page.locator('#tag-submit').click();expect(page.locator('[data-tag="账号 A 标签"]')).to_be_visible();page.locator('#close-tags').click()
        page.locator('#export-account-package').click();page.locator('#package-export-encrypted').check();page.locator('#package-password').fill('synthetic-session-password');page.locator('#package-password-confirm').fill('synthetic-session-password')
        with page.expect_download() as download:page.locator('#package-download').click()
        backup=Path(temporary)/'backup.json';download.value.save_as(str(backup));expect(page.locator('#account-package-dialog')).not_to_be_visible();page.locator('#close-data').click()
        import_directory(account_b);expect(page.locator('#search')).to_have_value('');page.locator('#search').fill('query-b-no-results');expect(page.locator('#count-memories')).to_have_text('0 / 1')
        switch(profile_a);expect(page.locator('#search')).to_have_value('query-a-no-results')
        # 在存储边界制造错误账号记录；读取仍走实际 IndexedDB 和正式会话校验。
        page.evaluate("""async({profile,id})=>{
          const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('gakumas-web');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
          try{await new Promise((resolve,reject)=>{const tx=db.transaction('profiles','readwrite'),store=tx.objectStore('profiles'),request=store.get(profile);request.onsuccess=()=>{window.sessionOriginal=request.result;store.put({...request.result,snapshot:{...request.result.snapshot,publicUserId:id}},profile);};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}
        }""",{'profile':profile_b,'id':account_a})
        page.locator('#profile').select_option(profile_b);expect(page.locator('#message')).to_contain_text('账号 ID 不匹配');expect(page.locator('#profile')).to_be_enabled();expect(page.locator('#profile')).to_have_value(profile_a);expect(page.locator('#search')).to_have_value('query-a-no-results')
        page.evaluate("""async profile=>{
          const db=await new Promise(resolve=>{const request=indexedDB.open('gakumas-web');request.onsuccess=()=>resolve(request.result);});
          try{await new Promise((resolve,reject)=>{const tx=db.transaction('profiles','readwrite');tx.objectStore('profiles').put(window.sessionOriginal,profile);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();delete window.sessionOriginal;}
        }""",profile_b)
        switch(profile_b);expect(page.locator('#search')).to_have_value('query-b-no-results')
        restore_backup(backup);expect(page.locator('#profile')).to_have_value(profile_a);expect(page.locator('#search')).to_have_value('query-a-no-results')
        page.locator('#data-open').click();page.locator('#manage-tags').click();expect(page.locator('[data-tag="账号 A 标签"]')).to_be_visible();page.locator('#close-tags').click();page.locator('#close-data').click()
        clear_current();expect(page.locator('#profile')).to_have_value(profile_b);expect(page.locator('#search')).to_have_value('query-b-no-results');expect(page.locator(f'#profile option[value="{profile_a}"]')).to_have_count(0)
        clear_current();expect(page.locator('#profile')).to_have_value('');expect(page.locator('#inventory')).to_be_hidden();expect(page.locator('#empty')).to_be_visible()
        restore_backup(backup);expect(page.locator('#profile')).to_have_value(profile_a);page.reload(wait_until='networkidle');expect(page.locator('#inventory')).to_be_visible(timeout=60000);expect(page.locator('#search')).to_have_value('query-a-no-results')
        assert not errors and not uploads,(errors,uploads);browser.close()
    print('同账号重导、跨账号偏好隔离、错配读取失败保留、加密备份跨账号恢复、删除后切换及空会话重建通过；无异常或上传。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
