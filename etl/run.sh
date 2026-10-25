#!/usr/bin/env bash
# Full pipeline for one state:  DATABASE_URL=... ./etl/run.sh OK [--addresses]
set -euo pipefail
cd "$(dirname "$0")/.."
STATE="${1:-OK}"; GEO_FLAG="${2:-}"
PY="${PYTHON:-python3}"
mkdir -p data/cache   # cached between runs by the workflow
"$PY" etl/migrate.py
"$PY" etl/margins.py --fetch || echo "IRS margins unavailable; using the last saved ones or sector defaults"
# Early: it only needs businesses already in the database, so headcounts land within minutes.
"$PY" etl/form5500.py --state "$STATE" || echo "Form 5500 step failed (non-fatal)"
# Public records (nonprofits, banks, SEC, SBA loans, contracts, DOT, years in business); each non-fatal.
# Steps marked "paid" run only in the Public records workflow, so nothing is looked up twice.
for m in $(grep -v '^#' etl/sources.txt | grep -v ' paid' | awk '{print $1}'); do
  "$PY" "etl/$m.py" --state "$STATE" || echo "$m failed (non-fatal)"
done
"$PY" etl/benchmarks.py --fetch --state "$STATE" || echo "Using sector-default benchmarks"
"$PY" etl/download_ppp.py --state "$STATE"
"$PY" etl/build.py --state "$STATE"
"$PY" etl/geocode.py $GEO_FLAG
"$PY" etl/places_only.py --state "$STATE" || echo "places-only step failed (non-fatal)"
"$PY" etl/websites.py || echo "website check failed (non-fatal)"
"$PY" etl/owners.py || echo "owner scan failed (non-fatal)"
"$PY" etl/owners_ai.py || echo "AI owner lookup failed (non-fatal)"
"$PY" etl/owners_search.py || echo "search owner lookup failed (non-fatal)"
"$PY" etl/diagnose.py --state "$STATE" || echo "diagnose failed (non-fatal)"
"$PY" etl/load.py --state "$STATE"
