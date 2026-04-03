#!/usr/bin/env python3
"""Run the chart interpretation bundle and emit a web-ready JSON payload."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


SERVER_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = SERVER_ROOT.parent
BACKEND_ROOT = Path(
    os.environ.get(
        "CHART_INTERPRETATION_BACKEND_ROOT",
        SERVER_ROOT / "vendor" / "chart_interpretation_backend",
    )
).resolve()

if not BACKEND_ROOT.exists():
    raise SystemExit(f"Chart interpretation backend directory is missing: {BACKEND_ROOT}")

for candidate in (SERVER_ROOT, PROJECT_ROOT, BACKEND_ROOT):
    if candidate.exists() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from market_data_store import PostgresDailyPriceStore
from trend_analysis.chart_interpretation.engine import ChartInterpretationEngine


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the bundled chart interpretation engine for ticker or CSV input."
    )
    subparsers = parser.add_subparsers(dest="mode", required=True)

    ticker_parser = subparsers.add_parser("ticker", help="Read one ticker from PostgreSQL and generate chart interpretation artifacts.")
    ticker_parser.add_argument("ticker", help="Ticker symbol such as AAPL or BTC-USD.")
    ticker_parser.add_argument("--output-dir", type=Path, required=True, help="Directory where artifacts will be written.")
    ticker_parser.add_argument("--market", choices=("auto", "us", "kr"), default="auto")
    ticker_parser.add_argument("--rows", type=int, default=260, help="Number of recent daily rows to read from PostgreSQL.")

    csv_parser = subparsers.add_parser("csv", help="Analyze one uploaded CSV and generate chart interpretation artifacts.")
    csv_parser.add_argument("csv_path", type=Path, help="Path to the OHLCV CSV file.")
    csv_parser.add_argument("--title", default=None, help="Optional title override for the exported artifacts.")
    csv_parser.add_argument("--output-dir", type=Path, required=True, help="Directory where artifacts will be written.")

    return parser


def export_ticker_from_postgres(
    engine: ChartInterpretationEngine,
    *,
    ticker: str,
    market: str,
    output_dir: Path,
    rows: int,
) -> tuple[object, str]:
    store = PostgresDailyPriceStore()
    fetch_result = store.fetch_recent_frame(ticker, market=market, limit=rows, min_rows=rows)
    prepared = engine.preprocessor.prepare_frame(fetch_result.frame)
    analysis = engine.analyze_frame(prepared.frame, preprocessing=prepared.diagnostics)
    analysis.modules.setdefault(
        "market_data_source",
        {
            "source": "postgres",
            "market": fetch_result.market,
            "ticker": fetch_result.ticker,
            "rows": len(fetch_result.frame),
            "start_date": fetch_result.start_date.isoformat(),
            "end_date": fetch_result.end_date.isoformat(),
        },
    )
    indicator_frame = engine.trend_engine.compute_indicator_frame(prepared.frame)
    artifacts = engine.renderer.export(indicator_frame, analysis, output_dir, fetch_result.ticker)
    return artifacts, fetch_result.ticker


def main() -> None:
    args = build_parser().parse_args()
    engine = ChartInterpretationEngine()

    if args.mode == "ticker":
        artifacts, label = export_ticker_from_postgres(
            engine,
            ticker=str(args.ticker).strip(),
            market=str(args.market).strip().lower(),
            output_dir=args.output_dir,
            rows=int(args.rows),
        )
    else:
        artifacts = engine.export_csv(
            path=args.csv_path,
            output_dir=args.output_dir,
            title=args.title or args.csv_path.stem,
        )
        label = str(args.title or args.csv_path.stem).strip()

    payload = json.loads(artifacts.analysis_json.read_text(encoding="utf-8"))
    print(
        json.dumps(
            {
                "label": label,
                "artifacts": {
                    "analysis_json": str(artifacts.analysis_json.resolve()),
                    "chart_png": str(artifacts.chart_png.resolve()),
                    "report_html": str(artifacts.report_html.resolve()),
                },
                "analysis": payload,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
