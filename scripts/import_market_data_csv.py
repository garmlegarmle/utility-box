#!/usr/bin/env python3
"""Import collected OHLCV CSV files into PostgreSQL."""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from market_data_store import MarketCode, PostgresDailyPriceStore, normalize_ticker


@dataclass(slots=True)
class ImportSummary:
    market: MarketCode
    ticker: str
    rows_upserted: int
    rows_loaded: int
    source_path: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import OHLCV CSV files into PostgreSQL.")
    parser.add_argument("--market", choices=("us", "kr"), required=True)
    parser.add_argument("--input-dir", required=True, help="Directory containing one CSV per ticker.")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL") or os.getenv("MARKET_DATA_DATABASE_URL") or "")
    parser.add_argument("--schema-path", default=str(PROJECT_ROOT / "server" / "sql" / "market_data.pg.sql"))
    parser.add_argument("--retain-max-rows", type=int, default=int(os.getenv("MARKET_DATA_RETAIN_MAX_ROWS", "260")))
    return parser.parse_args()


def discover_csv_files(input_dir: Path) -> list[Path]:
    return sorted(path for path in input_dir.glob("*.csv") if path.is_file())


def import_one_csv(
    store: PostgresDailyPriceStore,
    *,
    market: MarketCode,
    csv_path: Path,
    retain_max_rows: int,
) -> ImportSummary:
    normalized_ticker, _resolved_market = normalize_ticker(csv_path.stem, market)
    frame = pd.read_csv(csv_path)
    cleaned = PostgresDailyPriceStore.prepare_frame(frame)
    rows_upserted = store.upsert_frame(market, normalized_ticker, cleaned)
    store.trim_to_recent_rows(market, normalized_ticker, retain_max_rows)
    return ImportSummary(
        market=market,
        ticker=normalized_ticker,
        rows_upserted=rows_upserted,
        rows_loaded=len(cleaned),
        source_path=csv_path,
    )


def main() -> None:
    args = parse_args()
    input_dir = Path(args.input_dir).expanduser().resolve()
    if not input_dir.is_dir():
        raise SystemExit(f"Input directory does not exist: {input_dir}")

    csv_files = discover_csv_files(input_dir)
    if not csv_files:
        raise SystemExit(f"No CSV files found in {input_dir}")

    store = PostgresDailyPriceStore(args.database_url)
    store.apply_schema(args.schema_path)

    successes: list[ImportSummary] = []
    failures: list[tuple[str, str]] = []
    for csv_path in csv_files:
        try:
            summary = import_one_csv(
                store,
                market=args.market,
                csv_path=csv_path,
                retain_max_rows=args.retain_max_rows,
            )
            successes.append(summary)
            print(
                f"[ok] market={summary.market} ticker={summary.ticker} "
                f"rows_loaded={summary.rows_loaded} rows_upserted={summary.rows_upserted} source={summary.source_path.name}"
            )
        except Exception as error:  # noqa: BLE001
            failures.append((csv_path.name, str(error)))
            print(f"[fail] market={args.market} file={csv_path.name} error={error}", file=sys.stderr)

    print(f"[summary] market={args.market} success={len(successes)} failed={len(failures)}")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
