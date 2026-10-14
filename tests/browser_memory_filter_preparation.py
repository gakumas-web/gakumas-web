"""验证分批候选准备让出主线程、一次性发布，以及切换条件后不会覆盖新结果。"""
import argparse
from playwright.sync_api import sync_playwright


def check(url):
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page();errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle')
        page.context.new_cdp_session(page).send('Emulation.setCPUThrottlingRate',{'rate':4})
        result=page.evaluate('''async()=>{
            await (await import('./application/master-loader.mjs')).loadMaster('memories');
            const data=await (await fetch('./resources/preview-account.json')).json();
            const {prepareAccountDirectory,combineAccountDirectory}=await import('./domain/account-import.mjs');
            const {snapshot}=combineAccountDirectory(await prepareAccountDirectory(data.documents));
            const {syncMemoryFilterOptions:sync,prepareMemoryFilterOptions:prepare}=await import('./ui/filters.mjs');
            const ids=[...new Set(snapshot.memories.map(row=>row.characterId))];
            const view=id=>({character:id?[id]:[],skill:[],ability:[],memoryExamSkill:[],memoryExamItem:[]});
            const dump=()=>JSON.stringify(['skill','ability','memory-skill','memory-item'].map(id=>[...document.getElementById(id).options].map(row=>[row.value,row.text])));
            sync(snapshot,view());const expected=dump();
            sync(snapshot,view(ids[0]));const initial=dump();
            let ticks=0,partial=false,frame;
            const observe=()=>{ticks++;const current=dump();if(current!==initial&&current!==expected)partial=true;frame=requestAnimationFrame(observe);};
            frame=requestAnimationFrame(observe);await prepare(snapshot,view());cancelAnimationFrame(frame);
            const complete=dump()===expected;
            sync(snapshot,view(ids[1]));const latest=dump();
            const old=prepare(snapshot,view());sync(snapshot,view(ids[1]));await old;
            const syncWins=dump()===latest;
            const pending=prepare(snapshot,view());await prepare(snapshot,view(ids[1]));await pending;
            return {ticks,partial,complete,syncWins,cacheWins:dump()===latest};
        }''')
        assert result['ticks']>0 and not result['partial'],result
        assert result['complete'] and result['syncWins'] and result['cacheWins'],result
        assert not errors and not uploads,(errors,uploads)
        browser.close()
    print('候选分批让出主线程、完整发布、同步覆盖旧任务、缓存命中取消旧任务及无上传检查通过。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
