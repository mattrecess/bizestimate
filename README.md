# BizEstimate — "Zillow for businesses" (Oklahoma first)

Map and search of Oklahoma businesses with estimated revenue and EBITDA, derived from public SBA PPP loan data.

```
etl/   Python pipeline: download PPP data → estimate → geocode → load into Postgres
db/    Postgres schema (works on Supabase)
web/   Next.js app: map + list explorer, business pages, JSON API, claim/removal form
```

## How the estimates work

1. **Payroll.** A PPP loan was 2.5× average monthly payroll (3.5× for second-draw loans in NAICS 72), so annual payroll ≈ `loan ÷ 2.5 × 12`. A business's first-draw loan is preferred because it was sized on 2019 payroll.
2. **Revenue** = payroll ÷ the industry's payroll-to-revenue ratio (Economic Census, matched on the most specific NAICS prefix available).
3. **EBITDA** = revenue × the industry's EBITDA margin.
4. **Sole proprietors and the self-employed** were sized on owner profit, so the annualized amount is treated as owner earnings (≈ EBITDA), and revenue assumes a 30% net margin. Their street addresses are never shown, and their map pins sit at a ZIP-code centroid.

The ranges and margins are set in `etl/build.py` and `etl/benchmarks.py`. The built-in sector ratios are **rounded approximations**. `benchmarks.py --fetch` replaces them with exact Census figures; `run.sh` does this automatically.

## Launch steps

### 1. Database (Supabase, ~5 min)
1. Create a project at supabase.com.
2. Go to **Connect** and copy two connection strings:
   - **Session pooler** (port 5432): used by the ETL
   - **Transaction pooler** (port 6543): used by the web app on Vercel

### 2. Load Oklahoma data
**Option A — GitHub Actions (no local setup).** Push this repo to GitHub and add the repository secret `DATABASE_URL` (the session pooler string). Then go to **Actions → Load PPP data → Run workflow** with state `OK`.

**Option B — your machine:**
```bash
python3 -m venv .venv && .venv/bin/pip install -r etl/requirements.txt
DATABASE_URL="postgresql://..." PYTHON=.venv/bin/python ./etl/run.sh OK --addresses
```
Drop `--addresses` for a quick run that uses ZIP centroids only. Street-level geocoding uses the free Census batch geocoder (10k addresses per request) and can take an hour or more.

If data.sba.gov is slow, download the CSVs from https://data.sba.gov/dataset/ppp-foia yourself and run `python etl/download_ppp.py --state OK --local <dir>`, followed by the remaining steps from `run.sh`.

### 3. Web app (Vercel, ~5 min)
1. Import the repo on vercel.com and set **Root Directory** to `web`.
2. Add the environment variable `DATABASE_URL` (the transaction pooler string).
3. Deploy, then add your domain.

Local dev: `cd web && npm install && echo 'DATABASE_URL=...' > .env.local && npm run dev`

The map uses free OpenFreeMap tiles. To change the look, set `NEXT_PUBLIC_MAP_STYLE` to another MapLibre style URL.

## API

| Endpoint | Description |
|---|---|
| `GET /api/businesses` | `q`, `sector`, `city`, `min_rev`, `max_rev`, `bbox=w,s,e,n`, `sort` (`revenue_desc` \| `revenue_asc` \| `ebitda_desc` \| `jobs_desc` \| `name`), `limit` (≤200), `offset` |
| `GET /api/businesses/:id` | Business details, PPP loans and the benchmark used |
| `GET /api/points` | GeoJSON for the map (same filters, top 5,000 by revenue) |
| `POST /api/claims` | `{business_id, contact_name, contact_email, reported_revenue?, reported_ebitda?, message?, request_removal?}` |

## Testing
`DATABASE_URL=... PYTHON=.venv/bin/python etl/tests/smoke.sh` runs the full ETL offline on fake fixture rows.

## Before going public
- Review the `claims` table regularly, and honor removal requests by deleting the business.
- Add rate limiting (e.g. Vercel firewall rules) so the dataset can't be scraped wholesale.
- Every figure is labeled as an estimate. Keep it that way.
