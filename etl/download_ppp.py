"""Download the SBA PPP FOIA files and keep only one state's loans.

    python etl/download_ppp.py --state OK
    python etl/download_ppp.py --state OK --local ~/Downloads/ppp   # already-downloaded CSVs

The full national dataset is ~12 CSVs (several GB); they are streamed and
filtered row by row, so nothing large is written to disk.
"""
import argparse
import csv
import glob
import io
import json
import os
import re
import sys

from netutil import urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
CKAN = "https://data.sba.gov/api/3/action/package_show?id=ppp-foia"
DATASET_PAGE = "https://data.sba.gov/dataset/ppp-foia"

csv.field_size_limit(10_000_000)


def resource_urls():
    urls = []
    try:
        with urlopen(CKAN, timeout=60) as r:
            pkg = json.load(r)["result"]
        urls = [res["url"] for res in pkg["resources"]]
    except Exception as e:  # noqa: BLE001
        print(f"CKAN API failed ({e}); falling back to the dataset page", flush=True)
        with urlopen(DATASET_PAGE, timeout=60) as r:
            html = r.read().decode("utf-8", errors="replace")
        urls = re.findall(r'href="(https?://[^"]+?\.csv)"', html)
    urls = sorted({u for u in urls if u.lower().endswith(".csv") and "public" in u.lower()})
    if not urls:
        sys.exit("No PPP CSV files found on data.sba.gov")
    print(f"Found {len(urls)} PPP files", flush=True)
    return urls


def open_streams(local_dir):
    if local_dir:
        for path in sorted(glob.glob(os.path.join(os.path.expanduser(local_dir), "*.csv"))):
            yield path, open(path, newline="", encoding="utf-8", errors="replace")
    else:
        for url in resource_urls():
            resp = urlopen(url, timeout=600)
            yield url, io.TextIOWrapper(resp, encoding="utf-8", errors="replace", newline="")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    ap.add_argument("--local", help="directory of already-downloaded PPP CSVs")
    args = ap.parse_args()
    state = args.state.upper()

    os.makedirs(DATA_DIR, exist_ok=True)
    out_path = os.path.join(DATA_DIR, f"ppp_{state.lower()}.csv")
    writer, total = None, 0
    with open(out_path, "w", newline="") as out:
        for name, stream in open_streams(args.local):
            kept = 0
            with stream:
                # Some SBA files contain stray NUL bytes, which the csv module rejects.
                for row in csv.DictReader(line.replace("\0", "") for line in stream):
                    st = (row.get("BorrowerState") or row.get("ProjectState") or "").strip().upper()
                    if st != state:
                        continue
                    if writer is None:
                        writer = csv.DictWriter(out, fieldnames=list(row.keys()), extrasaction="ignore")
                        writer.writeheader()
                    writer.writerow(row)
                    kept += 1
            total += kept
            print(f"{os.path.basename(name)}: {kept:,} {state} loans", flush=True)
    print(f"Wrote {total:,} loans to {out_path}")


if __name__ == "__main__":
    main()
