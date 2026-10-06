import test from 'node:test';
import assert from 'node:assert/strict';
import {installMaster,supportInfo} from '../domain/catalog.mjs';
import {setLocale,t} from '../i18n.mjs';
import {createSemantics} from '../domain/semantic-model.mjs';

const tables={ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]};
const master=name=>({tables,supports:{cards:[{id:'card',name,rarity:'SupportCardRarity_SSR',type:'SupportCardType_Assist',characterIds:[]}]}});
test('公开支援说明可跨持有等级复用，语言与重新安装目录不能沿用旧说明',()=>{
  setLocale('zh-CN');installMaster(master('旧目录'));
  const first=supportInfo({supportCardId:'card',level:1});
  assert.equal(supportInfo({supportCardId:'card',level:60}),first);
  setLocale('ja');const japanese=supportInfo({supportCardId:'card'});
  assert.equal(japanese.type,t('辅助'));assert.notEqual(japanese,first);
  installMaster(master('新目录'));
  assert.equal(supportInfo({supportCardId:'card'}).name,'新目录');setLocale('zh-CN');
});
test('共用公开技能说明时，实际附魔和原始记录引用仍逐条生成',()=>{
  const semantics=createSemantics({...tables,ProduceCard:[{id:'skill',upgradeCount:0,name:'技能',descriptions:[{produceDescriptionType:'ProduceDescriptionType_PlainText',text:'集中+2'}]}]});
  const plain={id:'skill',upgradeCount:0,customizes:[]},customized={...plain,customizes:[{id:'unknown',customizeCount:1}]};
  const first=semantics.card(plain),second=semantics.card(customized);
  assert.equal(first.sourceText,second.sourceText);
  assert.equal(first.customizations.length,0);assert.equal(second.customizations.length,1);
  assert.equal(first.technical.entry,plain);assert.equal(second.technical.entry,customized);
  assert.notDeepEqual(first.lines,second.lines);
});
