"""Find the SBA 7(a)/504 FOIA dataset and its CSV links (run on GitHub)."""
import re
import sys

sys.path.insert(0, "etl")
from netutil import urlopen  # noqa: E402

for url in ["https://data.sba.gov/dataset/?q=7%28a%29+504+foia", "https://data.sba.gov/dataset/?q=foia",
            "https://data.sba.gov/en/dataset/7-a-504-foia", "https://data.sba.gov/api/3/action/package_search?q=504"]:
    try:
        with urlopen(url, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print("FAIL", url, e)
        continue
    print("==", url, len(html))
    for m in sorted(set(re.findall(r'(?:href="|"url": ")([^"]*(?:dataset/[a-z0-9-]+|\.csv))"', html)))[:60]:
        print("  ", m)
