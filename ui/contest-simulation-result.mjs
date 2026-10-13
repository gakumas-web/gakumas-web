import {contestEngineMap} from '../domain/contest-engine-map.mjs';
import {readSimulationMultiCore,saveSimulationMultiCore,onSimulationMultiCoreChange} from '../application/contest-compute-preferences.mjs';
import {el} from './dom.mjs';
import {t,locale} from '../i18n.mjs';
import {closeRewardPopover} from './card-rewards.mjs';
import {createContestQuickStagePicker} from './contest-quick-stage-picker.mjs';
import {startContestSimulation} from '../application/contest-simulation-client.mjs';

import {recommendationStatistics} from '../domain/contest-recommendations.mjs';
import {characterInfo} from '../domain/catalog.mjs';
import {illustration} from './illustrations.mjs';
import {loadoutPreview} from './contest-loadout-library.mjs';
import {comparisonScore,scoreQuantile,simulationChart} from './contest-simulation-charts.mjs';
import {simulationRecords} from './contest-simulation-records.mjs';
import {simulationStatistics} from './contest-simulation-statistics.mjs';
import {createSimulationHistoryPanel,simulationLoadoutSummary} from './contest-simulation-history.mjs';
import {createSimulationRecord,rememberSimulation} from '../application/contest-simulation-history.mjs';

export const errorLabels={invalid_loadout:'请先选择有效的主回忆，并检查属性与体力。',missing_support_bonus:'支援卡持有信息未采集，无法计算当前支援奖励。',unsupported_stage:'此舞台尚未接入完整模拟，请选择已收录的竞技场或活动舞台。',unsupported_stage_rules:'当前舞台的抽牌、手牌或体力规则与模拟引擎不一致，暂不能模拟。',missing_manual_multipliers:'请先填写此舞台的 Vo、Da、Vi 比赛倍率。',missing_default_deck:'此舞台的比赛公共卡组尚未收录。',engine_failed:'模拟未能完成，请调整编组后重试。',simulation_timeout:'模拟耗时过长，已停止；请减少模拟次数后重试。',invalid_options:'模拟次数无效。'};

