"""Read-only: where one business's owner and leadership names came from (edit ID). Names, titles and source
links only, no contact details (the log is public). Run via the DB probe workflow (script: people_probe)."""
import json
import os

import psycopg

ID = 1312636
url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("select biz_key, name, owner_name, owner_title, owner_source from businesses where id = %s", (ID,))
    key, *row = cur.fetchone()
    print("business:", row)
    cur.execute("select owner_name, owner_title from known_owners where biz_key = %s", (key,))
    print("entered by hand:", cur.fetchall())
    cur.execute("select source, data from business_sources where biz_key = %s and source in "
                "('owner_search', 'owner_lookup', 'leadership_lookup', 'website_profile', 'people_search', 'irs990_people', 'form5500_people')", (key,))
    for source, data in cur.fetchall():
        people = data.get("people") or data.get("team") or data.get("officers") or ([data] if data.get("name") else [])
        signer = data.get("signer")
        if signer:
            people = people + [signer]
        print(source, json.dumps([{k: p.get(k) for k in ("name", "title", "url", "year") if p.get(k)} for p in people])[:1500])
