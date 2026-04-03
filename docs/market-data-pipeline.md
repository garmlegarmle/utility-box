# Market Data Pipeline

This repo now supports a daily OHLCV pipeline where GitHub Actions collects market data, uploads the collected CSV bundle to the VPS over SSH, and the VPS imports that bundle into PostgreSQL. The ticker-based analysis services then read from PostgreSQL instead of calling public market-data APIs from the VPS.

The ticker flow for both `Trend Analyzer` and `Chart Interpretation` is now:

1. Check PostgreSQL for the requested ticker
2. If the ticker is missing, too short, or stale, dispatch a GitHub Actions sync for that ticker
3. Wait for the workflow to finish
4. Trim stored rows down to the latest `260`
5. Run the analysis from PostgreSQL

## What was added

- Workflows:
  - `.github/workflows/market-data-kr.yml`
  - `.github/workflows/market-data-us.yml`
- Collector script:
  - `scripts/sync_market_data.py`
- VPS import script:
  - `scripts/import_market_data_csv.py`
- Shared Python DB module:
  - `market_data_store/postgres.py`
- Market-data schema SQL:
  - `server/sql/market_data.pg.sql`
- Server bootstrap schema:
  - `server/sql/schema.pg.sql`
- Ticker analysis DB switch:
  - `server/scripts/chart_interpretation_run.py`

## PostgreSQL tables

Two daily OHLCV tables are created:

- `us_equity_daily`
- `kr_equity_daily`

Columns:

- `ticker`
- `trade_date`
- `open`
- `high`
- `low`
- `close`
- `volume`
- `created_at`
- `updated_at`

Each table uses `PRIMARY KEY (ticker, trade_date)`, so repeated inserts become upserts.

## GitHub setup

### 1. Add GitHub Secrets

Add these repository secrets:

- `MARKET_DATA_VPS_HOST`
- `MARKET_DATA_VPS_USER`
- `MARKET_DATA_VPS_SSH_KEY`

Use an SSH key that is authorized on the VPS account that can run `docker exec` against `utility-box-api`.

The workflow uploads CSV files to `/tmp/ga-ml-market-data/...` on the VPS and then imports them inside the API container with:

```bash
docker exec utility-box-api /opt/trend-analyzer-venv/bin/python /app/scripts/import_market_data_csv.py ...
```

This avoids exposing PostgreSQL publicly. GitHub Actions never talks to the Docker-internal `utility-box-db` host directly.

### 2. Add GitHub Variables

Add repository variables for ticker universes:

- `MARKET_DATA_US_TICKERS`
- `MARKET_DATA_KR_TICKERS`
- `MARKET_DATA_VPS_PORT` (optional, defaults to `22`)

Use comma, space, or newline separated values.

Example:

```text
AAPL,MSFT,NVDA,SPY,QQQ
```

```text
005930,000660,035420,068270
```

### 3. Workflow schedule

The workflows are already scheduled in UTC:

- Korea close: `0 7 * * 1-5`
  - 16:00 KST
- US close: `0 22 * * 1-5`
  - 07:00 KST next day

Both workflows also support manual `workflow_dispatch`.

For on-demand server-triggered syncs, the workflows also accept:

- `request_id`
- `retain_max_rows`
- `initial_lookback_days`

## VPS / service setup

If the Node API and the market-data tables share the same PostgreSQL database, nothing special is required beyond `DATABASE_URL`.

If market data should live in a different PostgreSQL database, set:

- `MARKET_DATA_DATABASE_URL`

in the API environment on the VPS.

Example in `deploy/vps/env/utility-box.api.env`:

```text
DATABASE_URL=postgres://utilitybox:change-me@utility-box-db:5432/utility_box
MARKET_DATA_DATABASE_URL=postgres://utilitybox:change-me@utility-box-db:5432/utility_box
MARKET_DATA_RETAIN_ROWS=260
MARKET_DATA_INITIAL_LOOKBACK_DAYS=730
MARKET_DATA_MAX_STALENESS_DAYS=5
MARKET_DATA_GITHUB_TOKEN=github_pat_xxx
MARKET_DATA_GITHUB_OWNER=garmlegarmle
MARKET_DATA_GITHUB_REPO=GA-ML
MARKET_DATA_GITHUB_REF=main
MARKET_DATA_US_WORKFLOW=market-data-us.yml
MARKET_DATA_KR_WORKFLOW=market-data-kr.yml
MARKET_DATA_GITHUB_TIMEOUT_MS=120000
MARKET_DATA_GITHUB_POLL_MS=4000
```

The shared Python DB module resolves the connection string in this order:

1. `MARKET_DATA_DATABASE_URL`
2. `DATABASE_URL`

`MARKET_DATA_GITHUB_TOKEN` must be a token that can dispatch workflows on the repository.
In practice that means a PAT or fine-grained token with repository Actions write access.

## Manual backfill

You can backfill or rerun manually from the repo root:

```bash
python scripts/sync_market_data.py \
  --market us \
  --tickers "AAPL MSFT NVDA SPY" \
  --database-url "$MARKET_DATA_DATABASE_URL"
```

```bash
python scripts/sync_market_data.py \
  --market kr \
  --tickers "005930 000660 035420" \
  --database-url "$MARKET_DATA_DATABASE_URL"
```

You can also collect CSV files without DB access:

```bash
python scripts/sync_market_data.py \
  --market us \
  --tickers "AAPL MSFT" \
  --skip-db \
  --output-dir /tmp/market-data-us
```

And import an uploaded CSV bundle on the VPS:

```bash
/opt/trend-analyzer-venv/bin/python /app/scripts/import_market_data_csv.py \
  --market us \
  --input-dir /tmp/ga-ml-market-data/us-manual \
  --retain-max-rows 260
```

Behavior:

- If a ticker has no rows yet, the script backfills roughly the last 730 calendar days.
- If a ticker already exists, the script refetches from `latest_trade_date - 10 days` and upserts.
- After each sync, rows older than the most recent `260` trading sessions for that ticker are deleted.
- Each ticker is retried up to 3 times before the run fails.
- In GitHub Actions, the collector runs in `--skip-db --output-dir ...` mode and the VPS importer performs the actual upsert.

## How the analysis service now reads from DB

`server/scripts/chart_interpretation_run.py` and `server/scripts/trend_analyze_ticker.py`
no longer download ticker data directly in ticker mode.

They now:

1. Reads the latest 260 daily rows from PostgreSQL
2. Infers market automatically from the ticker
   - `005930` / `005930.KS` / `005930.KQ` -> `kr`
   - everything else -> `us`
3. If needed, asks GitHub Actions to sync that ticker first
4. Trims stored history back down to `260` rows
5. Runs the analysis on the DB-backed dataframe

CSV upload mode is unchanged.

## Importing the Python DB module

Other Python services can import the shared DB reader directly:

```python
from market_data_store import PostgresDailyPriceStore

store = PostgresDailyPriceStore()
result = store.fetch_recent_frame("AAPL", market="us", limit=260, min_rows=260)
frame = result.frame
```

For Korean tickers:

```python
result = store.fetch_recent_frame("005930", market="kr", limit=260, min_rows=260)
```

Returned dataframe columns:

- `date`
- `open`
- `high`
- `low`
- `close`
- `volume`

## Notes

- The market-data collector applies `server/sql/market_data.pg.sql` automatically before syncing.
- The server bootstrap also includes the same tables inside `server/sql/schema.pg.sql`.
- `chart_interpretation_run.py` now depends on PostgreSQL-backed data for ticker mode. If neither `MARKET_DATA_DATABASE_URL` nor `DATABASE_URL` is set, ticker analysis will fail fast.
