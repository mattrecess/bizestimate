"""Show the links on the DOL enforcement data catalog (run on GitHub)."""
import re
import sys

sys.path.insert(0, "etl")
from netutil import urlopen  # noqa: E402

for url in ["https://enforcedata.dol.gov/views/data_catalogs.php", "https://enforcedata.dol.gov/views/data_summary.php"]:
    try:
        with urlopen(url, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print("FAIL", url, e)
        continue
    print("==", url, len(html))
    for m in sorted(set(re.findall(r'(?:href|src|data-[a-z]+)="([^"]+)"', html))):
        if "osha" in m.lower() or "zip" in m.lower() or "csv" in m.lower():
            print("  ", m)
    print(re.sub(r"\s+", " ", html)[-6000:])
