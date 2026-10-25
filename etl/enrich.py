"""Shared plumbing for public-record sources (SEC, Form 990, FDIC, SBA loans, contracts, ...).

Each source module fetches its records, matches them to listed businesses (matching.match_entities)
and calls save() with one JSON object per business. Profiles show those objects; sources that report
actual revenue also feed apply_reported(), which replaces our estimate with the reported figure.
"""
import json

from benchmarks import load_benchmarks, lookup
from margins import Margins

# Sources whose "revenue" is the business's own reported figure, most trusted first.
REPORTED = ["sec", "fdic", "ncua", "irs990"]
REPORTED_RANGE = (0.95, 1.05)


def businesses(cur, state):
    cur.execute("select biz_key, name, coalesce(address, ''), coalesce(city, ''), coalesce(zip, '') "
                "from businesses where state = %s", (state,))
    return [dict(zip(["biz_key", "name", "address", "city", "zip"], r)) for r in cur.fetchall()]


def save(cur, state, source, rows):
    """Replace one source's records for a state: rows = {biz_key: dict}."""
    # Concurrent runs (full pipeline and a quick workflow) take turns.
    cur.execute("lock table business_sources in share row exclusive mode")
    cur.execute("delete from business_sources s where s.source = %s and not exists "
                "(select 1 from businesses b where b.biz_key = s.biz_key and b.state <> %s)", (source, state))
    with cur.copy("copy business_sources (biz_key, source, data) from stdin") as cp:
        for key, data in rows.items():
            cp.write_row((key, source, json.dumps(data, default=str)))
    print(f"{source}: saved records for {len(rows):,} businesses", flush=True)


def apply_reported(cur, state):
    """Use reported revenue (SEC, bank call reports, Form 990) in place of our estimate."""
    cur.execute("""
        select distinct on (s.biz_key) s.biz_key, s.source, s.data, b.naics, b.est_method, b.est_revenue_mid
        from business_sources s join businesses b on b.biz_key = s.biz_key
        where b.state = %s and s.source = any(%s) and (s.data ->> 'revenue') is not null
          and coalesce(b.est_method, '') <> 'verified'   -- figures we've been told and may show win
        order by s.biz_key, array_position(%s, s.source)""", (state, REPORTED, REPORTED))
    margins, bench = Margins(), load_benchmarks()
    lo, hi = REPORTED_RANGE
    updates = []
    for key, source, data, naics, method, cur_rev in cur.fetchall():
        revenue = float(data["revenue"])
        if revenue <= 0:
            continue
        if data.get("ebitda") is not None:
            ebitda = float(data["ebitda"])
        else:
            ebitda = revenue * margins.margin(naics, revenue)
        if method == "reported" and cur_rev is not None and round(float(cur_rev)) == round(revenue):
            continue
        updates.append((round(revenue * lo), round(revenue), round(revenue * hi),
                        round(ebitda * lo), round(ebitda), round(ebitda * hi),
                        round(ebitda / revenue, 4), key))
    cur.executemany("""
        update businesses set est_revenue_low = %s, est_revenue_mid = %s, est_revenue_high = %s,
            est_ebitda_low = %s, est_ebitda_mid = %s, est_ebitda_high = %s, est_ebitda_margin = %s,
            est_method = 'reported', est_confidence = 'high'
        where biz_key = %s""", updates)
    print(f"Reported financials applied: {len(updates):,} updated", flush=True)


def apply_known(cur, state):
    """Figures we've been told and may show (known_financials.is_public) replace the estimate.
    Private ones change nothing on the site; they're only used to measure accuracy."""
    cur.execute("""
        update businesses b set
            est_revenue_low = k.revenue, est_revenue_mid = k.revenue, est_revenue_high = k.revenue,
            est_ebitda_low = k.ebitda, est_ebitda_mid = k.ebitda, est_ebitda_high = k.ebitda,
            est_ebitda_margin = case when k.revenue > 0 then round(k.ebitda / k.revenue, 4) end,
            est_method = 'verified', est_confidence = 'high'
        from known_financials k
        where k.biz_key = b.biz_key and k.is_public and k.revenue is not null and k.ebitda is not null
          and b.state = %s""", (state,))
    print(f"Verified figures applied: {cur.rowcount:,}", flush=True)


# Roles that make someone the owner for our purposes, best first.
OWNER_ROLES = ["owner", "co-owner", "founder", "co-founder", "president", "ceo", "chief executive", "principal", "managing partner"]


def _owner_rank(title):
    t = (title or "").lower()
    return next((i for i, r in enumerate(OWNER_ROLES) if r in t), None)


def apply_owners(cur, state):
    """Fill in owners we don't have from people found since the load: the company's own website
    (website_profile team) and Google search results (owner_search). Never overwrites an owner."""
    cur.execute("""
        select b.biz_key, s.source, s.data from businesses b
        join business_sources s on s.biz_key = b.biz_key and s.source in ('owner_search', 'website_profile', 'people_search')
        where b.state = %s and coalesce(b.owner_name, '') = ''""", (state,))
    best = {}
    for key, source, data in cur.fetchall():
        if source == "owner_search" and data.get("name"):
            cands = [(-1, data["name"], data.get("title") or "Owner", data.get("url"))]   # asked for the owner directly
        else:
            people = data.get("team") or data.get("people") or []
            cands = [(r, p["name"], p["title"], p.get("url")) for p in people
                     if (r := _owner_rank(p.get("title"))) is not None]
        for c in cands:
            if key not in best or c[0] < best[key][0]:
                best[key] = c
    cur.executemany("update businesses set owner_name = %s, owner_title = %s, owner_source = %s where biz_key = %s",
                    [(name, title[:60], url, key) for key, (_, name, title, url) in best.items()])
    print(f"Owners filled from websites and search results: {len(best):,}", flush=True)


def state_get(cur, key, default):
    cur.execute("select value from etl_state where key = %s", (key,))
    row = cur.fetchone()
    return row[0] if row else default


def state_set(cur, key, value):
    """Saved and committed at once, so an interrupted run never loses it (e.g. paid-for results)."""
    cur.execute("insert into etl_state (key, value, updated_at) values (%s, %s, now()) "
                "on conflict (key) do update set value = excluded.value, updated_at = now()",
                (key, json.dumps(value, default=str)))
    cur.connection.commit()


def label(naics):
    return lookup(load_benchmarks(), naics or "")[1]["label"]
