"""Fail if any page scrolls sideways on a phone (390px and 320px wide).

Usage: python tests/check_phone_width.py index.html variance/index.html ...
Needs: pip install playwright, and Chrome (set CHROME=/path if it isn't at /usr/bin/google-chrome).
"""
import asyncio
import os
import pathlib
import sys

from playwright.async_api import async_playwright

WIDTHS = (390, 320)

# Name the elements that stick out past the right edge, so a failure says what to fix.
WIDEST = """
w => [...document.querySelectorAll("body *")]
  .filter(e => e.getBoundingClientRect().right > w + 1)
  .slice(0, 3)
  .map(e => `<${e.tagName.toLowerCase()} class="${e.className}"> "${(e.textContent || "").trim().slice(0, 30)}"`)
"""


async def main(pages):
    chrome = os.environ.get("CHROME", "/usr/bin/google-chrome")
    failures = 0
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=chrome, args=["--no-sandbox"])
        for width in WIDTHS:
            for page_path in pages:
                page = await browser.new_page(viewport={"width": width, "height": 800})
                # Keep the check offline: stub third-party scripts like Chart.js instead of fetching them.
                await page.route("**/*.js", lambda r: r.continue_() if r.request.url.startswith("file:") else
                                 r.fulfill(body="window.Chart=function(){return{destroy(){},update(){}}};", content_type="application/javascript"))
                await page.goto(pathlib.Path(page_path).resolve().as_uri())
                await page.wait_for_timeout(500)
                scroll = await page.evaluate("document.documentElement.scrollWidth")
                if scroll > width:
                    failures += 1
                    print(f"[{width}px] {page_path}: page is {scroll}px wide; sticking out: {await page.evaluate(WIDEST, width)}")
                await page.close()
        await browser.close()
    print(f"{len(pages)} pages x {len(WIDTHS)} phone widths checked: {'all fit' if not failures else f'{failures} overflow'}")
    return failures


if __name__ == "__main__":
    sys.exit(1 if asyncio.run(main(sys.argv[1:])) else 0)
