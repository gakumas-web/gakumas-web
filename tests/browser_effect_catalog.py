"""通过正式资料加载器与技能详情组件验证分层后的图标、正文及卡片引用。"""
import argparse
from playwright.sync_api import sync_playwright,expect


def check(url):
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page();errors=[];uploads=[]
        page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda request:uploads.append(request.url) if request.post_data else None)
        page.goto(url,wait_until='networkidle')
        cases=page.evaluate("""async()=>{
          const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('memories');
          const {effectCatalog}=await import('./domain/effect-catalog.mjs'),{supportSkillVisual}=await import('./domain/catalog.mjs');
          const data=effectCatalog(),cards=data.cards.filter(row=>row.upgradeCount===0),reference=row=>({id:row.id,upgradeCount:0,customizes:[]});
          const cases=['stamina','direct','status'].map(kind=>{const row=cards.find(row=>supportSkillVisual(reference(row)).costs.some(cost=>cost.kind===kind&&cost.value>0&&cost.icon));if(!row)throw new Error('missing cost '+kind);return {kind,reference:reference(row)};});
          const linked=cards.find(row=>row.descriptions?.some(part=>part.produceDescriptionType==='ProduceDescriptionType_ProduceCard'&&part.targetId&&part.text));
          if(!linked||!data.labels.size||!data.effects.size)throw new Error('missing effect metadata');
          cases.push({kind:'linked',reference:reference(linked)});return cases;
        }""")
        for case in cases:
            page.evaluate("""async reference=>{
              const {cardRewardInfo}=await import('./domain/catalog.mjs'),{skillCardDetails}=await import('./ui/skill-card-details.mjs');
              document.querySelector('#effect-catalog-check')?.remove();
              const host=document.createElement('dialog');host.id='effect-catalog-check';host.append(skillCardDetails(cardRewardInfo(reference),{recorded:true,chooseVersion:false}));document.body.append(host);host.showModal();
            }""",case['reference'])
            host=page.locator('#effect-catalog-check');expect(host.locator('.support-skill-description .effect-reading')).to_be_visible()
            if case['kind']=='linked':expect(host.locator('.effect-card-reference').first).to_be_visible()
            else:
                # 两个渲染入口都必须解析资源名；地址和图片加载通过真实资源运行时核对。
                expect(host.locator(f'.support-skill-header-cost[data-cost-kind="{case["kind"]}"]')).to_have_count(1)
                page.wait_for_function("""async reference=>{
                  const {supportSkillVisual}=await import('./domain/catalog.mjs'),{assetURL,uiIconURL}=await import('./resources.mjs');
                  const host=document.querySelector('#effect-catalog-check'),costs=supportSkillVisual(reference).costs;
                  return costs.every(cost=>{
                    const url=cost.kind==='status'?assetURL(cost.icon):uiIconURL(cost.icon),header=host.querySelector(`.support-skill-header-cost[data-cost-kind="${cost.kind}"]`),thumbnail=host.querySelector(`.support-skill-cost[data-cost-kind="${cost.kind}"] .cost-symbol`);
                    const image=header?.querySelector(cost.kind==='status'?'img.foreground':'img');
                    return image?.getAttribute('src')===url&&thumbnail?.getAttribute('src')===url&&[image,thumbnail].every(node=>node.complete&&node.naturalWidth>0&&!node.src.includes('unavailable.svg'));
                  });
                }""",arg=case['reference'],timeout=60000)
        def reading_text():
            return host.locator('.support-skill-description').evaluate("node=>{const copy=node.cloneNode(true);for(const image of copy.querySelectorAll('.support-skill-thumbnail,.effect-inline-icon'))image.remove();return copy.textContent;}")
        before=reading_text()
        page.evaluate("async()=>{const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('achievements');}")
        # 晚到分包重新安装索引后，既有正文及重新构建的引用仍须一致。
        page.evaluate("""async reference=>{const {cardRewardInfo}=await import('./domain/catalog.mjs'),{skillCardDetails}=await import('./ui/skill-card-details.mjs');document.querySelector('#effect-catalog-check').replaceChildren(skillCardDetails(cardRewardInfo(reference),{recorded:true,chooseVersion:false}));}""",cases[-1]['reference'])
        assert reading_text()==before;expect(host.locator('.effect-card-reference').first).to_be_visible()
        assert not errors and not uploads,(errors,uploads);browser.close()
    print('正式资料分包加载、三类消耗图标、缩略图与详情地址、效果正文及晚到分包后的卡片引用通过；无异常或上传。')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');check(parser.parse_args().url)
