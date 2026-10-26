"""Probe NCUA account codes and Oklahoma vendor payment CSV columns."""
import csv
import io
import json
import urllib.request
import zipfile

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/126 Safari/537.36"}


def get(url, n=60_000_000):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return r.read(n)


z = zipfile.ZipFile(io.BytesIO(get("https://www.ncua.gov/files/publications/analysis/call-report-data-2026-06.zip")))
want = {"ACCT_010", "ACCT_115", "ACCT_117", "ACCT_131", "ACCT_661A", "ACCT_083", "ACCT_564A", "ACCT_564B", "ACCT_350",
        "ACCT_340", "ACCT_380", "ACCT_440A", "ACCT_671", "ACCT_IS0005", "ACCT_IS0010"}
desc = z.open("AcctDesc.txt").read().decode("latin-1").splitlines()
print(desc[0])
for line in desc[1:]:
    if any(f'"{w[5:]}"' in line or f",{w[5:]}," in line for w in want) or any(k in line.lower() for k in ("total interest income", "non-interest income", "net income", "full-time", "part-time", "number of current members", "total assets")):
        print("  ", line[:220])
for name in z.namelist():
    if name.startswith("FS220"):
        head = z.open(name).readline().decode("latin-1")
        hits = [w for w in want if f'"{w}"' in head]
        if hits:
            print(name, hits)
ok = [r for r in csv.DictReader(io.TextIOWrapper(z.open("FOICU.txt"), "latin-1")) if r["STATE"] == "OK"]
print("OK credit unions:", len(ok), ok[0]["CU_NAME"], ok[0]["CITY"])

meta = json.loads(get("https://data.ok.gov/api/3/action/package_show?id=state-of-oklahoma-vendor-payments-fiscal-year-2026"))
for res in meta["result"]["resources"]:
    print("resource:", res.get("name"), res.get("format"), res.get("url"), res.get("size"))
    with urllib.request.urlopen(urllib.request.Request(res["url"], headers=UA), timeout=180) as r:
        lines = [r.readline().decode("utf-8", "replace") for _ in range(4)]
    print("".join(lines)[:1500])
