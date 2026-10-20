#!/usr/bin/env bash
# Full pipeline for one state:  DATABASE_URL=... ./etl/run.sh OK [--addresses]
set -euo pipefail
cd "$(dirname "$0")/.."
STATE="${1:-OK}"; GEO_FLAG="${2:-}"
PY="${PYTHON:-python3}"
"$PY" etl/benchmarks.py --fetch || echo "Using sector-default benchmarks"
"$PY" etl/download_ppp.py --state "$STATE"
"$PY" etl/build.py --state "$STATE"
"$PY" etl/geocode.py $GEO_FLAG
"$PY" etl/load.py --state "$STATE"
