"""Print the titles and row/column labels of IRS SOI corporation tables (run on GitHub)."""
import io
import sys

import openpyxl

sys.path.insert(0, "etl")
from netutil import urlopen  # noqa: E402

for t in ["01", "04", "07", "08", "21", "21a", "22", "23", "24", "24a", "31", "32", "33", "51", "52", "53", "54", "61", "62"]:
    name = f"22co{t}ccr.xlsx"
    try:
        with urlopen("https://www.irs.gov/pub/irs-soi/" + name, timeout=120) as r:
            data = r.read()
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL {name}: {e!r}")
        continue
    print(f"\n===== {name} {len(data):,}B sheets={wb.sheetnames[:6]}")
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(max_row=14, values_only=True))
    for row in rows[:10]:
        cells = [str(c)[:60] for c in row if c not in (None, "")]
        if cells:
            print("   ", " | ".join(cells)[:400])
    # First column labels further down (row items).
    labels = [str(r[0])[:60] for r in ws.iter_rows(min_row=8, max_row=140, values_only=True) if r and r[0]]
    print("   rows:", labels[:70])
