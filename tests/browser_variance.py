"""Real browser checks for CSV input, evidence, comparison and downloads."""
import csv
import io
from pathlib import Path
import tempfile

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'variance/python'

with sync_playwright() as playwright, tempfile.TemporaryDirectory() as directory:
    browser = playwright.chromium.launch()
    page = browser.new_page(viewport={'width':390, 'height':844}, accept_downloads=True)
    page.route('https://**', lambda route: route.abort())
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto((ROOT / 'variance/index.html').as_uri())
    # The primary action is keyboard-operable.
    page.get_by_role('button', name='Load sample count', exact=True).focus()
    page.keyboard.press('Enter')
    expect(page.locator('#msg')).to_contain_text('164')

    # Exercise actual FileReader uploads, using only synthetic fixtures.
    page.locator('#file').set_input_files(FIXTURES / 'sample_count.csv')
    expect(page.locator('#msg')).to_contain_text('164')
    page.locator('#txFile').set_input_files(FIXTURES / 'sample_transactions.csv')
    expect(page.locator('#txMsg')).to_contain_text('11 transactions loaded')
    expect(page.locator('#out')).to_contain_text('matches transfers for 2')
    expect(page.locator('#out')).to_contain_text('supports 6')
    rows = page.locator('section[aria-labelledby="a-h"] tbody tr')
    expect(rows).to_have_count(28)
    battery = rows.filter(has=page.get_by_text('C-14-02', exact=True))
    expect(battery.locator('.evb')).to_have_text('✓ matching transfer')
    timing = rows.filter(has=page.get_by_text('F-02-05', exact=True))
    expect(timing.locator('.evb')).to_have_text('supported')

    page.locator('#prFile').set_input_files(FIXTURES / 'sample_prior_count.csv')
    expect(page.get_by_role('heading', name='Since the last count')).to_be_visible()

    # A later transfer must not be presented as evidence for an earlier count.
    history = (FIXTURES / 'sample_transactions.csv').read_text().replace('2026-10-18,BAT-5100', '2026-11-10,BAT-5100')
    page.locator('#txFile').set_input_files({'name':'future-transfer.csv', 'mimeType':'text/csv', 'buffer':history.encode()})
    expect(page.locator('#out')).to_contain_text('matches transfers for 0')

    with page.expect_download() as download:
        page.get_by_role('button', name='Download results CSV', exact=True).click()
    output = Path(directory) / 'results.csv'
    download.value.save_as(output)
    results = list(csv.DictReader(io.StringIO(output.read_text())))
    assert len(results) == 28
    assert {'likely_cause', 'explanation'} <= set(results[0])

    with page.expect_download() as download:
        page.locator('#dlRc').click()
    output = Path(directory) / 'blind.csv'
    download.value.save_as(output)
    recount = list(csv.DictReader(io.StringIO(output.read_text())))
    assert recount and 'system_qty' not in recount[0]
    page.locator('#blind').uncheck()
    with page.expect_download() as download:
        page.locator('#dlRc').click()
    output = Path(directory) / 'visible.csv'
    download.value.save_as(output)
    assert 'system_qty' in next(csv.DictReader(io.StringIO(output.read_text())))

    # Unrecognized headers can be mapped through the actual input controls.
    page.locator('#file').set_input_files({'name':'custom.csv', 'mimeType':'text/csv',
                                         'buffer':b'a,b,c,d,e\nSKU-1,A-01,20,8,2\n'})
    expect(page.locator('#mapBox')).to_be_visible()
    for field, index in [('sku',0), ('location',1), ('system_qty',2), ('counted_qty',3), ('unit_cost',4)]:
        page.locator('#m-' + field).select_option(str(index))
    page.locator('#mapGo').click()
    expect(page.locator('#msg')).to_contain_text('Analyzed 1 lines')
    assert not errors, errors
    browser.close()
print('Variance browser checks passed: keyboard, uploads, evidence, comparison, CSV/recount downloads, mapping.')
