import {createChoiceNavigation} from './choice-navigation.mjs';
import {contestRulesHelp} from './contest-card-cost.mjs';
import {layerSimulationMetrics} from './contest-simulation-charts.mjs';
import {readSimulationMultiCore} from '../application/contest-compute-preferences.mjs';
import {el} from './dom.mjs';
import {illustration,characterAccent} from './illustrations.mjs';
import {t,locale} from '../i18n.mjs';
import {characterInfo,compareCharacterFilters} from '../domain/catalog.mjs';
import {memoryShortId} from '../domain/model.mjs';
import {recommendationMemories,recommendationPairCount,RECOMMENDATION_FINAL_RUNS,RECOMMENDATION_LIMIT} from '../domain/contest-recommendations.mjs';
import {createContestRecommendationController} from '../application/contest-recommendation-controller.mjs';
import {captureSimulationLoadout} from '../application/contest-simulation-history.mjs';
import {comparisonScore,comparisonRange,scoreQuantile} from './contest-simulation-charts.mjs';
import {loadoutPreview} from './contest-loadout-library.mjs';
import {closeRewardPopover} from './card-rewards.mjs';
import {errorLabels} from './contest-simulation-result.mjs';

export function createContestRecommendations({getContext,onRestore,onSave,onOpenMemory,initialState,onTaskChange=()=>{}}){
  const element=el('div','','contest-recommendations');element.id='contest-recommendations';
  let view=null,disposed=false,cache=null,selectedCharacterId=initialState?.selectedCharacterId??null,handleSearchEvent=()=>{};
  const search=createContestRecommendationController({initialState,onEvent:event=>{
    if(event.type==='started')onTaskChange({state:'running',stop:search.stop});
    else if(event.type==='queued')onTaskChange({state:'queued',stop:search.stop});
    else if(event.type==='completed')onTaskChange({state:'completed'});
    else if(['stopped','failed','invalidated'].includes(event.type))onTaskChange({state:'stopped'});
    handleSearchEvent(event);
  }});
  function show(){
    if(disposed)return;
    const context=getContext(),eligible=recommendationMemories(context.memories,context.stage),characters=new Map();
    for(const memory of eligible)characters.set(memory.characterId,(characters.get(memory.characterId)??0)+1);
    if(!search.setContext(context)&&view)return;
    closeRewardPopover();
    const currentView=el('div','','recommendation-content');view=currentView;
    const description=el('p',t('使用当前舞台与持有回忆，所有符合偶像与计划条件的回忆都参与主副组合。'),'recommendation-description small muted');
    const controls=el('div','','recommendation-controls'),idolGroup=el('fieldset','','recommendation-characters'),start=el('button',t('开始搜索'),'primary recommendation-start'),stop=el('button',t('停止'),'recommendation-stop');
    const orderedCharacters=[...characters].sort(([a,ac],[b,bc])=>bc-ac||compareCharacterFilters(a,b));
    const idol={value:characters.has(selectedCharacterId)?selectedCharacterId:orderedCharacters[0]?.[0]??''},choices=[];
    selectedCharacterId=idol.value;
    const characterTitle=el('legend'),count=el('p',t('按回忆持有数排序'),'recommendation-count small muted');
    idolGroup.setAttribute('role','radiogroup');idolGroup.setAttribute('aria-label',t('模拟偶像(按回忆持有数排序)'));idolGroup.append(characterTitle,count);
    const navigateCharacters=createChoiceNavigation({getButtons:()=>choices,onMove:button=>button.click()});
    for(const [id,count] of orderedCharacters){
      const info=characterInfo(id),choice=el('button','','recommendation-character'),label=t('{0}（{1} 条回忆）',[info.name,count]);
      choice.dataset.characterId=id;choice.title=label;choice.setAttribute('role','radio');choice.setAttribute('aria-label',label);characterAccent(choice,id);
      const face=illustration(info.face,info.name,'filter-face');face.setAttribute('aria-hidden','true');choice.append(face,el('span',String(count),'recommendation-character-count'));
      choice.onclick=()=>{idol.value=id;selectedCharacterId=id;status.textContent='';render();sync();};
      choice.onkeydown=navigateCharacters;
      choices.push(choice);idolGroup.append(choice);
    }
    controls.append(start,stop);
    const status=el('p','','recommendation-status small muted'),progress=el('progress'),summary=el('p','','recommendation-summary small muted'),list=el('div','','recommendation-list');status.setAttribute('role','status');status.setAttribute('aria-live','polite');summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');progress.setAttribute('aria-label',t('推荐进度'));
    const algorithm=el('details','','recommendation-algorithm');algorithm.append(
      el('summary',t('推荐算法')),
      el('p',t('组合：从所选偶像、符合舞台计划的持有回忆中枚举主副组合，同一回忆不重复使用，各编组独立模拟。')),
      el('p',t('筛选：按 4 → 16 → 64 次逐步筛选，前两轮比较牌效，第三轮比较模拟得分；候选较少时跳过前置筛选。')),
      el('p',t('复评：最多 20 组各模拟 500 次，仅为前三名竞争接近的组合补到 {0} 次，最终推荐前 {1} 组。',[RECOMMENDATION_FINAL_RUNS,RECOMMENDATION_LIMIT])),
      el('p',t('推荐为抽样结果，不保证最优或实际战斗表现；不会自动写入模拟历史，可保存编组或载入后自行模拟。')),
      el('p',t('已完成结果按舞台和偶像暂存，重新推荐成功后替换；修改比赛倍率、导入快照、切换账号或刷新页面后清除。'))
    );
    currentView.append(description,contestRulesHelp(algorithm),idolGroup,controls,status,progress,summary,list);element.replaceChildren(currentView);
    const format=value=>new Intl.NumberFormat(locale(),{maximumFractionDigits:0}).format(value);
    function sync(){
      const candidates=recommendationMemories(context.memories,context.stage,idol.value),available=candidates.length;
      characterTitle.textContent=t('模拟偶像：{0} · 持有 {1} 条回忆 · {2} 个主副组合',[characterInfo(idol.value).name,available,recommendationPairCount(candidates)]);
      const missing=context.supportCards===undefined?'支援卡持有信息未采集，无法计算当前支援奖励。':context.stage.manualMultipliers&&!['vocal','dance','visual'].every(key=>Number.isFinite(context.manual[key])&&context.manual[key]>=0)?'请先填写此舞台的 Vo、Da、Vi 比赛倍率。':available<2?'至少需要同一偶像的两条符合当前舞台计划的回忆。':null;
      if(!search.running&&missing)status.textContent=t(missing);
      start.disabled=search.running||Boolean(missing);for(const choice of choices){const selected=choice.dataset.characterId===idol.value;choice.disabled=search.running;choice.setAttribute('aria-checked',String(selected));choice.tabIndex=selected?0:-1;}stop.hidden=!search.running;progress.hidden=!search.running;
      start.textContent=t(search.queued?'等待执行':search.running?'搜索中…':'开始搜索');stop.textContent=t(search.queued?'取消等待':'停止');
      list.inert=search.running;summary.title=search.running&&cache?t('重新模拟期间显示上次完成结果。'):'';
    }
    function sourceFor(row,index){
      const memories=[cache.memories[row.main],cache.memories[row.sub]],originals=[cache.originals[row.main],cache.originals[row.sub]];
      return {id:`recommendation-${cache.report.seed}-${index}`,stage:cache.stage,loadout:captureSimulationLoadout(memories,cache.manual,originals)};
    }
    function render(){
      closeRewardPopover();list.replaceChildren();summary.textContent='';cache=search.resultFor(idol.value);
      if(!cache)return;
      list.append(el('p',t('推荐结果暂存于当前页面；保存编组可再次载入。载入自选并完成模拟后，结果才会记入模拟历史。'),'small muted'));
      const report=cache.report;summary.textContent=t('推荐 {0} 组 · {1} 个组合 · {2} 次模拟 · 耗时 {3} 秒 · 种子 {4}',[report.rows.length,report.combinations,report.totalRuns,cache.elapsedSeconds.toFixed(0),report.seed]);
      if(report.skipped.length){
        const skipped=el('details','','recommendation-skipped'),names=[...new Set(report.skipped.flatMap(row=>row.details.map(detail=>detail.name)))];
        skipped.append(el('summary',t('{0} 种配置无法完整模拟，未参与推荐。',[report.skipped.length])));
        if(names.length)skipped.append(el('p',t('未匹配内容：{0}',[names.join('、')])));else skipped.append(el('p',t('请检查回忆的属性、体力及卡组记录。')));
        list.append(skipped);
      }
      if(!report.rows.length){list.append(el('p',t('没有可推荐的有效编组。'),'empty-result'));return;}
      const minimum=Math.min(...report.rows.map(row=>row.result.minimum)),maximum=Math.max(...report.rows.map(row=>row.result.maximum));
      for(const [index,row] of report.rows.entries()){
        const entry=el('article','','recommendation-entry');entry.dataset.rank=String(index+1);entry.dataset.score=String(row.stats.score);entry.dataset.main=String(row.main);entry.dataset.sub=String(row.sub);
        const head=el('div','','recommendation-entry-heading'),label=el('div','','recommendation-entry-identity'),metrics=el('div','','recommendation-metrics');const character=characterInfo(cache.characterId),face=illustration(character.face,character.name,'recommendation-entry-face');face.title=character.name;label.append(el('span',`#${index+1}`,'recommendation-rank'),face,el('span',t('{0} 次模拟',[row.stats.runs]),'recommendation-run-count small muted'));head.append(label,comparisonScore(row.stats));
        const values={...row.stats,p75:scoreQuantile(row.result.scores,.75),p25:scoreQuantile(row.result.scores,.25)};
        for(const [key,text] of [['mean','平均值'],['median','中位数'],['deviation','标准差'],['p25','P25'],['p75','P75']]){
          const metric=el('div'),value=el('strong',format(values[key]));metric.dataset.metric=key;
          if(key==='p75'||key==='p25')metric.title=t(key==='p75'?'第 75 百分位得分':'第 25 百分位得分');
          metric.append(el('small',t(text)),value);metrics.append(metric);
        }
      layerSimulationMetrics(metrics,row.result);
        const source=sourceFor(row,index),details=el('section','','recommendation-loadout');const preview=loadoutPreview(source.loadout,context.conversionRules),items=preview.querySelector('.loadout-library-items');
        for(const [slot,memoryIndex] of [row.main,row.sub].entries()){
          const memory=cache.originals[memoryIndex],role=preview.querySelectorAll('.loadout-library-memory>small')[slot],link=el('button',role.textContent,'recommendation-memory-link');
          link.type='button';link.title=`${role.textContent} ${memoryShortId(memory)??'—'}`;link.dataset.memoryKey=memory.key;link.onclick=()=>onOpenMemory(memory.key);role.replaceChildren(link);
        }
        if(items){const itemRow=el('div','','recommendation-item-row');itemRow.append(items);preview.prepend(itemRow);}const result=el('div','','recommendation-result');result.append(metrics,comparisonRange(row.result,minimum,maximum));details.append(preview,result);
        const actions=el('div','','recommendation-entry-actions'),load=el('button',t('载入编组至自选模拟'),'primary'),save=el('button',t('保存编组'));load.dataset.action='load';save.dataset.action='save';
        load.onclick=()=>onRestore(source);save.onclick=()=>onSave(source);actions.append(load,save);
        const footer=el('div','','recommendation-entry-footer');footer.append(actions);entry.append(head,details,footer);list.append(entry);
      }
    }
    handleSearchEvent=event=>{
      switch(event.type){
        case 'queued':status.textContent=t('等待其他计算完成，使用开始时的配置。');progress.removeAttribute('value');sync();break;
        case 'started':render();status.textContent=t('正在枚举主副回忆组合…');progress.removeAttribute('value');sync();break;
        case 'progress':{
          const update=event.update;
          if(update.phase==='prepare'){status.textContent=t('正在枚举 {0}/{1} 个组合',[update.completed,update.total]);break;}
          const phase=t(({rough:'牌效粗筛（累计 {0} 次）',screen:'牌效初筛（累计 {0} 次）',review:'复筛（累计 {0} 次）',final:'最终复评（累计 {0} 次）'})[update.phase],[update.budget]);status.textContent=t('{0}：{1}/{2} 组 · {3}/{4} 次模拟',[phase,update.completed,update.total,update.runs,update.plannedRuns]);progress.max=update.plannedRuns;progress.value=update.runs;break;
        }
        case 'completed':status.textContent='';render();break;
        case 'stopped':status.textContent=t(search.resultFor(idol.value)?'推荐已停止，保留上次完成结果。':'推荐已停止，未完成最终排名。');break;
        case 'failed':status.textContent=t(errorLabels[event.error.code]??'推荐未能完成，请重试。');break;
        case 'idle':sync();break;
      }
    };
    start.onclick=()=>{if(!search.running&&!start.disabled)return search.run(idol.value,{multiCore:readSimulationMultiCore()});};
    stop.onclick=search.stop;
    render();sync();
  }
  return {element,refresh:show,captureState:()=>({selectedCharacterId,results:search.captureResults()}),dispose(){disposed=true;search.dispose();view=null;element.replaceChildren();}};
}
