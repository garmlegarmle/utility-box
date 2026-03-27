"""CLI for downloading unseen holdout samples and evaluating the current model."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .holdout_validation import HoldoutValidationRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download unseen ETFs/stocks and evaluate the current trend model on them.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("optimizer_output/holdout_validation"),
        help="Directory where downloads, reports, and charts will be written.",
    )
    parser.add_argument(
        "--best-params-csv",
        type=Path,
        default=Path("optimizer_output/optimizer_best_params_by_head.csv"),
        help="Optimizer best-params CSV used to build the effective config.",
    )
    parser.add_argument(
        "--period",
        default="10y",
        help="Yahoo Finance download period. Default: 10y",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    runner = HoldoutValidationRunner(
        best_params_csv=args.best_params_csv,
        period=args.period,
    )
    artifacts = runner.run(args.output_dir)
    print(json.dumps(artifacts.to_dict(), indent=2))


if __name__ == "__main__":
    main()
