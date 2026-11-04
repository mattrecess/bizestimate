"""Re-base headline estimates on the newest Form 5500 headcount where there is a recent one.

Called by load.py (same transaction, so pages never show the PPP-era figure in between) and by
form5500.py after it refreshes the headcounts table.

The simple estimate (calibration.simple): latest plan participants, grown at the annual growth rate since
the plan year, x industry revenue per employee; EBITDA = revenue x the industry margin.

Skipped (the existing estimate stands) when the count is unlikely to be this company's workforce: fewer
than MIN_PARTICIPANTS (often an owners-only plan), or over MAX_GROWTH times the PPP headcount (more often a
wrong match or a parent company's plan than real growth). A recent 401(k) count otherwise always wins
(the owner's rule, Nov 4), even when it's lower than the PPP one.
Staffing firms and PEOs are skipped too: their plans cover workers placed at other companies.

The filing's own industry code replaces ours when ours is vague (a 2-5 digit code) or came from map
data, since the revenue per employee and margin depend on it.
"""
from datetime import date

from benchmarks import correct_naics, load_benchmarks, lookup
from calibration import PPP_YEAR_MID, Calibration

MIN_PARTICIPANTS = 3
MAX_GROWTH = 4           # more than 4x the PPP headcount is more often a mismatched or company-wide plan
RECENT_YEARS = 2          # counts for plan years from (this year - 2) onward
STAFFING = ("5613",)      # employment placement, temp help, PEOs


def _write(cur, updates, extra_sets):
    if not updates:
        return
    cols = [c for c in updates[0] if c != "key"]
    cur.executemany(f"update businesses set {', '.join(f'{c} = %({c})s' for c in cols)}, {extra_sets} where biz_key = %(key)s",
                    updates)


def apply(cur, state):
    """The newest 401(k) headcount, where it's recent, replaces the PPP one: the simple estimate from it."""
    # Before the query below: Calibration reads its settings on this cursor, which would discard the query's
    # results (until Nov 4 that left this step, and apply_fleet, updating nothing).
    bench, cal = load_benchmarks(), Calibration(cur)
    since = date.today().year - RECENT_YEARS
    cur.execute("""
        with latest as (
            select distinct on (biz_key) biz_key, employees, naics, year
            from headcounts where source = 'form5500' and year >= %(since)s
            order by biz_key, year desc
        )
        select b.biz_key, b.naics, b.source, l.naics, l.employees, l.year, b.name, b.industry,
               b.est_method, b.est_revenue_mid, b.est_ebitda_mid
        from businesses b join latest l on l.biz_key = b.biz_key
        where b.state = %(state)s and l.employees >= %(min)s
          and coalesce(b.est_method, '') not in ('reported', 'verified', 'branch')   -- actual figures win
          and (b.jobs_reported is null or l.employees <= %(max_growth)s * b.jobs_reported)""",
                {"since": since, "state": state, "min": MIN_PARTICIPANTS, "max_growth": MAX_GROWTH})
    updates, staffing = [], 0
    for key, naics, source, filed_naics, employees, year, name, cur_industry, method, cur_rev, cur_ebitda in cur.fetchall():
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
        # Counted at the end of the plan year.
        e = cal.simple(naics, float(employees), date(int(year), 12, 31))
        if not e:
            continue
        _, b = lookup(bench, naics)
        if method == "retirement_plan" and cur_rev is not None and round(float(cur_rev)) == e["est_revenue_mid"] \
                and cur_ebitda is not None and round(float(cur_ebitda)) == e["est_ebitda_mid"] and cur_industry == b["label"]:
            continue   # already current: don't rewrite the row
        updates.append({**e, "naics": naics, "industry": b["label"], "key": key})
    _write(cur, updates, "est_method = 'retirement_plan', est_confidence = 'medium'")
    print(f"Estimates re-based on recent retirement-plan headcounts: {len(updates):,} updated "
          f"({staffing:,} staffing firms/PEOs skipped)", flush=True)


TRUCKING = ("484", "4854", "4855", "4859")


def apply_fleet(cur, state):
    """Trucking and bus companies: size from the drivers (or trucks) on their current FMCSA
    registration where that's more than the 2020 PPP headcount grown since, or where there was none (a map
    listing on an industry average). Actual and 401(k) figures win."""
    cal = Calibration(cur)   # before the query (see apply)
    cur.execute("""
        select b.biz_key, b.naics, b.name, b.jobs_reported,
               (s.data ->> 'drivers')::numeric, (s.data ->> 'power_units')::numeric
        from businesses b join business_sources s on s.biz_key = b.biz_key and s.source = 'fmcsa'
        where b.state = %s and b.naics ~ '^(484|4854|4855|4859)'
          and coalesce(b.est_method, '') not in ('reported', 'verified', 'branch', 'retirement_plan', 'fleet')""", (state,))
    ppp_growth = (1 + cal.growth) ** ((date.today() - PPP_YEAR_MID).days / 365.25)
    updates = []
    for key, naics, name, jobs, drivers, units in cur.fetchall():
        fleet = max(float(drivers or 0), float(units or 0))
        if fleet < 2 or (jobs and fleet < 1.2 * float(jobs) * ppp_growth):
            continue   # the PPP count (office and shop staff included) is the better headcount
        e = cal.simple(correct_naics(name, naics), fleet, date.today())   # the registration is current
        if e:
            updates.append({**e, "key": key})
    _write(cur, updates, "est_method = 'fleet', est_confidence = 'medium'")
    print(f"Estimates re-based on current FMCSA fleets: {len(updates):,} trucking companies", flush=True)
