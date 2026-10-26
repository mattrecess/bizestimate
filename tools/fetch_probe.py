"""Find Census SUSB tables with receipts by enterprise size."""
import re
import urllib.request

for url in ("https://www2.census.gov/programs-surveys/susb/tables/2022/", "https://www2.census.gov/programs-surveys/susb/tables/2017/"):
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            body = r.read().decode("utf-8", "replace")
        print(f"== {url}")
        for f in re.findall(r'href="([^"?/][^"]*)"', body):
            print("  ", f)
    except Exception as e:  # noqa: BLE001
        print(f"== {url}: {e!r}")
