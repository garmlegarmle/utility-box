#!/usr/bin/env python3
"""Fetch daily OHLCV data and upsert it into PostgreSQL."""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from market_data_store import MarketCode, PostgresDailyPriceStore, normalize_ticker


MARKET_TIMEZONES: dict[MarketCode, str] = {
    "us": "America/New_York",
    "kr": "Asia/Seoul",
}


@dataclass(slots=True)
class SyncSummary:
    market: MarketCode
    ticker: str
    row_count: int
    rows_upserted: int
    start_date: date
    end_date: date
    output_path: Path | None = None


class YahooFinanceCollector:
    def fetch(self, ticker: str, start_date: date, end_date: date) -> pd.DataFrame:
        import yfinance as yf

        exclusive_end = end_date + timedelta(days=1)
        frame = yf.download(
            tickers=ticker,
            start=start_date.isoformat(),
            end=exclusive_end.isoformat(),
            interval="1d",
            auto_adjust=False,
            progress=False,
            threads=False,
        )
        if frame is None or frame.empty:
            raise ValueError(f"No OHLCV rows returned by yfinance for {ticker}.")

        if isinstance(frame.columns, pd.MultiIndex):
            frame.columns = frame.columns.get_level_values(0)

        prepared = frame.copy()
        prepared.columns = [str(column).strip().lower().replace(" ", "_") for column in prepared.columns]
        prepared.index = pd.to_datetime(prepared.index, errors="coerce")
        prepared.index.name = "date"
        prepared = prepared.rename(columns={"adjclose": "adj_close", "adj_close": "adj_close"})
        return prepared.reset_index()[["date", "open", "high", "low", "close", "volume"]]


class PykrxCollector:
    def fetch(self, ticker: str, start_date: date, end_date: date) -> pd.DataFrame:
        from pykrx import stock

        frame = stock.get_market_ohlcv_by_date(
            fromdate=start_date.strftime("%Y%m%d"),
            todate=end_date.strftime("%Y%m%d"),
            ticker=ticker,
            adjusted=False,
        )
        if frame is None or frame.empty:
            raise ValueError(f"No OHLCV rows returned by pykrx for {ticker}.")

        prepared = frame.copy()
        prepared.index = pd.to_datetime(prepared.index, errors="coerce")
        prepared.index.name = "date"
        prepared = prepared.rename(
            columns={
                "시가": "open",
                "고가": "high",
                "저가": "low",
                "종가": "close",
                "거래량": "volume",
            }
        )
        return prepared.reset_index()[["date", "open", "high", "low", "close", "volume"]]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch market data and upsert it into PostgreSQL.")
    parser.add_argument("--market", choices=("us", "kr"), required=True)
    parser.add_argument("--tickers", default="", help="Comma, space, or newline separated tickers.")
    parser.add_argument("--database-url", default=os.getenv("MARKET_DATA_DATABASE_URL") or os.getenv("DATABASE_URL") or "")
    parser.add_argument("--schema-path", default=str(PROJECT_ROOT / "server" / "sql" / "market_data.pg.sql"))
    parser.add_argument("--output-dir", default="", help="Optional directory to export one cleaned CSV per ticker.")
    parser.add_argument("--skip-db", action="store_true", help="Collect/export without writing to PostgreSQL.")
    parser.add_argument("--initial-lookback-days", type=int, default=730)
    parser.add_argument("--overlap-days", type=int, default=10)
    parser.add_argument("--retain-max-rows", type=int, default=int(os.getenv("MARKET_DATA_RETAIN_MAX_ROWS", "260")))
    parser.add_argument("--retries", type=int, default=int(os.getenv("MARKET_DATA_FETCH_RETRIES", "3")))
    parser.add_argument("--retry-delay-seconds", type=float, default=2.0)
    return parser.parse_args()


def parse_tickers(raw: str) -> list[str]:
    values: list[str] = []
    for chunk in str(raw or "").replace(",", "\n").splitlines():
        for item in chunk.split():
            normalized = item.strip()
            if normalized:
                values.append(normalized)
    deduped: list[str] = []
    seen = set()
    for value in values:
        key = value.upper()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(value)
    return deduped


def current_market_date(market: MarketCode) -> date:
    timezone = ZoneInfo(MARKET_TIMEZONES[market])
    return datetime.now(timezone).date()


def start_date_for_sync(
    latest_date: date | None,
    *,
    end_date: date,
    initial_lookback_days: int,
    overlap_days: int,
) -> date:
    if latest_date is None:
        return end_date - timedelta(days=initial_lookback_days)
    candidate = latest_date - timedelta(days=max(overlap_days, 0))
    return min(candidate, end_date)


