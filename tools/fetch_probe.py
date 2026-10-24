"""Find the SBA 7(a)/504 FOIA dataset and its CSV links (run on GitHub)."""
import re
import sys

sys.path.insert(0, "etl")
from netutil import urlopen  # noqa: E402

for url in [f"https://data.sba.gov/dataset/?page={n}" for n in range(1, 7)] + [
        "https://www.sba.gov/about-sba/sba-performance/open-government/foia/frequently-requested-records/sba-7a-504-loan-data-reports"]:
    try:
        with urlopen(url, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print("FAIL", url, e)
        continue
    print("==", url, len(html))
    for m in sorted(set(re.findall(r'(?:href="|"url": ")([^"]*(?:dataset/[a-z0-9-]+|\.csv))"', html)))[:60]:
        print("  ", m)
