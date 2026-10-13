"""使用实际赛季卡片下拉列表选择赛季。"""
from playwright.sync_api import expect


def select_season(page,season_id):
    page.locator('#season-activity-mode').set_checked(season_id.startswith('event:'))
    page.locator('#season-select').click()
    popup=page.locator('#season-picker-popup:popover-open');expect(popup).to_be_visible()
    popup.locator(f'[data-season-id="{season_id}"]').click()
    expect(page.locator('#season-select')).to_have_attribute('data-value',season_id)
