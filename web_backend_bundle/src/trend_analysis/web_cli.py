"""CLI for exporting a web-ready current-state payload."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .web_export import WebAnalysisExporter


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export a web-ready 200-bar chart payload from one OHLCV CSV.",
    )
    parser.add_argument("csv_path", type=Path, help="Path to the OHLCV CSV file.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory where the JSON payload and preview chart will be saved.",
    )
    parser.add_argument(
        "--date-column",
        default="date",
        help="Date column name inside the CSV.",
    )
    parser.add_argument(
        "--ticker",
        default=None,
        help="Optional ticker label override.",
    )
    parser.add_argument(
        "--best-params-csv",
        type=Path,
        default=Path("best_params/optimizer_best_params_by_head.csv"),
        help="Optimizer best-params CSV used to build the effective config.",
    )
    parser.add_argument(
        "--use-default-config",
        action="store_true",
        help="Ignore optimizer output and use the package default config.",
    )
    parser.add_argument(
        "--window-bars",
        type=int,
        default=200,
        help="Number of most recent bars to include in the web chart payload.",
    )
    parser.add_argument(
        "--json-only",
        action="store_true",
        help="Print only the artifact JSON summary.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    output_dir = args.output_dir or (args.csv_path.resolve().parent / f"{args.csv_path.stem}_web_export")

    if args.use_default_config or not args.best_params_csv.exists():
        exporter = WebAnalysisExporter()
    else:
        exporter = WebAnalysisExporter.from_best_params_csv(args.best_params_csv)

    artifacts = exporter.export_from_csv(
        csv_path=args.csv_path,
        output_dir=output_dir,
        date_column=args.date_column,
        ticker=args.ticker,
        window_bars=args.window_bars,
    )
    payload = artifacts.to_dict()
    if not args.json_only:
        print(f"Web payload saved to: {artifacts.payload_json}")
        print(f"Chart preview saved to: {artifacts.chart_png}")
        print(f"Summary saved to: {artifacts.summary_md}")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
