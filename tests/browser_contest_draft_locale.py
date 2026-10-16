"""通过真实语言切换重建工作区，确认未编辑配置仍可显式恢复草稿。"""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect
from browser_static import ROOT, fixtures
from browser_artifacts import artifact_path


def check(url):
    with TemporaryDirectory(dir=ROOT/'local',prefix='draft-locale-') as temporary,sync_playwright() as p:
        browser=p.chromium.launch()
        page=browser.new_page()
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(url,wait_until='networkidle')
        folder=Path(temporary)/'account'
        for name,document in fixtures().items():
            document['publicUserId']='synthetic-draft-locale'
            path=folder/name/'snapshot.json'
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(document))
        page.locator('#account-directory-files').set_input_files(str(folder))
        expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        page.evaluate('''async()=>{
          await(await import('./application/master-loader.mjs')).loadMaster('contests');
          const {contestCatalog}=await import('./domain/catalog.mjs'),{createContestDraft}=await import('./application/contest-drafts.mjs'),storage=await import('./application/storage.mjs'),profile=document.querySelector('#profile').value,data=await storage.profileData(profile);
          const entry=createContestDraft({stage:contestCatalog().choices[0],selected:[null,null],drafts:[null,null],editing:[false,false],contentVersion:(await import('./application/content-manager.mjs')).contentManager.status().version});
          await storage.saveSimulationDraft(profile,entry,data.ordinary.lifecycleId);
        }''')
        page.locator('[data-tab="seasonSimulation"]').click()
        recovery=page.locator('.contest-draft-recovery')
        expect(recovery.get_by_role('button',name='恢复草稿',exact=True)).to_be_enabled(timeout=60000)
        page.locator('#language').select_option('ja')
        restore=recovery.get_by_role('button',name='下書きを復元',exact=True)
        expect(restore).to_be_enabled(timeout=60000)
        for width in [1280,390,360]:
            page.set_viewport_size({'width':width,'height':1000})
            assert recovery.evaluate('element=>element.scrollWidth<=element.clientWidth')
            expect(restore).to_be_visible()
            recovery.screenshot(path=artifact_path(ROOT/f'local/checks/nextsteps-20261016/drafts-final-ja-{width}.png'))
        restore.click()
        expect(recovery).to_contain_text('設定を復元しました')
        page.wait_for_function("async()=>!(await(await import('./application/storage.mjs')).simulationDrafts(document.querySelector('#profile').value)).length")
        assert not errors,errors
        browser.close()
    print('未编辑配置在日文切换重建后仍可显式恢复，旧草稿已消费。')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',required=True)
    check(parser.parse_args().url)
