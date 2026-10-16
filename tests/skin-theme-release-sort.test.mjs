import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installMaster,skinThemeNames} from '../domain/catalog.mjs';
import {skinEntries} from '../domain/catalog-selectors.mjs';

const release=day=>Date.UTC(2025,0,day);

function master(){
  return {
    tables:{ProduceCard:[],ProduceItem:[],MemoryAbility:[],ProduceSkill:[],ProduceEffect:[],ProduceExamEffect:[]},
    characters:{hski:'主题角色甲',ttmr:'装扮角色',fktn:'主题角色乙'},
    idols:{
      cards:[
        {id:'base-b',characterId:'ttmr',assetId:'base-b',name:'基础卡',originalIdolCardSkinId:'base-b-skin'},
        {id:'theme-a',characterId:'hski',assetId:'theme-a',name:'Agitato',originalIdolCardSkinId:'native-a'},
        {id:'theme-c',characterId:'fktn',assetId:'theme-c',name:'Agitato',originalIdolCardSkinId:'native-c'},
      ],
      skins:[
        {id:'unknown',idolCardId:'base-b',assetId:'unknown',name:'未知装扮',theme:'未知主题',viewStartTime:'0'},
        {id:'missing',idolCardId:'base-b',assetId:'missing',name:'小悪魔',theme:'Agitato',themeStartTime:0,viewStartTime:'0'},
        {id:'native-c',idolCardId:'theme-c',assetId:'theme-c',name:'',theme:'Agitato',themeStartTime:0,viewStartTime:String(release(400))},
        {id:'ordinary-early',idolCardId:'base-b',assetId:'ordinary-early',name:'小悪魔',theme:'Agitato',viewStartTime:String(release(50))},
        {id:'native-a',idolCardId:'theme-a',assetId:'theme-a',name:'',theme:'Agitato',themeStartTime:0,viewStartTime:String(release(300))},
        {id:'own-date',idolCardId:'base-b',assetId:'own-date',name:'小悪魔',theme:'Agitato',viewStartTime:String(release(350))},
        {id:'swimsuit',idolCardId:'base-b',assetId:'swimsuit',name:'水着',theme:'水着',themeStartTime:release(200),viewStartTime:String(release(200))},
        {id:'base-b-skin',idolCardId:'base-b',assetId:'base-b',name:'',viewStartTime:String(release(10))},
      ],
    },
  };
}

const entries=(filters={})=>skinEntries({},'',{ownership:'all',catalogSort:'release',...filters});
const ids=rows=>rows.map(row=>row.held.idolCardSkinId);

test('缺失日期的装扮按同主题原生偶像卡最早有效日期参与新旧排序',()=>{
  const input=master(),before=JSON.stringify(input);
  installMaster(input);
  const rows=entries();
  assert.equal(rows.find(row=>row.held.idolCardSkinId==='missing').info.sortReleaseTime,release(300));
  assert.deepEqual(ids(rows),['native-c','own-date','native-a','missing','swimsuit','ordinary-early','unknown']);
  assert.deepEqual(ids(entries({catalogSort:'releaseAsc'})),['ordinary-early','swimsuit','native-a','missing','own-date','native-c','unknown']);
  assert.equal(JSON.stringify(input),before);
});

test('角色筛选排除主题偶像卡后，装扮仍使用完整目录中的主题日期',()=>{
  installMaster(master());
  const rows=entries({skinCharacter:['ttmr']});
  assert.deepEqual(ids(rows),['own-date','missing','swimsuit','ordinary-early','unknown']);
  assert.equal(rows.find(row=>row.held.idolCardSkinId==='missing').info.sortReleaseTime,release(300));
});

test('主题日期仅补排序缺口，已有具体发行时间与来源保持原值',()=>{
  installMaster(master());
  const rows=entries(),own=rows.find(row=>row.held.idolCardSkinId==='own-date').info;
  const missing=rows.find(row=>row.held.idolCardSkinId==='missing').info;
  assert.equal(own.sortReleaseTime,release(350));
  assert.equal(own.viewStartTime,release(350));
  assert.deepEqual(own.releaseTimeSource,{time:release(350),source:'catalog'});
  assert.equal(missing.viewStartTime,undefined);
  assert.equal(missing.releaseTimeSource,undefined);
});

test('不同主题没有可确认日期时，升序和降序均排在最后',()=>{
  installMaster(master());
  for(const catalogSort of ['release','releaseAsc']){
    const rows=entries({catalogSort}),unknown=rows.at(-1);
    assert.equal(unknown.held.idolCardSkinId,'unknown');
    assert.equal(unknown.info.sortReleaseTime,undefined);
  }
});

