"""Read-only health report: database size, the biggest tables with their dead rows and last vacuum,
and memory settings. Run via the DB probe workflow (script: db_health)."""
import os
import psycopg

url = os.environ["DATABASE_URL"].strip().strip("'\"")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("set statement_timeout = '60s'")
    cur.execute("select pg_size_pretty(pg_database_size(current_database()))")
    print("database size:", cur.fetchone()[0])
    for k in ("shared_buffers", "effective_cache_size", "work_mem", "max_connections"):
        cur.execute(f"show {k}")
        print(f"{k}: {cur.fetchone()[0]}")
    cur.execute("""
        select relname, pg_size_pretty(pg_total_relation_size(relid)), pg_size_pretty(pg_relation_size(relid)),
               n_live_tup, n_dead_tup, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
        from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 15""")
    print("\ntable | total | heap | live | dead | last vacuum | last autovacuum | last analyze | last autoanalyze")
    for r in cur.fetchall():
        print(" | ".join(str(x) for x in r))
    cur.execute("select count(*) from pg_stat_activity where state = 'active'")
    print("\nactive queries:", cur.fetchone()[0])
