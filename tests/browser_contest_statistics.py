"""用真实 Worker 检查统计展示、跨舞台历史筛选和保存失败提示。"""
from browser_artifacts import artifact_path
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]


def check(url):
    fixtures=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle')
        page.evaluate("async()=>{const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');}")
        # 对照参考网址的两组公开卡片，容量必须逐组一致。
        costs=page.evaluate('''async()=>{const {contestEngineMap}=await import('./domain/contest-engine-map.mjs');const {contestSimulationReference}=await import('./domain/catalog.mjs');const {contestDeckCost}=await import('./domain/contest-card-cost.mjs');const reverse=new Map(Object.entries(contestEngineMap.cards).map(([key,[id]])=>[id,JSON.parse(key)]));return [[479,453,87,106,109,168],[479,592,87,159,161,598]].map(ids=>contestDeckCost(ids.map(id=>{const [gameId,upgradeCount]=reverse.get(id);return contestSimulationReference('card',{id:gameId,upgradeCount,customizes:[]});})).total);}''')
        assert costs==[663,744],costs
        for request in [fixtures['customized'],fixtures['requests'][1]]:
            page.evaluate('''async request=>{const {createContestSimulationPanel}=await import('./ui/contest-simulation-result.mjs');const {contestCatalog}=await import('./domain/catalog.mjs');const stage=contestCatalog().choices.find(stage=>stage.preset?.id===request.stage.preset.id);window.statisticsPanel?.dispose();window.statisticsPanel?.element.remove();const panel=createContestSimulationPanel({stage,profile:'account-synthetic-statistics',getInput:()=>({request,stage,characterId:'hski'}),onRestore:()=>false});window.statisticsPanel=panel;document.body.append(panel.element);panel.update({stage,available:true,signature:request.stage.preset.id});panel.element.querySelector('.season-simulate').click();}''',request)
            dialog=page.locator('#contest-simulation-result');expect(dialog.locator('.simulation-save-status')).to_have_text('已保存到此舞台的模拟历史。',timeout=120000)
        dialog.locator('.simulation-statistics > summary').click()
        assert dialog.locator('.simulation-statistics tbody tr[data-entity-type="skillCard"]').count()>0
        assert dialog.locator('.simulation-statistics tbody tr[data-entity-type="pItem"]').count()>0
        for width in [1280,390,320]:
            page.set_viewport_size({'width':width,'height':1000});assert dialog.evaluate('node=>node.scrollWidth<=node.clientWidth');page.screenshot(path=artifact_path(str(ROOT/f'local/season-simulation/statistics-{width}.png')))
        dialog.locator('.simulation-statistics > summary').click();dialog.locator('.season-simulation-history-open').click()
        expect(dialog.locator('.simulation-history-entry')).to_have_count(1)
        dialog.get_by_role('combobox',name='舞台筛选').select_option('all');expect(dialog.locator('.simulation-history-entry')).to_have_count(2)
        for width in [1280,320]:
            page.set_viewport_size({'width':width,'height':1000});dialog.locator('.simulation-history').scroll_into_view_if_needed();assert dialog.evaluate('node=>node.scrollWidth<=node.clientWidth');page.screenshot(path=artifact_path(str(ROOT/f'local/season-simulation/history-{width}.png')))
        key='contest:'+str(fixtures['customized']['stage']['preset']['id']);dialog.get_by_role('combobox',name='舞台筛选').select_option(key);expect(dialog.locator('.simulation-history-entry')).to_have_count(1)
        dialog.locator('.simulation-history-entry').get_by_role('button',name='查看结果',exact=True).click();expect(dialog.locator('[data-score="mean"] strong')).to_be_visible()
        # 保存故障不能抹掉已完成结果，也不能显示保存成功。
        page.evaluate("()=>{window.originalHistoryOpen=indexedDB.open;indexedDB.open=()=>{throw new DOMException('synthetic quota','QuotaExceededError');};}")
        dialog.get_by_role('slider',name='模拟次数').fill('100');dialog.locator('.contest-simulation-controls .primary').click()
        expect(dialog.locator('.simulation-save-status')).to_have_text('结果已完成，但历史保存失败；当前结果仍可查看。',timeout=30000);expect(dialog.locator('[data-score="mean"] strong')).to_be_visible()
        page.evaluate('()=>{indexedDB.open=window.originalHistoryOpen;}')
        assert not errors,errors;assert not uploads,uploads;browser.close()
    print('容量 663/744 对照、真实卡片与道具统计、跨舞台历史筛选、保存失败保留结果及桌面／窄屏验证通过。')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8091/');args=parser.parse_args();check(args.url)
