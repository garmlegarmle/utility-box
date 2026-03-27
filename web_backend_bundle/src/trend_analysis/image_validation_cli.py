"""CLI for validating image-based chart analysis from an OHLCV CSV."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .image_validation import ImageValidationRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Render chart images from an OHLCV CSV, run image analysis, and compare against direct CSV analysis.",
    )
    parser.add_argument("csv_path", type=Path, help="Path to the OHLCV CSV file.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory where validation artifacts will be written.",
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
        "--window-bars",
        type=int,
        default=200,
        help="Bars per validation window before rendering the chart image.",
    )
    parser.add_argument(
        "--step-bars",
        type=int,
        default=10,
        help="How many bars to move forward between validation samples.",
    )
    parser.add_argument(
        "--forward-horizons",
        default="5,10,20",
        help="Comma-separated forward-return horizons in bars.",
    )
    parser.add_argument(
        "--max-samples",
        type=int,
        default=None,
        help="Optional cap on the number of validation windows.",
    )
    parser.add_argument(
        "--keep-sample-images",
        action="store_true",
        help="Keep the rendered and annotated sample images under the output directory.",
    )
    parser.add_argument(
        "--chart-style",
        choices=("line", "candlestick", "auto"),
        default="line",
        help="Rendered chart style used for validation images.",
    )
    parser.add_argument(
        "--json-only",
        action="store_true",
        help="Print only the artifact JSON summary.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    output_dir = args.output_dir or (args.csv_path.resolve().parent / f"{args.csv_path.stem}_image_validation")
    horizons = tuple(int(item.strip()) for item in args.forward_horizons.split(",") if item.strip())
    runner = ImageValidationRunner(
        window_bars=args.window_bars,
        step_bars=args.step_bars,
        forward_horizons=horizons,
        keep_sample_images=args.keep_sample_images,
        max_samples=args.max_samples,
        chart_style=args.chart_style,
    )
    artifacts = runner.build_from_csv(
        csv_path=args.csv_path,
        output_dir=output_dir,
        date_column=args.date_column,
        ticker=args.ticker,
    )
    payload = artifacts.to_dict()
    if not args.json_only:
        print(f"Validation CSV saved to: {artifacts.analysis_csv}")
        print(f"Metrics JSON saved to: {artifacts.metrics_json}")
        print(f"Summary saved to: {artifacts.summary_md}")
        if artifacts.sample_images_dir is not None:
            print(f"Sample images saved to: {artifacts.sample_images_dir}")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
