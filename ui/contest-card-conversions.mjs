import {el,openDialog} from './dom.mjs';
import {t} from '../i18n.mjs';
import {cardRewardInfo,planLabel} from '../domain/catalog.mjs';
import {skillThumbnail,filterSymbol} from './illustrations.mjs';
import {supportHint,closeRewardPopover} from './card-rewards.mjs';
import {skillCardDetails} from './skill-card-details.mjs';
import {choiceFilterIcons} from './choice-filter-icons.mjs';
import {activeConversionCard,conversionUnlocked} from '../domain/card-conversions.mjs';

let dialog;
export function openContestCardConversionSettings({choices,level,preferences,capturedKnown=false,onChange}){
  if(!dialog){dialog=el('dialog','','contest-conversion-dialog');dialog.id='contest-card-conversion-dialog';dialog.setAttribute('aria-labelledby','contest-card-conversion-title');dialog.addEventListener('close',closeRewardPopover);document.body.append(dialog);}
  const head=el('div','','dialog-head'),title=el('h2',t('技能卡转换状态')),close=el('button',t('关闭'));
  title.id='contest-card-conversion-title';close.onclick=()=>dialog.close();head.append(title,close);
  const error=el('p','','message error');error.hidden=true;error.setAttribute('role','alert');
  const pairs=new Map(choices.filter(choice=>choice.conversion).map(choice=>[choice.conversion.beforeProduceCardId,choice.conversion]));
  const byId=new Map(choices.map(choice=>[choice.id,choice]));
  const panel=el('section','','contest-card-conversions');
  panel.append(el('p',t(capturedKnown?'默认采用采集的游戏转换设置，手动选择仅在本站生效。':'尚未采集游戏转换设置，解锁后默认启用转换版，可手动调整。')+t('所有舞台共用此设置，已有回忆中的非当前版本在实际比赛中视为空技能卡槽位。'),'small muted'));
  const list=el('div','','contest-card-conversion-list');panel.append(list);
  const filters=el('div','','contest-conversion-filters contest-memory-plan-flows contest-item-filters'),plan=el('select');plan.id='contest-conversion-plan';
  plan.append(new Option(t('全部'),''));
  for(const value of ['Plan1','Plan2','Plan3','Common'])if([...pairs.values()].some(pair=>byId.get(pair.afterProduceCardId).metadata.plan===value))plan.append(new Option(value==='Common'?t('通用'):planLabel(value),value));
  const planFilter=choiceFilterIcons(plan,'plan','计划',filterRows);
  const enhanced=el('input'),enhancedLabel=el('label','','contest-conversion-enhanced');enhanced.type='checkbox';enhanced.checked=true;enhanced.id='contest-conversion-enhanced';
  enhancedLabel.append(enhanced,el('span',t('强化')));head.insertBefore(enhancedLabel,close);filters.append(planFilter.group);
  enhanced.onchange=()=>{const scrollTop=panel.scrollTop;drawRows();panel.scrollTop=scrollTop;};
  function filterRows(){
    closeRewardPopover();
    for(const row of list.children)row.hidden=Boolean(plan.value&&row.dataset.plan!==plan.value);
    planFilter.sync();
    panel.scrollTop=0;
  }

  function drawRows(){
    closeRewardPopover();list.replaceChildren();
    for(const pair of [...pairs.values()].sort((a,b)=>a.unlockProducerLevel-b.unlockProducerLevel)){
      const before=byId.get(pair.beforeProduceCardId),after=byId.get(pair.afterProduceCardId),unlocked=conversionUnlocked(pair,level);
      const row=el('section','','contest-card-conversion'),heading=el('div','','contest-conversion-heading'),name=el('h3',after.name),symbol=filterSymbol(after.metadata.plan);
      row.dataset.conversionId=pair.beforeProduceCardId;row.dataset.plan=after.metadata.plan;row.setAttribute('role','group');row.setAttribute('aria-label',`${before.name} → ${after.name}`);
      if(symbol)heading.append(symbol);heading.append(name);
      const requirement=el('small',t('解锁 P 等级：{0}',[pair.unlockProducerLevel]),'contest-conversion-requirement muted');
      requirement.title=unlocked?requirement.textContent:`${requirement.textContent} · ${t(Number.isSafeInteger(level)?'尚未解锁':'P 等级未知')}`;
      heading.append(requirement);
      // 统一强化开关只改变预览；转换选择和回忆记录保持独立。
      const rewards=[before,after].map(choice=>cardRewardInfo({id:choice.id,upgradeCount:enhanced.checked?1:0,customizes:[]},choice.previewCharacterId));
      const cards=el('div','','contest-conversion-options'),inputs=[];
      for(const [index,version] of ['before','after'].entries()){
        const reward=rewards[index],option=el('div','','contest-conversion-option'),input=el('input');
        input.type='radio';input.name=`conversion-${pair.beforeProduceCardId}`;input.value=version;input.disabled=!unlocked;
        input.setAttribute('aria-label',t(version==='before'?'原版：{0}':'转换后：{0}',[reward.name]));option.dataset.version=version;
        const preview=el('button','','contest-conversion-card'),thumb=skillThumbnail(reward.versions[0]);thumb.dataset.upgradeCount=String(reward.reference.upgradeCount);
        preview.setAttribute('aria-label',reward.name);preview.append(thumb);
        option.append(preview,input,el('span',reward.name,'contest-conversion-card-name'));
        supportHint(preview,()=>skillCardDetails(reward,{recorded:true,chooseVersion:false}),{container:option});
        const showDetails=preview.onclick;preview.onclick=()=>{showDetails();if(!input.disabled)input.click();};
        cards.append(option);inputs.push(input);
        input.onchange=()=>{
          if(!input.checked)return;
          const next={...preferences,[pair.beforeProduceCardId]:version};
          try{onChange(next,{beforeProduceCardId:pair.beforeProduceCardId,version});preferences=next;error.hidden=true;}
          catch{error.textContent=t('版本设置保存失败，请检查浏览器存储。');error.hidden=false;}
          sync();
        };
      }
      function sync(){
        const selected=activeConversionCard(pair,level,preferences)===pair.afterProduceCardId?'after':'before';
      name.textContent=rewards[selected==='after'?1:0].name;
        for(const input of inputs){input.checked=input.value===selected;input.parentElement.classList.toggle('is-selected',input.checked);input.parentElement.classList.toggle('is-locked',input.disabled&&!input.checked);}
      }
      sync();row.append(heading,cards);list.append(row);
    }
    filterRows();
  }
  drawRows();dialog.replaceChildren(head,filters,panel,error);openDialog(dialog);
}
