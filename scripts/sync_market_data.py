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
    rows_upserted: int
    start_date: date
    end_date: date


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
    parser.add_argument("--initial-lookback-days", type=int, default=730)
    parser.add_argument("--overlap-days", type=int, default=10)
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


def sync_one_ticker(
    store: PostgresDailyPriceStore,
    *,
    market: MarketCode,
    raw_ticker: str,
    end_date: date,
    initial_lookback_days: int,
    overlap_days: int,
    retries: int,
    retry_delay_seconds: float,
) -> SyncSummary:
    normalized_ticker, _resolved_market = normalize_ticker(raw_ticker, market)
    collector = collector_for_market(market)

    def work() -> SyncSummary:
        latest_date = store.latest_trade_date(market, normalized_ticker)
        fetch_start = start_date_for_sync(
            latest_date,
            end_date=end_date,
            initial_lookback_days=initial_lookback_days,
            overlap_days=overlap_days,
        )
        frame = collector.fetch(normalized_ticker, fetch_start, end_date)
        rows_upserted = store.upsert_frame(market, normalized_ticker, frame)
        cleaned = store.prepare_frame(frame)
        return SyncSummary(
            market=market,
            ticker=normalized_ticker,
            rows_upserted=rows_upserted,
            start_date=pd.Timestamp(cleaned.index.min()).date(),
            end_date=pd.Timestamp(cleaned.index.max()).date(),
        )

    return with_retries(work, retries=max(1, retries), retry_delay_seconds=max(0.5, retry_delay_seconds))


def main() -> None:
    args = parse_args()
    market: MarketCode = args.market
    tickers = parse_tickers(args.tickers)
    if not tickers:
        raise SystemExit("Provide tickers via --tickers or the workflow env.")

    store = PostgresDailyPriceStore(args.database_url)
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
                initial_lookback_days=args.initial_lookback_days,
                overlap_days=args.overlap_days,
                retries=args.retries,
                retry_delay_seconds=args.retry_delay_seconds,
            )
            successes.append(summary)
            print(
                f"[ok] market={summary.market} ticker={summary.ticker} "
                f"rows_upserted={summary.rows_upserted} window={summary.start_date.isoformat()}..{summary.end_date.isoformat()}"
            )
        except Exception as error:  # noqa: BLE001
            failures.append((raw_ticker, str(error)))
            print(f"[fail] market={market} ticker={raw_ticker} error={error}", file=sys.stderr)

    print(f"[summary] market={market} success={len(successes)} failed={len(failures)}")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
