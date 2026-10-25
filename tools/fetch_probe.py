"""Check FRED series for CPI and Oklahoma employment by supersector (run on GitHub)."""
import urllib.error
import urllib.request

IDS = ["CPIAUCSL", "OKCONS", "OKMFG", "OKTRAD", "OKTRADE", "OKTTU", "OKINFO", "OKFIRE", "OKPBSV", "OKEDUH", "OKLEIH",
       "OKSRVO", "OKNRMN", "OKMINE", "OKGOVT", "OKNA"]
for i in IDS:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={i}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r:
            lines = r.read().decode().strip().splitlines()
            print("OK ", i, len(lines), lines[0], lines[-1])
    except urllib.error.HTTPError as e:
        print("ERR", e.code, i)
    except Exception as e:  # noqa: BLE001
        print("ERR", type(e).__name__, i)
