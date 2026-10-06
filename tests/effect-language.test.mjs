import test from 'node:test';
import assert from 'node:assert/strict';
import {setLocale} from '../i18n.mjs';
import {effectSourceText,abilityLabel,abilityValue,effectSearchText} from '../domain/effect-language.mjs';
import {descriptionText} from '../domain/semantic-text.mjs';

test('完整效果无论长短及界面语言均保留原文，不改写关键词或卡名',()=>{
  const sources=['好調3ターン','プロデュース開始時、体力回復4','集中の75%分好調増加させ、集中を半分にする','アピールの基本か距離感の基本をえいえいおーにチェンジして強化','未知のメカニズム'];
  for(const language of ['zh-CN','ja']){
    setLocale(language);for(const source of sources)assert.equal(effectSourceText(source),source);
  }
  setLocale('zh-CN');
});
test('仅对完整的简短能力标签及数值单位本地化，不对句子做局部替换',()=>{
  setLocale('zh-CN');
  assert.equal(abilityLabel('好調'),'好调');assert.equal(abilityLabel('やる気'),'干劲');
  assert.equal(abilityLabel('初期 Vo'),'初始 Vo');assert.equal(abilityLabel('スキルカード使用数追加'),'技能卡使用次数增加');
  assert.equal(abilityLabel('好調状態の場合、使用可'),'好調状態の場合、使用可');
  assert.equal(abilityValue('3ターン'),'3 回合');assert.equal(abilityValue('+2.1%'),'+2.1%');
  setLocale('ja');assert.equal(abilityLabel('好調'),'好調');assert.equal(abilityValue('3ターン'),'3ターン');setLocale('zh-CN');
});
test('中文关键词搜索保留固定别名，移除旧自动句式译文',()=>{
  const source='プロデュース開始時、体力回復4';
  const searchable=effectSearchText(source);
  assert.ok(searchable.includes(source));assert.ok(searchable.includes('体力恢复'));
  assert.ok(!searchable.includes('培育开始时，恢复 4 点体力'));
});
test('源分隔标记只改变阅读布局，正文保留源词句',()=>{
  const parts=[{produceDescriptionType:'ProduceDescriptionType_PlainText',text:'元気+4'},
    {produceDescriptionType:'ProduceDescriptionType_ProduceDescriptionName',targetId:'Label_StyleDot',text:''},
    {produceDescriptionType:'ProduceDescriptionType_PlainText',text:'集中+2'}];
  const labels=new Map([['Label_StyleDot',{name:''}]]);
  assert.equal(descriptionText(parts,labels).text,'元気+4集中+2');
  assert.equal(effectSourceText(descriptionText(parts,labels,true).text),'元気+4\n集中+2');
});
