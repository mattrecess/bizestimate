"""Re-base headline estimates on the newest Form 5500 headcount where there is a recent one.

Called by load.py (same transaction, so pages never show the PPP-era figure in between) and by
form5500.py after it refreshes the headcounts table.

revenue = latest plan participants x industry revenue per employee; EBITDA = revenue x margin.

Skipped (the existing estimate stands) when the count is likely to be partial rather than the
workforce: fewer than MIN_PARTICIPANTS (often an owners-only plan), under half the PPP headcount
(plans can exclude part-timers and new hires, so a big "drop" is more often coverage), or over
MAX_GROWTH times it (more often a wrong match or a parent company's plan than real growth).
"""
from datetime import date

MIN_PARTICIPANTS = 3
MAX_GROWTH = 4           # more than 4x the PPP headcount is more often a mismatched or company-wide plan
RECENT_YEARS = 2          # counts for plan years from (this year - 2) onward
RANGE = (0.8, 1.5)        # participants undercount staff somewhat, so the range leans upward


def apply(cur, state):
    since = date.today().year - RECENT_YEARS
    lo, hi = RANGE
    cur.execute(f"""
        with latest as (
            select distinct on (biz_key) biz_key, employees
            from headcounts where source = 'form5500' and year >= %(since)s
            order by biz_key, year desc
        ), est as (
            select b.biz_key, l.employees * ib.revenue_per_employee as revenue, ib.ebitda_margin as margin
            from businesses b
            join latest l on l.biz_key = b.biz_key
            cross join lateral (
                select revenue_per_employee, ebitda_margin from industry_benchmarks
                where b.naics like naics_prefix || '%%' order by length(naics_prefix) desc limit 1
            ) ib
            where b.state = %(state)s and ib.revenue_per_employee is not null
              and l.employees >= %(min)s
              and (b.jobs_reported is null
                   or l.employees between 0.5 * b.jobs_reported and %(max_growth)s * b.jobs_reported)
        )
        update businesses b set
            est_revenue_low = round(e.revenue * {lo}), est_revenue_mid = round(e.revenue),
            est_revenue_high = round(e.revenue * {hi}),
            est_ebitda_low = round(e.revenue * e.margin * {lo}), est_ebitda_mid = round(e.revenue * e.margin),
            est_ebitda_high = round(e.revenue * e.margin * {hi}),
            est_method = 'retirement_plan', est_confidence = 'medium'
        from est e
        where b.biz_key = e.biz_key
          and (b.est_method, b.est_revenue_mid) is distinct from ('retirement_plan', round(e.revenue))""",
                {"since": since, "state": state, "min": MIN_PARTICIPANTS, "max_growth": MAX_GROWTH})
    print(f"Estimates re-based on recent retirement-plan headcounts: {cur.rowcount:,} updated", flush=True)
