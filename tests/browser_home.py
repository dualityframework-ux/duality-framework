"""Homepage navigation, highlights and change log work by touch and keyboard, without JS."""
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
        page.emulate_media(reduced_motion='reduce')
        page.goto((ROOT / "index.html").as_uri())
        for link in page.locator('nav .links a, footer .links a').all():
            bounds = link.bounding_box()
            assert bounds['height'] >= 44 and bounds['width'] >= 44, 'Navigation tap area is too small'
        # Every section remains reachable by keyboard with JavaScript disabled.
        for link in page.locator('nav .links a').all():
            target = link.get_attribute('href')
            link.focus()
            page.keyboard.press('Enter')
            expect(page.locator(target + ' h2')).to_be_in_viewport()
            assert page.url.endswith(target)
        page.locator('footer').get_by_role('link', name='Back to top ↑', exact=True).click()
        expect(page.locator('h1')).to_be_in_viewport()
        expect(page).to_have_url((ROOT / 'index.html').as_uri() + '#top')
        for name, href in (
            ('Open Variance ↗', './variance/'),
            ('Open Runway ↗', 'https://dualityframework-ux.github.io/Runway/'),
            ('Open frame² ↗', './frame2/'),
        ):
            link = page.get_by_role('link', name=name, exact=True)
            expect(link).to_have_attribute('href', href)
            link.focus()
            expect(link).to_be_focused()
        for link in page.locator('.go a, .project-open').all():
            bounds = link.bounding_box()
            assert bounds['height'] >= 44 and bounds['width'] >= 44, 'Project tap area is too small'
        # Each live tool has one clear entry point before its supporting links.
        for card in page.locator('.card').all():
            if card.locator('.status.live').count():
                expect(card.locator('.project-open')).to_have_count(1)
                primary = card.locator('.project-open').bounding_box()
                supporting = card.locator('.go').bounding_box()
                assert primary['y'] + primary['height'] <= supporting['y']
            else:
                expect(card.locator('.project-open')).to_have_count(0)
        # Each skill on the Variance card links to a page and section that exist.
        skills = page.locator('.card .skills a')
        expect(skills).to_have_count(6)
        for href in skills.evaluate_all('links => links.map(a => a.getAttribute("href"))'):
            if href.startswith('./'):
                path, _, anchor = href[2:].partition('#')
                target = ROOT / path
                assert target.is_file(), href
                assert f'id="{anchor}"' in target.read_text(), href
        # Three highlights on the homepage; the full history lives on the change log.
        highlights = page.locator('#log > ol > li')
        expect(highlights).to_have_count(3)
        titles = [t.strip() for t in highlights.locator('b').all_inner_texts()]
        expect(page.locator('.log-history')).to_have_count(0)
        changelog = page.get_by_role('link', name='See every change in the change log →')
        expect(changelog).to_have_attribute('href', './changelog.html')
        assert page.locator('body').evaluate('() => document.documentElement.scrollWidth') <= width
        changelog.click()
        expect(page.locator('h1')).to_have_text('Every change, newest first.')
        logged = [t.strip() for t in page.locator('#log > ol > li b').all_inner_texts()]
        assert all(t in logged for t in titles), 'Every highlight is also in the change log'
        for href in page.locator('#log a').evaluate_all('links => links.map(a => a.getAttribute("href"))'):
            if href.startswith('./'):
                path = href[2:].split('#')[0] or 'index.html'
                assert (ROOT / path).exists() or (ROOT / path / 'index.html').exists(), href
        assert page.locator('body').evaluate('() => document.documentElement.scrollWidth') <= width
        for scheme in ('light', 'dark'):
            page.emulate_media(color_scheme=scheme)
            assert not page.evaluate(CHECK), f'Change log contrast failed at {width}px ({scheme})'
        page.close()
    browser.close()
print('Homepage: navigation, highlights and change log passed at phone and desktop widths')
