"""使用实际公开内容与推荐 Worker 验证名称差异卡及附魔能够参与推荐。"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]

def check(url='http://127.0.0.1:18765/'):
    fixtures=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())
    monthly=[{'id':'p_card-00-sup-3_155','upgradeCount':1,'customizes':[{'id':id,'customizeCount':1}]} for id in ['p_card_custom-020-g_effect-cost_reduce-2','p_card_custom-070-g_effect-effect_add-e_effect-exam_block-0004']]
    hold=json.loads((ROOT/'tests/fixtures/public-data/contest-hold-customization.json').read_text())['card']['reference']
    cases=[{'source':fixtures['customized'],'references':monthly,'stageNumber':1,'planType':2},{'source':next(r for r in fixtures['requests'] if r['plan']=='anomaly'),'references':[hold,hold],'stageNumber':3,'planType':4}]
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page();errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle')
        for case in cases:
            result=page.evaluate('''async ({source,references,stageNumber,planType})=>{
          const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');
          const {contestCatalog,idolInfo}=await import('./domain/catalog.mjs');
          const {startContestRecommendations}=await import('./application/contest-recommendation-client.mjs');
          const idolCardId=source.cards[0].record.definition.originIdolCardId,identity=idolInfo({idolCardId});
          const stage=contestCatalog().choices.find(s=>s.kind==='contest'&&s.seasonNumber===53&&s.stageNumber===stageNumber);
          const memories=references.map((reference,i)=>({key:'synthetic-name-match-'+i,characterId:identity.characterId,idolCardId,planType,...source.params,vocal:source.params.vocal+i*200,
            examBattleProduceCards:[...source.cards.map(c=>c.reference),reference],examBattleProduceItemIds:source.items.map(item=>item.id)}));
          const report=await startContestRecommendations({memories,stage,supportCards:[]},{seed:42}).promise;
          return {rows:report.rows.map(row=>({main:row.main,runs:row.stats.runs,mean:row.result.mean})),skipped:report.skipped,combinations:report.combinations};
            }''',case)
            assert result['combinations']==2 and len(result['rows'])==2 and not result['skipped'],result
            assert {row['main'] for row in result['rows']}=={0,1}
            assert all(row['runs'] in [500,2000] and row['mean']>0 for row in result['rows'])
        assert not errors,errors
        assert not uploads,uploads
        browser.close()
    print('月明かりに包まれて+ 两种附魔及モチベ+保留附魔通过实际推荐 Worker，无跳过、报错或上传。',flush=True)

if __name__=='__main__':check()
