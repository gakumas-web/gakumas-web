"""以真实推荐 Worker 验证四张持续效果卡，不替换引擎和推荐流程。"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def check(url='http://127.0.0.1:18765/'):
    base=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())
    source=next(r for r in base['requests'] if r['plan']=='logic')
    entries=json.loads((ROOT/'tests/fixtures/public-data/contest-status-customizations.json').read_text())['entries']
    references={entry['record']['name']:entry['reference'] for entry in entries}
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page();errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle')
        for name,reference in references.items():
            result=page.evaluate('''async({source,reference})=>{
              const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');
              const {contestCatalog,idolInfo}=await import('./domain/catalog.mjs');const {startContestRecommendations}=await import('./application/contest-recommendation-client.mjs');
              const idolCardId=source.cards[0].record.definition.originIdolCardId,identity=idolInfo({idolCardId}),stage=contestCatalog().choices.find(s=>s.kind==='contest'&&s.seasonNumber===53&&s.stageNumber===2);
              const memories=[0,1].map(i=>({key:'synthetic-status-'+i,characterId:identity.characterId,idolCardId,planType:3,...source.params,vocal:source.params.vocal+i*200,examBattleProduceCards:[...source.cards.map(c=>c.reference),reference],examBattleProduceItemIds:source.items.map(item=>item.id)}));
              const report=await startContestRecommendations({memories,stage,supportCards:[]},{seed:42}).promise;
              return {rows:report.rows.length,skipped:report.skipped,runs:report.rows.map(r=>r.stats.runs)};
            }''',{'source':source,'reference':reference})
            assert result['rows']==2 and not result['skipped'],(name,result)
            assert all(runs in [500,2000] for runs in result['runs'])
        assert not errors,errors
        assert not uploads,uploads
        browser.close()
    print('四张持续效果卡通过真实推荐 Worker，未跳过且无上传。',flush=True)
if __name__=='__main__':check()
