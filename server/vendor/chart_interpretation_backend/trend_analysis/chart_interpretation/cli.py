"""CLI for the chart interpretation engine."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .engine import ChartInterpretationEngine


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Interpret one OHLCV CSV and export analysis artifacts.")
    parser.add_argument("csv_path", type=Path, help="CSV path with timestamp, open, high, low, close, volume.")
    parser.add_argument("--output-dir", type=Path, default=Path("chart_interpretation_output"), help="Output directory for artifacts.")
    parser.add_argument("--title", default=None, help="Optional chart title override.")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    engine = ChartInterpretationEngine()
    artifacts = engine.export_csv(args.csv_path, args.output_dir, title=args.title)
    print(json.dumps(artifacts.to_dict(), indent=2))


if __name__ == "__main__":
    main()
