"""The Variance one-page summary prints to exactly one page and offers a print button on screen."""
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as p:
    options = {'executable_path': os.environ['CHROME']} if os.environ.get('CHROME') else {}
    browser = p.chromium.launch(**options)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    page.route('https://**', lambda route: route.abort())
    page.goto((ROOT / 'variance/one-pager.html').as_uri())
    expect(page.get_by_role('button', name='Print or save as PDF')).to_be_visible()
    expect(page.get_by_role('link', name='← Full case study')).to_have_attribute('href', './case-study.html')
    for size in ('Letter', 'A4'):
        pdf = page.pdf(format=size, prefer_css_page_size=False)
        pages = len(re.findall(rb'/Type\s*/Page[^s]', pdf))
        assert pages == 1, f'One-pager prints to {pages} pages on {size}'
    page.emulate_media(media='print')
    expect(page.get_by_role('button', name='Print or save as PDF')).to_be_hidden()
    browser.close()
print('One-pager: prints to one page on Letter and A4, print button on screen')
