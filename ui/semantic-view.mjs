import {customizationEffects} from './card-customizations.mjs';
import {t,localizeSource} from '../i18n.mjs';
import {effectReading,isEffectCaveat} from './effect-view.mjs';
const textNode = (tag, text, className = '') => {
  const node = document.createElement(tag); node.textContent = localizeSource(text); node.className = className; return node;
};
function descriptionEntry(entry,options) {
  const block=textNode('article','','semantic-entry');
  const heading=textNode('h4',entry.heading);
  if(entry.status==='unresolved')heading.append(textNode('span',t('说明暂缺'),'semantic-status unresolved'));
  block.append(heading);
  if(entry.customization){block.append(customizationEffects(entry.customization));return block;}
  for (const line of entry.lines) {
    if (line==='以下为未叠加自定义的基础卡说明'||isEffectCaveat(line)||/^强化 \+\d+$/.test(line)) continue;
    const definition=entry.technical?.definition??entry.technical?.skill;
    block.append(effectReading(line===entry.sourceText?entry.readingText:line,{...options,descriptionParts:line===entry.sourceText?(definition?.descriptions??definition?.produceDescriptions):undefined,interfaceText:line!==entry.sourceText,cardReferences:entry.cardReferences??[],effectIds:line===entry.sourceText?(entry.technical?.slots?.map(slot=>slot.effectId)??[]):[]}));
  }
  for (const customization of entry.customizations??[]) block.append(descriptionEntry(customization,options));
  return block;
}
export function semanticContent(group,options={}) {
  const node=textNode('div','','semantic-content');
  if (!group.entries.length) node.append(textNode('p',t('快照中为空；不推断为无价值')));
  for (const entry of group.entries) node.append(descriptionEntry(entry,options));
  return node;
}
export function semanticSection(name, group, expanded = false) {
  const section=textNode('details','','detail-section semantic-section');
  section.open=expanded;
  section.append(textNode('summary',name),semanticContent(group)); return section;
}
export function semanticComparisonRow(name, groups) {
  const row=textNode('tr'); const header=textNode('th',name);header.scope='row';row.append(header);
  const different=new Set(groups.map(group=>group.signature)).size>1;
  for (const group of groups) {
    const cell=textNode('td','',different?'different semantic-cell':'semantic-cell');
    if (different) cell.append(textNode('p',t('原始配置有差异；相同未解析文案不代表同一效果'),'semantic-caveat'));
    cell.append(semanticContent(group));row.append(cell);
  }
  return row;
}
