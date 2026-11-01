"""Season tiles support keyboard entry, closing and filtered states."""
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as playwright:
    options = {'executable_path': os.environ['CHROME']} if os.environ.get('CHROME') else {}
    browser = playwright.chromium.launch(**options)
    for width in (320, 390, 1100):
        page = browser.new_page(viewport={'width': width, 'height': 844})
        # Exercise the app offline; chart rendering is outside this keyboard test.
        page.route('https://**', lambda route: route.fulfill(
            body='window.Chart=function(){return {destroy(){},update(){}}};',
            content_type='application/javascript') if 'chart.umd' in route.request.url else route.abort())
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto((ROOT / 'frame2/index.html').as_uri())
        tile = page.get_by_role('button', name='Open 2024 season', exact=True)
        for key in ('Enter', 'Space'):
            tile.focus()
            assert tile.evaluate('e => getComputedStyle(e).outlineStyle') != 'none'
            page.keyboard.press(key)
            expect(page.locator('#seasonCard')).to_be_visible()
            expect(page.locator('.sc-year')).to_contain_text('2024')
            expect(page.get_by_role('button', name='Close', exact=True)).to_be_focused()
            if key == 'Enter':
                page.keyboard.press('Escape')
            else:
                page.get_by_role('button', name='Close', exact=True).click()
            expect(page.locator('#seasonCard')).not_to_be_visible()
            expect(tile).to_be_focused()
            expect(tile).to_be_in_viewport()
        tile.focus()
        page.keyboard.press('Enter')
        search = page.locator('#playerSearch')
        search.fill('R')
        expect(search).to_be_focused()
        expect(page.locator('.sc-year')).to_contain_text('2024')
        page.keyboard.press('ArrowLeft')
        expect(search).to_be_focused()
        expect(page.locator('.sc-year')).to_contain_text('2024')
        search.fill('')
        page.get_by_role('button', name='Close', exact=True).click()
        expect(tile).to_be_focused()
        tile.press('Enter')
        search.fill('no-such-synthetic-player')
        expect(search).to_be_focused()
        expect(page.locator('#seasonCard')).not_to_be_visible()
        expect(tile).to_be_disabled()
        assert page.evaluate('document.documentElement.scrollWidth') <= width
        assert not errors, errors
        page.close()
    browser.close()
print('frame² keyboard seasons passed at phone and desktop widths')
