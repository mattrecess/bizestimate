"""Turn filtered PPP loans into deduplicated businesses with revenue/EBITDA estimates.

    python etl/build.py --state OK

Reads data/ppp_<state>.csv, writes data/businesses.csv and data/loans.csv.

Method
------
Primary: revenue = reported jobs x the industry's revenue per employee; EBITDA = revenue x
the industry margin. The payroll method below is kept as a cross-check, and used when a
business reported no jobs.

A first-draw PPP loan was 2.5x average monthly 2019 payroll (3.5x for second
draws in NAICS 72), so annual payroll ~= loan / multiplier * 12. Revenue is
payroll / the industry's payroll-to-revenue ratio, EBITDA is revenue x the
industry margin. Sole proprietors and the self-employed were sized on owner
net profit instead, so for them the annualized amount is treated as owner
earnings (~EBITDA) and revenue is backed out from an assumed net margin.
"""
import argparse
import csv
import os
import re
from collections import defaultdict
from datetime import datetime

from benchmarks import load_benchmarks, lookup
from matching import name_score, name_tokens, parse_address

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")

INDIVIDUAL_TYPES = {"sole proprietorship", "self-employed individuals", "independent contractors"}
SOLE_PROP_NET_MARGIN = 0.30          # owner earnings / revenue for one-person businesses
PAYROLL_RANGE = (0.75, 1.35)         # payroll excludes comp over $100k/yr, so skew high
OWNER_RANGE = (0.6, 1.6)
EMPLOYEE_RANGE = (0.7, 1.4)          # reported jobs are a point-in-time headcount
SUFFIXES = re.compile(r"\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|PLLC|PC|LP|LLP|DBA)\b")


def norm_name(name):
    n = re.sub(r"[^A-Z0-9 ]", " ", name.upper())
    n = SUFFIXES.sub(" ", n)
    return re.sub(r"\s+", " ", n).strip()


def num(v):
    try:
        return float(str(v).replace(",", "")) if v not in (None, "") else None
    except ValueError:
        return None


def date(v):
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(v.strip(), fmt).date().isoformat()
        except (ValueError, AttributeError):
            pass
    return None


def estimate(loan_amount, draw, naics, jobs, business_type, bench):
    multiplier = 3.5 if draw == "second" and (naics or "").startswith("72") else 2.5
    annual = loan_amount / multiplier * 12
    individual = (business_type or "").strip().lower() in INDIVIDUAL_TYPES
    owner_only = individual and (jobs or 0) <= 1

    # Payroll method: one-person businesses were sized on owner earnings, everyone else on payroll.
    if owner_only:
        payroll_revenue, payroll_ebitda = annual / SOLE_PROP_NET_MARGIN, annual
    else:
        payroll_revenue = annual / bench["payroll_to_revenue"]
        payroll_ebitda = payroll_revenue * bench["ebitda_margin"]
    est = {
        "est_payroll": None if owner_only else round(annual),
        "est_revenue_by_payroll": round(payroll_revenue),
        "est_revenue_by_employees": None,
    }

    # Primary method: reported employees x the industry's revenue per employee.
    if jobs and jobs > 0 and bench.get("revenue_per_employee"):
        revenue = jobs * bench["revenue_per_employee"]
        ebitda = revenue * bench["ebitda_margin"]
        lo, hi = EMPLOYEE_RANGE
        # When the two methods disagree by more than 2x, flag the estimate as shaky.
        agree = 0.5 <= revenue / payroll_revenue <= 2
        est.update(est_revenue_by_employees=round(revenue), est_method="employees",
                   est_confidence="medium" if agree else "low")
    else:
        revenue, ebitda = payroll_revenue, payroll_ebitda
        lo, hi = OWNER_RANGE if owner_only else PAYROLL_RANGE
        est.update(est_method="owner_earnings" if owner_only else "payroll", est_confidence="low")
    est.update(
        est_revenue_low=round(revenue * lo), est_revenue_mid=round(revenue),
        est_revenue_high=round(revenue * hi), est_ebitda_low=round(ebitda * lo),
        est_ebitda_mid=round(ebitda), est_ebitda_high=round(ebitda * hi),
    )
    return est


BUSINESS_COLS = [
    "biz_key", "name", "address", "city", "state", "zip", "county", "naics", "industry",
    "business_type", "is_individual", "is_nonprofit", "jobs_reported", "est_payroll",
    "est_revenue_low", "est_revenue_mid", "est_revenue_high", "est_ebitda_low",
    "est_ebitda_mid", "est_ebitda_high", "est_revenue_by_employees", "est_revenue_by_payroll", "est_method",
    "est_confidence", "total_ppp_amount",
]
LOAN_COLS = ["loan_number", "biz_key", "draw", "date_approved", "amount", "payroll_proceed",
             "forgiveness_amount", "loan_status", "lender", "jobs_reported"]


