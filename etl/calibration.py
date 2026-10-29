"""Calibrating estimates against real figures, and the admin's own figures per industry.

Three layers, strongest first:
  1. industry_overrides (set in /admin/industries): the admin's revenue per employee, EBITDA margin
     and sale multiple for an industry (NAICS prefix). Revenue per employee becomes a factor on our
     raw estimate (override / the benchmark we used).
  2. industry_calibration, learned here every load: for each industry and segment (nonprofit or
     for-profit), the median of reported revenue (Form 990, SEC, figures the admin entered or owners
     sent) over our raw PPP-based estimate, shrunk toward 1 when there are few examples. Nonprofit
     examples only ever calibrate nonprofits.
  3. Nothing: the benchmark estimate stands.

Learning uses the raw estimates (est_revenue_by_employees / _by_payroll, never calibrated), so a
correction doesn't feed on itself from one load to the next.
"""
import math
import statistics as st
from collections import defaultdict

from adjust import Adjust
from benchmarks import load_benchmarks, lookup

MIN_EXAMPLES = 20      # fewer than this in an industry and segment: no learned correction
SHRINK = 20            # factor = exp(median log ratio x n / (n + SHRINK)): few examples, small correction
BOUNDS = (0.5, 2.0)
BLEND_WITHIN = 3.0     # same rule as build.py: headcount and payroll combined when within 3x
CALIBRATED = ("employees", "blend", "payroll", "industry_average", "retirement_plan", "fleet")


def raw_estimate(by_emp, by_pay):
    e = float(by_emp) if by_emp else None
    p = float(by_pay) if by_pay else None
    if e and p and 1 / BLEND_WITHIN <= p / e <= BLEND_WITHIN:
        return math.sqrt(e * p)
    return e or p


def learn(cur, state):
    """Recompute industry_calibration from businesses with real revenue."""
    cur.execute("""
        with truth as (
          select b.biz_key, (s.data ->> 'revenue')::numeric as revenue, (s.data ->> 'year')::int as year,
                 s.source = 'irs990' or b.is_nonprofit as nonprofit
          from business_sources s join businesses b on b.biz_key = s.biz_key
          where b.state = %(state)s and s.source in ('irs990', 'sec') and (s.data ->> 'revenue')::numeric > 100000
          union all
          select b.biz_key, k.revenue, k.year, b.is_nonprofit from known_financials k join businesses b on b.biz_key = k.biz_key
          where b.state = %(state)s and k.revenue > 0)
        select distinct on (t.biz_key) b.naics, t.nonprofit, t.revenue, t.year, b.est_revenue_by_employees, b.est_revenue_by_payroll
        from truth t join businesses b on b.biz_key = t.biz_key
        where coalesce(b.naics, '') <> '' and (b.est_revenue_by_employees > 0 or b.est_revenue_by_payroll > 0)
        order by t.biz_key""", {"state": state})
    groups = defaultdict(list)
    adjust = Adjust()
    for naics, nonprofit, revenue, year, by_emp, by_pay in cur.fetchall():
        raw = raw_estimate(by_emp, by_pay)
        if not raw:
            continue
        segment = "nonprofit" if nonprofit else "for_profit"
        # Our estimates are in today's dollars; a filing is for its own year, so bring it up to date first.
        actual_now = float(revenue) * (adjust.inflation(year) if year else 1)
        ratio = math.log(actual_now / raw)
        for n in (2, 3, 4):
            if len(naics) >= n:
                groups[(naics[:n], segment)].append(ratio)
    rows = []
    for (prefix, segment), logs in groups.items():
        if len(logs) < MIN_EXAMPLES:
            continue
        med = st.median(logs)
        factor = min(BOUNDS[1], max(BOUNDS[0], math.exp(med * len(logs) / (len(logs) + SHRINK))))
        miss = math.exp(st.median(abs(x) for x in logs))
        rows.append((prefix, segment, round(factor, 4), len(logs), round(miss, 3)))
    cur.execute("delete from industry_calibration")
    cur.executemany("insert into industry_calibration (naics_prefix, segment, revenue_factor, n, typical_miss) "
                    "values (%s, %s, %s, %s, %s)", rows)
    print(f"Calibration: learned corrections for {len(rows):,} industry segments "
          f"({sum(1 for r in rows if r[1] == 'for_profit'):,} for-profit)", flush=True)
    for r in sorted(rows, key=lambda r: -r[3])[:12]:
        print(f"  {r[1]:10} {r[0]:6} x{r[2]:.2f} from {r[3]:,} examples (raw typically off {r[4]:.2f}x)", flush=True)


