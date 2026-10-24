"""List the data-file links on a few public pages (run on GitHub, which can reach them)."""
import re
import sys
import urllib.request

sys.path.insert(0, "etl")
from netutil import urlopen  # noqa: E402

PAGES = [
    "https://www.irs.gov/statistics/soi-tax-stats-corporation-source-book-publication-1053",
    "https://www.irs.gov/statistics/soi-tax-stats-corporation-source-book-data-file",
    "https://www.irs.gov/statistics/soi-tax-stats-table-5-returns-of-active-corporations",
]
for url in PAGES:
    try:
        with urlopen(url, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print(f"FAIL {url}: {e!r}")
        continue
    links = sorted(set(re.findall(r'href="([^"]+\.(?:zip|xlsx?|csv|txt|pdf))"', html, re.I)))
    print(f"== {url} ({len(html):,} chars, {len(links)} files)")
    for l in links[:120]:
        print("  ", l)
    for m in re.findall(r'<a [^>]*href="(/statistics/[^"]*source-book[^"]*)"', html)[:30]:
        print("   page:", m)
