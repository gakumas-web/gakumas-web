import {assetURL,imageLoading} from '../resources.mjs';
import {skillThumbnail} from './illustrations.mjs';
import {supportSkillVisual} from '../domain/catalog.mjs';
import {descriptionIconType} from '../domain/effect-icons.mjs';
import {watchImage} from './image-loading.mjs';
import {t,localizeSource} from '../i18n.mjs';
import {plainText,descriptionLayout} from '../domain/semantic-text.mjs';
import {effectSourceText} from '../domain/effect-language.mjs';
import {iconForEffect} from '../domain/ability-summary.mjs';

let catalog={}, effects=new Map(), cards=[],labels=new Map();
export function installEffectPresentation(input) {
  catalog=input.abilityIcons??{};
  labels=new Map((input.semantics?.tables?.ProduceDescriptionLabel??[]).map(row=>[row.id,row]));
  cards=input.tables.ProduceCard??[];
  effects=new Map((input.tables.ProduceEffect??[]).map(row=>[row.id,row]));
}
const node=(tag,text='',className='')=>{const value=document.createElement(tag);value.textContent=text;value.className=className;return value;};
const examTerms={技能卡使用次数增加:'ExamPlayableValueAdd',元気:'ExamBlock',好調:'ExamParameterBuff',強気:'ExamCardPlayAggressive',全力値:'ExamFullPowerPoint',消費体力減少:'ExamStaminaConsumptionDown',スキルカード使用数追加:'ExamPlayableValueAdd',Shield:'ExamBlock',Focus:'ExamLessonBuff','Good Condition':'ExamParameterBuff','Good Impression':'ExamReview','Full Power Points':'ExamFullPowerPoint',Preservation:'ExamPreservation',Aggressive:'ExamCardPlayAggressive',温存:'ExamPreservation',体力消耗降低:'ExamStaminaConsumptionDown',好印象:'ExamReview',强势:'ExamCardPlayAggressive',元气:'ExamBlock',全力值:'ExamFullPowerPoint',好调:'ExamParameterBuff',技能卡可使用次数增加:'ExamPlayableValueAdd',集中:'ExamLessonBuff'};
function picture(icon,background,label) {
  const wrap=node('span','','effect-inline-icon');
  wrap.classList.toggle('exam-icon',!background&&icon.startsWith('img_general_icon_exam-effect_'));wrap.setAttribute('aria-hidden','true');
  for(const [file,layer] of [[background,'background'],[icon,'foreground']]) {
    if(!file)continue;
    const image=node('img');image.loading=imageLoading();image.src=assetURL(file);image.alt='';image.className=layer;
    watchImage(image);wrap.append(image);
  }
  wrap.title=label;return wrap;
}
// 正文卡片引用默认显示未强化版本；角色差分使用目录中的默认图。
function referenceImages(cardReferences){
  const references=new Map();
  for(const reference of cardReferences){
    const matches=cards.filter(card=>card.id===reference.id&&card.upgradeCount===0);
    const images=[...new Set(matches.flatMap(card=>Object.values(card.images??{})))];
    if(reference.name)references.set(reference.name,{name:reference.name,generic:true});
    if(reference.name&&images.length>0&&matches.length===1){
      const card={id:matches[0].id,upgradeCount:matches[0].upgradeCount,customizes:[]};
      references.set(reference.name,{name:reference.name,image:images[0],reference:card,visual:supportSkillVisual(card)});
    }
  }
  return references;
}
function referenceIcon(reference){
  return reference.generic?picture(catalog.examIcons.ExamCardCreateId,null,reference.name):skillThumbnail(reference,{compact:true});
}
function richLine(text,cardReferences=[],comparison) {
  const paragraph=node('p','','effect-reading-line');
  const appendText=text=>{
  const tokens=text.split(/(技能卡使用次数增加|Good Condition|Good Impression|Full Power Points|Preservation|Aggressive|Shield|Focus|スキルカード使用数追加|消費体力減少|元気|好調|強気|全力値|体力消耗降低|技能卡可使用次数增加|好印象|全力值|温存|强势|元气|好调|集中|[+−-]?\d+(?:\.\d+)?(?:%|％)?)/g);
  for(const token of tokens) {
    if(!token)continue;
    const icon=catalog.examIcons?.[examTerms[token]];
    if(icon){const term=node('span','','effect-term');term.append(picture(icon,null,token),document.createTextNode(token));paragraph.append(term);}
    else if(/^[+−-]?\d/.test(token)){
      paragraph.append(node('strong',token,'effect-number'));
      const change=comparison?.changes.get(comparison.index++);
      if(change){
        const value=`${change.delta>0?'+':''}${change.delta}${change.unit}`;
        const difference=node('span',` (${value})`,'effect-number-change '+(change.delta>0?'increase':'decrease'));
        difference.title=t('相对基准等级的变化：{0}',[value]);paragraph.append(difference);
      }
    }
    else paragraph.append(document.createTextNode(token));
  }
  };
  const references=referenceImages(cardReferences);
  if(!references.size){appendText(text);return paragraph;}
  const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp([...references.keys()].sort((a,b)=>b.length-a.length).map(escaped).join('|'),'g');
  let offset=0;
  for(const match of text.matchAll(pattern)){
    appendText(text.slice(offset,match.index));
    const name=match[0],reference=node('span','','effect-card-reference');
    if(comparison)comparison.index+=(name.match(/[+−-]?\d+(?:\.\d+)?[%％]?/g)??[]).length;
    reference.title=name;
    reference.append(referenceIcon(references.get(name)),document.createTextNode(name));paragraph.append(reference);offset=match.index+name.length;
  }
  appendText(text.slice(offset));return paragraph;
}
export const isEffectCaveat=line=>/^(?:效果 \d|触发条件|关联 \d|适用模式|没有可联接|卡牌使用条件|附加使用限制|费用／|道具效果链|效果待解析|未解析[:：]|未解析基础说明|未解析能力说明)/.test(line);
// 行首图标独立占列，正文保留原节点；句中图标仍随文字排列。
function alignLeadingIcons(body){
  for(const line of body.querySelectorAll('.effect-reading-line')){
    const icons=[];
    while(line.firstElementChild){
      const first=line.firstChild;
      if(first?.nodeType!==1)break;
      if(first.classList.contains('effect-inline-icon')){icons.push(first);first.remove();continue;}
      const icon=first.classList.contains('effect-term')?first.firstElementChild:null;
      if(!icon?.classList.contains('effect-inline-icon'))break;
      icons.push(icon);icon.remove();
      if(first.childNodes.length)break;
      first.remove();
    }
    if(!icons.length)continue;
    const leading=node('span','','effect-leading-icons'),text=node('span','','effect-line-text');
    leading.append(...icons);text.append(...line.childNodes);line.append(leading,text);line.classList.add('effect-reading-hanging');
  }
}
export function effectReading(raw,{descriptionParts,leadingEffectIcons=false,effectIds=[],cardReferences=[],numberChanges=[],interfaceText=['未解锁','已解锁','效果说明未解析','效果说明未收录'].includes(raw)}={}) {
  const block=node('div','','effect-reading');
  // 直接读取结构化说明中的卡片关联，让附魔、道具和技能正文共用同一缩略图。
  const linkedReferences=[...cardReferences,...(descriptionParts??[]).filter(part=>part.produceDescriptionType==='ProduceDescriptionType_ProduceCard'&&part.targetId&&part.text).map(part=>({id:part.targetId,name:plainText(part.text)}))];
  const unique=new Set(),leadingIcons=[];
  const finish=body=>{
    const first=body.querySelector('.effect-reading-line');
    const existing=first?.firstElementChild?.querySelector('.effect-inline-icon .foreground')?.getAttribute('src');
    first?.prepend(...leadingIcons.filter(icon=>icon.querySelector('.foreground')?.getAttribute('src')!==existing));
    alignLeadingIcons(body);block.append(body);return block;
  };
  const layout=descriptionParts?.length?descriptionLayout(descriptionParts,labels):[];
  const lineImage=line=>!line.effectId||line.tokens.some(token=>catalog.examIcons?.[descriptionIconType(token)])?{}:iconForEffect(effects.get(line.effectId),catalog);
  const inlineIcons=descriptionParts?.some(part=>catalog.examIcons?.[descriptionIconType(part)])||layout.some(line=>lineImage(line).icon);
  for(const id of inlineIcons&&!leadingEffectIcons?[]:effectIds){const image=iconForEffect(effects.get(id),catalog);if(image.icon&&!unique.has(image.icon)){
    unique.add(image.icon);leadingIcons.push(picture(image.icon,image.background,''));
  }}
  if(layout.length){
    block.classList.add('effect-reading-structured');
    const body=node('div','','effect-reading-body');
    const references=referenceImages(linkedReferences);
    let numberIndex=0;const changes=new Map(numberChanges.map(change=>[change.index,change]));
    for(const line of layout){
      const paragraph=node('p','',`effect-reading-line effect-line-${line.kind}`);
      const image=lineImage(line);
      if(image.icon){const term=node('span','','effect-term');term.append(picture(image.icon,image.background,''));paragraph.append(term);}
      for(const token of line.tokens){
        const type=descriptionIconType(token),icon=catalog.examIcons?.[type];
        const cardImage=references.get(token.text);
        const target=icon||cardImage?node('span','',cardImage?'effect-card-reference':'effect-term'):paragraph;
        if(icon){target.append(picture(icon,null,''));paragraph.append(target);}
        else if(cardImage){target.append(referenceIcon(cardImage));paragraph.append(target);}
        for(const text of token.text.split(/([+−-]?\d+(?:\.\d+)?[%％]?)/g)){
          if(!text)continue;
          if(/^[+−-]?\d/.test(text)){
            target.append(node(token.amount?'strong':'span',text,token.amount?'effect-amount':''));
            const change=changes.get(numberIndex++);
            if(change)target.append(node('span',` (${change.delta>0?'+':''}${change.delta}${change.unit})`,'effect-number-change '+(change.delta>0?'increase':'decrease')));
          }else target.append(document.createTextNode(text));
        }
      }
      body.append(paragraph);
    }
    return finish(body);
  }
  const lines=raw.split('\n').filter(Boolean),body=node('div','','effect-reading-body');
  const comparison={changes:new Map(numberChanges.map(change=>[change.index,change])),index:0};
  for(const line of lines) {
    if(isEffectCaveat(line))continue;
    if(/未定義のパターン/.test(line)){body.append(node('p',t('该效果的公开说明暂缺。'),'muted'));continue;}
    const text=interfaceText?localizeSource(line):effectSourceText(line);
    // 正文保持源词句及顺序，沿用主数据分隔标记生成的换行。
    body.append(richLine(text,linkedReferences,comparison));
  }
  if(!body.childNodes.length)body.append(node('p',t('效果说明暂缺，请展开原文核对。'),'muted'));
  return finish(body);
}
