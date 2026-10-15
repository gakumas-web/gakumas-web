"""固定公开合成输入，验收新预设的实际成本、多核一致性与基本质量对照。"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_artifacts import artifact_path

ROOT=Path(__file__).resolve().parents[1]

PREPARE='''async request=>{
  const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');
  const c=await import('./domain/catalog.mjs'),{cardConversionRules}=await import('./domain/card-conversions.mjs');
  const {buildContestOptimizationInput}=await import('./application/contest-optimization-input.mjs');
  const stage=c.contestCatalog().choices.find(row=>row.preset?.id===request.stage.preset.id),idolCardId=request.cards[0].record.definition.originIdolCardId;
  const context={stage,idolCards:[{idolCardId,levelLimitRank:3,potentialRank:2}],supportCards:[],producerLevel:80,conversionRules:cardConversionRules(c.contestCardConversions(),80)};
  const constraints={params:request.params,roles:[0,1].map(()=>({exclusiveId:request.cards[0].reference.id,grade:15})),items:request.items.map(item=>item.id)};
  window.presetOptions={input:buildContestOptimizationInput(context,constraints),stage,supportCards:[],conversionRules:context.conversionRules};
  window.presetReports={};return {stage:stage.id,params:request.params,producerLevel:80,seed:73};
}'''

RUN='''async ({name,multiCore})=>{
  const {startContestOptimization,OPTIMIZATION_BUDGETS}=await import('./application/contest-optimization-client.mjs');
  const preset=name.endsWith('standard')?'standard':'deep',budget={...OPTIMIZATION_BUDGETS[preset]};
  if(name.startsWith('old-'))Object.assign(budget,preset==='standard'?{population:48,finalCandidates:5}:{finalCandidates:10,finalRuns:1000});
  let previous=performance.now(),maxGap=0,ticks=0;const started=previous;
  const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-previous);previous=now;ticks++;},25);
  try{
    const report=await startContestOptimization(presetOptions,{seed:73,budget,multiCore}).promise;
    const key=name+(multiCore?'-multi':'-single');presetReports[key]=report;
    if(report.totalRuns>budget.totalRunLimit)throw Error('total budget exceeded');
    if(Object.values(report.diagnostics.phaseRuns).reduce((a,b)=>a+b,0)!==report.totalRuns)throw Error('phase accounting mismatch');
    if(report.diagnostics.budgetLimited)throw Error('default preset was truncated');
    if(!report.rows.length||report.rows.some(row=>row.result.runs!==budget.finalRuns))throw Error('missing final samples');
    if(multiCore){
      const signature=value=>JSON.stringify(value.rows.map(row=>[row.key,row.result.scores]));
      if(signature(report)!==signature(presetReports[name+'-single']))throw Error('multicore changed results');
    }
    return {name,multiCore,elapsedMs:performance.now()-started,totalRuns:report.totalRuns,phaseRuns:report.diagnostics.phaseRuns,returned:report.rows.length,structures:new Set(report.rows.map(row=>row.structure)).size,finalRuns:budget.finalRuns,bestScore:report.rows[0].stats.score,maxMainThreadGapMs:maxGap,heartbeatTicks:ticks,workersRemaining:window.presetWorkers};
  }finally{clearInterval(timer);}
}'''

QUALITY='''async()=>{
  const {createContestSimulationRequest}=await import('./domain/contest-engine-request.mjs');
  const {startContestSimulation}=await import('./application/contest-simulation-client.mjs');
  const {recommendationStatistics}=await import('./domain/contest-recommendations.mjs');
  const result=[];
  for(const preset of ['standard','deep']){
    const scores={};
    for(const variant of ['old','new']){
      const row=presetReports[`${variant}-${preset}-single`].rows[0];
      const request=createContestSimulationRequest(row.memories,presetOptions.stage,[],{},presetOptions.conversionRules);
      const evaluated=await startContestSimulation(request,{runs:1000,seed:61937,multiCore:false}).promise;
      scores[variant]=recommendationStatistics(evaluated.scores).score;
    }
    result.push({preset,referenceSeed:61937,referenceRuns:1000,...scores,relativeChange:(scores.new-scores.old)/Math.max(1,Math.abs(scores.old))});
  }
  return result;
}'''

def check(url,output):
    result={'scope':'一个公开合成输入、固定种子的小范围验收，不代表跨舞台质量结论或真实设备耗时承诺。','runs':[]}
    output=artifact_path(output);output.parent.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True);page=browser.new_page();uploads=[];errors=[]
        page.on('request',lambda r:uploads.append(r.url) if r.post_data else None)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.add_init_script("Object.defineProperty(navigator,'hardwareConcurrency',{value:4});window.presetWorkers=0;const Native=Worker;window.Worker=class extends Native{constructor(...args){super(...args);this.counted=String(args[0]).endsWith('contest-simulation-worker.mjs');if(this.counted)presetWorkers++;}terminate(){if(this.counted){this.counted=false;presetWorkers--;}super.terminate();}};")
        page.goto(url,wait_until='networkidle')
        request=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())['requests'][0]
        result['input']=page.evaluate(PREPARE,request)
        result['release']=page.evaluate("async()=>{const r=await(await fetch('./release.json')).json();return {version:r.version,files:Object.fromEntries(Object.entries(r.files).filter(([name])=>name.includes('optimization')||name==='domain/contest-engine-runner.mjs'))};}")
        for name,multi in [('old-standard',False),('new-standard',False),('new-standard',True),('old-deep',False),('new-deep',False),('new-deep',True)]:
            row=page.evaluate(RUN,{'name':name,'multiCore':multi});assert row['workersRemaining']==0,row
            result['runs'].append(row);output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
            print(json.dumps(row,ensure_ascii=False),flush=True)
        result['quality']=page.evaluate(QUALITY)
        result['cancel']=page.evaluate('''async()=>{
          const {startContestOptimization,OPTIMIZATION_BUDGETS}=await import('./application/contest-optimization-client.mjs');
          let task,at=0;task=startContestOptimization(presetOptions,{seed:74,budget:OPTIMIZATION_BUDGETS.deep,multiCore:true,onProgress:value=>{if(!at&&value.phase==='search'&&value.completed>0){at=performance.now();task.cancel();}}});
          try{await task.promise;throw Error('cancel ignored');}catch(error){if(error.name!=='AbortError'||!at)throw error;}
          if(presetWorkers)throw Error('worker leak');return {elapsedMs:performance.now()-at,workersRemaining:presetWorkers};
        }''')
        assert not uploads and not errors,(uploads,errors)
        result['uploads']=uploads;result['pageErrors']=errors;output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        browser.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);parser.add_argument('--output',default=str(ROOT/'local/checks/review-066-followup/presets.json'));args=parser.parse_args();check(args.url,args.output)
