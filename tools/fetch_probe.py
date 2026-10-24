"""List recent data files on IRS SOI business-statistics pages (run on GitHub)."""
import re
import sys

sys.path.insert(0, "etl")
from netutil import urlopen  # noqa: E402

PAGES = [
    "https://www.irs.gov/statistics/soi-tax-stats-corporation-complete-report",
    "https://www.irs.gov/statistics/soi-tax-stats-s-corporation-statistics",
    "https://www.irs.gov/statistics/soi-tax-stats-integrated-business-data",
    "https://www.irs.gov/statistics/soi-tax-stats-table-5-returns-of-active-corporations",
    "https://www.irs.gov/statistics/soi-tax-stats-table-6-returns-of-active-corporations",
    "https://www.irs.gov/statistics/soi-tax-stats-table-7-returns-of-active-corporations",
    "https://www.irs.gov/statistics/soi-tax-stats-corporation-tax-statistics",
    "https://www.irs.gov/statistics/soi-tax-stats-partnership-statistics-by-sector-or-industry",
    "https://www.irs.gov/statistics/soi-tax-stats-nonfarm-sole-proprietorship-statistics",
]
for url in PAGES:
    try:
        with urlopen(url, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print(f"FAIL {url}: {e!r}")
        continue
    # Link text helps tell the tables apart.
    links = re.findall(r'<a[^>]+href="([^"]+\.(?:zip|xlsx?|csv))"[^>]*>(.*?)</a>', html, re.I | re.S)
    recent = [(h, re.sub(r"<[^>]+>|\s+", " ", t).strip()) for h, t in links if re.search(r"/(19|2[0-9])[a-z]", h)]
    print(f"== {url}: {len(links)} files, {len(recent)} from 2019+")
    for h, t in recent[:80]:
        print(f"   {h}  | {t[:110]}")
    titles = re.findall(r"<h[234][^>]*>(.*?)</h[234]>", html, re.S)
    print("   headings:", [re.sub(r"<[^>]+>|\s+", " ", x).strip()[:80] for x in titles[:25]])
