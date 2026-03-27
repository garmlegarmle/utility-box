"""CLI for batch image validation across a directory of OHLCV CSV files."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .batch_image_validation import BatchImageValidationRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run rolling image-vs-CSV pattern validation across every OHLCV CSV in a directory.",
    )
    parser.add_argument("csv_dir", type=Path, help="Directory containing OHLCV CSV files.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory where batch validation artifacts will be written.",
    )
    parser.add_argument(
        "--date-column",
        default="date",
        help="Date column name inside the CSV files.",
    )
    parser.add_argument(
        "--glob",
        default="*.csv",
        help="Glob pattern used to select CSV files inside the directory.",
    )
    parser.add_argument(
        "--window-bars",
        type=int,
        default=140,
        help="Bars per validation window. Default matches the pattern analysis window.",
    )
    parser.add_argument(
        "--step-bars",
        type=int,
        default=20,
        help="How many bars to move forward between validation samples.",
    )
    parser.add_argument(
        "--forward-horizons",
        default="5,10,20",
        help="Comma-separated forward-return horizons in bars.",
    )
    parser.add_argument(
        "--max-samples-per-file",
        type=int,
        default=None,
        help="Optional cap on the number of rolling windows evaluated per CSV.",
    )
    parser.add_argument(
        "--chart-styles",
        default="line,candlestick",
        help="Comma-separated chart styles to validate. Supported: line,candlestick.",
    )
    parser.add_argument(
        "--keep-sample-images",
        action="store_true",
        help="Keep the rendered and annotated sample images under the output directory.",
    )
    parser.add_argument(
        "--json-only",
        action="store_true",
        help="Print only the artifact JSON summary.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    output_dir = args.output_dir or (args.csv_dir.resolve().parent / f"{args.csv_dir.name}_image_validation_batch")
    horizons = tuple(int(item.strip()) for item in args.forward_horizons.split(",") if item.strip())
    chart_styles = tuple(item.strip() for item in args.chart_styles.split(",") if item.strip())
    runner = BatchImageValidationRunner(
        window_bars=args.window_bars,
        step_bars=args.step_bars,
        forward_horizons=horizons,
        keep_sample_images=args.keep_sample_images,
        max_samples_per_file=args.max_samples_per_file,
        chart_styles=chart_styles,
    )
    artifacts = runner.build_from_directory(
        csv_dir=args.csv_dir,
        output_dir=output_dir,
        date_column=args.date_column,
        glob=args.glob,
    )
    payload = artifacts.to_dict()
    if not args.json_only:
        print(f"All samples CSV saved to: {artifacts.all_samples_csv}")
        print(f"File summary CSV saved to: {artifacts.file_summary_csv}")
        print(f"CSV pattern performance saved to: {artifacts.csv_pattern_performance_csv}")
        print(f"Image pattern performance saved to: {artifacts.image_pattern_performance_csv}")
        print(f"Pattern recognition CSV saved to: {artifacts.pattern_recognition_csv}")
        print(f"Pattern confusion CSV saved to: {artifacts.pattern_confusion_csv}")
        print(f"Metrics JSON saved to: {artifacts.metrics_json}")
        print(f"Summary saved to: {artifacts.summary_md}")
        if artifacts.sample_images_dir is not None:
            print(f"Sample images saved to: {artifacts.sample_images_dir}")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
