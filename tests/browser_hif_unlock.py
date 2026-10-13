"""遍历当前目录中的 HIF 专属卡，验证持有与未持有记录的真实提示。"""
import argparse
from playwright.sync_api import sync_playwright,expect


def check(url):
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page();page.goto(url,wait_until='networkidle')
        page.locator('#data-open').click();page.locator('#enable-preview-account').click();expect(page.locator('#inventory')).to_be_visible(timeout=60000)
        page.locator('[data-tab="idolCards"]').click()
        cases=page.evaluate('''async()=>{const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('idolCards');const {collectionRecords,progressionInfo}=await import('./domain/catalog.mjs');const data=await (await fetch('./resources/preview-account.json')).json();const snapshot=data.documents.find(row=>row.source==='user_get');return collectionRecords(snapshot,'idolCards','all').filter(held=>progressionInfo('idolPreview',held)?.rewards.some(row=>row.scope==='hif-final')).map(held=>({id:held.idolCardId,label:held.ownership==='unowned'||held.primaStellaUpgradedTime===0?'未解锁':held.primaStellaUpgradedTime>0?'已解锁':'解锁状态未采集'}));}''')
        if page.locator('#owned-only').get_attribute('aria-checked')=='true':page.locator('#owned-only').click()
        counts={}
        for case in cases:
            page.locator('#search').fill(case['id']);row=page.locator(f'.idol-card[data-idol-id="{case["id"]}"]');expect(row).to_be_visible(timeout=30000)
            button=row.locator('[data-reward-scope="hif-final"] .support-reward-trigger');expect(button).to_have_count(1)
            label=button.get_attribute('aria-label');assert 'HIF 本战专用 · '+case['label'] in label;assert '升级时间' not in label
            button.click();hint=page.locator('.support-reward-popover:popover-open');expect(hint).to_contain_text('HIF 本战专用 · '+case['label'])
            counts[case['label']]=counts.get(case['label'],0)+1
        assert counts.get('已解锁',0)>0 and counts.get('未解锁',0)>0
        assert not counts.get('解锁状态未采集',0)
        browser.close()
    print('全部 HIF 提示验证通过：'+str(counts))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18765/');args=parser.parse_args();check(args.url)