def merge_duplicates(loans_by_biz):
    """Merge businesses filed under slightly different names at the same street address and ZIP,
    e.g. "RED DIRT PAINTERS, CO" and "RED DIRT PAINTERS CO. DBA CERTAPRO PAINTERS"."""
    by_address = defaultdict(list)
    for key, loans in loans_by_biz.items():
        row = loans[0]["_row"]
        parsed = parse_address(row.get("BorrowerAddress"))
        if parsed:
            by_address[(parsed, key.rsplit("|", 1)[1])].append(key)
    merged = 0
    for keys in by_address.values():
        if len(keys) < 2:
            continue
        # Keep the key with the most loans (ties: shortest name), fold similar names into it.
        keys.sort(key=lambda k: (-len(loans_by_biz[k]), len(k)))
        kept = []
        for k in keys:
            tokens = name_tokens(k.rsplit("|", 1)[0])
            into = next((t for t in kept if name_score(tokens, name_tokens(t.rsplit("|", 1)[0])) >= 1), None)
            if into is None:
                kept.append(k)
                continue
            for loan in loans_by_biz.pop(k):
                loan["biz_key"] = into
                loans_by_biz[into].append(loan)
            merged += 1
    print(f"Merged {merged:,} duplicate listings", flush=True)
    return loans_by_biz


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    args = ap.parse_args()
    src = os.path.join(DATA_DIR, f"ppp_{args.state.lower()}.csv")
    bench_all = load_benchmarks()

    loans_by_biz = defaultdict(list)
    with open(src, newline="") as f:
        for r in csv.DictReader(f):
            name = (r.get("BorrowerName") or "").strip()
            zip5 = (r.get("BorrowerZip") or "").strip()[:5]
            amount = num(r.get("CurrentApprovalAmount")) or num(r.get("InitialApprovalAmount"))
            if not name or not amount or amount <= 0:
                continue
            key = f"{norm_name(name)}|{zip5}"
            loans_by_biz[key].append({
                "loan_number": r.get("LoanNumber", "").strip(),
                "biz_key": key,
                "draw": "second" if (r.get("ProcessingMethod") or "").strip().upper() == "PPS" else "first",
                "date_approved": date(r.get("DateApproved")),
                "amount": amount,
                "payroll_proceed": num(r.get("PAYROLL_PROCEED")),
                "forgiveness_amount": num(r.get("ForgivenessAmount")),
                "loan_status": (r.get("LoanStatus") or "").strip(),
                "lender": (r.get("OriginatingLender") or r.get("ServicingLenderName") or "").strip(),
                "jobs_reported": int(num(r.get("JobsReported")) or 0) or None,
                "_row": r,
            })

    loans_by_biz = merge_duplicates(loans_by_biz)

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(os.path.join(DATA_DIR, "businesses.csv"), "w", newline="") as bf, \
         open(os.path.join(DATA_DIR, "loans.csv"), "w", newline="") as lf:
        bw = csv.DictWriter(bf, fieldnames=BUSINESS_COLS)
        lw = csv.DictWriter(lf, fieldnames=LOAN_COLS, extrasaction="ignore")
        bw.writeheader()
        lw.writeheader()
        for key, loans in loans_by_biz.items():
            # First draws are sized on 2019 payroll; prefer the largest of those.
            primary = max(loans, key=lambda l: (l["draw"] == "first", l["amount"]))
            r = primary["_row"]
            naics = (r.get("NAICSCode") or "").strip()
            jobs = max((l["jobs_reported"] or 0) for l in loans) or None
            btype = (r.get("BusinessType") or "").strip()
            _, bench = lookup(bench_all, naics)
            est = estimate(primary["amount"], primary["draw"], naics, jobs, btype, bench)
            bw.writerow({
                "biz_key": key,
                "name": r["BorrowerName"].strip(),
                "address": (r.get("BorrowerAddress") or "").strip(),
                "city": (r.get("BorrowerCity") or "").strip().title(),
                "state": (r.get("BorrowerState") or "").strip().upper(),
                "zip": (r.get("BorrowerZip") or "").strip()[:5],
                "county": (r.get("ProjectCountyName") or "").strip().title(),
                "naics": naics,
                "industry": bench["label"],
                "business_type": btype,
                "is_individual": btype.lower() in INDIVIDUAL_TYPES,
                "is_nonprofit": (r.get("NonProfit") or "").strip().upper() == "Y"
                or "non-profit" in btype.lower(),
                "jobs_reported": jobs,
                "total_ppp_amount": round(sum(l["amount"] for l in loans), 2),
                **est,
            })
            for l in loans:
                if l["loan_number"]:
                    lw.writerow(l)
    print(f"Built {len(loans_by_biz):,} businesses from {src}")


if __name__ == "__main__":
    main()
