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
import datetime
import math
import statistics as st
from collections import defaultdict

from adjust import Adjust
from benchmarks import load_benchmarks, lookup
from margins import Margins

MIN_EXAMPLES = 20      # fewer than this in an industry and segment: no learned correction
SHRINK = 20            # factor = exp(median log ratio x n / (n + SHRINK)): few examples, small correction
BOUNDS = (0.5, 2.0)
BLEND_WITHIN = 3.0     # same rule as build.py: headcount and payroll combined when within 3x
# Employee-based estimates (PPP, 401(k), fleet) use the simple formula (Calibration.simple) and are left out
# of calibration, growth adjustment and the range tilt below.
CALIBRATED = ("payroll", "industry_average")
# PPP-era estimates (2020 headcount and payroll, and the industry averages drawn from them) are brought
# up to date at the admin's annual growth rate (estimate_settings 'annual_growth', default 8%), in place
# of inflation and Oklahoma industry job growth. Calibration then measures the result against real figures.
PPP_ERA = ("payroll", "owner_earnings", "industry_average")
DEFAULT_GROWTH = 0.08
# The shown estimate is moved toward the top of its range by this share of the way, measured on a
# log scale (estimate_settings 'range_tilt'; 0 = middle, 1 = top). Learning keeps using the raw figures.
DEFAULT_TILT = 0.5
TILTED = CALIBRATED + ("owner_earnings",)
PPP_YEAR_MID = datetime.date(2020, 7, 1)
# The simple estimate (Nov 4, the owner's rule): employees (newest count we have: a recent 401(k) filing, else
# the 2020 PPP loan, or a trucking fleet) grown at the annual growth rate since that count, x the industry's
# revenue per employee (the admin's figure, else the Census one kept within these bounds) = revenue;
# x the industry EBITDA margin = EBITDA; x the size and industry multiple = value (map_tables).
RPE_BOUNDS = (100_000, 500_000)
SIMPLE_RANGE = (0.75, 1.3)
EMPLOYEE_METHODS = ("employees", "blend")


def raw_estimate(by_emp, by_pay):
    e = float(by_emp) if by_emp else None
    p = float(by_pay) if by_pay else None
    if e and p and 1 / BLEND_WITHIN <= p / e <= BLEND_WITHIN:
        return math.sqrt(e * p)
    return e or p


def learn(cur, state, growth_factor=None):
    """Recompute industry_calibration from businesses with real revenue. growth_factor(job_growth): for
    estimates loaded before the annual growth setting, the factor that brings them to it."""
    cur.execute("""
        with truth as (
          select b.biz_key, (s.data ->> 'revenue')::numeric as revenue, (s.data ->> 'year')::int as year,
                 s.source = 'irs990' or b.is_nonprofit as nonprofit
          from business_sources s join businesses b on b.biz_key = s.biz_key
          where b.state = %(state)s and s.source in ('irs990', 'sec') and (s.data ->> 'revenue')::numeric > 100000
          union all
          select b.biz_key, k.revenue, k.year, b.is_nonprofit from known_financials k join businesses b on b.biz_key = k.biz_key
          where b.state = %(state)s and k.revenue > 0)
        select distinct on (t.biz_key) b.naics, t.nonprofit, t.revenue, t.year, b.est_revenue_by_employees, b.est_revenue_by_payroll,
               (to_jsonb(b) ->> 'est_growth_rate') is null, b.est_growth
        from truth t join businesses b on b.biz_key = t.biz_key
        where coalesce(b.naics, '') <> '' and (b.est_revenue_by_employees > 0 or b.est_revenue_by_payroll > 0)
        order by t.biz_key""", {"state": state})
    groups = defaultdict(list)
    adjust = Adjust()
    for naics, nonprofit, revenue, year, by_emp, by_pay, before_growth, job_growth in cur.fetchall():
        raw = raw_estimate(by_emp, by_pay)
        if not raw:
            continue
        if before_growth and growth_factor:
            raw *= growth_factor(float(job_growth or 1))
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


def revenue_scale(scale):
    """The admin's margin-by-size scale, entered as [[EBITDA, margin], ...] (an HVAC company with $500K of
    EBITDA runs about 14%, one with $10M about 30%), as [(revenue, margin), ...] sorted by revenue: margin
    can't be read off EBITDA directly, since EBITDA is revenue x margin."""
    points = []
    for item in scale or []:
        try:
            ebitda, m = float(item[0]), float(item[1])
        except (TypeError, ValueError, IndexError):
            continue
        if ebitda > 0 and 0 < m < 1:
            points.append((ebitda / m, m))
    return sorted(points) or None


