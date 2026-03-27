"""CLI for generating a historical trend-analysis chart and report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .history_report import HistoricalAnalysisReporter


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate a historical price + regime visualization from one OHLCV CSV.",
    )
    parser.add_argument("csv_path", type=Path, help="Path to the OHLCV CSV file.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory where the chart, CSV, and summary files will be saved.",
    )
    parser.add_argument(
        "--date-column",
        default="date",
        help="Date column name inside the CSV.",
    )
    parser.add_argument(
        "--ticker",
        default=None,
        help="Optional ticker label override for the chart title and output names.",
    )
    parser.add_argument(
        "--best-params-csv",
        type=Path,
        default=Path("optimizer_output/optimizer_best_params_by_head.csv"),
        help="Optimizer best-params CSV used to build the effective analysis config.",
    )
    parser.add_argument(
        "--use-default-config",
        action="store_true",
        help="Ignore optimizer output and build the report with the package default config.",
    )
    parser.add_argument(
        "--rolling-match-window",
        type=int,
        default=60,
        help="Rolling window length for match-rate panels.",
    )
    parser.add_argument(
        "--json-only",
        action="store_true",
        help="Print only the artifact JSON summary.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    output_dir = args.output_dir or (args.csv_path.resolve().parent / f"{args.csv_path.stem}_history_report")

    if args.use_default_config or not args.best_params_csv.exists():
        reporter = HistoricalAnalysisReporter(rolling_match_window=args.rolling_match_window)
    else:
        reporter = HistoricalAnalysisReporter.from_best_params_csv(
            best_params_csv=args.best_params_csv,
            rolling_match_window=args.rolling_match_window,
        )

    artifacts = reporter.build_from_csv(
        csv_path=args.csv_path,
        output_dir=output_dir,
        date_column=args.date_column,
        ticker=args.ticker,
    )
    payload = artifacts.to_dict()
    if not args.json_only:
        print(f"Chart saved to: {artifacts.chart_png}")
        print(f"Analysis CSV saved to: {artifacts.analysis_csv}")
        print(f"Summary saved to: {artifacts.summary_md}")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
