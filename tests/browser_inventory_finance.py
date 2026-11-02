"""Evidence changes the financial result; keyboard, offline fallback and mobile layout work."""
import os
from pathlib import Path
from playwright.sync_api import expect, sync_playwright
from check_contrast import CHECK

ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / 'notes/inventory-finance.html').as_uri()
with sync_playwright() as p:
    options = {'executable_path': os.environ['CHROME']} if os.environ.get('CHROME') else {}
    browser = p.chromium.launch(**options)
    for width in (320, 390, 1100):
        page = browser.new_page(viewport={'width': width, 'height': 844})
        page.route('https://**', lambda route: route.abort())
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(URL)
        expect(page.locator('[data-value="profitAfter"]')).to_have_text('$39,625.00')
        expect(page.locator('[data-value="marginAfter"]')).to_have_text('39.63%')
        for key, amount, margin, exposure, label in (
            ('pending', '$0.00', '40.00%', '$600.00', 'Count only'),
            ('found', '$0.00', '40.00%', '$0.00', 'All stock located'),
            ('shipment', '$600.00', '39.40%', '$0.00', 'Shipment cost not posted'),
            ('loss', '$375.00', '39.63%', '$0.00', 'Partial recovery; loss confirmed'),
        ):
            radio = page.locator(f'input[value="{key}"]')
            radio.focus()
            page.keyboard.press('Space')
            expect(radio).to_be_checked()
            expect(radio).to_be_focused()
            expect(page.locator('[data-value="label"]')).to_have_text(label)
            expect(page.locator('[data-value="debit"]')).to_have_text(amount)
            expect(page.locator('[data-value="credit"]')).to_have_text(amount)
            expect(page.locator('[data-value="marginAfter"]')).to_have_text(margin)
            expect(page.locator('[data-value="exposure"]')).to_have_text(exposure)
            expect(page.get_by_role('status')).to_contain_text(label)
            assert page.evaluate('document.documentElement.scrollWidth') <= width
            for scheme in ('light', 'dark'):
                page.emulate_media(color_scheme=scheme)
                assert not page.evaluate(CHECK), f'{key}, {width}, {scheme}'
        for label in page.locator('label').all():
            assert label.bounding_box()['height'] >= 44
        # Normal arrow-key radio navigation also updates the result.
        page.locator('input[value="loss"]').focus()
        page.keyboard.press('ArrowRight')
        expect(page.locator('input[value="shipment"]')).to_be_checked()
        expect(page.locator('[data-value="debit"]')).to_have_text('$600.00')
        for href in page.locator('a').evaluate_all('links => links.map(a => a.getAttribute("href"))'):
            if not href.startswith('https:'):
                target = (ROOT / 'notes' / href.split('#')[0]).resolve()
                assert target.exists(), href
        assert not errors, errors
        page.close()
        fallback = browser.new_page(viewport={'width': width, 'height': 844}, java_script_enabled=False)
        fallback.goto(URL)
        expect(fallback.locator('#scenario-controls')).to_be_hidden()
        expect(fallback.locator('[data-value="profitAfter"]')).to_have_text('$39,625.00')
        expect(fallback.locator('[data-value="marginAfter"]')).to_have_text('39.63%')
        assert fallback.evaluate('document.documentElement.scrollWidth') <= width
        fallback.close()
    browser.close()
print('Inventory-to-finance: evidence scenarios, keyboard, contrast, phone widths and no-JS fallback passed.')
