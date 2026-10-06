import {uiIconURL} from '../resources.mjs';
import {el} from './dom.mjs';
import {t} from '../i18n.mjs';
import {skillThumbnail} from './illustrations.mjs';
import {customizationPanel,customizationEffects} from './card-customizations.mjs';
import {semanticContent} from './semantic-view.mjs';

function costLine(visual){
  const costs=el('div','','support-skill-header-costs');
  for(const cost of visual.costsKnown===false?[]:visual.costs){
    const value=el('span','','support-skill-header-cost');value.dataset.costKind=cost.kind;
    if(cost.icon){
      const icon=el('img');icon.src=cost.icon;icon.alt='';
      if(cost.kind==='status'){
        const frame=el('span','','support-skill-header-status-icon'),background=el('img');background.src=uiIconURL('skill-cost-status-bg.webp');background.alt='';icon.className='foreground';frame.append(background,icon);value.append(frame);
      }else value.append(icon);
    }
    value.append(el('span',`${cost.label} ${cost.value?`−${cost.value}`:'0'}`));costs.append(value);
  }
  return costs;
}
function basicEffects(version,recorded){
  const description={...version.description,...(recorded?{customizations:[]}:{}),lines:version.description.lines.filter(line=>line!==`强化 +${version.reference.upgradeCount}`&&!line.startsWith('体力消耗：'))};
  const effect=semanticContent({entries:[description]});effect.querySelector('h4')?.remove();
  // 使用消耗集中放在卡名下方，不在基础效果正文中重复。
  for(const line of effect.querySelectorAll(':scope > .semantic-entry > .effect-reading .effect-line-cost'))line.remove();
  effect.classList.add('support-skill-description');return effect;
}
function currentCustomizations(entries,reference){
  const count=(reference.customizes??[]).reduce((sum,entry)=>sum+entry.customizeCount,0);
  const section=el('section','','recorded-customization-effects');section.append(el('h5',t('当前附魔效果 ({0})',[count])));
  for(const entry of entries){
    if(entry.customization)section.append(customizationEffects(entry.customization,{current:true}));
    else section.append(semanticContent({entries:[entry]}));
  }
  return section;
}

// 三处入口共用说明组件；实际记录和目录奖励仅在数据、可用操作上有区别。
export function skillCardDetails(reward,{chooseVersion=true,customization,recorded=false,onVersionChange=()=>{}}={}){
  const body=el('div','','support-reward-body reward-description support-skill-detail');
  const label=el('label','','support-unupgraded'),toggle=el('input');toggle.type='checkbox';
  const initial=reward.reference?.upgradeCount??reward.versions.find(version=>version.reference.upgradeCount===1)?.reference.upgradeCount??reward.versions[0].reference.upgradeCount;
  const enhanced=Math.max(1,initial);
  toggle.checked=initial>0;toggle.disabled=!reward.versions.some(version=>version.reference.upgradeCount===0)||!reward.versions.some(version=>version.reference.upgradeCount===enhanced);
  label.append(toggle,document.createTextNode(t('显示强化状态')));
  const content=el('div');
  function render(){
    const version=reward.versions.find(entry=>entry.reference.upgradeCount===(toggle.checked?enhanced:0))??reward.versions[0];
    // 记录型列表缩略图保持采集状态，强化切换只改变浮层预览。
    if(!recorded)onVersionChange(version);
    const header=el('header','','support-skill-header'),identity=el('div'),title=el('div','','support-skill-title'),name=el('h4',version.name);name.title=version.name;
    title.append(name);if(chooseVersion)title.append(label);
    identity.append(title,costLine(version.visual));
    const effect=basicEffects(version,recorded),restrictions=el('div','','support-skill-restrictions');
    for(const line of effect.querySelectorAll(':scope > .semantic-entry > .effect-reading .effect-line-restriction'))restrictions.append(line);
    if(restrictions.childElementCount)identity.append(restrictions);
    const artwork=el('div','','support-skill-artwork');artwork.append(skillThumbnail(version),el('p',`${version.rarity.toUpperCase()} · ${version.category}`,'support-skill-category'));
    header.append(artwork,identity);content.replaceChildren(header,effect);
    if(recorded){
      const current=version.description.customizations??[];
      if(current.length)content.append(currentCustomizations(current,version.reference));
      const options=customizationPanel({cards:[version.reference]},{recorded:true});if(options)content.append(options);
    }else if(customization===undefined)content.append(customizationPanel({cards:[version.reference]}));
    else if(customization)content.append(el('p',`${t('特训 {0} 解锁专属技能卡附魔',[customization.rank])} · ${t('详情见附魔图标')}`,'small muted idol-customization-hint'));
  }
  toggle.onchange=()=>{render();toggle.focus({preventScroll:true});};body.append(content);render();return body;
}
