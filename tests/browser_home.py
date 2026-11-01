"""Homepage update history stays reachable by touch and keyboard, without JS."""
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from check_contrast import CHECK

ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as playwright:
    options = {"executable_path": os.environ["CHROME"]} if os.environ.get("CHROME") else {}
    browser = playwright.chromium.launch(**options)
    for width in (320, 390, 1100):
        page = browser.new_page(viewport={"width": width, "height": 844}, java_script_enabled=False)
        page.goto((ROOT / "index.html").as_uri())
        for name, href in (
            ('Open Variance ↗', './variance/'),
            ('Open Runway ↗', 'https://dualityframework-ux.github.io/Runway/'),
            ('Open frame² ↗', './frame2/'),
        ):
            link = page.get_by_role('link', name=name, exact=True)
            expect(link).to_have_attribute('href', href)
            link.focus()
            expect(link).to_be_focused()
        for link in page.locator('.go a').all():
            bounds = link.bounding_box()
            assert bounds['height'] >= 44 and bounds['width'] >= 44, 'Project tap area is too small'
        expect(page.locator('#log > ol > li')).to_have_count(3)
        history = page.locator('.log-history')
        older = history.locator('li').first
        expect(older).not_to_be_visible()
        toggle = history.locator('summary')
        expect(toggle).to_have_accessible_name('Show older updates')
        toggle.click()
        expect(older).to_be_visible()
        expect(history.get_by_role('link', name='Try it').last).to_be_visible()
        expect(toggle).to_have_accessible_name('Hide older updates')
        toggle.focus()
        page.keyboard.press('Enter')
        expect(older).not_to_be_visible()
        page.keyboard.press('Space')
        expect(older).to_be_visible()
        assert page.locator('body').evaluate('() => document.documentElement.scrollWidth') <= width
        for scheme in ('light', 'dark'):
            page.emulate_media(color_scheme=scheme)
            assert not page.evaluate(CHECK), f'Expanded history contrast failed at {width}px ({scheme})'
        page.close()
    browser.close()
print('Homepage history: touch, keyboard, and expanded phone layout passed')
