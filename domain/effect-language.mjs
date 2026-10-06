import {locale,localizeSource,t} from '../i18n.mjs';
import {plainText} from './semantic-text.mjs';

// 只对简短能力标签使用完整词匹配，不改写效果正文中的词语或句式。
const abilityTerms={
  'やる気':'干劲','元気':'元气','好調':'好调','絶好調':'绝好调','強気':'强气',
  '好印象':'好印象','集中':'集中','全力値':'全力值','温存':'温存',
  'スキルカード使用数追加':'技能卡使用次数增加','パラメータ値増加':'属性值增加',
  '消費体力減少':'体力消耗降低',
};
export const effectSourceText=raw=>plainText(raw).trim();
export function abilityLabel(raw){
  const source=effectSourceText(raw);
  return locale()==='ja'&&Object.hasOwn(abilityTerms,source)?source:localizeSource(abilityTerms[source]??source);
}
export function abilityValue(raw){
  const source=effectSourceText(raw),turns=source.match(/^([+−-]?\d+(?:\.\d+)?)ターン$/);
  return turns?t('{0} 回合',[turns[1]]):localizeSource(source);
}

// 中文搜索只增加固定术语别名，不生成或检索拼接出的译文句子。
const searchTerms={...abilityTerms,
  'ボーカル':['Vo','声乐'],'ダンス':['Da','舞蹈'],'ビジュアル':['Vi','形象'],
  '体力回復':'体力恢复','最大体力':'最大体力','パラメータボーナス':'属性成长率',
  'SPレッスン発生率':'SP 课程出现率','Pポイント':'P 点数',
  'プロデュース開始時':'培育开始时','休む選択時':'休息时','相談選択時':'咨询时',
  'おでかけ終了時':'外出结束时','活動支給・差し入れ選択時':'选择活动补给／慰问品时',
  'スキルカード':'技能卡','Pアイテム':'P 道具','Pドリンク':'P 饮料',
};
export function effectSearchText(raw){
  const source=effectSourceText(raw);
  return [source,...Object.entries(searchTerms).filter(([term])=>source.includes(term)).flatMap(([,aliases])=>aliases)].join(' ');
}