def scaled_margin(points, revenue):
    """Margin at a revenue: straight between the scale's points (on a log revenue scale), flat beyond them."""
    if revenue <= points[0][0]:
        return points[0][1]
    for (r0, m0), (r1, m1) in zip(points, points[1:]):
        if revenue <= r1:
            t = math.log(revenue / r0) / math.log(r1 / r0)
            return m0 + t * (m1 - m0)
    return points[-1][1]


class Calibration:
    def __init__(self, cur):
        cur.execute("select naics_prefix, segment, revenue_factor from industry_calibration")
        self.learned = {(p, s): float(f) for p, s, f in cur.fetchall()}
        # to_jsonb: tolerant of a database without the margin_scale column yet
        cur.execute("""select naics_prefix, revenue_per_employee, ebitda_margin, multiple, to_jsonb(o) -> 'margin_scale'
                       from industry_overrides o""")
        self.overrides = {p: (rpe, margin, mult, revenue_scale(scale)) for p, rpe, margin, mult, scale in cur.fetchall()}
        self.bench, self.adjust, self.irs = load_benchmarks(), Adjust(), Margins()
        cur.execute("select value from estimate_settings where key = 'annual_growth'")
        row = cur.fetchone()
        self.growth = float(row[0]) if row else DEFAULT_GROWTH
        cur.execute("select value from estimate_settings where key = 'range_tilt'")
        row = cur.fetchone()
        self.tilt = min(1.0, max(0.0, float(row[0]))) if row else DEFAULT_TILT

    def tilted(self, mid, high):
        """The estimate moved toward the top of its range."""
        if mid is None or high is None or mid <= 0 or high <= mid:
            return mid
        return mid * (high / mid) ** self.tilt

    def growth_factor(self, job_growth):
        """Multiplier taking a PPP-era estimate from (inflation since its base year x Oklahoma industry job
        growth) to (2020 dollars x the annual growth rate since mid-2020): the base year cancels out."""
        years = (datetime.date.today() - PPP_YEAR_MID).days / 365.25
        return (1 + self.growth) ** years / (self.adjust.inflation(2020) * (job_growth or 1))

    def _override(self, naics):
        """The admin's figures for this code, each from the most specific industry that sets it: a margin
        for 4233 and a revenue per employee for all of 42 both apply to a 423320 business."""
        code = naics or ""
        found = [None, None, None, None]
        for n in range(min(len(code), 6), 1, -1):
            o = self.overrides.get(code[:n])
            if o:
                found = [mine if mine is not None else theirs for mine, theirs in zip(found, o)]
        return tuple(found) if any(v is not None for v in found) else None

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

    def margin(self, naics, revenue=None):
        """The admin's EBITDA margin for the industry: from its margin-by-size scale at this revenue when it
        has one, else its single margin; None when the admin hasn't set either."""
        o = self._override(naics)
        if not o:
            return None
        if o[3] and revenue:
            return scaled_margin(o[3], revenue)
        return float(o[1]) if o[1] else None

    def rpe(self, naics):
        """Revenue per employee for the industry: the admin's figure, else the Census one within RPE_BOUNDS."""
        o = self._override(naics)
        if o and o[0]:
            return float(o[0])
        _, b = lookup(self.bench, naics)
        if not b.get("revenue_per_employee"):
            return None
        return min(RPE_BOUNDS[1], max(RPE_BOUNDS[0], float(b["revenue_per_employee"])))

    def simple(self, naics, employees, as_of):
        """The simple estimate from a headcount counted on date as_of; None without an industry figure."""
        rpe = self.rpe(naics)
        if not rpe or not employees or employees <= 0:
            return None
        years = max(0.0, (datetime.date.today() - as_of).days / 365.25)
        growth = (1 + self.growth) ** years
        revenue = float(employees) * growth * rpe
        margin = self.margin(naics, revenue) or self.irs.margin(naics, revenue)
        lo, hi = SIMPLE_RANGE
        ebitda = revenue * margin
        return {"est_revenue_low": round(revenue * lo), "est_revenue_mid": round(revenue), "est_revenue_high": round(revenue * hi),
                "est_ebitda_low": round(ebitda * lo), "est_ebitda_mid": round(ebitda), "est_ebitda_high": round(ebitda * hi),
                "est_ebitda_margin": round(margin, 4), "est_revenue_by_employees": round(revenue),
                "est_employees": float(employees), "est_count_year": as_of.year, "est_rpe": round(rpe),
                "est_growth": round(growth, 4), "est_growth_rate": self.growth,
                "est_inflation": 1, "est_calibration": 1, "est_tilt": 0}

    def apply_simple(self, cur):
        """PPP businesses with an employee count: the simple estimate from that count (mid-2020)."""
        cur.execute("select biz_key, naics, jobs_reported from stage_biz where est_method = any(%s) "
                    "and coalesce(jobs_reported, '') <> ''", (list(EMPLOYEE_METHODS),))
        updates = []
        for key, naics, jobs in cur.fetchall():
            e = self.simple(naics, float(jobs), PPP_YEAR_MID)
            if e:
                updates.append({**e, "key": key})
        cols = [c for c in (updates[0] if updates else {}) if c != "key"]
        if updates:
            cur.executemany(f"update stage_biz set {', '.join(f'{c} = %({c})s' for c in cols)}, est_method = 'employees', "
                            f"est_confidence = 'medium' where biz_key = %(key)s",
                            [{k: (str(v) if v is not None else None) for k, v in u.items()} for u in updates])
        print(f"Simple estimate: {len(updates):,} businesses from their PPP headcount, grown {self.growth:.0%} a year", flush=True)

    def apply_growth(self, cur):
        """Bring PPP-era staged estimates up to date at the annual growth rate (before calibration, and
        including the raw headcount and payroll figures, so calibration measures the growth too)."""
        cur.execute("select biz_key, est_inflation, est_growth, est_revenue_low, est_revenue_mid, est_revenue_high, "
                    "est_ebitda_low, est_ebitda_mid, est_ebitda_high, est_revenue_by_employees, est_revenue_by_payroll "
                    "from stage_biz where est_method = any(%s)", (list(PPP_ERA),))
        updates = []
        for key, _inflation, job_growth, *vals in cur.fetchall():
            g = self.growth_factor(float(job_growth or 1))
            vals = [round(float(v) * g) if v not in (None, "") else None for v in vals]
            updates.append((*vals, self.growth, key))
        cur.executemany("""update stage_biz set est_revenue_low = %s, est_revenue_mid = %s, est_revenue_high = %s,
                             est_ebitda_low = %s, est_ebitda_mid = %s, est_ebitda_high = %s,
                             est_revenue_by_employees = %s, est_revenue_by_payroll = %s, est_growth_rate = %s
                           where biz_key = %s""", updates)
        print(f"Growth: {len(updates):,} PPP-era estimates brought up to date at {self.growth:.0%} a year", flush=True)

    def apply_stage(self, cur):
        """Calibrate the staged (raw) estimates before they're loaded, then tilt them up their range."""
        cur.execute("select biz_key, naics, is_nonprofit, est_method, est_revenue_low, est_revenue_mid, est_revenue_high, "
                    "est_ebitda_low, est_ebitda_mid, est_ebitda_high from stage_biz where est_method = any(%s)", (list(TILTED),))
        updates, calibrated = [], 0
        for key, naics, nonprofit, method, *vals in cur.fetchall():
            rl, rm, rh, el, em, eh = (float(v) if v not in (None, "") else None for v in vals)
            if rm is None:
                continue
            f, margin = 1.0, None
            if method in CALIBRATED:
                f = self.factor(naics, str(nonprofit).lower() in ("true", "t"))
                margin = self.margin(naics, rm * f)
                calibrated += abs(f - 1) >= 0.005 or margin is not None
            rl, rm, rh = (x * f if x is not None else None for x in (rl, rm, rh))
            if margin is not None:
                # Each end of the range at its own size's margin, where the admin set a margin-by-size scale.
                el, em, eh = (x * (self.margin(naics, x) or margin) if x is not None else None for x in (rl, rm, rh))
            else:
                el, em, eh = (x * f if x is not None else None for x in (el, em, eh))
            rm, em = self.tilted(rm, rh), self.tilted(em, eh)
            updates.append((*(round(x) if x is not None else None for x in (rl, rm, rh, el, em, eh)),
                            round(f, 4), margin, self.tilt, key))
        cur.executemany("""update stage_biz set est_revenue_low = %s, est_revenue_mid = %s, est_revenue_high = %s,
                             est_ebitda_low = %s, est_ebitda_mid = %s, est_ebitda_high = %s, est_calibration = %s,
                             est_ebitda_margin = coalesce(%s::text, est_ebitda_margin), est_tilt = %s
                           where biz_key = %s""", updates)
        print(f"Calibration: {calibrated:,} estimates adjusted; {len(updates):,} moved {self.tilt:.0%} of the way "
              f"up their range", flush=True)
