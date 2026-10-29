"""Listings for companies known only from public records: trucking carriers (FMCSA) and 401(k) plan
sponsors (Form 5500) that match no PPP borrower or map listing.

fmcsa.py and form5500.py call save() with the records they couldn't match; load.py calls stage() to
add them to the next load, placed at their ZIP (an approximate location) and skipping any whose name
and ZIP are already listed. Only registered companies (LLC, Inc, Corp, ...) are kept, never a person's
name, so sole proprietors stay out.

revenue = headcount x industry revenue per employee (drivers or trucks for carriers, plan
participants for sponsors); EBITDA = revenue x the industry's IRS margin for that size.
"""
import json
import re

from adjust import Adjust
from benchmarks import correct_naics, load_benchmarks, lookup
from calibration import Calibration
from geocode import jitter, zip_centroids
from margins import Margins
from matching import full_name
from size_factors import SizeFactors

PREFIX = {"fmcsa": "DOT|", "form5500": "EIN|"}
COMPANY = re.compile(r"\b(LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP|PLLC|PC|PA)\b\.?", re.I)
RANGE = {"fmcsa": (0.7, 1.4), "form5500": (0.8, 1.5)}
STAFFING = ("5613",)
MAX_REVENUE = 1e9


def is_company(name):
    return bool(name and COMPANY.search(name))


def own_listing(key):
    """A business key that is itself one of these listings (a record matched to it stays a record)."""
    return str(key).startswith(tuple(PREFIX.values()))


def save(cur, state, source, records):
    """records: [{id, name, address, city, zip, naics, employees, ...}] for this source; replaces the last set."""
    cur.execute("delete from record_listings where source = %s and state = %s", (source, state))
    kept = [r for r in records if is_company(r["name"]) and r.get("zip") and r.get("employees")]
    cur.executemany("insert into record_listings (biz_key, source, state, data) values (%s, %s, %s, %s) "
                    "on conflict (biz_key) do nothing",
                    [(PREFIX[source] + str(r["id"]), source, state, json.dumps(r)) for r in kept])
    print(f"{source}: {len(kept):,} unmatched companies saved as record-only listings", flush=True)


def stage(cur, state, cols):
    """Rows (dicts over cols) for record-only listings not already staged under the same name and ZIP."""
    cur.execute("select to_regclass('record_listings') is not null")
    if not cur.fetchone()[0]:
        return []
    cur.execute("select biz_key, source, data from record_listings where state = %s order by source desc", (state,))
    records = cur.fetchall()
    cur.execute("select name, left(zip, 5) from stage_biz")
    listed = {(full_name(n or ""), z) for n, z in cur.fetchall()}
    try:
        zips = zip_centroids()
    except OSError as e:
        print(f"record-only listings: ZIP centroids unavailable ({e!r}); none added", flush=True)
        return []
    bench, adjust, margins, sizes, cal = load_benchmarks(), Adjust(), Margins(), SizeFactors(), Calibration(cur)
    out, skipped = [], 0
    for key, source, d in records:
        zip5 = str(d.get("zip") or "")[:5]
        naics = correct_naics(d["name"], d.get("naics") or ("4841" if source == "fmcsa" else ""))
        ident = (full_name(d["name"]), zip5)
        if ident in listed or zip5 not in zips or naics.startswith(STAFFING):
            skipped += 1
            continue
        _, b = lookup(bench, naics)
        if not b.get("revenue_per_employee"):
            skipped += 1
            continue
        listed.add(ident)
        employees = float(d["employees"])
        inflation = adjust.inflation(b.get("year"))
        factor = cal.factor(naics, False)
        revenue = employees * sizes.rpe(naics, employees, b["revenue_per_employee"]) * inflation * factor
        if revenue > MAX_REVENUE:
            # Too big to be an unknown company: more likely a parent's plan or a wrong industry code.
            print(f"record-only listings: skipped {d['name']} ({source}, {employees:,.0f} employees, "
                  f"${revenue / 1e9:.1f}B estimated)", flush=True)
            skipped += 1
            continue
        margin = cal.margin(naics) or margins.margin(naics, revenue)
        lo, hi = RANGE[source]
        lat, lon = zips[zip5]
        dlat, dlon = jitter(key)
        row = {c: "" for c in cols}
        row.update({
            "biz_key": key, "name": d["name"].strip(), "address": (d.get("address") or "").strip(),
            "city": (d.get("city") or "").strip().title(), "state": state, "zip": zip5, "naics": naics,
            "industry": b["label"], "is_individual": "False", "is_nonprofit": "False",
            "lat": round(lat + dlat, 6), "lon": round(lon + dlon, 6), "geo_precision": "zip",
            "est_revenue_low": round(revenue * lo), "est_revenue_mid": round(revenue), "est_revenue_high": round(revenue * hi),
            "est_ebitda_low": round(revenue * lo * margin), "est_ebitda_mid": round(revenue * margin),
            "est_ebitda_high": round(revenue * hi * margin), "est_ebitda_margin": margin if margins.data else "",
            "est_inflation": inflation, "est_growth": 1, "est_confidence": "low", "est_calibration": round(factor, 4),
            "est_method": "fleet" if source == "fmcsa" else "retirement_plan",
            "phone": d.get("phone") or "", "source": source,
        })
        out.append({c: row.get(c, "") for c in cols})
    print(f"record-only listings: {len(out):,} staged ({skipped:,} already listed or not placeable)", flush=True)
    return out
