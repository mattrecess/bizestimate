"""Find where the DOL enforcement data catalog gets its file list (run on GitHub)."""
import re
import sys

sys.path.insert(0, "etl")
from netutil import urlopen  # noqa: E402

with urlopen("https://enforcedata.dol.gov/views/data_catalogs.php", timeout=60) as r:
    html = r.read().decode("utf-8", "replace")
js = re.findall(r'src="(/static/js/main[^"]+)"', html)
print("bundles", js)
for path in js:
    with urlopen("https://enforcedata.dol.gov" + path, timeout=120) as r:
        code = r.read().decode("utf-8", "replace")
    print(len(code))
    for pat in [r'"[^"]*data_catalog[^"]*"', r'"[^"]*osha[^"]*"', r'"/api[^"]*"', r'https?://[a-z0-9.-]+/[^"\s]{0,80}']:
        print(pat, sorted(set(re.findall(pat, code, re.I)))[:40])
for guess in ["https://enforcedata.dol.gov/data_catalog/OSHA/", "https://enforcedata.dol.gov/api/data_catalog",
              "https://enforcedata.dol.gov/data_catalog/data_catalog.json"]:
    try:
        with urlopen(guess, timeout=60) as r:
            body = r.read().decode("utf-8", "replace")
            print("OK", guess, len(body), sorted(set(re.findall(r'osha_[a-z_]+[^"<\s]*', body)))[:30])
    except Exception as e:  # noqa: BLE001
        print("FAIL", guess, e)