def with_retries(operation, *, retries: int, retry_delay_seconds: float):
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            return operation()
        except Exception as error:  # noqa: BLE001
            last_error = error
            if attempt >= retries:
                break
            time.sleep(retry_delay_seconds * attempt)
    if last_error is None:
        raise RuntimeError("Retry loop ended without a result or exception.")
    raise last_error


def collector_for_market(market: MarketCode):
    return YahooFinanceCollector() if market == "us" else PykrxCollector()


def write_export_csv(output_dir: Path, ticker: str, frame: pd.DataFrame) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    export_frame = frame.reset_index().rename(columns={frame.index.name or "index": "date"})
    export_frame["date"] = pd.to_datetime(export_frame["date"], errors="coerce").dt.date.astype(str)
    output_path = output_dir / f"{ticker}.csv"
    export_frame.to_csv(output_path, index=False)
    return output_path


def sync_one_ticker(
    store: PostgresDailyPriceStore | None,
    *,
    market: MarketCode,
    raw_ticker: str,
    end_date: date,
    output_dir: Path | None,
    initial_lookback_days: int,
    overlap_days: int,
    retain_max_rows: int,
    retries: int,
    retry_delay_seconds: float,
) -> SyncSummary:
    normalized_ticker, _resolved_market = normalize_ticker(raw_ticker, market)
    collector = collector_for_market(market)

    def work() -> SyncSummary:
        latest_date = store.latest_trade_date(market, normalized_ticker) if store is not None else None
        fetch_start = start_date_for_sync(
            latest_date,
            end_date=end_date,
            initial_lookback_days=initial_lookback_days,
            overlap_days=overlap_days,
        )
        frame = collector.fetch(normalized_ticker, fetch_start, end_date)
        cleaned = PostgresDailyPriceStore.prepare_frame(frame)
        rows_upserted = 0
        if store is not None:
            rows_upserted = store.upsert_frame(market, normalized_ticker, cleaned)
            store.trim_to_recent_rows(market, normalized_ticker, retain_max_rows)
        output_path = write_export_csv(output_dir, normalized_ticker, cleaned) if output_dir is not None else None
        return SyncSummary(
            market=market,
            ticker=normalized_ticker,
            row_count=len(cleaned),
            rows_upserted=rows_upserted,
            start_date=pd.Timestamp(cleaned.index.min()).date(),
            end_date=pd.Timestamp(cleaned.index.max()).date(),
            output_path=output_path,
        )

    return with_retries(work, retries=max(1, retries), retry_delay_seconds=max(0.5, retry_delay_seconds))


def main() -> None:
    args = parse_args()
    market: MarketCode = args.market
    tickers = parse_tickers(args.tickers)
    if not tickers:
        raise SystemExit("Provide tickers via --tickers or the workflow env.")

    output_dir = Path(args.output_dir).expanduser().resolve() if str(args.output_dir or "").strip() else None
    use_database = bool(str(args.database_url or "").strip()) and not args.skip_db
    if not use_database and output_dir is None:
        raise SystemExit("Provide --database-url or --output-dir when collecting market data.")

    store = PostgresDailyPriceStore(args.database_url) if use_database else None
    if store is not None:
        store.apply_schema(args.schema_path)
    end_date = current_market_date(market)

    successes: list[SyncSummary] = []
    failures: list[tuple[str, str]] = []
    for raw_ticker in tickers:
        try:
            summary = sync_one_ticker(
                store,
                market=market,
                raw_ticker=raw_ticker,
                end_date=end_date,
                output_dir=output_dir,
                initial_lookback_days=args.initial_lookback_days,
                overlap_days=args.overlap_days,
                retain_max_rows=args.retain_max_rows,
                retries=args.retries,
                retry_delay_seconds=args.retry_delay_seconds,
            )
            successes.append(summary)
            detail_parts = [
                f"[ok] market={summary.market}",
                f"ticker={summary.ticker}",
                f"rows={summary.row_count}",
                f"rows_upserted={summary.rows_upserted}",
                f"window={summary.start_date.isoformat()}..{summary.end_date.isoformat()}",
            ]
            if summary.output_path is not None:
                detail_parts.append(f"csv={summary.output_path}")
            print(" ".join(detail_parts))
        except Exception as error:  # noqa: BLE001
            failures.append((raw_ticker, str(error)))
            print(f"[fail] market={market} ticker={raw_ticker} error={error}", file=sys.stderr)

    print(f"[summary] market={market} success={len(successes)} failed={len(failures)}")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
