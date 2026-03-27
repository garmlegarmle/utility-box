"""CLI for generating a markdown draft from validation artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .validation_report import ValidationReportBuilder


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate a report-ready markdown draft from a batch image validation output directory.",
    )
    parser.add_argument("validation_dir", type=Path, help="Directory containing batch image validation artifacts.")
    parser.add_argument("--primary-horizon", type=int, default=10, help="Forward horizon used for the report tables.")
    parser.add_argument("--min-pattern-samples", type=int, default=20, help="Minimum sample size for pattern-level interpretation.")
    parser.add_argument("--json-only", action="store_true", help="Print only the artifact JSON payload.")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    builder = ValidationReportBuilder(
        primary_horizon=args.primary_horizon,
        min_pattern_samples=args.min_pattern_samples,
    )
    artifacts = builder.build(args.validation_dir)
    payload = artifacts.to_dict()
    if not args.json_only:
        print(f"Report markdown saved to: {artifacts.report_md}")
        print(f"Report HTML saved to: {artifacts.report_html}")
        print(f"Image pattern usefulness CSV saved to: {artifacts.image_pattern_usefulness_csv}")
        print(f"CSV pattern usefulness CSV saved to: {artifacts.csv_pattern_usefulness_csv}")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
