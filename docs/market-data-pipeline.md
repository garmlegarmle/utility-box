# Market Data Pipeline

This repo now supports a daily OHLCV pipeline where GitHub Actions collects market data and upserts it into PostgreSQL, and the ticker-based chart analysis service reads from PostgreSQL instead of calling public market-data APIs from the VPS.

## What was added

- Workflows:
  - `.github/workflows/market-data-kr.yml`
  - `.github/workflows/market-data-us.yml`
- Collector script:
  - `scripts/sync_market_data.py`
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

### 1. Add GitHub Secret

Add this repository secret:

- `MARKET_DATA_DATABASE_URL`

Use a PostgreSQL connection string that can reach the VPS database from GitHub Actions, for example:

```text
postgres://utilitybox:password@your-vps-ip:5432/utility_box
```

If PostgreSQL is not exposed publicly, allow access only from trusted IP ranges or use a tunnel/VPN. GitHub Actions still needs network reachability to the database endpoint.

### 2. Add GitHub Variables

Add repository variables for ticker universes:

- `MARKET_DATA_US_TICKERS`
- `MARKET_DATA_KR_TICKERS`

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

## VPS / service setup

If the Node API and the market-data tables share the same PostgreSQL database, nothing special is required beyond `DATABASE_URL`.

If market data should live in a different PostgreSQL database, set:

- `MARKET_DATA_DATABASE_URL`

in the API environment on the VPS.

Example in `deploy/vps/env/utility-box.api.env`:

```text
DATABASE_URL=postgres://utilitybox:change-me@utility-box-db:5432/utility_box
MARKET_DATA_DATABASE_URL=postgres://utilitybox:change-me@utility-box-db:5432/utility_box
```

The shared Python DB module resolves the connection string in this order:

1. `MARKET_DATA_DATABASE_URL`
2. `DATABASE_URL`

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

Behavior:

- If a ticker has no rows yet, the script backfills roughly the last 730 calendar days.
- If a ticker already exists, the script refetches from `latest_trade_date - 10 days` and upserts.
- Each ticker is retried up to 3 times before the run fails.

## How the analysis service now reads from DB

`server/scripts/chart_interpretation_run.py` no longer downloads ticker data directly in ticker mode.

It now:

1. Reads the latest 260 daily rows from PostgreSQL
2. Infers market automatically from the ticker
   - `005930` / `005930.KS` / `005930.KQ` -> `kr`
   - everything else -> `us`
3. Runs chart interpretation on the DB-backed dataframe

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
