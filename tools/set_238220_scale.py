"""One-off (Nov 3, at the owner's request): NAICS 238220's EBITDA margin by company size: 14% at $500K of
EBITDA, 18% at $1M, 24% at $5M, 30% at $10M. Same field the /admin/industries scale form writes; the
single 18% margin stays as the fallback. Run via the DB probe workflow (script: set_238220_scale)."""
import json
import os

import psycopg

SCALE = [[500000, 0.14], [1000000, 0.18], [5000000, 0.24], [10000000, 0.30]]
url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("alter table industry_overrides add column if not exists margin_scale jsonb")
    cur.execute("""insert into industry_overrides (naics_prefix, ebitda_margin, margin_scale, updated_at)
                   values ('238220', 0.18, %s, now())
                   on conflict (naics_prefix) do update set margin_scale = excluded.margin_scale, updated_at = now()""",
                (json.dumps(SCALE),))
    cur.execute("select naics_prefix, ebitda_margin, margin_scale from industry_overrides where naics_prefix = '238220'")
    print("industry_overrides:", cur.fetchone())
