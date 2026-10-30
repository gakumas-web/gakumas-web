"""通过真实能力与语言切换验证可用草稿恢复，以及待补草稿保持禁用。"""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect
from browser_static import ROOT, fixtures
from browser_artifacts import artifact_path


def check(url, artifact_dir=None):
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
        drafts=page.evaluate('''async()=>{
          await(await import('./application/master-loader.mjs')).loadMaster('contests');
          const {contestCatalog}=await import('./domain/catalog.mjs'),{createContestDraft}=await import('./application/contest-drafts.mjs'),storage=await import('./application/storage.mjs'),profile=document.querySelector('#profile').value,data=await storage.profileData(profile);
          const {verifyContestStageCapability}=await import('./domain/contest-stage-capability.mjs');
          const choices=contestCatalog().choices.filter(stage=>stage.kind==='contest');
          const capabilities=await Promise.all(choices.map(verifyContestStageCapability));
          const ready=choices.find((stage,index)=>capabilities[index].state==='ready'),pending=choices.find((stage,index)=>capabilities[index].state==='pending');
          if(!ready)throw new Error('草稿恢复正例需要真实可模拟舞台');
          const contentVersion=(await import('./application/content-manager.mjs')).contentManager.status().version;
          const create=stage=>createContestDraft({stage,selected:[null,null],drafts:[null,null],editing:[false,false],contentVersion});
          const entry=create(ready);await storage.saveSimulationDraft(profile,entry,data.ordinary.lifecycleId);
          let pendingEntry=null;
          if(pending){pendingEntry=create(pending);await storage.saveSimulationDraft(profile,pendingEntry,data.ordinary.lifecycleId);}
          return {readyId:entry.id,readyStageId:ready.id,pendingId:pendingEntry?.id??null,pendingStageId:pending?.id??null};
        }''')
        page.locator('[data-tab="seasonSimulation"]').click()
        recovery=page.locator('.contest-draft-recovery')
        ready_row=recovery.locator('[data-draft-id='+json.dumps(drafts['readyId'])+']')
        pending_row=recovery.locator('[data-draft-id='+json.dumps(drafts['pendingId'])+']') if drafts['pendingId'] else None
        expect(ready_row.get_by_role('button',name='恢复草稿',exact=True)).to_be_enabled(timeout=60000)
        if pending_row is not None:
            expect(pending_row.get_by_role('button',name='恢复草稿',exact=True)).to_be_disabled()
            expect(pending_row).to_contain_text('模拟资料待补充')
        page.locator('#language').select_option('ja')
        restore=ready_row.get_by_role('button',name='下書きを復元',exact=True)
        expect(restore).to_be_enabled(timeout=60000)
        if pending_row is not None:
            expect(pending_row.get_by_role('button',name='下書きを復元',exact=True)).to_be_disabled()
            expect(pending_row).to_contain_text('シミュレーション用データを準備中')
        for width in [1280,390,360]:
            page.set_viewport_size({'width':width,'height':1000})
            assert recovery.evaluate('element=>element.scrollWidth<=element.clientWidth')
            expect(restore).to_be_visible()
            if pending_row is not None:
                expect(pending_row.get_by_role('button',name='下書きを復元',exact=True)).to_be_disabled()
            screenshot=(Path(artifact_dir)/f'drafts-final-ja-{width}.png') if artifact_dir else ROOT/f'local/checks/nextsteps-20261016/drafts-final-ja-{width}.png'
            recovery.screenshot(path=artifact_path(screenshot))
        restore.click()
        expect(recovery).to_contain_text('設定を復元しました')
        page.wait_for_function("""async ({readyId,pendingId})=>{
          const entries=await(await import('./application/storage.mjs')).simulationDrafts(document.querySelector('#profile').value);
          return !entries.some(entry=>entry.id===readyId)&&entries.length===(pendingId?1:0)&&(!pendingId||entries[0].id===pendingId);
        }""",arg=drafts)
        if pending_row is not None:
            expect(pending_row.get_by_role('button',name='下書きを復元',exact=True)).to_be_disabled()
            page.locator('#language').select_option('zh-CN')
            expect(pending_row.get_by_role('button',name='恢复草稿',exact=True)).to_be_disabled(timeout=60000)
            expect(ready_row).to_have_count(0)
            retained=page.evaluate("async()=> (await(await import('./application/storage.mjs')).simulationDrafts(document.querySelector('#profile').value)).map(entry=>entry.id)")
            assert retained==[drafts['pendingId']],retained
        assert not errors,errors
        browser.close()
    print(json.dumps({'ready_stage':drafts['readyStageId'],'ready_draft_consumed':True,'pending_stage':drafts['pendingStageId'],'pending_draft_checked':drafts['pendingId'] is not None,'page_errors':len(errors)},ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',required=True)
    parser.add_argument('--artifact-dir',type=Path)
    args=parser.parse_args()
    check(args.url,args.artifact_dir)
