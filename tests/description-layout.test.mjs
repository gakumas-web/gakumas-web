import test from 'node:test';
import assert from 'node:assert/strict';
import {descriptionLayout,descriptionText} from '../domain/semantic-text.mjs';
const part=(type,text='',extra={})=>({produceDescriptionType:'ProduceDescriptionType_'+type,text,...extra});
const dot=part('ProduceDescriptionName','',{targetId:'Label_StyleDot'});
test('条件、效果与限制沿节点顺序分行，正文和次数完整保留',()=>{
  const parts=[part('PlainText','使用後、',{originProduceExamTriggerId:'trigger'}),dot,
    part('ProduceExamEffectType','好調',{examEffectType:'ProduceExamEffectType_ExamParameterBuff',originProduceExamEffectId:'effect'}),
    part('Exam','3',{examDescriptionType:'ExamDescriptionType_CustomizeTurn'}),part('PlainText','ターン'),
    part('ProduceDescription','重複不可',{targetId:'Label_NoDeckDuplication'}),part('PlainText',' '),
    part('ProduceDescription','レッスン中1回',{targetId:'Label_ProduceCardMovePositionType_Lost'})];
  const layout=descriptionLayout(parts);
  assert.deepEqual(layout.map(line=>line.kind),['condition','effect','restriction']);
  assert.deepEqual(layout.map(line=>line.tokens.map(t=>t.text).join('')),['使用後、','好調3ターン','重複不可 レッスン中1回']);
  assert.equal(layout[1].tokens[0].examEffectType,'ProduceExamEffectType_ExamParameterBuff');
  assert.equal(layout[1].tokens[1].amount,true);
});
test('HTML换行、标签补全与未知片段不丢失，条件数字不冒充效果数值',()=>{
  const parts=[part('PlainText','3ターン目<br>'),part('ProduceDescriptionName','',{targetId:'label'}),part('NewUnknownType','')];
  const labels=new Map([['label',{name:'説明'}]]),layout=descriptionLayout(parts,labels);
  assert.equal(layout[0].tokens[0].amount,false);
  assert.equal(layout.flatMap(line=>line.tokens.map(t=>t.text)).join(''),descriptionText(parts,labels,true).text.replace(/\n/g,''));
  assert.match(layout.at(-1).tokens.at(-1).text,/未解析/);
});

test('明确费用节点与使用条件分行，费用不混入条件',()=>{
  const parts=[part('PlainText','集中消費',{isCost:true}),part('Exam','5',{isCost:true,examDescriptionType:'ExamDescriptionType_CustomizeCostValue'}),part('PlainText',''),part('PlainText','好調が12ターン以上の場合、使用可',{originProduceExamTriggerId:'condition'})];
  const lines=descriptionLayout(parts);assert.deepEqual(lines.map(line=>line.kind),['cost','condition']);
  assert.deepEqual(lines.map(line=>line.tokens.map(token=>token.text).join('')),['集中消費5','好調が12ターン以上の場合、使用可']);
});

test('分段节点的效果关联保留到对应行，不丢失P道具图标来源或串到下一行',()=>{
  const rows=descriptionLayout([part('PlainText','レッスン終了時、'),{...dot,originProduceExamEffectId:'p_effect-vocal'},part('PlainText','ボーカル+'),part('DiffText','26'),dot,part('PlainText','補足')]);
  assert.deepEqual(rows.map(row=>row.effectId),[undefined,'p_effect-vocal',undefined]);
  assert.equal(rows[0].kind,'context');assert.equal(rows[1].kind,'effect');
  assert.deepEqual(rows.map(row=>row.tokens.map(token=>token.text).join('')),['レッスン終了時、','ボーカル+26','補足']);
});

test('同一效果名称中的换行只在首行保留图标，不复制成两个效果',()=>{
  const rows=descriptionLayout([
    part('ProduceExamEffectType','パラメータ\n上昇回数',{examEffectType:'ProduceExamEffectType_ExamLesson'}),
    part('DiffText','(+1)'),
  ]);
  assert.equal(rows.flatMap(row=>row.tokens).filter(token=>token.examEffectType).length,1);
  assert.deepEqual(rows.map(row=>row.tokens.map(token=>token.text).join('')),['パラメータ','上昇回数(+1)']);
});


test('剧本与唯一发动限制独立成行，保留完整原文',()=>{
  const parts=[part('PlainText','スキルカードを引く'),
    part('ProduceDescriptionName','H.I.F専用　',{targetId:'Label_ProduceType_HatsuboshiIdolFestival'}),
    part('ProduceDescriptionName','重複発動不可',{targetId:'Label_MemoryAbilityIsUniqueActivation'})];
  const rows=descriptionLayout(parts);
  assert.deepEqual(rows.map(row=>row.kind),['effect','restriction']);
  assert.deepEqual(rows.map(row=>row.tokens.map(token=>token.text).join('')),['スキルカードを引く','H.I.F専用　重複発動不可']);
});


test('抽卡固定效果文本可取得技能卡图标',async()=>{
  const {descriptionIconType}=await import('../domain/effect-icons.mjs');
  assert.equal(descriptionIconType({text:'スキルカードを引く'}),'ExamCardCreateId');
  assert.equal(descriptionIconType({text:'未知の効果'}),undefined);
});
