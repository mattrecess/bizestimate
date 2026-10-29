"""Re-base headline estimates on the newest Form 5500 headcount where there is a recent one.

Called by load.py (same transaction, so pages never show the PPP-era figure in between) and by
form5500.py after it refreshes the headcounts table.

revenue = latest plan participants x industry revenue per employee; EBITDA = revenue x the
industry's IRS margin adjusted for that revenue (margins.py).

Skipped (the existing estimate stands) when the count is likely to be partial rather than the
workforce: fewer than MIN_PARTICIPANTS (often an owners-only plan), under half the PPP headcount
(plans can exclude part-timers and new hires, so a big "drop" is more often coverage), or over
MAX_GROWTH times it (more often a wrong match or a parent company's plan than real growth).
Staffing firms and PEOs are skipped too: their plans cover workers placed at other companies.

The filing's own industry code replaces ours when ours is vague (a 2-5 digit code) or came from map
data, since the revenue per employee and margin depend on it.
"""
from datetime import date

from benchmarks import correct_naics, load_benchmarks, lookup
from adjust import Adjust
from margins import Margins
from size_factors import SizeFactors

MIN_PARTICIPANTS = 3
MAX_GROWTH = 4           # more than 4x the PPP headcount is more often a mismatched or company-wide plan
RECENT_YEARS = 2          # counts for plan years from (this year - 2) onward
RANGE = (0.8, 1.5)        # participants undercount staff somewhat, so the range leans upward
STAFFING = ("5613",)      # employment placement, temp help, PEOs


def apply(cur, state):
    since = date.today().year - RECENT_YEARS
    cur.execute("""
        with latest as (
            select distinct on (biz_key) biz_key, employees, naics
            from headcounts where source = 'form5500' and year >= %(since)s
            order by biz_key, year desc
        )
        select b.biz_key, b.naics, b.source, l.naics, l.employees, b.est_method, b.est_revenue_mid,
               b.est_ebitda_mid, b.industry, b.name
        from businesses b join latest l on l.biz_key = b.biz_key
        where b.state = %(state)s and l.employees >= %(min)s
          and coalesce(b.est_method, '') not in ('reported', 'verified', 'branch')   -- actual figures win
          and (b.jobs_reported is null
               or l.employees between 0.5 * b.jobs_reported and %(max_growth)s * b.jobs_reported)""",
                {"since": since, "state": state, "min": MIN_PARTICIPANTS, "max_growth": MAX_GROWTH})
    margins, bench, adjust, sizes = Margins(), load_benchmarks(), Adjust(), SizeFactors()
    lo, hi = RANGE
    updates, staffing = [], 0
    for key, naics, source, filed_naics, employees, method, cur_rev, cur_ebitda, cur_industry, name in cur.fetchall():
        naics = naics or ""
        # The filing's code is more specific than a map listing's, but plan paperwork often carries a
        # parent's or a generic code (an engineering contractor filed as a petroleum wholesaler), so it
        # only replaces ours within the same sector.
        if filed_naics and (len(naics) < 6 or source == "overture") and (not naics or naics[:2] == filed_naics[:2]):
            naics = filed_naics
        naics = correct_naics(name, naics)
        if naics.startswith(STAFFING):
            staffing += 1
            continue
        _, b = lookup(bench, naics)
        if not b.get("revenue_per_employee"):
            continue
        # Recent headcount, so only prices need bringing up to date (benchmark year -> now).
        inflation = adjust.inflation(b.get("year"))
        revenue = float(employees) * sizes.rpe(naics, employees, b["revenue_per_employee"]) * inflation
        margin = margins.margin(naics, revenue)
        ebitda = revenue * margin
        if method == "retirement_plan" and cur_rev is not None and round(revenue) == round(float(cur_rev)) \
                and cur_ebitda is not None and round(ebitda) == round(float(cur_ebitda)) and cur_industry == b["label"]:
            continue   # already current: don't rewrite the row
        updates.append((round(revenue * lo), round(revenue), round(revenue * hi),
                        round(ebitda * lo), round(ebitda), round(ebitda * hi),
                        margin if margins.data else None, naics, b["label"], inflation, key))
    cur.executemany("""
        update businesses set est_revenue_low = %s, est_revenue_mid = %s, est_revenue_high = %s,
            est_ebitda_low = %s, est_ebitda_mid = %s, est_ebitda_high = %s, est_ebitda_margin = %s,
            naics = %s, industry = %s, est_inflation = %s, est_growth = 1,
            est_method = 'retirement_plan', est_confidence = 'medium'
        where biz_key = %s""", updates)
    print(f"Estimates re-based on recent retirement-plan headcounts: {len(updates):,} updated "
          f"({staffing:,} staffing firms/PEOs skipped)", flush=True)


TRUCKING = ("484", "4854", "4855", "4859")
FLEET_RANGE = (0.7, 1.4)


def apply_fleet(cur, state):
    """Trucking and bus companies: size from the drivers (or trucks) on their current FMCSA
    registration where that's more than the 2020 PPP headcount, or where there was none (a map listing
    on an industry average). Actual and 401(k) figures win."""
    cur.execute("""
        select b.biz_key, b.naics, b.name, b.jobs_reported, b.est_growth,
               (s.data ->> 'drivers')::numeric, (s.data ->> 'power_units')::numeric
        from businesses b join business_sources s on s.biz_key = b.biz_key and s.source = 'fmcsa'
        where b.state = %s and b.naics ~ '^(484|4854|4855|4859)'
          and coalesce(b.est_method, '') not in ('reported', 'verified', 'branch', 'retirement_plan', 'fleet')""", (state,))
    margins, bench, adjust, sizes = Margins(), load_benchmarks(), Adjust(), SizeFactors()
    lo, hi = FLEET_RANGE
    updates = []
    for key, naics, name, jobs, growth, drivers, units in cur.fetchall():
        fleet = max(float(drivers or 0), float(units or 0))
        ppp_now = float(jobs or 0) * float(growth or 1)
        if fleet < 2 or (ppp_now and fleet < 1.2 * ppp_now):
            continue   # the PPP count (office and shop staff included) is the better headcount
        naics = correct_naics(name, naics)
        _, b = lookup(bench, naics)
        if not b.get("revenue_per_employee"):
            continue
        inflation = adjust.inflation(b.get("year"))
        revenue = fleet * sizes.rpe(naics, fleet, b["revenue_per_employee"]) * inflation
        margin = margins.margin(naics, revenue)
        updates.append((round(revenue * lo), round(revenue), round(revenue * hi),
                        round(revenue * margin * lo), round(revenue * margin), round(revenue * margin * hi),
                        margin if margins.data else None, inflation, key))
    cur.executemany("""
        update businesses set est_revenue_low = %s, est_revenue_mid = %s, est_revenue_high = %s,
            est_ebitda_low = %s, est_ebitda_mid = %s, est_ebitda_high = %s, est_ebitda_margin = %s,
            est_inflation = %s, est_growth = 1, est_method = 'fleet', est_confidence = 'medium'
        where biz_key = %s""", updates)
    print(f"Estimates re-based on current FMCSA fleets: {len(updates):,} trucking companies", flush=True)
