"""One-off (Nov 4, at the owner's request): Lightle Sand & Construction's owner is David Dollar, not the name
the web search took from its Facebook page. Entered as an owner set by hand (known_owners, as /admin does), which
every load keeps over anything found automatically; the wrong search result is removed.
Run via the DB probe workflow (script: set_owner)."""
import os

import psycopg

ID, NAME, TITLE = 1312636, "David Dollar", "Owner"
url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("select biz_key from businesses where id = %s", (ID,))
    (key,) = cur.fetchone()
    cur.execute("""insert into known_owners (biz_key, owner_name, owner_title, note, updated_at)
                   values (%s, %s, %s, 'Set at the owner''s request (Nov 4)', now())
                   on conflict (biz_key) do update set owner_name = excluded.owner_name, owner_title = excluded.owner_title,
                     note = excluded.note, updated_at = now()""", (key, NAME, TITLE))
    cur.execute("update businesses set owner_name = %s, owner_title = %s, owner_source = null where biz_key = %s", (NAME, TITLE, key))
    cur.execute("delete from business_sources where biz_key = %s and source = 'owner_lookup' and lower(data ->> 'name') <> lower(%s)", (key, NAME))
    print("wrong search results removed:", cur.rowcount)
    cur.execute("select name, owner_name, owner_title from businesses where id = %s", (ID,))
    print("now:", cur.fetchone())
