"""Command-line interface for the trend analysis engine."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .config import EngineConfig
from .engine import TrendAnalysisEngine


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""

    parser = argparse.ArgumentParser(
        description="Analyze a daily OHLCV CSV file and classify the current trend regime.",
    )
    parser.add_argument("csv_path", type=Path, help="Path to the OHLCV CSV file.")
    parser.add_argument(
        "--date-column",
        default="date",
        help="Column name to parse as the datetime index if the CSV index is not already datetime.",
    )
    parser.add_argument(
        "--language",
        default="en",
        help="Summary language key. v1 ships with English templates by default.",
    )
    parser.add_argument(
        "--json-only",
        action="store_true",
        help="Print only the JSON result.",
    )
    return parser


def main() -> None:
    """CLI entry point."""

    args = build_parser().parse_args()
    config = EngineConfig()
    config.summary.language = args.language

    engine = TrendAnalysisEngine(config)
    result = engine.analyze_csv(args.csv_path, date_column=args.date_column)
    payload = result.to_dict()

    if not args.json_only:
        print(result.summary_text)
        if result.pattern_analysis is not None:
            print(result.pattern_analysis.summary_text_ko)
    print(json.dumps(payload, indent=2, default=str))


if __name__ == "__main__":
    main()
