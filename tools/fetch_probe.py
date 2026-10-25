"""Which request styles the BLS accepts from GitHub (run on GitHub)."""
import urllib.error
import urllib.request

URLS = ["https://data.bls.gov/cew/data/api/2024/a/area/40000.csv",
        "https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0",
        "https://download.bls.gov/pub/time.series/cu/cu.data.1.AllItems"]
HEADERS = [
    {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
     "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9"},
    {"User-Agent": "BizEstimate data pipeline (github.com/mattrecess/bizestimate)"},
    {"User-Agent": "curl/8.5.0", "Accept": "*/*"},
]
for h in HEADERS:
    for url in URLS:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as r:
                print("OK ", r.status, len(r.read(200000)), h["User-Agent"][:25], url)
        except urllib.error.HTTPError as e:
            print("ERR", e.code, h["User-Agent"][:25], url, e.read()[:150])
        except Exception as e:  # noqa: BLE001
            print("ERR", type(e).__name__, h["User-Agent"][:25], url)
