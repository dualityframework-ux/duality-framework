"""Fail if any visible text on the given pages is below WCAG AA contrast, in light or dark mode.

Usage: python tests/check_contrast.py index.html variance/index.html ...
Needs: pip install playwright, and Chrome (set CHROME=/path if it isn't at /usr/bin/google-chrome).
"""
import asyncio
import os
import pathlib
import sys

from playwright.async_api import async_playwright

# For each element with its own text: compare its color to the first opaque background behind it.
# Large text (24px, or 18.66px bold) needs 3:1; everything else needs 4.5:1.
CHECK = r"""
() => {
  const lum = c => { const v = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
                     return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
                       const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const b = parse(getComputedStyle(e).backgroundColor); if (b && b.a > 0.5) return b.c; } return [255, 255, 255]; };
  const fails = [];
  for (const el of document.querySelectorAll("body *")) {
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (cs.visibility === "hidden" || cs.display === "none" || el.closest("[hidden]") || !r.width || !r.height) continue;
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el), a = lum(fg.c), b = lum(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize), need = size >= 24 || (parseInt(cs.fontWeight) >= 600 && size >= 18.66) ? 3 : 4.5;
    if (ratio < need) fails.push(`${ratio.toFixed(2)}:1 < ${need} "${el.textContent.trim().slice(0, 40)}" rgb(${fg.c}) on rgb(${bg})`);
  }
  return fails;
}
"""


async def main(pages):
    chrome = os.environ.get("CHROME", "/usr/bin/google-chrome")
    failures = 0
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=chrome, args=["--no-sandbox"])
        for scheme in ("light", "dark"):
            for page_path in pages:
                ctx = await browser.new_context(viewport={"width": 1100, "height": 900}, color_scheme=scheme)
                page = await ctx.new_page()
                # Keep the check offline: stub third-party scripts like Chart.js instead of fetching them.
                await page.route("**/*.js", lambda r: r.continue_() if r.request.url.startswith("file:") else
                                 r.fulfill(body="window.Chart=function(){return{destroy(){},update(){}}};", content_type="application/javascript"))
                await page.goto(pathlib.Path(page_path).resolve().as_uri())
                await page.wait_for_timeout(500)
                fails = await page.evaluate(CHECK)
                for f in fails:
                    print(f"[{scheme}] {page_path}: {f}")
                failures += len(fails)
                await ctx.close()
        await browser.close()
    print(f"{len(pages)} pages x 2 themes checked: {'all pass' if not failures else f'{failures} contrast failures'}")
    return failures


if __name__ == "__main__":
    sys.exit(1 if asyncio.run(main(sys.argv[1:])) else 0)
