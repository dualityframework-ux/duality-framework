"""Case-study shortcuts work without JavaScript at phone and desktop widths."""
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as playwright:
    options = {'executable_path': os.environ['CHROME']} if os.environ.get('CHROME') else {}
    browser = playwright.chromium.launch(**options)
    for width in (320, 390, 1100):
        page = browser.new_page(viewport={'width': width, 'height': 844}, java_script_enabled=False)
        page.route('https://**', lambda route: route.abort())
        page.goto((ROOT / 'variance/case-study.html').as_uri())
        contents = page.get_by_role('navigation', name='On this page', exact=True)
        expect(contents.get_by_role('link')).to_have_count(6)
        for link in contents.get_by_role('link').all():
            target = link.get_attribute('href')
            bounds = link.bounding_box()
            assert bounds['height'] >= 44 and bounds['width'] >= 44
            link.focus()
            page.keyboard.press('Enter')
            expect(page.locator(target)).to_be_in_viewport()
            assert page.url.endswith(target)
        assert page.evaluate('document.documentElement.scrollWidth') <= width
        page.close()
    browser.close()
print('Case-study section links: keyboard, anchors and phone layout passed')