class Calibration:
    def __init__(self, cur):
        cur.execute("select naics_prefix, segment, revenue_factor from industry_calibration")
        self.learned = {(p, s): float(f) for p, s, f in cur.fetchall()}
        cur.execute("select naics_prefix, revenue_per_employee, ebitda_margin, multiple from industry_overrides")
        self.overrides = {p: (rpe, margin, mult) for p, rpe, margin, mult in cur.fetchall()}
        self.bench, self.adjust = load_benchmarks(), Adjust()

    def _override(self, naics):
        code = naics or ""
        for n in range(min(len(code), 6), 1, -1):
            if code[:n] in self.overrides:
                return self.overrides[code[:n]]
        return None

    def factor(self, naics, nonprofit):
        """Revenue factor for a raw estimate: the admin's revenue per employee, else the learned one, else 1."""
        o = self._override(naics)
        if o and o[0]:
            _, b = lookup(self.bench, naics)
            if b.get("revenue_per_employee"):
                # The admin's figure is in today's dollars; the benchmark is in its own year's.
                return float(o[0]) / (float(b["revenue_per_employee"]) * self.adjust.inflation(b.get("year")))
        segment = "nonprofit" if nonprofit else "for_profit"
        code = naics or ""
        for n in range(min(len(code), 4), 1, -1):
            if (code[:n], segment) in self.learned:
                return self.learned[(code[:n], segment)]
        return 1.0

    def margin(self, naics):
        o = self._override(naics)
        return float(o[1]) if o and o[1] else None

    def apply_stage(self, cur):
        """Calibrate the staged (raw) estimates before they're loaded."""
        cur.execute("select biz_key, naics, is_nonprofit, est_method, est_revenue_low, est_revenue_mid, est_revenue_high, "
                    "est_ebitda_low, est_ebitda_mid, est_ebitda_high from stage_biz where est_method = any(%s)", (list(CALIBRATED),))
        updates = []
        for key, naics, nonprofit, method, *vals in cur.fetchall():
            f = self.factor(naics, str(nonprofit).lower() in ("true", "t"))
            margin = self.margin(naics)
            if abs(f - 1) < 0.005 and margin is None:
                continue
            rl, rm, rh, el, em, eh = (float(v) if v not in (None, "") else None for v in vals)
            if rm is None:
                continue
            rl, rm, rh = (round(x * f) if x is not None else None for x in (rl, rm, rh))
            if margin is not None:
                el, em, eh = (round(x * margin) if x is not None else None for x in (rl, rm, rh))
            else:
                el, em, eh = (round(x * f) if x is not None else None for x in (el, em, eh))
            updates.append((rl, rm, rh, el, em, eh, round(f, 4), margin, key))
        cur.executemany("""update stage_biz set est_revenue_low = %s, est_revenue_mid = %s, est_revenue_high = %s,
                             est_ebitda_low = %s, est_ebitda_mid = %s, est_ebitda_high = %s, est_calibration = %s,
                             est_ebitda_margin = coalesce(%s::text, est_ebitda_margin)
                           where biz_key = %s""", updates)
        print(f"Calibration: {len(updates):,} estimates adjusted", flush=True)
