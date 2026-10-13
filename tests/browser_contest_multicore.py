"""使用真实 Worker 验证普通模拟的并行一致性和任务清理。"""
import json
from playwright.sync_api import sync_playwright
from browser_static import ROOT


def check(url):
    fixture=json.loads((ROOT/'tests/fixtures/public-data/contest-engine.json').read_text())
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page();errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.add_init_script('''Object.defineProperty(navigator,'hardwareConcurrency',{value:8});window.active=0;window.peak=0;const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);window.active++;window.peak=Math.max(window.peak,window.active);}terminate(){if(!this.ended){this.ended=true;window.active--;}super.terminate();}};''')
        page.goto(url,wait_until='networkidle')
        result=page.evaluate('''async request=>{
          const {startContestSimulation}=await import('./application/contest-simulation-client.mjs');
          const reports=[];
          for(const multiCore of [false,true]){
            window.peak=0;const progress=[];
            const result=await startContestSimulation(request,{runs:101,seed:42,multiCore,onProgress:n=>progress.push(n)}).promise;
            reports.push({result,peak:window.peak,active:window.active,progress});
          }
          const failures=[];
          for(const mode of ['cancel','timeout','invalid']){
            const input=structuredClone(request);if(mode==='invalid')input.cards[0].record.name+='invalid';
            const run=startContestSimulation(input,{runs:10000,seed:42,multiCore:true,timeoutMs:mode==='timeout'?1:120000});
            if(mode==='cancel')run.cancel();
            try{await run.promise;throw Error('unexpected success');}catch(error){failures.push({mode,code:error.name==='AbortError'?error.name:error.code,active:window.active});}
          }
          return {identical:JSON.stringify(reports[0].result)===JSON.stringify(reports[1].result),reports:reports.map(({result,...rest})=>rest),failures};
        }''',fixture['customized'])
        assert result['identical'],result
        for report,peak in zip(result['reports'],[1,4]):
            assert report['peak']==peak and report['active']==0,report
            assert report['progress']==sorted(report['progress']) and report['progress'][-1]==101,report
        assert [row['code'] for row in result['failures']]==['AbortError','simulation_timeout','unsupported_entities'],result
        assert all(row['active']==0 for row in result['failures']),result
        assert not errors and not uploads,(errors,uploads)
        browser.close()
    print('普通模拟单／四 Worker 完整结果一致，进度、取消、超时、错误清理和无上传通过。',flush=True)
