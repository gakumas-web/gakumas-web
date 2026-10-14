"""用实际页面与公开预览记录核对技能卡数值和不同尺寸的显示规则。"""
from browser_artifacts import artifact_path
import re

from playwright.sync_api import sync_playwright,expect
from browser_static import ROOT
from browser_simulation_helpers import select_season


def check(url):
    output=artifact_path(ROOT/'local/skill-display-audit');output.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle');page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        cases=page.evaluate('''async()=>{
          const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('memories');const {prepareSnapshot}=await import('./domain/model.mjs'),{supportSkillVisual,memoryExclusiveSkill}=await import('./domain/catalog.mjs'),{skillThumbnailFor}=await import('./ui/illustrations.mjs');
          const data=await(await fetch('./resources/preview-account.json')).json(),snapshot=await prepareSnapshot(data.documents.find(d=>d.source==='user_get')),cases=[];
          for(const [id,damage,block] of [['p_card-00-sup-3_026','6','5'],['p_card-00-men-3_012','6','5'],['p_card-02-men-3_040',null,'2+4']]){
            let found;
            for(const memory of snapshot.memories){for(const reference of [memory.produceCard,...memory.examBattleProduceCards].filter(Boolean)){
              if(reference.id!==id||reference.upgradeCount!==1||!reference.customizes?.length)continue;
              const node=skillThumbnailFor(reference,memory.characterId),actualDamage=node.querySelector('.support-skill-damage')?.textContent??null,actualBlock=node.querySelector('.support-skill-block')?.textContent??null;
              if(actualDamage!==damage||actualBlock!==block)continue;
              const compact=skillThumbnailFor(reference,memory.characterId,{compact:true});if((compact.querySelector('.support-skill-damage')?.textContent??null)!==damage||(compact.querySelector('.support-skill-block')?.textContent??null)!==block)throw Error('Compact values missing');
              found={id,key:memory.key,damage,block};break;
            }if(found)break;}
            if(!found)throw Error('Public case missing: '+id);cases.push(found);
          }
          const compare=snapshot.memories.filter(m=>m.examBattleProduceCards.length&&supportSkillVisual(memoryExclusiveSkill(m)?.reference??{}).damage).slice(0,2).map(m=>m.key);
          return {cases,compare};
        }''')
        for index,case in enumerate(cases['cases']):
            page.locator('#search').fill(case['key']);row=page.locator(f'.memory-row[data-memory-key="{case["key"]}"]');expect(row).to_be_visible()
            actual=row.locator(f'.memory-skill-hint[data-card-id="{case["id"]}"]>.support-reward-trigger .support-skill-thumbnail').evaluate_all('(nodes)=>nodes.map(n=>({damage:n.querySelector(".support-skill-damage")?.textContent??null,block:n.querySelector(".support-skill-block")?.textContent??null}))')
            assert {'damage':case['damage'],'block':case['block']} in actual,(case,actual)
            if index==0:
                for width in [1280,375]:
                    page.set_viewport_size({'width':width,'height':1100});row.scroll_into_view_if_needed();page.mouse.move(2,2)
                    page.wait_for_function("()=>[...document.querySelectorAll('.memory-row>.memory-card-topline img,.memory-row>.memory-battle img')].every(i=>i.complete)")
                    assert row.evaluate('e=>e.scrollWidth<=e.clientWidth');row.screenshot(path=artifact_path(str(output/f'memory-{width}.png')))
        print('普通回忆的附魔固定值与紧凑渲染通过。',flush=True)
        page.set_viewport_size({'width':1280,'height':1000})
        for key in cases['compare']:
            page.locator('#search').fill(key);row=page.locator(f'.memory-row[data-memory-key="{key}"]');expect(row).to_be_visible();row.locator('.pick input').check()
        page.locator('#compare').click();expect(page.locator('#compare-dialog')).to_be_visible();expect(page.locator('.comparison-table .comparison-memory-art .support-skill-damage')).to_have_count(2);page.locator('#compare-dialog').screenshot(path=artifact_path(str(output/'comparison.png')));page.locator('#close-compare').click()
        page.locator('[data-tab="selectionMemories"]').click();expect(page.locator('.selection-memory-card').first).to_be_visible(timeout=60000);page.locator('.selection-loadout>summary').first.click();expect(page.locator('.selection-loadout[open] .support-skill-thumbnail').first).to_be_visible();assert page.locator('.selection-loadout[open] .support-skill-damage,.selection-loadout[open] .support-skill-block').count()>0
        page.locator('.selection-memory-card').first.screenshot(path=artifact_path(str(output/'selection.png')))
        for tab in ['idolCards','supportCards']:
            page.locator(f'[data-tab="{tab}"]').click()
            if tab=='supportCards':
                target=page.evaluate('''async()=>{const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('supportCards');const {supportInfo}=await import('./domain/catalog.mjs'),data=await(await fetch('./resources/preview-account.json')).json();return data.documents.find(d=>d.source==='user_get').supportCards.find(held=>supportInfo(held).events?.some(e=>e.rewards.some(r=>r.kind==='card'&&r.versions.some(v=>v.visual.damage||v.visual.block))))?.supportCardId;}''')
                assert target;page.locator('#search').fill(target)
            expect(page.locator('#list .support-skill-thumbnail').first).to_be_visible(timeout=30000)
            assert page.locator('#list .support-skill-damage,#list .support-skill-block').count()>0
            page.locator('#list>article').first.screenshot(path=artifact_path(str(output/f'{tab}.png')))
        print('比较、选拔、偶像与支援技能卡页面通过。',flush=True)
        page.locator('[data-tab="seasonSimulation"]').click();select_season(page,'contest:pvp_rate_config-53');page.locator('.season-stage-tab').first.click();panel=page.locator('#contest-recommendations')
        panel.locator('.recommendation-character').filter(has=page.locator('.recommendation-character-count',has_text=re.compile('^2$'))).first.click();panel.locator('.recommendation-start').click();expect(panel.locator('.recommendation-summary')).to_contain_text('推荐 2 组',timeout=120000)
        expect(panel.locator('.recommendation-stop')).not_to_be_visible();assert panel.locator('.recommendation-loadout .support-skill-damage,.recommendation-loadout .support-skill-block').count()>0
        panel.locator('.recommendation-entry').first.screenshot(path=artifact_path(str(output/'recommendation.png')))
        panel.locator('[data-action=load]').first.click();expect(page.locator('.season-memory-board')).to_have_count(2);assert page.locator('.season-memory-board .support-skill-damage,.season-memory-board .support-skill-block').count()>0
        page.locator('#contest-simulation-runs').fill('100');page.locator('.season-simulate').click();expect(page.locator('.simulation-save-status')).to_have_text('已保存到此舞台的模拟历史。',timeout=120000)
        page.locator('.simulation-statistics>summary').click();assert page.locator('.simulation-statistics .support-skill-damage,.simulation-statistics .support-skill-block').count()>0
        page.locator('.simulation-records>summary').click();assert page.locator('.simulation-records .support-skill-damage,.simulation-records .support-skill-block').count()>0
        page.locator('.simulation-statistics').screenshot(path=artifact_path(str(output/'statistics.png')));page.locator('.simulation-turn').first.screenshot(path=artifact_path(str(output/'turn.png')))
        page.get_by_role('tab',name='模拟历史',exact=True).click();expect(page.locator('.simulation-history-entry')).to_have_count(1);assert page.locator('.simulation-history-entry .loadout-library-preview .support-skill-damage,.simulation-history-entry .loadout-library-preview .support-skill-block').count()>0
        page.locator('.simulation-history-entry').screenshot(path=artifact_path(str(output/'history.png')))
        assert not errors and not uploads,(errors,uploads);browser.close()
    print('实际回忆、比较、选拔、偶像、支援、推荐、自选、统计、逐回合和历史技能卡显示通过。',flush=True)


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