export function createContestSimulationPanel({profile,stage,supportBonus,getInput,onRestore,onOpenConversions,quickStages=[],onQuickStage,onTaskChange=()=>{}}){
  const element=el('section','','contest-simulation-result contest-simulation-inline');element.id='contest-simulation-result';element.setAttribute('aria-labelledby','contest-simulation-result-title');
  let activeRun=null,disposed=false,running=false,completed=false,available=false,inputSignature='',resultSignature='',characterId,lastEntry=null;
  let mode='recommended',recommendations=null,optimization=null,selectMode=()=>{};
  const heading=el('div','','simulation-section-intro'),title=el('h2',t('舞台模拟'));title.id='contest-simulation-result-title';
  const multiCore=el('input'),multiCoreLabel=el('label','','simulation-multicore'),titleGroup=el('div','','simulation-title-group season-section-heading');
  multiCore.type='checkbox';multiCore.setAttribute('aria-label',t('模拟开启多核加速'));multiCoreLabel.append(multiCore,el('span',t('模拟开启多核加速')));
  const syncMultiCore=()=>{multiCore.checked=readSimulationMultiCore();multiCoreLabel.title=t('使用一半逻辑核心，下次模拟生效。');};
  const unsubscribeMultiCore=onSimulationMultiCoreChange(syncMultiCore);syncMultiCore();
  multiCore.onchange=()=>{try{saveSimulationMultiCore(multiCore.checked);}catch{multiCoreLabel.title=t('多核设置未能保存，当前页面仍会使用该值。');}};
  titleGroup.append(title,multiCoreLabel);
  const titleBlock=el('div','','simulation-heading-title'),engineCredit=el('p','','small muted'),engineLink=el('a',`GakumasTools · ${contestEngineMap.source.commit.slice(0,7)}`);engineLink.href=`https://github.com/${contestEngineMap.source.repository}/commit/${contestEngineMap.source.commit}`;engineLink.title=contestEngineMap.source.commit;engineLink.target='_blank';engineLink.rel='noopener noreferrer';engineCredit.append(t('模拟引擎：'),engineLink);const titleRow=el('div','','simulation-title-row season-section-heading');titleRow.append(titleGroup);if(supportBonus!==undefined){const bonus=el('span',t('当前支援卡奖励倍率 {0}',[supportBonus===null?t('未采集'):`+${supportBonus.toFixed(2)}%`]),'season-support-bonus');if(supportBonus!==null)bonus.title=`×${(1+supportBonus/100).toFixed(4)}`;titleRow.append(bonus);}titleBlock.append(titleRow,engineCredit,el('p',t('模拟采用自动出牌和随机抽样，供编组比较参考；实战表现可能因出牌策略和随机过程而不同。引擎与效果数据来自 GakumasTools。'),'simulation-source-note small muted'),el('p',t('综合分 =（平均数 + 中位数）÷ 2 + 0.25 × 上行波动 − 0.25 × 下行波动。上下行波动分别衡量高于和低于中位数的频率与幅度。'),'simulation-score-note small muted'));heading.append(titleBlock);
  if(onOpenConversions){const conversions=el('button',t('技能卡转换状态'),'contest-card-conversions-open');conversions.onclick=onOpenConversions;titleGroup.append(conversions);}
  const controls=el('div','','contest-simulation-controls'),runs=el('input'),runValue=el('output'),runLabel=el('label',t('模拟次数')),rerun=el('button',t('模拟'),'primary season-simulate'),stop=el('button',t('停止'));runs.id='contest-simulation-runs';runs.type='range';runs.min='100';runs.max='10000';runs.step='100';runs.value='500';runLabel.htmlFor=runs.id;runValue.htmlFor=runs.id;runValue.textContent=runs.value;runLabel.append(runValue,runs);controls.append(runLabel,rerun,stop);
  const quickPicker=onQuickStage?createContestQuickStagePicker(quickStages,onQuickStage):null;if(quickPicker)controls.insertBefore(quickPicker.element,stop);
  const failure=el('div','','simulation-run-error');
  const status=el('p','','small muted'),progress=el('progress'),output=el('section','','contest-simulation-output'),saveStatus=el('p','','simulation-save-status small muted'),stale=el('p','','simulation-stale-note small muted');status.setAttribute('role','status');status.setAttribute('aria-live','polite');progress.setAttribute('aria-label',t('模拟进度'));saveStatus.setAttribute('aria-live','polite');stale.hidden=true;
  const resultView=el('section','','simulation-result-view');resultView.id='simulation-result-view';resultView.hidden=true;resultView.setAttribute('aria-label',t('模拟结果'));
  const history=createSimulationHistoryPanel({profile,stage,onView:entry=>{
    if(running)return;characterId=entry.characterId;runs.value=String(entry.result.runs);runValue.textContent=runs.value;completed=true;resultSignature='history';status.textContent=t('正在查看历史模拟：{0}',[new Intl.DateTimeFormat(locale(),{dateStyle:'short',timeStyle:'medium'}).format(new Date(entry.createdAt))]);saveStatus.textContent='';showResult(entry.result,entry);selectMode('selected');sync();
  },onRestore:entry=>{
    if(running)return;
    if(onRestore(entry)===false)saveStatus.textContent=t('当前资料已不包含此舞台，无法载入编组。');
    else selectMode('selected');
  }});
  history.element.id='simulation-history-view';history.element.hidden=true;
  resultView.append(stale,failure,output,saveStatus);element.append(heading,controls,status,progress,resultView,history.element);
  function sync(){
    resultView.hidden=!output.childElementCount;status.hidden=!status.textContent;runs.disabled=running;rerun.disabled=running||!available;quickPicker?.setDisabled(running||!available);history.setBusy(running);rerun.textContent=t(completed?'重新模拟':'模拟');stop.hidden=!running;progress.hidden=!running;
    stale.hidden=!completed||!running&&(resultSignature==='history'||resultSignature===inputSignature);stale.textContent=t(running?'正在重新模拟，以下保留上次完成结果。':'编组已调整，以下保留上次模拟结果；重新模拟后更新。');
  }
  const format=value=>new Intl.NumberFormat(locale(),{maximumFractionDigits:0}).format(value);
  function showResult(result,entry){
    failure.replaceChildren();lastEntry=entry;
    const statistics=recommendationStatistics(result.scores),overview=el('header','','simulation-result-overview'),identity=el('div','','simulation-result-identity'),caption=el('div','','simulation-result-caption');
    identity.append(el('h3',t('模拟结果')));
    if(entry){const date=el('time',new Intl.DateTimeFormat(locale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(entry.createdAt)));date.dateTime=entry.createdAt;caption.append(date);}
    if(characterId){const character=characterInfo(characterId),face=illustration(character.face,character.name,'simulation-result-face');face.title=character.name;caption.append(face);}
    caption.append(el('span',t('{0} 次模拟',[result.runs])));
    if(!result.manualMultipliers)caption.append(el('span',t('支援奖励 +{0}%',[(result.supportBonus*100).toFixed(2)]),'simulation-result-bonus'));
    caption.append(el('span',t('随机种子 {0}',[result.seed]),'simulation-result-seed'));

    identity.append(caption);overview.append(identity,comparisonScore(statistics));
    const values={...result,deviation:statistics.deviation,p25:scoreQuantile(result.scores,.25),p75:scoreQuantile(result.scores,.75)},scores=el('div','','contest-simulation-scores');
    for(const [key,label] of [['mean','平均值'],['median','中位数'],['deviation','标准差'],['p25','P25'],['p75','P75']]){const stat=el('div');stat.dataset.score=key;stat.append(el('span',t(label)),el('strong',format(values[key])));scores.append(stat);}

    const multipliers=el('div','','contest-simulation-multipliers');for(const [key,label] of [['vocal','Vo'],['dance','Da'],['visual','Vi']]){const value=el('div');value.append(el('small',label),el('strong',`${new Intl.NumberFormat(locale(),{maximumFractionDigits:1}).format(result.multipliers[key]*100)}%`));value.dataset.attribute=key;multipliers.append(value);}
    const bonus=el('p',result.manualMultipliers?t('使用手动输入的倍率，不再叠加支援奖励。'):t('已计入支援奖励 +{0}%。',[(result.supportBonus*100).toFixed(2)]),'small muted');
    const graphControls=el('div','','simulation-segments'),graph=el('div'),recordControls=el('div','','simulation-segments'),records=el('div'),recordScore=el('p','','simulation-record-score');
    function switches(container,options,initial,callback){
      container.setAttribute('role','group');
      for(const [key,label] of options){const button=el('button',t(label));button.type='button';button.dataset.view=key;button.setAttribute('aria-pressed',String(key===initial));button.onclick=()=>{for(const sibling of container.children)sibling.setAttribute('aria-pressed',String(sibling===button));callback(key);};container.append(button);}callback(initial);
    }
    graphControls.setAttribute('aria-label',t('结果图表'));recordControls.setAttribute('aria-label',t('代表局'));
    switches(graphControls,[['distribution','分数分布'],['box','分位区间'],['turns','得分走势']],'distribution',key=>graph.replaceChildren(simulationChart(result,key)));
    switches(recordControls,[['minimumRun','最低分'],['representative','接近平均分'],['maximumRun','最高分']],'representative',key=>{const run=result[key];recordScore.textContent=t('本局得分：{0}',[format(run.score)]);records.replaceChildren(simulationRecords(run,{characterId}));});
    const details=el('details','','simulation-records'),recordToolbar=el('div','','simulation-record-toolbar');recordToolbar.append(recordControls,recordScore);details.append(el('summary',t('逐回合记录')),recordToolbar,records);
    engineLink.href='https://github.com/gakumas-tools/gakumas-tools/tree/'+result.source.commit;
    const analysis=el('div','','simulation-result-analysis'),chartPanel=el('section','','simulation-result-chart-panel'),context=el('aside','','simulation-result-context'),configuration=el('section','','simulation-result-configuration');
    chartPanel.append(graphControls,graph);configuration.append(el('h4',t('本次使用倍率')),multipliers);if(result.manualMultipliers)configuration.append(bonus);context.append(configuration);
    if(entry){const deck=el('section','','simulation-result-deck');deck.append(el('h4',t('本次编组')),entry.loadout?.memories?.some(Boolean)?loadoutPreview(entry.loadout,{excludedCardIds:entry.loadout.memories.flatMap(memory=>memory?.examBattleProduceCards??[]).map(card=>card.id).filter(id=>!entry.request.cards.some(card=>card.reference.id===id))}):simulationLoadoutSummary(entry));context.append(deck);}
    analysis.append(chartPanel,context);
    const inspections=el('div','','simulation-result-inspections');inspections.append(simulationStatistics(result.statistics,{characterId}),details);output.replaceChildren(overview,scores,analysis,inspections);
  }
  function showError(error){
    const message=el('p',t(error.code==='unsupported_entities'?'以下内容尚未匹配到模拟引擎，未生成分数：':errorLabels[error.code]??errorLabels.engine_failed),'message');message.setAttribute('role','alert');const target=completed?failure:output;target.replaceChildren(message);
    if(error.details?.length){const list=el('ul');const seen=new Set();for(const item of error.details){const label=t(({card:'技能卡',customization:'附魔',item:'P 道具'})[item.kind]??'未分类')+' · '+item.name;if(!seen.has(label)){seen.add(label);list.append(el('li',label));}}target.append(list);}
  }
  async function run(){
    if(!available||running||disposed)return;
    closeRewardPopover();const input=getInput(),request=input.request,runStage=input.stage,loadout=input.loadout,signature=inputSignature;characterId=input.characterId;
    running=true;failure.replaceChildren();if(!completed)output.replaceChildren();saveStatus.textContent='';selectMode('selected');onTaskChange({state:'running',stop:()=>activeRun?.cancel()});progress.max=Number(runs.value);progress.value=0;status.textContent=t('正在模拟 {0}/{1}',[0,runs.value]);sync();
    let handle;
    try{
      handle=startContestSimulation(request,{runs:Number(runs.value),multiCore:readSimulationMultiCore(),onProgress:count=>{if(activeRun!==handle||disposed)return;progress.value=count;status.textContent=t('正在模拟 {0}/{1}',[count,runs.value]);}});activeRun=handle;
      const result=await handle.promise;if(activeRun!==handle||disposed)return;completed=true;resultSignature=signature;status.textContent=t('已完成 {0} 次模拟',[result.runs]);
      const entry=createSimulationRecord(request,runStage,result,{characterId:input.characterId,loadout});showResult(result,entry);onTaskChange({state:'completed'});
      try{const saved=await rememberSimulation(profile,entry);if(!disposed){saveStatus.textContent=saved?t('已保存到此舞台的模拟历史。'):'';await history.refresh(entry.id);}}
      catch{if(!disposed)saveStatus.textContent=t('结果已完成，但历史保存失败；当前结果仍可查看。');}
    }catch(error){if(handle&&activeRun!==handle||disposed)return;onTaskChange({state:'stopped'});if(error.name==='AbortError')status.textContent=t('模拟已停止');else{status.textContent=t('模拟未完成');showError(error);}}
    finally{if(!disposed&&(!handle||activeRun===handle)){activeRun=null;running=false;sync();}}
  }
  rerun.onclick=run;stop.onclick=()=>activeRun?.cancel();runs.oninput=()=>{runValue.textContent=runs.value;};
  runs.onchange=()=>{status.textContent=available?t('请选择模拟次数后开始。'):'';sync();};
  sync();void history.refresh();
  return {element,setModes(selection,recommendationPanel,optimizationPanel){
    recommendations=recommendationPanel;optimization=optimizationPanel;
    const tabs=el('div','','simulation-segments simulation-mode-tabs'),selectedPanel=el('div','','simulation-selected-panel'),recommendedPanel=recommendations.element;
    tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',t('舞台模拟'));
    selectedPanel.append(selection,...[...element.children].filter(child=>child!==heading&&child!==history.element));
    const entries=[['recommended','推荐编组模拟',recommendedPanel],...(optimization?[['optimization','自定义推荐编组模拟',optimization.element]]:[]),['selected','自选编组模拟',selectedPanel],['history','模拟历史',history.element]];
    selectMode=value=>{
      closeRewardPopover();quickPicker?.hide();mode=value;
      for(const [key,,panel] of entries){const selected=key===mode,tab=tabs.querySelector(`[data-mode="${key}"]`);panel.hidden=!selected;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
      if(mode==='recommended')recommendations.refresh();
      if(mode==='optimization')optimization?.refresh();
      if(mode==='history')void history.refresh();
    };
    for(const [index,[key,label,panel]] of entries.entries()){
      const tab=el('button',t(label),key==='history'?'season-simulation-history-open':'');tab.dataset.mode=key;tab.id=`simulation-mode-${key}`;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panel.id||`simulation-panel-${key}`);panel.id||=`simulation-panel-${key}`;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);
      tab.onclick=()=>selectMode(key);
      tab.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?entries.length-1:(index+(event.key==='ArrowLeft'?-1:1)+entries.length)%entries.length;selectMode(entries[next][0]);tabs.children[next].focus();};tabs.append(tab);
    }
    element.append(tabs,recommendedPanel,...(optimization?[optimization.element]:[]),selectedPanel,history.element);selectMode(mode);
  },showSelected(){selectMode('selected');},showMode(value){selectMode(value);},update(input){
    available=input.available;inputSignature=input.signature;
    if(stage.id!==input.stage.id){stage=input.stage;history.setStage(stage);}
    if(!completed&&!running){status.textContent=available?t('请选择模拟次数后开始。'):'';}
    if(mode==='recommended')recommendations?.refresh();if(mode==='optimization')optimization?.refresh();sync();
  },dispose(){quickPicker?.dispose();unsubscribeMultiCore();disposed=true;activeRun?.cancel();activeRun=null;},refreshHistory(){void history.refresh();},showHistory(){selectMode('history');},captureState(){return {mode,runs:runs.value,entry:completed?lastEntry:null,signature:resultSignature};},restoreState(state){
    runs.value=state.runs;runValue.textContent=runs.value;
    if(state.entry){const entry=state.entry;characterId=entry.characterId;completed=true;resultSignature=state.signature;showResult(entry.result,entry);status.textContent=t('已完成 {0} 次模拟',[entry.result.runs]);}
    selectMode(state.mode??'recommended');sync();
  }};
}
