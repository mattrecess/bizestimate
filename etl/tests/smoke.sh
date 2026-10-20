#!/usr/bin/env bash
# Runs the ETL end to end on fake fixture rows against $DATABASE_URL, offline.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PYTHON:-python3}"; [[ "$PY" == */* ]] && PY="$(cd "$(dirname "$PY")" && pwd)/$(basename "$PY")"
WORK="$(mktemp -d)"
cp -r "$HERE/../../etl" "$HERE/../../db" "$WORK/"
mkdir -p "$WORK/data" "$WORK/fixture"
cp "$HERE/fixture_ppp.csv" "$WORK/fixture/"
# Fake ZIP centroids so geocode.py needs no network.
printf 'GEOID\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG   \n73102\t1\t0\t1\t0\t35.4700\t-97.5200\n74103\t1\t0\t1\t0\t36.1550\t-95.9930\n73069\t1\t0\t1\t0\t35.2200\t-97.4400\n73034\t1\t0\t1\t0\t35.6700\t-97.4500\n' > "$WORK/data/zcta_gazetteer.txt"
cd "$WORK"
"$PY" etl/download_ppp.py --state OK --local fixture
"$PY" etl/build.py --state OK
"$PY" etl/geocode.py
"$PY" etl/load.py --state OK
echo "OK: $WORK"
