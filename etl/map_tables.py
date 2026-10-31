"""Precomputed tables that keep the map and list fast, rebuilt after each load (load.py).

- businesses.est_value_mid: each business's estimated value (EBITDA x the size and industry multiple
  from web/lib/multiples.json, the same figures the site shows), so sorting and filtering by value
  can use an index instead of computing it for every business in view.
- map_points: a slim copy of what the map needs (location, name, industry, revenue, value), about
  1/25th the size of businesses, so a city's pins come from memory.
- map_cells: business counts per ~1 km square (0.01 degree) and sector, so "how many in view"
  is a sum over a few hundred squares instead of a count of every business.

Each table is built under a new name and swapped in, so the site never sees it half-built.
"""
import json
import math
import os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
MULTIPLES = os.path.join(HERE, "..", "web", "lib", "multiples.json")
CELL = 100   # cells per degree
REFERENCE_EBITDA = 1_000_000   # the admin's multiple for an industry is for a company of about this size


def value_sql(overrides=()):
    """SQL for estimated value, mirroring estimateValue() in web/lib/valuation.ts. overrides: the admin's
    (NAICS prefix, multiple) pairs from industry_overrides: the multiple for a company with about $1M of
    EBITDA in that industry, replacing our industry adjustment; the size curve still scales it."""
    with open(MULTIPLES) as f:
        m = json.load(f)
    size = " ".join(f"when est_ebitda_mid >= {floor} then {mult}" for floor, mult in reversed(m["size"]))
    reference = max(mult for floor, mult in m["size"] if floor <= REFERENCE_EBITDA)
    # The admin's industries first (they win over ours whatever the code length), then ours, longest first.
    own = [(p, float(x) / reference) for p, x in sorted(overrides, key=lambda r: -len(r[0]))]
    ind = " ".join(f"when starts_with(naics, '{prefix}') then {round(f, 4)}"
                   for prefix, f in own + sorted(m["industry"], key=lambda r: -len(r[0])))
    multiple = f"round((case {size} else {m['size'][0][1]} end) * (case {ind} else 1 end), 1)"
    return (f"(case when est_ebitda_mid > 0 and not is_nonprofit and not starts_with(coalesce(naics, ''), '5221') "
            f"and not starts_with(coalesce(naics, ''), '813') then round(est_ebitda_mid * {multiple}) end)")


def swap(cur, name):
    cur.execute(f"drop table if exists {name}_old")
    cur.execute(f"alter table if exists {name} rename to {name}_old")
    cur.execute(f"alter table {name}_new rename to {name}")
    cur.execute(f"drop table if exists {name}_old")


COMPS = 6
GRID = 0.1           # degrees: squares for finding neighbors (about 7 miles)
MAX_RING = 8         # squares out (about 50 miles), as getComparables' "nearby" box (web/lib/business.ts)


def nearest(grid, key, b, limit=COMPS):
    """The `limit` nearest others with this NAICS prefix, searching squares outward from the business
    until enough are found (or about 50 miles out)."""
    cx, cy = int(b[3] // GRID), int(b[2] // GRID)
    coslat = math.cos(math.radians(b[2]))
    found = []
    for k in range(MAX_RING + 1):
        for x in range(cx - k, cx + k + 1):
            for y in range(cy - k, cy + k + 1):
                if max(abs(x - cx), abs(y - cy)) != k:
                    continue   # this ring's squares only
                for o in grid.get((key, x, y), ()):
                    if o[0] != b[0]:
                        found.append((math.hypot(o[2] - b[2], (o[3] - b[3]) * coslat), o[0]))
        # Anything in a farther ring is at least k squares away, so stop once enough are closer than that.
        if len([d for d, _ in found if d <= k * GRID]) >= limit:
            break
    return [i for _, i in sorted(found)[:limit]]


def comparables(conn, state):
    """Each business's nearest similar businesses (same 4-digit NAICS, else same sector, within about
    50 miles), worked out here once a night instead of per page view: measuring distances on demand
    took over a minute per page when crawlers were busy."""
    with conn.cursor() as cur:
        cur.execute("""select id, coalesce(naics, ''), lat, lon from businesses
                       where state = %s and lat is not null and length(coalesce(naics, '')) >= 2
                         and est_revenue_mid is not null and coalesce(est_method, '') <> 'branch'""", (state,))
        rows = cur.fetchall()
        grid = defaultdict(list)
        for r in rows:
            for size in (4, 2):
                if len(r[1]) >= size:
                    grid[(r[1][:size], int(r[3] // GRID), int(r[2] // GRID))].append(r)
        out = []
        for b in rows:
            ids = nearest(grid, b[1][:4], b) if len(b[1]) >= 4 else []
            if len(ids) < 3:
                ids = nearest(grid, b[1][:2], b)
            if ids:
                out.append((b[0], ids))
        cur.execute("drop table if exists business_comps_new")
        cur.execute("create table business_comps_new (id bigint primary key, comps bigint[] not null)")
        with cur.copy("copy business_comps_new (id, comps) from stdin") as cp:
            for row in out:
                cp.write_row(row)
        cur.execute("analyze business_comps_new")
        cur.execute("set local lock_timeout = '20s'")
        swap(cur, "business_comps")
        conn.commit()
        print(f"Comparables: nearest similar businesses stored for {len(out):,} businesses", flush=True)


def refresh(conn, state):
    with conn.cursor() as cur:
        cur.execute("select naics_prefix, multiple from industry_overrides where multiple > 0 and naics_prefix ~ '^[0-9]{2,6}$'")
        v = value_sql(cur.fetchall())
        # In batches of ids, each its own transaction: one statement rewriting every row was a lot to ask
        # of the database right after the load had just rewritten them all.
        cur.execute("select min(id), max(id) from businesses where state = %s", (state,))
        lo, hi = cur.fetchone()
        changed = 0
        for start in range(lo or 0, (hi or -1) + 1, 20000):
            cur.execute(f"update businesses set est_value_mid = {v} where state = %s and id >= %s and id < %s "
                        f"and est_value_mid is distinct from {v}", (state, start, start + 20000))
            changed += cur.rowcount
            conn.commit()
        print(f"Map tables: stored values changed for {changed:,} businesses", flush=True)

        cur.execute("drop table if exists map_points_new")
        cur.execute("""
            create table map_points_new as
            select id, lat, lon, name, coalesce(naics, '') as naics, coalesce(est_method, '') as est_method, is_nonprofit,
                   est_revenue_mid, est_value_mid
            from businesses where lat is not null""")
        cur.execute("alter table map_points_new add primary key (id)")
        cur.execute("create index on map_points_new (lat, lon)")
        cur.execute("create index on map_points_new (est_revenue_mid desc nulls last)")
        cur.execute("analyze map_points_new")
        cur.execute("drop table if exists map_cells_new")
        cur.execute(f"""
            create table map_cells_new as
            select floor(lon * {CELL})::int as cx, floor(lat * {CELL})::int as cy, coalesce(left(naics, 2), '') as sector,
                   count(*)::int as n
            from businesses where lat is not null and coalesce(est_method, '') <> 'branch'
            group by 1, 2, 3""")
        cur.execute("create index on map_cells_new (cx, cy)")
        cur.execute("analyze map_cells_new")
        cur.execute("set local lock_timeout = '20s'")
        swap(cur, "map_points")
        swap(cur, "map_cells")
        cur.execute("select (select count(*) from map_points), (select count(*) from map_cells)")
        points, cells = cur.fetchone()
        conn.commit()
        print(f"Map tables: {points:,} map points, {cells:,} map squares", flush=True)
    comparables(conn, state)
