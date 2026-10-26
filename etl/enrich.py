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


# "Likely to sell": points per signal, summed and capped at 100.
SELL_POINTS = {"age40": 30, "age25": 22, "age15": 12, "founder": 20, "no_successor": 10, "shrinking": 15,
               "next_gen": -10, "sold": -40}


def _years_in_business(src):
    years = [y for y in ((src.get("founded") or {}).get("year"), (src.get("fdic") or {}).get("founded"),
                         (src.get("fmcsa") or {}).get("registered"), (src.get("website_profile") or {}).get("founded_year"))
             if isinstance(y, int) and 1850 < y <= 2026]
    return min(years) if years else None


def _parts(name):
    words = [w for w in (name or "").upper().replace(".", " ").split() if len(w) > 1 and w not in ("JR", "SR", "II", "III")]
    return (words[0], words[-1]) if len(words) >= 2 else None


def sell_signals(row, src, headcounts, this_year):
    """(score, [signal text]) for one business, or (None, []) where it doesn't apply."""
    if row["is_nonprofit"] or row["est_method"] == "branch" or src.get("sec") or src.get("fdic") or src.get("ncua") or src.get("irs990"):
        return None, []
    points, signals = 0, []
    founded = _years_in_business(src)
    age = this_year - founded if founded else None
    if age is not None:
        key = "age40" if age >= 40 else "age25" if age >= 25 else "age15" if age >= 15 else None
        if key:
            points += SELL_POINTS[key]
            signals.append(f"In business {age} years (since {founded})")
    profile = src.get("website_profile") or {}
    owner, founder = _parts(row["owner_name"]), _parts(profile.get("founder"))
    founder_led = (owner and founder and owner == founder) or (row["owner_title"] or "").lower().startswith("founder")
    if founder_led and age and age >= 20:
        points += SELL_POINTS["founder"]
        signals.append(f"Founder still runs it after {age} years")
    team = [p for p in profile.get("team") or [] if _parts(p.get("name"))]
    if owner and team:
        family = [p for p in team if _parts(p["name"])[1] == owner[1] and _parts(p["name"])[0] != owner[0]]
        if family:
            points += SELL_POINTS["next_gen"]
            signals.append(f"Family in the business ({family[0]['name']}, {family[0]['title']})")
        elif age and age >= 25:
            points += SELL_POINTS["no_successor"]
            signals.append("No family successor named on its website")
    if len(headcounts) >= 2:
        latest_year, latest = headcounts[-1]
        peak_year, peak = max(headcounts[:-1], key=lambda h: h[1])
        if peak >= 10 and latest <= 0.8 * peak and latest_year - peak_year <= 4:
            points += SELL_POINTS["shrinking"]
            signals.append(f"Headcount down {round(100 * (1 - latest / peak))}% since {peak_year} (retirement plan filings)")
    changed = (src.get("sba") or {}).get("ownership_change_year")
    if changed and this_year - int(changed) <= 5:
        points += SELL_POINTS["sold"]
        signals.append(f"Changed hands recently (SBA-financed purchase, FY{changed})")
    if not signals:
        return None, []
    return max(0, min(100, points)), signals


def apply_signals(cur, state):
    """Score every business for signs it may sell soon (age, founder-led, no successor, shrinking)."""
    import datetime
    this_year = datetime.date.today().year
    cur.execute("""
        select b.biz_key, b.owner_name, b.owner_title, b.is_nonprofit, coalesce(b.est_method, ''),
               (select jsonb_object_agg(s.source, s.data) from business_sources s where s.biz_key = b.biz_key),
               (select jsonb_agg(jsonb_build_array(h.year, h.employees) order by h.year) from headcounts h
                where h.biz_key = b.biz_key and h.source = 'form5500'),
               b.sell_score
        from businesses b where b.state = %s""", (state,))
    rows = cur.fetchall()
    counts = {"scored": 0, "high": 0}
    cur.execute("create temp table sell_stage (biz_key text primary key, score smallint, signals jsonb) on commit drop")
    with cur.copy("copy sell_stage (biz_key, score, signals) from stdin") as cp:
        for key, owner, title, nonprofit, method, src, heads, old in rows:
            row = {"owner_name": owner, "owner_title": title, "is_nonprofit": nonprofit, "est_method": method}
            score, signals = sell_signals(row, src or {}, [tuple(h) for h in heads or []], this_year)
            counts["scored"] += score is not None
            counts["high"] += (score or 0) >= 40
            if score is not None or old is not None:
                cp.write_row((key, score, json.dumps(signals) if signals else None))
    cur.execute("""update businesses b set sell_score = t.score, sell_signals = t.signals from sell_stage t
                   where b.biz_key = t.biz_key and (b.sell_score, b.sell_signals) is distinct from (t.score, t.signals)""")
    print(f"Sell signals: {counts['scored']:,} businesses scored, {counts['high']:,} at 40+ ({cur.rowcount:,} changed)", flush=True)
