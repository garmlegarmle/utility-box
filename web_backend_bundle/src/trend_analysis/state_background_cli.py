"""CLI for batch rendering trend-state background charts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .state_background_chart import TrendStateBackgroundChartRenderer


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Render one price chart per ticker with daily trend-state background shading.",
    )
    parser.add_argument(
        "input_path",
        type=Path,
        nargs="?",
        default=Path("optimizer_output/downloads"),
        help="CSV file or directory containing OHLCV CSV files.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("optimizer_output/state_background_charts"),
        help="Directory where rendered charts will be written.",
    )
    parser.add_argument(
        "--date-column",
        default="date",
        help="Date column name inside the CSV.",
    )
    parser.add_argument(
        "--pattern",
        default="*_daily_10y.csv",
        help="Glob pattern used when input_path is a directory.",
    )
    parser.add_argument(
        "--ticker",
        default=None,
        help="Optional ticker label override when rendering one CSV.",
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
        help="Ignore optimizer output and render with the package default config.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()

    if args.use_default_config or not args.best_params_csv.exists():
        renderer = TrendStateBackgroundChartRenderer()
    else:
        renderer = TrendStateBackgroundChartRenderer.from_best_params_csv(args.best_params_csv)

    if args.input_path.is_dir():
        artifacts = renderer.build_from_directory(
            input_dir=args.input_path,
            output_dir=args.output_dir,
            pattern=args.pattern,
            date_column=args.date_column,
        )
        print(json.dumps(artifacts.to_dict(), indent=2))
        return

    chart_path = renderer.build_from_csv(
        csv_path=args.input_path,
        output_dir=args.output_dir,
        date_column=args.date_column,
        ticker=args.ticker,
    )
    print(json.dumps({"chart_path": str(chart_path)}, indent=2))


if __name__ == "__main__":
    main()
