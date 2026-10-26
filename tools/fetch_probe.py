"""Peek at Census SUSB 2022 state x 6-digit NAICS x enterprise size (receipts by size)."""
import urllib.request

URL = "https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_6digitnaics_2022.txt"
with urllib.request.urlopen(URL, timeout=300) as r:
    head = r.readline().decode("latin-1")
    print(head.strip())
    n, shown = 0, 0
    for raw in r:
        line = raw.decode("latin-1")
        n += 1
        if n <= 3 or (("423320" in line or "561730" in line) and shown < 24):
            shown += n > 3
            print(line.strip()[:300])
    print("rows:", n)
