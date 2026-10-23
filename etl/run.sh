#!/usr/bin/env bash
# Full pipeline for one state:  DATABASE_URL=... ./etl/run.sh OK [--addresses]
set -euo pipefail
cd "$(dirname "$0")/.."
STATE="${1:-OK}"; GEO_FLAG="${2:-}"
PY="${PYTHON:-python3}"
mkdir -p data/cache   # cached between runs by the workflow
"$PY" etl/migrate.py
"$PY" etl/benchmarks.py --fetch || echo "Using sector-default benchmarks"
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
