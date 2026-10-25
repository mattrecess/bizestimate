"""Nonprofit leadership from Form 990 e-filings: officers, directors, key employees and pay, and
the paid preparer (the organization's accounting firm).

    DATABASE_URL=... python etl/irs990_people.py --state OK

Covers the nonprofits irs990.py matched. The IRS publishes every e-filed return as XML inside large
zip archives, with a yearly index; only the needed returns are read out of the archives (HTTP range
requests), so nothing large is downloaded.
"""
import argparse
import csv
import io
import json
import time
import xml.etree.ElementTree as ET
import zipfile

import psycopg

import enrich
from load import database_url
from netutil import urlopen

BASE = "https://apps.irs.gov/pub/epostcard/990/xml/{year}/"
MAX_PEOPLE = 15


class RemoteFile(io.RawIOBase):
    """A seekable read-only view of a URL using HTTP range requests (enough for zipfile)."""

    def __init__(self, url):
        self.url, self.pos = url, 0
        req = urlopen(url, headers={"Range": "bytes=0-0"}, timeout=60)
        self.size = int(req.headers["Content-Range"].split("/")[-1])
        req.close()
        self.cache = (0, b"")

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = {0: offset, 1: self.pos + offset, 2: self.size + offset}[whence]
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        start, data = self.cache
        if not (start <= self.pos and self.pos + n <= start + len(data)):
            # Read ahead in 256 KB blocks: zipfile makes many small reads.
            end = min(self.size, self.pos + max(n, 1 << 18)) - 1
            with urlopen(self.url, headers={"Range": f"bytes={self.pos}-{end}"}, timeout=120) as r:
                self.cache = (self.pos, r.read())
            start, data = self.cache
        out = data[self.pos - start:self.pos - start + n]
        self.pos += len(out)
        return out

    def readinto(self, b):
        data = self.read(len(b))
        b[:len(data)] = data
        return len(data)


def local(tag):
    return tag.rsplit("}", 1)[-1]


def text(el, name):
    for e in el.iter():
        if local(e.tag) == name and (e.text or "").strip():
            return e.text.strip()
    return None


def parse(xml):
    root = ET.fromstring(xml)
    people = []
    groups = {"Form990PartVIISectionAGrp", "OfficerDirectorTrusteeEmplGrp", "OfficerDirTrstKeyEmplGrp",
              "CompensationHighestPaidEmplGrp"}
    for el in root.iter():
        if local(el.tag) in groups:
            name = text(el, "PersonNm") or text(el, "BusinessNameLine1Txt")
            if not name:
                continue
            comp = text(el, "ReportableCompFromOrgAmt") or text(el, "CompensationAmt") or "0"
            try:
                comp = float(comp)
            except ValueError:
                comp = 0.0
            people.append({"name": name.title() if name.isupper() else name, "title": text(el, "TitleTxt") or "", "pay": comp})
    seen, uniq = set(), []
    for p in sorted(people, key=lambda p: -p["pay"]):
        if p["name"].lower() not in seen:
            seen.add(p["name"].lower())
            uniq.append(p)
    preparer = None
    for el in root.iter():
        if local(el.tag) in ("PreparerFirmGrp", "PreparerFirmName"):
            preparer = text(el, "BusinessNameLine1Txt") or text(el, "BusinessNameLine1")
            if preparer:
                break
    period = text(root, "TaxPeriodEndDt") or text(root, "TaxPeriodEndDate") or ""
    return {"officers": uniq[:MAX_PEOPLE], "preparer": preparer, "year": int(period[:4]) if period[:4].isdigit() else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        cur.execute("""select s.biz_key, s.data ->> 'ein' from business_sources s join businesses b using (biz_key)
                       where s.source = 'irs990' and b.state = %s""", (state,))
        by_ein = {ein.lstrip("0"): key for key, ein in cur.fetchall() if ein}
        print(f"irs990_people: {len(by_ein):,} matched nonprofits", flush=True)
        # Newest return per EIN across the last few index years.
        latest = {}
        this_year = time.gmtime().tm_year
        for year in range(this_year - 2, this_year + 1):
            try:
                with urlopen(BASE.format(year=year) + f"index_{year}.csv", timeout=300) as r:
                    rows = csv.DictReader(io.TextIOWrapper(r, encoding="utf-8", errors="replace"))
                    for row in rows:
                        ein = (row.get("EIN") or "").lstrip("0")
                        if ein in by_ein and row.get("XML_BATCH_ID"):
                            prev = latest.get(ein)
                            if prev is None or row.get("TAX_PERIOD", "") >= prev["TAX_PERIOD"]:
                                latest[ein] = {**row, "_year": year}
            except Exception as e:  # noqa: BLE001
                print(f"irs990_people: index {year} unavailable ({e!r})", flush=True)
        print(f"irs990_people: e-filed returns found for {len(latest):,}", flush=True)
        by_batch = {}
        for ein, row in latest.items():
            by_batch.setdefault((row["_year"], row["XML_BATCH_ID"]), []).append((ein, row["OBJECT_ID"]))
        out, failed = {}, 0
        for (year, batch), items in sorted(by_batch.items()):
            try:
                z = zipfile.ZipFile(RemoteFile(BASE.format(year=year) + f"{batch}.zip"))
                names = {n.rsplit("/", 1)[-1].split("_")[0]: n for n in z.namelist()}
            except Exception as e:  # noqa: BLE001
                print(f"irs990_people: batch {batch} unreadable ({e!r})", flush=True)
                failed += len(items)
                continue
            for ein, obj in items:
                try:
                    data = parse(z.read(names[obj]))
                except Exception:  # noqa: BLE001
                    failed += 1
                    continue
                if data["officers"] or data["preparer"]:
                    out[by_ein[ein]] = data
            print(f"irs990_people: batch {batch}: {len(items)} returns", flush=True)
        print(f"irs990_people: leadership for {len(out):,} nonprofits ({failed} unreadable)", flush=True)
        for key, d in list(out.items())[:5]:
            print(f"  sample: {[(p['name'], p['title']) for p in d['officers'][:3]]} preparer={d['preparer']}", flush=True)
        enrich.save(cur, state, "irs990_people", out)


if __name__ == "__main__":
    main()
