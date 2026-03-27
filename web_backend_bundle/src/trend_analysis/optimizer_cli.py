"""Command-line entry point for the walk-forward optimizer."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from .optimizer import DEFAULT_OPTIMIZER_TICKERS, OptimizationSettings, TrendParameterOptimizer


class CliProgressReporter:
    """Render optimizer progress to stderr."""

    def __init__(self) -> None:
        self.started_at = time.time()
        self.last_bar_length = 0
        self.active_bar = False

    def handle_event(self, event: dict[str, Any]) -> None:
        event_type = str(event.get("type", "message"))
        if event_type == "trial_progress":
            self._render_progress(event)
            return
        if self.active_bar:
            self._clear_progress_line()
        message = str(event.get("message", "")).strip()
        if message:
            self._write_line(message)

    def finish(self) -> None:
        if self.active_bar:
            self._clear_progress_line()
            self._write_line("Optimization finished.")

    def _render_progress(self, event: dict[str, Any]) -> None:
        completed = int(event.get("completed", 0))
        total = max(1, int(event.get("total", 1)))
        stage_name = str(event.get("stage_name", "stage"))
        ratio = completed / total
        bar_width = 28
        filled = min(bar_width, int(round(ratio * bar_width)))
        bar = f"[{'#' * filled}{'-' * (bar_width - filled)}]"
        elapsed = max(0.0, time.time() - self.started_at)
        eta = (elapsed / completed) * (total - completed) if completed > 0 else 0.0
        line = (
            f"{bar} {completed}/{total} "
            f"{stage_name:<13} "
            f"{ratio * 100:5.1f}% "
            f"elapsed {self._format_seconds(elapsed)} "
            f"eta {self._format_seconds(eta)} "
            f"dir {float(event.get('direction_quality', 0.0)):.3f} "
            f"trn {float(event.get('transition_quality', 0.0)):.3f} "
            f"conf {float(event.get('confidence_quality', 0.0)):.3f}"
        )
        self._write_progress(line)

    def _write_progress(self, line: str) -> None:
        padded = line
        if self.last_bar_length > len(line):
            padded += " " * (self.last_bar_length - len(line))
        sys.stderr.write(f"\r{padded}")
        sys.stderr.flush()
        self.last_bar_length = len(line)
        self.active_bar = True

    def _clear_progress_line(self) -> None:
        sys.stderr.write("\r" + (" " * self.last_bar_length) + "\r")
        sys.stderr.flush()
        self.last_bar_length = 0
        self.active_bar = False

    @staticmethod
    def _write_line(message: str) -> None:
        sys.stderr.write(f"{message}\n")
        sys.stderr.flush()

    @staticmethod
    def _format_seconds(value: float) -> str:
        seconds = max(0, int(round(value)))
        minutes, secs = divmod(seconds, 60)
        hours, minutes = divmod(minutes, 60)
        if hours > 0:
            return f"{hours:02d}:{minutes:02d}:{secs:02d}"
        return f"{minutes:02d}:{secs:02d}"


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""

    parser = argparse.ArgumentParser(
        description=(
            "Download 10 years of daily OHLCV data, run walk-forward parameter optimization, "
            "and save CSV outputs."
        )
    )
    parser.add_argument(
        "output_dir",
        nargs="?",
        default="optimizer_output",
        help="Directory where downloads and optimizer CSV files will be saved.",
    )
    parser.add_argument(
        "--trials",
        type=int,
        default=OptimizationSettings().max_trials,
        help="Per-stage random-search trial count for stage 1 and stage 2.",
    )
    parser.add_argument(
        "--tickers",
        default=",".join(DEFAULT_OPTIMIZER_TICKERS),
        help="Comma-separated ticker list. Default uses the ETF basket configured for the optimizer.",
    )
    parser.add_argument("--period", default="10y", help="Yahoo Finance history period. Default: 10y")
    parser.add_argument("--train-days", type=int, default=OptimizationSettings().train_days)
    parser.add_argument("--validation-days", type=int, default=OptimizationSettings().validation_days)
    parser.add_argument("--test-days", type=int, default=OptimizationSettings().test_days)
    parser.add_argument("--purge-days", type=int, default=OptimizationSettings().purge_days)
    parser.add_argument("--step-days", type=int, default=OptimizationSettings().step_days)
    parser.add_argument("--lookback-bars", type=int, default=OptimizationSettings().lookback_bars)
    parser.add_argument("--random-seed", type=int, default=OptimizationSettings().random_seed)
    parser.add_argument("--stage2-seed", type=int, default=OptimizationSettings().stage2_seed)
    parser.add_argument(
        "--top-candidates",
        type=int,
        default=OptimizationSettings().top_candidates_per_head,
        help="Top candidates per head retained after combining stage 1 and stage 2.",
    )
    parser.add_argument(
        "--local-trials",
        type=int,
        default=OptimizationSettings().local_search_trials,
        help="Stage 4 local neighborhood-search trial count.",
    )
    parser.add_argument("--local-seed", type=int, default=OptimizationSettings().local_search_seed)
    parser.add_argument(
        "--jobs",
        default="auto",
        help="Parallel worker count. Use 'auto' to use available CPU cores minus one, or pass an integer.",
    )
    parser.add_argument(
        "--max-wfo-folds",
        type=int,
        default=None,
        help="Optional cap on the number of most recent walk-forward folds to use.",
    )
    return parser


def main() -> None:
    """Run the optimizer from the command line."""

    parser = build_parser()
    args = parser.parse_args()

    tickers = tuple(part.strip().upper() for part in args.tickers.split(",") if part.strip())
    if not tickers:
        raise SystemExit("At least one ticker is required.")
    if args.trials <= 0:
        raise SystemExit("--trials must be greater than zero.")
    if args.top_candidates <= 0:
        raise SystemExit("--top-candidates must be greater than zero.")
    if args.local_trials < 0:
        raise SystemExit("--local-trials must be zero or greater.")
    jobs = _resolve_jobs(args.jobs)

    settings = OptimizationSettings(
        tickers=tickers,
        period=args.period,
        lookback_bars=args.lookback_bars,
        step_days=args.step_days,
        train_days=args.train_days,
        validation_days=args.validation_days,
        test_days=args.test_days,
        purge_days=args.purge_days,
        max_wfo_folds=args.max_wfo_folds,
        max_trials=args.trials,
        stage2_seed=args.stage2_seed,
        top_candidates_per_head=args.top_candidates,
        local_search_trials=args.local_trials,
        local_search_seed=args.local_seed,
        parallel_jobs=jobs,
        random_seed=args.random_seed,
    )

    reporter = CliProgressReporter()
    optimizer = TrendParameterOptimizer(settings=settings, progress_event_callback=reporter.handle_event)
    try:
        artifacts = optimizer.run(Path(args.output_dir))
    finally:
        reporter.finish()
    print(json.dumps(artifacts.to_dict(), indent=2))


def _resolve_jobs(raw_value: str) -> int:
    normalized = raw_value.strip().lower()
    if normalized == "auto":
        cpu_count = os.cpu_count() or 1
        return max(1, cpu_count - 1)
    jobs = int(normalized)
    if jobs <= 0:
        raise SystemExit("--jobs must be greater than zero.")
    return jobs


if __name__ == "__main__":
    main()
