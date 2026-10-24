"""Re-base headline estimates on the newest Form 5500 headcount where there is a recent one.

Called by load.py (same transaction, so pages never show the PPP-era figure in between) and by
form5500.py after it refreshes the headcounts table.

revenue = latest plan participants x industry revenue per employee; EBITDA = revenue x the
industry's IRS margin adjusted for that revenue (margins.py).

Skipped (the existing estimate stands) when the count is likely to be partial rather than the
workforce: fewer than MIN_PARTICIPANTS (often an owners-only plan), under half the PPP headcount
(plans can exclude part-timers and new hires, so a big "drop" is more often coverage), or over
MAX_GROWTH times it (more often a wrong match or a parent company's plan than real growth).
"""
from datetime import date

from margins import Margins

MIN_PARTICIPANTS = 3
MAX_GROWTH = 4           # more than 4x the PPP headcount is more often a mismatched or company-wide plan
RECENT_YEARS = 2          # counts for plan years from (this year - 2) onward
RANGE = (0.8, 1.5)        # participants undercount staff somewhat, so the range leans upward


def apply(cur, state):
    since = date.today().year - RECENT_YEARS
    cur.execute("""
        with latest as (
            select distinct on (biz_key) biz_key, employees
            from headcounts where source = 'form5500' and year >= %(since)s
            order by biz_key, year desc
        )
        select b.biz_key, b.naics, l.employees * ib.revenue_per_employee, b.est_method, b.est_revenue_mid,
               b.est_ebitda_mid
        from businesses b
        join latest l on l.biz_key = b.biz_key
        cross join lateral (
            select revenue_per_employee from industry_benchmarks
            where b.naics like naics_prefix || '%%' order by length(naics_prefix) desc limit 1
        ) ib
        where b.state = %(state)s and ib.revenue_per_employee is not null
          and l.employees >= %(min)s
          and (b.jobs_reported is null
               or l.employees between 0.5 * b.jobs_reported and %(max_growth)s * b.jobs_reported)""",
                {"since": since, "state": state, "min": MIN_PARTICIPANTS, "max_growth": MAX_GROWTH})
    margins = Margins()
    lo, hi = RANGE
    updates = []
    for key, naics, revenue, method, cur_rev, cur_ebitda in cur.fetchall():
        revenue = float(revenue)
        margin = margins.margin(naics, revenue)
        ebitda = revenue * margin
        if method == "retirement_plan" and cur_rev is not None and round(revenue) == round(float(cur_rev)) \
                and cur_ebitda is not None and round(ebitda) == round(float(cur_ebitda)):
            continue   # already current: don't rewrite the row
        updates.append((round(revenue * lo), round(revenue), round(revenue * hi),
                        round(ebitda * lo), round(ebitda), round(ebitda * hi), margin, key))
    cur.executemany("""
        update businesses set est_revenue_low = %s, est_revenue_mid = %s, est_revenue_high = %s,
            est_ebitda_low = %s, est_ebitda_mid = %s, est_ebitda_high = %s, est_ebitda_margin = %s,
            est_method = 'retirement_plan', est_confidence = 'medium'
        where biz_key = %s""", updates)
    print(f"Estimates re-based on recent retirement-plan headcounts: {len(updates):,} updated", flush=True)
