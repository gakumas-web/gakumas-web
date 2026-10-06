import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSemantics} from '../domain/semantic-model.mjs';
import {descriptionText, configurationSignature} from '../domain/semantic-text.mjs';

const text=value=>({produceDescriptionType:'ProduceDescriptionType_PlainText',text:value});
const percent=[text('ボーカル'),text('パラメータボーナス+'),{produceDescriptionType:'ProduceDescriptionType_DiffText',text:'2.8%'}];
const tables={
  MemoryAbility:[{id:'ability',level:1,skillId:'skill'},{id:'ability',level:2,skillId:'skill'},{id:'conditional',level:1,skillId:'conditional'},{id:'multi',level:1,skillId:'multi'}],
  ProduceSkill:[{id:'skill',level:1,descriptions:percent,definition:{activationCount:1},produceEffectId1:'growth',produceTriggerId1:'p_trigger-produce_start-no_description'},
    {id:'skill',level:2,descriptions:[text('ボーナス+4%')],produceEffectId1:'growth',produceTriggerId1:'p_trigger-produce_start-no_description'},
    {id:'conditional',level:1,descriptions:[text('ダンスレッスン終了時、30%の確率で体力回復4')],produceEffectId1:'growth',produceTriggerId1:'condition'},
    {id:'multi',level:1,descriptions:[text('効果Aと効果B')],produceEffectId1:'growth',produceTriggerId1:'condition',produceEffectId2:'missing',produceTriggerId2:'unknown'}],
  ProduceEffect:[{id:'growth',effectValueMin:28,effectValueMax:28}],
  ProduceCard:[{id:'card',upgradeCount:1,name:'技能+',descriptions:[text('集中+4\n次のターン、元気+2')],playEffects:[{produceExamEffectId:'exam',produceExamTriggerId:'unlisted-condition'}]}],
  ProduceExamEffect:[{id:'exam',descriptions:[text('元気+2')],effectValue1:2,effectCount:0,effectTurn:0}],ProduceItem:[]};
const catalog={ProduceDescriptionLabel:[],ProduceTrigger:[{id:'p_trigger-produce_start-no_description',phaseType:'ProducePhaseType_ProduceStart'},{id:'condition',phaseType:'ProducePhaseType_EndLesson'}],
  ProduceCardCustomize:[{id:'custom',customizeCount:1,description:'元気追加',produceCardGrowEffectIds:['grow']},{id:'custom',customizeCount:2,description:'成長追加',produceCardGrowEffectIds:[]}],
  ProduceCardGrowEffect:[{id:'grow',playProduceExamEffectId:'exam',targetPlayProduceExamEffectIds:[]}]};
const semantics=createSemantics(tables,catalog);

