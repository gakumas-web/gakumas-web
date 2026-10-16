import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createContestDraft,captureOptimizationDraft,revalidateContestDraft} from '../application/contest-drafts.mjs';

const stage={id:'synthetic-stage',kind:'contest',planType:'ProducePlanType_Plan1',preset:{id:'synthetic-preset'}};
const card={id:'synthetic-card',upgradeCount:0,customizes:[]};
const memory={key:'synthetic-memory',characterId:'synthetic-character',idolCardId:'synthetic-idol',planType:2,grade:0,vocal:100,dance:200,visual:300,stamina:20,examBattleProduceCards:[card],examBattleProduceItemIds:[],privateAccount:'excluded'};
const context={stage,memories:[memory],catalog:{cards:[],items:[]},ownership:{idolCardIds:new Set(['synthetic-idol']),supportCardIds:new Set(),producerLevel:1},optimizationContext:{stage,idolCards:[],supportCards:[],producerLevel:1},contentVersion:'synthetic-content'};

test('草稿只捕获明确列出的配置，不复制账号、结果或搜索缓存',()=>{
  const entry=createContestDraft({stage,selected:[memory,null],drafts:[memory,null],editing:[true,false],mode:'optimization',runs:'100',optimization:{params:{vocal:'123',unknown:'excluded'},roles:[{exclusiveId:'synthetic-card',grade:'0',result:'excluded'}],items:[],seed:'17',customBudget:{population:'5',cache:'excluded'},report:{secret:'excluded'},worker:{state:'excluded'}},contentVersion:'synthetic-content',result:{scores:[1]},worker:'excluded'},new Date('2026-10-16T00:00:00Z'));
  const json=JSON.stringify(entry);assert.equal(json.includes('excluded'),false);assert.equal(json.includes('scores'),false);assert.equal(json.includes('worker'),false);assert.equal(json.includes('report'),false);
  assert.equal(entry.configuration.optimization.params.vocal,'123');assert.equal(entry.updatedAt,'2026-10-16T00:00:00.000Z');assert.deepEqual(entry.configuration.selectedKeys,['synthetic-memory',null]);
});

test('搜索草稿保留未填完和待修正的输入，过滤其它状态',()=>{
  const draft=captureOptimizationDraft({params:{vocal:'',stamina:'0'},strength:'custom',customBudget:{population:'',totalRunLimit:'1'},seed:'not-valid-yet',report:{rows:[1]}});
  assert.deepEqual(draft.params,{vocal:'',stamina:'0'});assert.equal(draft.seed,'not-valid-yet');assert.deepEqual(draft.customBudget,{population:'',totalRunLimit:'1'});assert.equal(draft.report,undefined);
});

test('快照变化后清除失效回忆并保留倍率和未完成搜索参数，列出问题',()=>{
  const entry=createContestDraft({stage,selected:[memory,null],drafts:[memory,null],manual:{vocal:123},optimization:{params:{vocal:'300'},roles:[{exclusiveId:'missing',grade:'0'}],items:['missing']},contentVersion:'old'});
  const restored=revalidateContestDraft(entry,{...context,memories:[]});
  assert.deepEqual(restored.state.selected,[null,null]);assert.equal(restored.state.manual.vocal,123);assert.equal(restored.state.optimization.form.params.vocal,'300');assert.deepEqual(restored.state.optimization.form.roles,[{grade:'0'}]);assert.ok(restored.issues.length>=3);assert.equal(restored.state.result.entry,undefined);
});

test('失效技能槽回退当前原回忆，仍可恢复其它自定义属性',()=>{
  const changed={...memory,vocal:456,examBattleProduceCards:[{id:'missing',upgradeCount:0,customizes:[]}]};
  const entry=createContestDraft({stage,selected:[memory,null],drafts:[changed,null],contentVersion:'synthetic-content'}),restored=revalidateContestDraft(entry,context);
  assert.equal(restored.state.drafts[0].vocal,456);assert.deepEqual(restored.state.drafts[0].examBattleProduceCards,[card]);assert.equal(restored.state.selected[0].key,memory.key);assert.ok(restored.issues.some(issue=>issue.includes('自定义技能')));
});


test('通用计划舞台恢复合法回忆和推荐偶像，不套用固定计划映射',()=>{
  const common={...stage,planType:'ProducePlanType_Common',preset:{id:'synthetic-free',plan:'free'}};
  const entry=createContestDraft({stage:common,selected:[memory,null],drafts:[memory,null],recommendedCharacterId:memory.characterId,contentVersion:'synthetic-content'});
  const restored=revalidateContestDraft(entry,{...context,stage:common,optimizationContext:{...context.optimizationContext,stage:common}});
  assert.equal(restored.state.selected[0].key,memory.key);assert.equal(restored.state.recommendations.selectedCharacterId,memory.characterId);assert.deepEqual(restored.issues,[]);
});
