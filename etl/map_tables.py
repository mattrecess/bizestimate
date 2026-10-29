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
import os

HERE = os.path.dirname(os.path.abspath(__file__))
MULTIPLES = os.path.join(HERE, "..", "web", "lib", "multiples.json")
CELL = 100   # cells per degree


def value_sql():
    """SQL for estimated value, mirroring estimateValue() in web/lib/valuation.ts."""
    with open(MULTIPLES) as f:
        m = json.load(f)
    size = " ".join(f"when est_ebitda_mid >= {floor} then {mult}" for floor, mult in reversed(m["size"]))
    ind = " ".join(f"when starts_with(naics, '{prefix}') then {f}"
                   for prefix, f in sorted(m["industry"], key=lambda r: -len(r[0])))
    multiple = f"round((case {size} else {m['size'][0][1]} end) * (case {ind} else 1 end), 1)"
    return (f"(case when est_ebitda_mid > 0 and not is_nonprofit and not starts_with(coalesce(naics, ''), '5221') "
            f"and not starts_with(coalesce(naics, ''), '813') then round(est_ebitda_mid * {multiple}) end)")


def swap(cur, name):
    cur.execute(f"drop table if exists {name}_old")
    cur.execute(f"alter table if exists {name} rename to {name}_old")
    cur.execute(f"alter table {name}_new rename to {name}")
    cur.execute(f"drop table if exists {name}_old")


def refresh(conn, state):
    with conn.cursor() as cur:
        v = value_sql()
        cur.execute(f"update businesses set est_value_mid = {v} where state = %s and est_value_mid is distinct from {v}", (state,))
        print(f"Map tables: stored values changed for {cur.rowcount:,} businesses", flush=True)
        conn.commit()

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
