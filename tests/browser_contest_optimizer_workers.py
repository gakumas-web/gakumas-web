"""在三个计划中用真实 Worker 核对遗传搜索的合法结果、多核确定性及局部改进阶段的取消。"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]


def check(url):
    requests=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['requests']
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page()
        page.add_init_script("Object.defineProperty(navigator,'hardwareConcurrency',{value:4});")
        page.goto(url,wait_until='networkidle')
        result=page.evaluate('''async requests=>{
          const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');
          const c=await import('./domain/catalog.mjs'),{cardConversionRules}=await import('./domain/card-conversions.mjs');
          const {buildContestOptimizationInput}=await import('./application/contest-optimization-input.mjs'),{startContestOptimization}=await import('./application/contest-optimization-client.mjs');
          const {contestDeckCost}=await import('./domain/contest-card-cost.mjs');
          const budget={population:8,generations:3,samples:3,reviewCandidates:4,reviewRuns:5,finalCandidates:2,finalRuns:8,polishParents:1,polishNeighbors:4,polishRounds:1,polishRuns:5};
          const results=[];
          for(const request of requests){
            const stage=c.contestCatalog().choices.find(row=>row.preset?.id===request.stage.preset.id),idolCardId=request.cards[0].record.definition.originIdolCardId;
            const context={stage,idolCards:[{idolCardId,levelLimitRank:3,potentialRank:2}],supportCards:[],producerLevel:80,conversionRules:cardConversionRules(c.contestCardConversions(),80)};
            const constraints={roles:[0,1].map(()=>({exclusiveId:request.cards[0].reference.id,grade:15,params:request.params,maxCustomizeCount:2,maxCustomizedCards:1})),items:request.items.map(item=>item.id)};
            const input=buildContestOptimizationInput(context,constraints),options={input,stage,supportCards:[],conversionRules:context.conversionRules};
            const single=await startContestOptimization(options,{seed:73,budget}).promise;
            const multi=await startContestOptimization(options,{seed:73,budget,multiCore:true}).promise;
            const signature=report=>JSON.stringify(report.rows.map(row=>({memories:row.memories,scores:row.result.scores})));
            const valid=single.rows.every(row=>row.memories.every(memory=>{
              const cards=memory.examBattleProduceCards,cost=contestDeckCost(cards.map(card=>c.contestSimulationReference('card',card))).total;
              return cards.length===6&&cost>=546&&cost<=858&&cards.every(card=>!context.conversionRules.excludedCardIds.includes(card.id))&&cards.flatMap(card=>card.customizes).reduce((sum,value)=>sum+value.customizeCount,0)<=2&&cards.filter(card=>card.customizes.length).length<=1;
            }));
            let task,sawPolish=false,cancelled=false;
            task=startContestOptimization(options,{seed:73,budget,multiCore:true,onProgress:value=>{if(value.phase==='polish'&&!sawPolish){sawPolish=true;task.cancel();}}});
            try{await task.promise;}catch(error){cancelled=error.name==='AbortError';}
            results.push({plan:request.plan,rows:single.rows.length,identical:signature(single)===signature(multi)&&single.totalRuns===multi.totalRuns,valid,totalRuns:single.totalRuns,polishCancellation:sawPolish&&cancelled});
          }
          return results;
        }''',requests)
        assert all(row['rows']==2 and row['identical'] and row['valid'] and row['polishCancellation'] for row in result),result
        print(json.dumps(result,ensure_ascii=False));browser.close()


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