test('精确能力等级，不回退其它等级',()=>{
  assert.ok(semantics.ability({id:'ability',level:2}).lines[0].includes('4%'));
  assert.equal(semantics.ability({id:'ability',level:3}).status,'unresolved');
});
test('百分比使用源说明的2.8%，不把原始28当28%或再次缩放',()=>{
  const result=semantics.ability({id:'ability',level:1});
  assert.equal(result.lines[0],'ボーカルパラメータボーナス+2.8%');
  assert.equal(result.technical.slots[0].effect.effectValueMin,28);
  assert.ok(!result.lines.some(line=>line.startsWith('触发：')||line.startsWith('发动次数上限：')));
  assert.equal(result.technical.skill.definition.activationCount,1);
  assert.equal(result.technical.slots[0].trigger.phaseType,'ProducePhaseType_ProduceStart');
});
test('条件与概率原文保留，缺失触发条件不能变成无条件',()=>{
  const known=semantics.ability({id:'conditional',level:1});
  assert.equal(known.lines[0],'ダンスレッスン終了時、30%の確率で体力回復4');
  const missing=createSemantics(tables,{}).ability({id:'conditional',level:1});
  assert.ok(missing.lines.some(x=>x.includes('触发条件 1 未解析')));
});
test('多效果全部保留，第二效果与触发未知明确提示',()=>{
  const result=semantics.ability({id:'multi',level:1});
  assert.equal(result.technical.slots.length,2);
  assert.ok(result.lines.includes('效果 2 未解析'));
  assert.ok(result.lines.includes('触发条件 2 未解析'));
  assert.equal(result.status,'partial');
});
test('自定义按ID和次数精确联接，不伪造最终叠加数值',()=>{
  const result=semantics.card({id:'card',upgradeCount:1,customizes:[{id:'custom',customizeCount:1},{id:'custom',customizeCount:2}]});
  assert.equal(result.customizations.length,2);
  assert.ok(result.customizations[0].heading.includes('元気追加'));
  assert.ok(result.customizations[1].heading.includes('成長追加'));
  assert.ok(result.lines[0].includes('未叠加自定义'));
  assert.equal(result.customizations[0].technical.growDefinitions.length,1);
});
test('零次零回合不作为默认效果说明，未知结构不静默丢弃',()=>{
  const result=semantics.card({id:'card',upgradeCount:1,customizes:[]});
  assert.equal(result.lines.join('').includes('回合 0'),false);
  assert.ok(result.lines.some(x=>x.includes('触发条件未完整解析')));
  assert.equal(descriptionText([{produceDescriptionType:'FutureType',text:'future'}]).unknown,1);
});
test('说明标签来自精确表，富文本仅作纯文本',()=>{
  const labels=new Map([['label',{name:'好調'}]]);
  assert.equal(descriptionText([{produceDescriptionType:'ProduceDescriptionType_ProduceDescriptionName',targetId:'label',text:''},text('<nobr>2ターン</nobr>')],labels).text,'好調2ターン');
});
test('相同未知文案仍按原始ID区分，签名保留重复并忽略顺序',()=>{
  const a=semantics.group({abilities:[{id:'unknown-a',level:1}]},'abilities');
  const b=semantics.group({abilities:[{id:'unknown-b',level:1}]},'abilities');
  assert.deepEqual(a.entries[0].lines,b.entries[0].lines);assert.notEqual(a.signature,b.signature);
  assert.equal(a.entries[0].technical.entry.id,'unknown-a');
  assert.equal(configurationSignature([1,2,1]),configurationSignature([2,1,1]));
  assert.notEqual(configurationSignature([1,2,1]),configurationSignature([1,2]));
});
test('逗号前的描述片段不能推断成触发条件',()=>{
  const sentence='説明の前半、これは発動条件ではない';
  const source={...tables,ProduceSkill:tables.ProduceSkill.map(row=>row.id==='conditional'?{...row,descriptions:[text(sentence)]}:row)};
  const result=createSemantics(source,catalog).ability({id:'conditional',level:1});
  assert.equal(result.lines[0],sentence);
  assert.equal(result.lines.some(line=>line.startsWith('触发原文：')),false);
  assert.ok(result.lines.some(line=>line.includes('触发条件 1 未完整解析')));
});
test('自定义标题不泄露原始引用，技术定义仍保留',()=>{
  const raw='p_card_custom-wrapper-example';
  const source={...catalog,ProduceCardCustomize:[{id:'raw',customizeCount:1,description:raw,produceCardGrowEffectIds:[]}]};
  const result=createSemantics(tables,source).customize({id:'raw',customizeCount:1});
  assert.equal(result.heading.includes(raw),false);
  assert.equal(result.technical.definition.description,raw);
  assert.equal(result.status,'unresolved');
});
test('已存公开自定义定义的标题检查只报告汇总',()=>{
  const source=JSON.parse(readFileSync(new URL('./fixtures/public-data/semantics.json',import.meta.url),'utf8')).tables;
  const formatter=createSemantics(tables,source);
  let rawLabels=0;
  const reference=/Produce\w*Type_|\b(?:p_card_custom|p_trigger|p_effect|g_effect|e_effect|e_trigger|p_card|p_item_effect)[-_][A-Za-z0-9_-]+/;
  for(const definition of source.ProduceCardCustomize){
    if(reference.test(definition.description))rawLabels++;
    assert.equal(reference.test(formatter.customize({id:definition.id,customizeCount:definition.customizeCount}).heading),false);
  }
  console.log(`Public customization headings: definitions=${source.ProduceCardCustomize.length}, raw-reference labels=${rawLabels}, visible leaks=0`);
});
