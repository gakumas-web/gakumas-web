"""通过合成账号导入验证计划、流派只筛选 HIF 分组，并保留隐藏的已选能力。"""
from browser_artifacts import artifact_path
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect
from browser_static import ROOT, fixtures


def check(url):
    with TemporaryDirectory(dir=ROOT/'local', prefix='ability-filters-') as temporary, sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1280, 'height': 1000})
        errors, uploads = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: uploads.append(request.url) if request.post_data else None)
        page.goto(url, wait_until='networkidle')
        records = page.evaluate('''async () => {
            await (await import('./application/master-loader.mjs')).loadMaster('memories');
            const {takeMaster}=await import('./application/master-prefetch.mjs');
            const {abilitySummaries,abilityChoiceKey,selectionChoiceMetadata}=await import('./domain/catalog.mjs');
            const {abilityGroupInfo}=await import('./domain/ability-summary.mjs');
            const input=await takeMaster('abilities'),records=new Map();
            for(const row of input.tables.MemoryAbility){
                const reference={id:row.id,level:row.level},summary=abilitySummaries({abilities:[reference]})[0];
                const group=abilityGroupInfo(summary.description).id;
                const parts=summary.description.technical?.skill?.descriptions??[];
                const card=parts.find((part,index)=>part.produceDescriptionType==='ProduceDescriptionType_ProduceCard'&&/^使用後/.test(parts[index+1]?.text??''));
                const metadata=card?selectionChoiceMetadata('card',{id:card.targetId,upgradeCount:0}):{};
                const sample=group==='hif'?JSON.stringify([group,metadata.plan,metadata.flows]):group;
                if(!records.has(sample))records.set(sample,{reference,key:abilityChoiceKey(row.id),group,metadata});
            }
            return [...records.values()];
        }''')
        hif = [row for row in records if row['group'] == 'hif']
        assert len({row['metadata']['plan'] for row in hif}) >= 2
        assert any(row['metadata']['flows'] for row in hif)
        documents = fixtures()
        documents['capture']['memories'][0]['abilities'] = [row['reference'] for row in records]
        for name, document in documents.items():
            target = Path(temporary)/'account'/name/'snapshot.json'
            target.parent.mkdir(parents=True)
            target.write_text(json.dumps(document))
        page.locator('#account-directory-files').set_input_files(str(Path(temporary)/'account'))
        expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        if page.locator('#filter-toggle').get_attribute('aria-expanded') == 'false':
            page.locator('#filter-toggle').click()
        opener = page.locator('#inheritance-ability-open')
        opener.click()
        expect(page.locator('#selection-picker')).to_be_visible()
        expect(page.locator('.selection-choice-icon-filters [role="radiogroup"]')).to_have_count(2)
        expect(page.locator('#selection-picker-hint')).to_contain_text('仅作用于 HIF 技能卡')
        non_hif = page.locator('.ability-picker-group:not([data-ability-group="hif"]) input')
        unchanged = non_hif.evaluate_all('(nodes)=>nodes.map(node=>[node.value,node.disabled])')
        assert unchanged
        hif_inputs = page.locator('[data-ability-group="hif"] input')
        assert set(hif_inputs.evaluate_all('(nodes)=>nodes.map(node=>node.value)')) == {row['key'] for row in hif}
        selected = hif[0]
        hif_inputs.locator(f'xpath=self::*[@value="{selected["key"]}"]').check()
        non_hif.first.check()
        for plan in dict.fromkeys(row['metadata']['plan'] for row in hif):
            page.locator(f'#selection-picker-plan-icons [data-value="{plan}"]').click()
            eligible = [row for row in hif if row['metadata']['plan'] == plan]
            assert set(hif_inputs.evaluate_all('(nodes)=>nodes.map(node=>node.value)')) == {row['key'] for row in eligible}
            flows = page.locator('#selection-picker-flow-icons button:visible').evaluate_all('(nodes)=>nodes.map(node=>node.dataset.value)')
            expected_flows = {flow for row in eligible for flow in row['metadata']['flows']}
            if any(not row['metadata']['flows'] for row in eligible):
                expected_flows.add('unclassified')
            assert set(flows) == expected_flows | {''}
            for flow in flows:
                page.locator(f'#selection-picker-flow-icons [data-value="{flow}"]').click()
                expected = {row['key'] for row in eligible if not flow or (not row['metadata']['flows'] if flow == 'unclassified' else flow in row['metadata']['flows'])}
                assert set(hif_inputs.evaluate_all('(nodes)=>nodes.map(node=>node.value)')) == expected
                assert non_hif.evaluate_all('(nodes)=>nodes.map(node=>[node.value,node.disabled])') == unchanged
                expect(non_hif.first).to_be_checked()
            page.locator('#selection-picker-flow-icons [data-value=""]').click()
        other_plan = next(row['metadata']['plan'] for row in hif if row['metadata']['plan'] != selected['metadata']['plan'])
        page.locator(f'#selection-picker-plan-icons [data-value="{other_plan}"]').click()
        expect(hif_inputs.locator(f'xpath=self::*[@value="{selected["key"]}"]')).to_have_count(0)
        for width in [1280, 390, 320]:
            page.set_viewport_size({'width': width, 'height': 1000})
            assert page.locator('#selection-picker').evaluate('element=>element.scrollWidth<=element.clientWidth')
            if width != 320:
                page.screenshot(path=artifact_path(str(ROOT/f'local/ability-filters-{width}.png')))
        page.locator('#selection-picker-confirm').click()
        expect(page.locator('#inheritance-ability-list button')).to_have_count(2)
        opener.click()
        expect(page.locator('#selection-picker-plan-icons [data-value=""]')).to_have_attribute('aria-checked', 'true')
        expect(hif_inputs.locator(f'xpath=self::*[@value="{selected["key"]}"]')).to_be_checked()
        page.locator('#selection-picker-clear').click()
        page.locator('#selection-picker-cancel').click()
        expect(page.locator('#inheritance-ability-list button')).to_have_count(2)
        opener.click()
        page.locator(f'#selection-picker-plan-icons [data-value="{other_plan}"]').click()
        page.locator('#selection-picker-clear').click()
        page.locator('#selection-picker-confirm').click()
        expect(page.locator('#inheritance-ability-list button')).to_have_count(0)
        page.locator('#inheritance-skill-open').click()
        expect(page.locator('.selection-choice-icon-filters [role="radiogroup"]')).to_have_count(3)
        expect(page.locator('#selection-picker-plan-icons [data-value=""]')).to_have_attribute('aria-checked', 'true')
        assert not errors, errors
        assert not uploads, uploads
        browser.close()
    print('HIF 计划／流派筛选、其他分组不变、隐藏选择保留、取消／清空、弹窗切换及窄屏检查通过；无脚本异常或上传。')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8080/')
    check(parser.parse_args().url)
