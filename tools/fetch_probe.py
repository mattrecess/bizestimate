"""Fetch public industry valuation-multiple tables (plain requests, saved as text) for the multiples research."""
import html
import re
import urllib.request

URLS = [
    "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/vebitda.html",
    "https://firstpagesage.com/business/ebitda-multiples-by-industry/",
    "https://www.bizbuysell.com/insight-report/",
    "https://www.ibba.org/market-pulse/",
    "https://bschool.pepperdine.edu/institutes-centers/pcmi/",
]
for url in URLS:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "BizEstimate research (python urllib)"})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode("utf-8", "replace")
        text = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw)
        text = re.sub(r"(?i)</(tr|p|li|h\d|div)>", "\n", text)
        text = re.sub(r"(?i)</t[dh]>", " | ", text)
        text = html.unescape(re.sub(r"<[^>]+>", " ", text))
        text = "\n".join(re.sub(r"[ \t]+", " ", l).strip() for l in text.splitlines() if l.strip())
        print(f"===== {url} (HTTP {r.status}, {len(text):,} chars)\n{text[:25000]}\n", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"===== {url} FAILED {e!r}\n", flush=True)
