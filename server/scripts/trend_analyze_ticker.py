#!/usr/bin/env python3
"""Analyze one ticker from PostgreSQL and print a web-ready payload JSON."""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path


SERVER_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = SERVER_ROOT if (SERVER_ROOT / "web_backend_bundle").exists() else SERVER_ROOT.parent
BUNDLE_ROOT = PROJECT_ROOT / "web_backend_bundle"
SRC_ROOT = BUNDLE_ROOT / "src"

for candidate in (SERVER_ROOT, PROJECT_ROOT, SRC_ROOT):
    if candidate.exists() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from market_data_store import PostgresDailyPriceStore, normalize_ticker
from trend_analysis.web_export import WebAnalysisExporter


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Analyze one ticker from PostgreSQL and emit a JSON payload for the GA-ML trend analyzer."
    )
    parser.add_argument("ticker", help="Ticker symbol such as AAPL or 005930.")
    parser.add_argument("--market", choices=("auto", "us", "kr"), default="auto")
    parser.add_argument("--rows", type=int, default=260, help="Number of trailing daily rows required from PostgreSQL.")
    parser.add_argument("--window-bars", type=int, default=200, help="Number of trailing bars to emit in the payload.")
    parser.add_argument(
        "--best-params-csv",
        type=Path,
        default=BUNDLE_ROOT / "best_params" / "optimizer_best_params_by_head.csv",
        help="Best-params CSV used to build the effective config.",
    )
    parser.add_argument(
        "--use-default-config",
        action="store_true",
        help="Ignore optimizer output and use the package default config.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    normalized_ticker, resolved_market = normalize_ticker(str(args.ticker).strip(), args.market)
    store = PostgresDailyPriceStore()
    fetch_result = store.fetch_recent_frame(
        normalized_ticker,
        market=resolved_market,
        limit=int(args.rows),
        min_rows=int(args.rows),
    )

    if args.use_default_config or not args.best_params_csv.exists():
        exporter = WebAnalysisExporter()
    else:
        exporter = WebAnalysisExporter.from_best_params_csv(args.best_params_csv)

    with tempfile.TemporaryDirectory(prefix="ga-ml-trend-db-") as temp_dir:
        csv_path = Path(temp_dir) / f"{fetch_result.ticker}.csv"
        frame = fetch_result.frame[["date", "open", "high", "low", "close", "volume"]].copy()
        frame.to_csv(csv_path, index=False)
        payload, _chart_df = exporter.build_payload_from_csv(
            csv_path=csv_path,
            date_column="date",
            ticker=fetch_result.ticker,
            window_bars=int(args.window_bars),
        )

    payload.setdefault("meta", {})
    payload["meta"]["market"] = fetch_result.market
    payload["meta"]["market_data_source"] = "postgres"
    payload["meta"]["stored_rows"] = len(fetch_result.frame)
    payload["meta"]["stored_window_start"] = fetch_result.start_date.isoformat()
    payload["meta"]["stored_window_end"] = fetch_result.end_date.isoformat()
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