test('同主题普通装扮较早发行，不能替代主题偶像卡作为日期来源',()=>{
  installMaster(master());
  const rows=entries({skinTheme:'Agitato'});
  assert.equal(rows.find(row=>row.held.idolCardSkinId==='ordinary-early').info.sortReleaseTime,release(50));
  assert.equal(rows.find(row=>row.held.idolCardSkinId==='missing').info.sortReleaseTime,release(300));
});

test('目录重装后不沿用旧主题偶像卡日期',()=>{
  installMaster(master());
  assert.equal(entries().find(row=>row.held.idolCardSkinId==='missing').info.sortReleaseTime,release(300));
  const replacement=master();
  replacement.idols.cards=replacement.idols.cards.filter(card=>card.id==='base-b');
  replacement.idols.skins=replacement.idols.skins.filter(skin=>skin.idolCardId==='base-b');
  installMaster(replacement);
  const rows=entries(),missing=rows.find(row=>row.held.idolCardSkinId==='missing');
  assert.equal(missing.info.sortReleaseTime,undefined);
  assert.deepEqual(ids(rows),['own-date','swimsuit','ordinary-early','unknown','missing']);
});

test('主题顺序先比较有效主题日期，再按角色排列同主题装扮',()=>{
  installMaster(master());
  const rows=entries({catalogSort:'theme'});
  assert.deepEqual(ids(rows),['swimsuit','native-a','missing','ordinary-early','own-date','native-c','unknown']);
  const agitato=rows.filter(row=>row.info.theme==='Agitato');
  assert.deepEqual(agitato.map(row=>row.info.characterId),['hski','ttmr','ttmr','ttmr','fktn']);
  assert.ok(agitato.every(row=>row.info.themeCardStartTime===release(300)));
});

test('角色筛选排除全部主题偶像卡后，主题顺序仍将水着放在小悪魔之前',()=>{
  installMaster(master());
  const rows=entries({catalogSort:'theme',skinCharacter:['ttmr']});
  assert.deepEqual(ids(rows),['swimsuit','missing','ordinary-early','own-date','unknown']);
  assert.ok(rows.filter(row=>row.info.theme==='Agitato').every(row=>row.info.themeCardStartTime===release(300)));
});

test('卡片主题顺序与主题选项一致，有效主题日期优先于主题偶像卡日期',()=>{
  const input=master();
  input.idols.cards.push({id:'swim-card',characterId:'hski',assetId:'swim-card',name:'水着主题卡',originalIdolCardSkinId:'native-swim'});
  input.idols.skins.push({id:'native-swim',idolCardId:'swim-card',assetId:'swim-card',name:'',theme:'水着',themeStartTime:release(200),viewStartTime:String(release(450))});
  installMaster(input);
  for(const filters of [{},{skinCharacter:['ttmr']}]){
    const rows=entries({catalogSort:'theme',...filters});
    const themes=[...new Set(rows.map(row=>row.info.theme))];
    assert.deepEqual(themes,['水着','Agitato','未知主题']);
    assert.deepEqual(themes,skinThemeNames(rows.map(row=>row.info)));
    assert.equal(rows.at(-1).held.idolCardSkinId,'unknown');
  }
});

test('目录重装清除主题排序日期回退，未知主题继续放在已知主题之后',()=>{
  installMaster(master());
  assert.equal(entries({catalogSort:'theme'}).find(row=>row.held.idolCardSkinId==='missing').info.themeCardStartTime,release(300));
  const replacement=master();
  replacement.idols.cards=replacement.idols.cards.filter(card=>card.id==='base-b');
  replacement.idols.skins=replacement.idols.skins.filter(skin=>skin.idolCardId==='base-b');
  installMaster(replacement);
  const rows=entries({catalogSort:'theme'});
  assert.equal(rows[0].held.idolCardSkinId,'swimsuit');
  assert.equal(rows.find(row=>row.held.idolCardSkinId==='missing').info.themeCardStartTime,undefined);
  assert.ok(rows.filter(row=>row.info.theme==='Agitato').every(row=>row.info.themeCardStartTime===undefined));
  assert.deepEqual([...new Set(rows.map(row=>row.info.theme))],['水着','Agitato','未知主题']);
  assert.equal(rows.at(-1).held.idolCardSkinId,'unknown');
});
