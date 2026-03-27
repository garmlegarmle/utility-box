"""Walk-forward parameter optimizer for the trend analysis engine."""

from __future__ import annotations

import copy
import json
import os
import random
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

from .classifier import RegimeClassifier
from .config import EngineConfig
from .data import MarketDataHandler
from .downloader import DownloadRequest, YahooFinanceDownloader
from .features import FeatureEngine
from .indicators import IndicatorEngine
from .scoring import ScoringEngine
from .transition_probability import StateTransitionCalibrator

DEFAULT_OPTIMIZER_TICKERS = (
    "SPY",
    "QQQ",
    "SOXX",
    "XLC",
    "XLY",
    "XLP",
    "XLE",
    "XLF",
    "XLV",
    "XLI",
    "XLB",
    "XLRE",
    "XLK",
    "XLU",
)


@dataclass(slots=True)
class OptimizationSettings:
    """Runtime settings for walk-forward optimization."""

    tickers: tuple[str, ...] = DEFAULT_OPTIMIZER_TICKERS
    period: str = "10y"
    lookback_bars: int = 200
    step_days: int = 1
    direction_horizons: tuple[int, int] = (5, 10)
    direction_horizon_weights: tuple[float, float] = (0.60, 0.40)
    transition_horizon: int = 10
    train_days: int = 756
    validation_days: int = 126
    test_days: int = 252
    purge_days: int = 20
    max_wfo_folds: int | None = None
    max_trials: int = 512
    stage2_seed: int = 123
    top_candidates_per_head: int = 15
    local_search_trials: int = 320
    local_search_seed: int = 777
    parallel_jobs: int = 1
    random_seed: int = 42
    direction_strong_atr: float = 1.50
    direction_weak_atr: float = 0.50
    transition_adverse_atr: float = 1.00
    transition_top_fraction: float = 0.20
    state_transition_calibration_bins: int = 6
    confidence_top_fraction: float = 0.30
    selection_median_weight: float = 0.50
    selection_mean_weight: float = 0.30
    selection_worst_weight: float = 0.20


@dataclass(slots=True)
class OptimizationArtifacts:
    """Paths to the generated optimization result files."""

    output_dir: Path
    downloads_dir: Path
    trials_csv: Path
    fold_scores_csv: Path
    best_params_csv: Path
    summary_csv: Path
    manifest_csv: Path
    stage1_trials_csv: Path
    stage2_trials_csv: Path
    stage3_candidates_csv: Path
    stage4_trials_csv: Path
    family_comparison_csv: Path
    state_transition_calibration_csv: Path
    report_md: Path

    def to_dict(self) -> dict[str, str]:
        return {
            "output_dir": str(self.output_dir),
            "downloads_dir": str(self.downloads_dir),
            "trials_csv": str(self.trials_csv),
            "fold_scores_csv": str(self.fold_scores_csv),
            "best_params_csv": str(self.best_params_csv),
            "summary_csv": str(self.summary_csv),
            "manifest_csv": str(self.manifest_csv),
            "stage1_trials_csv": str(self.stage1_trials_csv),
            "stage2_trials_csv": str(self.stage2_trials_csv),
            "stage3_candidates_csv": str(self.stage3_candidates_csv),
            "stage4_trials_csv": str(self.stage4_trials_csv),
            "family_comparison_csv": str(self.family_comparison_csv),
            "state_transition_calibration_csv": str(self.state_transition_calibration_csv),
            "report_md": str(self.report_md),
        }


@dataclass(slots=True)
class TrialEvaluationResult:
    """Single-trial evaluation payload."""

    trial_id: int
    trial_row: dict[str, Any]
    fold_records: list[dict[str, Any]]


@dataclass(slots=True)
class TrialSpec:
    """Parameterized trial specification."""

    global_trial_id: int
    stage_name: str
    stage_trial_id: int
    seed: int
    sampled: dict[str, dict[str, Any]]
    source_head: str | None = None
    parent_trial_id: int | None = None


class TrendParameterOptimizer:
    """Download data, run walk-forward optimization, and save CSV outputs."""

    def __init__(
        self,
        base_config: EngineConfig | None = None,
        settings: OptimizationSettings | None = None,
        progress_callback: Callable[[str], None] | None = None,
        progress_event_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.base_config = base_config or EngineConfig()
        self.settings = settings or OptimizationSettings()
        self.downloader = YahooFinanceDownloader()
        self.progress_callback = progress_callback
        self.progress_event_callback = progress_event_callback

    def run(self, output_dir: str | Path) -> OptimizationArtifacts:
        """Download data, optimize parameters, and save the resulting CSV files."""

        output_root = Path(output_dir).expanduser().resolve()
        downloads_dir = output_root / "downloads"
        output_root.mkdir(parents=True, exist_ok=True)
        downloads_dir.mkdir(parents=True, exist_ok=True)

        self._notify("Downloading or reusing OHLCV data...")
        manifest_df = self._download_all(downloads_dir)
        frames = self._load_downloads(manifest_df)
        parallel_jobs = self._resolve_parallel_jobs()
        total_trial_budget = (2 * self.settings.max_trials) + self.settings.local_search_trials
        self._notify(
            "Loaded "
            f"{len(frames)} ticker files. Starting staged optimization with "
            f"{total_trial_budget} total trials using {parallel_jobs} worker(s)...",
            event_type="phase",
            trials=total_trial_budget,
            jobs=parallel_jobs,
        )

        next_trial_id = 1
        stage1_specs = self._build_random_trial_specs(
            seed=self.settings.random_seed,
            count=self.settings.max_trials,
            stage_name="stage1_random",
            start_trial_id=next_trial_id,
        )
        next_trial_id += len(stage1_specs)
        stage2_specs = self._build_random_trial_specs(
            seed=self.settings.stage2_seed,
            count=self.settings.max_trials,
            stage_name="stage2_random",
            start_trial_id=next_trial_id,
        )
        next_trial_id += len(stage2_specs)

        spec_map: dict[int, TrialSpec] = {
            spec.global_trial_id: spec for spec in [*stage1_specs, *stage2_specs]
        }

        stage1_trials_df, stage1_folds_df, completed_trials = self._evaluate_trial_specs(
            frames=frames,
            trial_specs=stage1_specs,
            completed_trials=0,
            total_trial_budget=total_trial_budget,
        )
        stage2_trials_df, stage2_folds_df, completed_trials = self._evaluate_trial_specs(
            frames=frames,
            trial_specs=stage2_specs,
            completed_trials=completed_trials,
            total_trial_budget=total_trial_budget,
        )

        initial_trials_df = pd.concat([stage1_trials_df, stage2_trials_df], ignore_index=True)
        top_candidates_df = self._select_top_candidates(initial_trials_df)

        local_specs = self._build_local_trial_specs(
            top_candidates_df=top_candidates_df,
            spec_map=spec_map,
            count=self.settings.local_search_trials,
            start_trial_id=next_trial_id,
        )
        for spec in local_specs:
            spec_map[spec.global_trial_id] = spec
        stage4_trials_df, stage4_folds_df, completed_trials = self._evaluate_trial_specs(
            frames=frames,
            trial_specs=local_specs,
            completed_trials=completed_trials,
            total_trial_budget=total_trial_budget,
        )

        trials_df = pd.concat(
            [stage1_trials_df, stage2_trials_df, stage4_trials_df],
            ignore_index=True,
        ).sort_values("trial_id").reset_index(drop=True)
        fold_scores_df = pd.concat(
            [stage1_folds_df, stage2_folds_df, stage4_folds_df],
            ignore_index=True,
        ).sort_values(["trial_id", "head", "fold"]).reset_index(drop=True)

        best_direction_trial = int(trials_df.sort_values("direction_quality", ascending=False).iloc[0]["trial_id"])
        best_transition_trial = int(trials_df.sort_values("transition_quality", ascending=False).iloc[0]["trial_id"])
        best_confidence_trial = int(trials_df.sort_values("confidence_quality", ascending=False).iloc[0]["trial_id"])

        best_params_df = self._evaluate_best_trials(
            frames=frames,
            spec_map=spec_map,
            best_trial_ids={
                "direction": best_direction_trial,
                "transition": best_transition_trial,
                "confidence": best_confidence_trial,
            },
            trials_df=trials_df,
        )
        calibration_df, calibration_metrics = self._build_state_transition_calibration(
            frames=frames,
            spec_map=spec_map,
            best_trial_ids={
                "direction": best_direction_trial,
                "transition": best_transition_trial,
                "confidence": best_confidence_trial,
            },
        )
        family_comparison_df = self._build_direction_family_comparison(trials_df)
        best_direction_family = (
            str(family_comparison_df.iloc[0]["direction_family"])
            if not family_comparison_df.empty
            else "n/a"
        )
        pure_family_df = family_comparison_df[
            family_comparison_df["direction_family"].isin(["ema", "ichimoku"])
        ]
        best_pure_direction_family = (
            str(pure_family_df.iloc[0]["direction_family"])
            if not pure_family_df.empty
            else "n/a"
        )

        summary_df = pd.DataFrame(
            [
                {
                    "tickers": ",".join(self.settings.tickers),
                    "period": self.settings.period,
                    "lookback_bars": self.settings.lookback_bars,
                    "direction_evaluation_mode": "current_state_reference",
                    "direction_horizons": ",".join(str(value) for value in self.settings.direction_horizons),
                    "direction_horizon_weights": ",".join(str(value) for value in self.settings.direction_horizon_weights),
                    "transition_horizon": self.settings.transition_horizon,
                    "train_days": self.settings.train_days,
                    "validation_days": self.settings.validation_days,
                    "test_days": self.settings.test_days,
                    "purge_days": self.settings.purge_days,
                    "max_wfo_folds": self.settings.max_wfo_folds,
                    "actual_wfo_folds": int(fold_scores_df[fold_scores_df["head"] == "direction"]["fold"].nunique()),
                    "random_stage_trials": self.settings.max_trials,
                    "stage1_seed": self.settings.random_seed,
                    "stage2_seed": self.settings.stage2_seed,
                    "top_candidates_per_head": self.settings.top_candidates_per_head,
                    "local_search_trials": self.settings.local_search_trials,
                    "local_search_seed": self.settings.local_search_seed,
                    "total_trials_evaluated": len(trials_df),
                    "parallel_jobs": parallel_jobs,
                    "best_direction_trial": best_direction_trial,
                    "best_transition_trial": best_transition_trial,
                    "best_confidence_trial": best_confidence_trial,
                    "best_direction_family": best_direction_family,
                    "best_pure_direction_family": best_pure_direction_family,
                    "state_transition_auc": calibration_metrics["state_transition_auc"],
                    "state_transition_top_accuracy": calibration_metrics["state_transition_accuracy"],
                    "state_transition_brier": calibration_metrics["state_transition_brier"],
                }
            ]
        )

        artifacts = OptimizationArtifacts(
            output_dir=output_root,
            downloads_dir=downloads_dir,
            trials_csv=output_root / "optimizer_trials.csv",
            fold_scores_csv=output_root / "optimizer_fold_scores.csv",
            best_params_csv=output_root / "optimizer_best_params_by_head.csv",
            summary_csv=output_root / "optimizer_summary.csv",
            manifest_csv=output_root / "optimizer_download_manifest.csv",
            stage1_trials_csv=output_root / "stage1_random_trials.csv",
            stage2_trials_csv=output_root / "stage2_random_trials.csv",
            stage3_candidates_csv=output_root / "stage3_top_candidates.csv",
            stage4_trials_csv=output_root / "stage4_local_trials.csv",
            family_comparison_csv=output_root / "optimizer_direction_family_comparison.csv",
            state_transition_calibration_csv=output_root / "optimizer_state_transition_calibration.csv",
            report_md=output_root / "optimizer_report.md",
        )
        manifest_df.to_csv(artifacts.manifest_csv, index=False)
        trials_df.to_csv(artifacts.trials_csv, index=False)
        fold_scores_df.to_csv(artifacts.fold_scores_csv, index=False)
        best_params_df.to_csv(artifacts.best_params_csv, index=False)
        summary_df.to_csv(artifacts.summary_csv, index=False)
        stage1_trials_df.to_csv(artifacts.stage1_trials_csv, index=False)
        stage2_trials_df.to_csv(artifacts.stage2_trials_csv, index=False)
        top_candidates_df.to_csv(artifacts.stage3_candidates_csv, index=False)
        stage4_trials_df.to_csv(artifacts.stage4_trials_csv, index=False)
        family_comparison_df.to_csv(artifacts.family_comparison_csv, index=False)
        calibration_df.to_csv(artifacts.state_transition_calibration_csv, index=False)
        artifacts.report_md.write_text(
            self._render_optimizer_report(
                summary_df=summary_df,
                best_params_df=best_params_df,
                family_comparison_df=family_comparison_df,
                trials_df=trials_df,
                calibration_metrics=calibration_metrics,
            ),
            encoding="utf-8",
        )
        self._notify("Saved optimizer CSV outputs.", event_type="finished", artifacts=artifacts.to_dict())

        return artifacts

    def build_evaluation_samples(
        self,
        frames: dict[str, pd.DataFrame],
        config: EngineConfig | None = None,
    ) -> pd.DataFrame:
        """Return per-bar evaluation samples for one or more ticker frames.

        This exposes the same internal sample builder used by the optimizer so
        historical visualization and diagnostics can reuse the exact same
        current-state and transition evaluation logic.
        """

        evaluation_config = config or self.base_config
        return self._evaluate_config(frames, evaluation_config)

    def calculate_head_metrics(self, samples: pd.DataFrame, head: str) -> dict[str, float]:
        """Return the aggregate metric bundle for one optimizer head."""

        return self._head_metrics(samples, head)

    def _download_all(self, downloads_dir: Path) -> pd.DataFrame:
        rows: list[dict[str, Any]] = []
        for ticker in self.settings.tickers:
            request = DownloadRequest(
                ticker=ticker,
                save_dir=downloads_dir,
                period=self.settings.period,
            )
            output_path = downloads_dir / request.filename()
            if not output_path.exists():
                self._notify(f"Downloading {ticker} ({self.settings.period}) ...")
                self.downloader.download(request)
            else:
                self._notify(f"Reusing cached download for {ticker}.")
            rows.append(
                {
                    "ticker": ticker,
                    "csv_path": str(output_path),
                }
            )
        return pd.DataFrame(rows)

    def _load_downloads(self, manifest_df: pd.DataFrame) -> dict[str, pd.DataFrame]:
        frames: dict[str, pd.DataFrame] = {}
        for row in manifest_df.to_dict("records"):
            ticker = str(row["ticker"])
            path = Path(str(row["csv_path"]))
            frames[ticker] = pd.read_csv(path, parse_dates=["date"]).set_index("date")
        return frames

    def _build_random_trial_specs(
        self,
        seed: int,
        count: int,
        stage_name: str,
        start_trial_id: int,
    ) -> list[TrialSpec]:
        rng = random.Random(seed)
        specs: list[TrialSpec] = []
        for index in range(count):
            specs.append(
                TrialSpec(
                    global_trial_id=start_trial_id + index,
                    stage_name=stage_name,
                    stage_trial_id=index + 1,
                    seed=seed,
                    sampled=self._sample_trial_overrides(rng),
                )
            )
        return specs

    def _evaluate_trial_specs(
        self,
        frames: dict[str, pd.DataFrame],
        trial_specs: list[TrialSpec],
        completed_trials: int,
        total_trial_budget: int,
    ) -> tuple[pd.DataFrame, pd.DataFrame, int]:
        if not trial_specs:
            return pd.DataFrame(), pd.DataFrame(), completed_trials

        stage_name = trial_specs[0].stage_name
        self._notify(
            f"Starting {stage_name} with {len(trial_specs)} trials...",
            event_type="phase",
            stage_name=stage_name,
            stage_trials=len(trial_specs),
        )

        trials_records: list[dict[str, Any]] = []
        fold_records: list[dict[str, Any]] = []
        parallel_jobs = self._resolve_parallel_jobs()

        if parallel_jobs <= 1:
            for spec in trial_specs:
                result = self._evaluate_trial(frames=frames, spec=spec)
                trials_records.append(result.trial_row)
                fold_records.extend(result.fold_records)
                completed_trials += 1
                self._notify_trial_progress(
                    completed=completed_trials,
                    total=total_trial_budget,
                    trial_row=result.trial_row,
                )
        else:
            with ProcessPoolExecutor(
                max_workers=parallel_jobs,
                initializer=_init_optimizer_worker,
                initargs=(self.base_config, self.settings, frames),
            ) as executor:
                futures = {
                    executor.submit(_run_optimizer_trial, spec): spec.global_trial_id for spec in trial_specs
                }
                for future in as_completed(futures):
                    result = future.result()
                    trials_records.append(result.trial_row)
                    fold_records.extend(result.fold_records)
                    completed_trials += 1
                    self._notify_trial_progress(
                        completed=completed_trials,
                        total=total_trial_budget,
                        trial_row=result.trial_row,
                    )

        trials_df = pd.DataFrame(trials_records).sort_values("trial_id").reset_index(drop=True)
        fold_df = pd.DataFrame(fold_records).sort_values(["trial_id", "head", "fold"]).reset_index(drop=True)
        return trials_df, fold_df, completed_trials

    def _select_top_candidates(self, trials_df: pd.DataFrame) -> pd.DataFrame:
        rows: list[dict[str, Any]] = []
        top_n = self.settings.top_candidates_per_head
        for head in ("direction", "transition", "confidence"):
            sort_columns = [
                f"{head}_quality",
                f"{head}_validation_median_quality",
                f"{head}_validation_worst_quality",
                f"{head}_validation_mean_quality",
                f"{head}_accuracy",
            ]
            ordered = trials_df.sort_values(sort_columns, ascending=False).head(top_n)
            for rank, row in enumerate(ordered.to_dict("records"), start=1):
                rows.append(
                    {
                        "head": head,
                        "rank": rank,
                        "trial_id": int(row["trial_id"]),
                        "direction_family": row.get("direction_family"),
                        "stage_name": row["stage_name"],
                        "stage_trial_id": int(row["stage_trial_id"]),
                        "seed": int(row["seed"]),
                        "quality": float(row[f"{head}_quality"]),
                        "accuracy": float(row[f"{head}_accuracy"]),
                        "validation_mean_quality": float(row[f"{head}_validation_mean_quality"]),
                        "validation_median_quality": float(row[f"{head}_validation_median_quality"]),
                        "validation_worst_quality": float(row[f"{head}_validation_worst_quality"]),
                    }
                )
        return pd.DataFrame(rows).sort_values(["head", "rank"]).reset_index(drop=True)

    def _build_local_trial_specs(
        self,
        top_candidates_df: pd.DataFrame,
        spec_map: dict[int, TrialSpec],
        count: int,
        start_trial_id: int,
    ) -> list[TrialSpec]:
        if count <= 0 or top_candidates_df.empty:
            return []

        rng = random.Random(self.settings.local_search_seed)
        candidates = top_candidates_df.to_dict("records")
        weights = [max(1e-6, float(record["quality"])) for record in candidates]
        signatures = {
            self._sample_signature(spec.sampled)
            for spec in spec_map.values()
        }
        specs: list[TrialSpec] = []
        max_attempts = max(count * 20, 100)
        attempts = 0

        while len(specs) < count and attempts < max_attempts:
            attempts += 1
            candidate = rng.choices(candidates, weights=weights, k=1)[0]
            parent_spec = spec_map[int(candidate["trial_id"])]
            sampled = self._sample_local_neighbor(
                rng=rng,
                base_sampled=parent_spec.sampled,
                target_head=str(candidate["head"]),
            )
            signature = self._sample_signature(sampled)
            if signature in signatures:
                continue
            signatures.add(signature)
            specs.append(
                TrialSpec(
                    global_trial_id=start_trial_id + len(specs),
                    stage_name="stage4_local",
                    stage_trial_id=len(specs) + 1,
                    seed=self.settings.local_search_seed,
                    sampled=sampled,
                    source_head=str(candidate["head"]),
                    parent_trial_id=int(candidate["trial_id"]),
                )
            )
        return specs

    def _sample_trial_overrides(self, rng: random.Random) -> dict[str, dict[str, Any]]:
        return {
            "shared": self._sample_space(rng, self._shared_space()),
            "direction": self._sample_space(rng, self._direction_space()),
            "transition": self._sample_space(rng, self._transition_space()),
            "confidence": self._sample_space(rng, self._confidence_space()),
        }

    def _evaluate_trial(
        self,
        frames: dict[str, pd.DataFrame],
        spec: TrialSpec,
    ) -> TrialEvaluationResult:
        direction_config = self.base_config.with_overrides(
            self._merge_overrides(spec.sampled["shared"], spec.sampled["direction"])
        )
        transition_config = self.base_config.with_overrides(
            self._merge_overrides(spec.sampled["shared"], spec.sampled["transition"])
        )
        confidence_config = self.base_config.with_overrides(
            self._merge_overrides(spec.sampled["shared"], spec.sampled["confidence"])
        )

        direction_samples = self._evaluate_config(frames, direction_config)
        transition_samples = self._evaluate_config(frames, transition_config)
        confidence_samples = self._evaluate_config(frames, confidence_config)

        direction_fold_df, direction_cv = self._evaluate_head_wfo(
            direction_samples,
            head="direction",
            trial_id=spec.global_trial_id,
        )
        transition_fold_df, transition_cv = self._evaluate_head_wfo(
            transition_samples,
            head="transition",
            trial_id=spec.global_trial_id,
        )
        confidence_fold_df, confidence_cv = self._evaluate_head_wfo(
            confidence_samples,
            head="confidence",
            trial_id=spec.global_trial_id,
        )

        fold_records: list[dict[str, Any]] = []
        for frame in (direction_fold_df, transition_fold_df, confidence_fold_df):
            for record in frame.to_dict("records"):
                record["stage_name"] = spec.stage_name
                record["stage_trial_id"] = spec.stage_trial_id
                record["seed"] = spec.seed
                record["source_head"] = spec.source_head
                record["parent_trial_id"] = spec.parent_trial_id
                fold_records.append(record)

        trial_row = {
            "trial_id": spec.global_trial_id,
            "stage_name": spec.stage_name,
            "stage_trial_id": spec.stage_trial_id,
            "seed": spec.seed,
            "source_head": spec.source_head,
            "parent_trial_id": spec.parent_trial_id,
            "direction_family": self._infer_direction_family(spec.sampled["direction"].get("category_weights", {}).get("trend_direction", {})),
            "direction_quality": direction_cv["selection_score"],
            "direction_accuracy": direction_cv["validation_accuracy_mean"],
            "direction_sign_accuracy": direction_cv["validation_sign_accuracy_mean"],
            "direction_validation_mean_quality": direction_cv["validation_mean_quality"],
            "direction_validation_median_quality": direction_cv["validation_median_quality"],
            "direction_validation_worst_quality": direction_cv["validation_worst_quality"],
            "transition_quality": transition_cv["selection_score"],
            "transition_accuracy": transition_cv["validation_accuracy_mean"],
            "transition_auc": transition_cv["validation_auc_mean"],
            "transition_state_transition_accuracy": transition_cv["validation_state_transition_accuracy_mean"],
            "transition_state_transition_auc": transition_cv["validation_state_transition_auc_mean"],
            "transition_validation_mean_quality": transition_cv["validation_mean_quality"],
            "transition_validation_median_quality": transition_cv["validation_median_quality"],
            "transition_validation_worst_quality": transition_cv["validation_worst_quality"],
            "confidence_quality": confidence_cv["selection_score"],
            "confidence_accuracy": confidence_cv["validation_accuracy_mean"],
            "confidence_rank_corr": confidence_cv["validation_rank_corr_mean"],
            "confidence_validation_mean_quality": confidence_cv["validation_mean_quality"],
            "confidence_validation_median_quality": confidence_cv["validation_median_quality"],
            "confidence_validation_worst_quality": confidence_cv["validation_worst_quality"],
        }
        trial_row.update(self._flatten_trial_overrides(spec.sampled))
        return TrialEvaluationResult(
            trial_id=spec.global_trial_id,
            trial_row=trial_row,
            fold_records=fold_records,
        )

    @staticmethod
    def _sample_space(rng: random.Random, space: dict[str, list[Any]]) -> dict[str, Any]:
        overrides: dict[str, Any] = {}
        for path, candidates in space.items():
            TrendParameterOptimizer._assign_nested(overrides, path, copy.deepcopy(rng.choice(candidates)))
        return overrides

    @staticmethod
    def _assign_nested(target: dict[str, Any], path: str, value: Any) -> None:
        parts = path.split(".")
        current = target
        for part in parts[:-1]:
            current = current.setdefault(part, {})
        current[parts[-1]] = value

    @staticmethod
    def _merge_overrides(shared: dict[str, Any], head: dict[str, Any]) -> dict[str, Any]:
        merged = copy.deepcopy(shared)

        def _deep_merge(base: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
            for key, value in extra.items():
                if isinstance(value, dict) and isinstance(base.get(key), dict):
                    _deep_merge(base[key], value)
                else:
                    base[key] = copy.deepcopy(value)
            return base

        return _deep_merge(merged, head)

    def _evaluate_config(self, frames: dict[str, pd.DataFrame], config: EngineConfig) -> pd.DataFrame:
        records: list[pd.DataFrame] = []
        data_handler = MarketDataHandler(config)
        indicator_engine = IndicatorEngine(config)
        feature_engine = FeatureEngine(config)
        scoring_engine = ScoringEngine(config)
        classifier = RegimeClassifier(config)

        for ticker, raw_frame in frames.items():
            cleaned = data_handler.prepare(raw_frame.reset_index(), date_column="date")
            indicator_frame = indicator_engine.compute(cleaned)
            feature_frame = feature_engine.compute_frame(indicator_frame)
            coverage_ratio = feature_frame.notna().mean(axis=1)

            score_rows: list[dict[str, Any]] = []
            for as_of_date, row in feature_frame.iterrows():
                feature_values = {
                    key: (None if pd.isna(value) else float(value))
                    for key, value in row.items()
                }
                component_scores = scoring_engine.score_values(feature_values)
                classification = classifier.classify_values(
                    features=feature_values,
                    component_scores=component_scores,
                    coverage_ratio=float(coverage_ratio.loc[as_of_date]),
                )
                score_rows.append(
                    {
                        "as_of_date": as_of_date,
                        "ticker": ticker,
                        "composite_trend_score": component_scores.composite_trend_score,
                        "trend_direction_score": component_scores.trend_direction.score,
                        "trend_strength_score": component_scores.trend_strength.score,
                        "momentum_score": component_scores.momentum.score,
                        "volatility_regime_score": component_scores.volatility_regime.score,
                        "volume_confirmation_score": component_scores.volume_confirmation.score,
                        "transition_risk_score": component_scores.transition_risk.score,
                        "confidence_score": classification["confidence_score"],
                        "regime_label": classification["regime_label"],
                        "trend_state_label": classification["trend_state_label"],
                    }
                )

            scores_df = pd.DataFrame(score_rows).set_index("as_of_date")
            targets_df = self._build_targets(cleaned, indicator_frame, feature_frame, scores_df)
            merged = scores_df.join(targets_df, how="inner")
            merged["close"] = cleaned["close"].reindex(merged.index)
            merged["open"] = cleaned["open"].reindex(merged.index)
            merged["high"] = cleaned["high"].reindex(merged.index)
            merged["low"] = cleaned["low"].reindex(merged.index)
            merged["volume"] = cleaned["volume"].reindex(merged.index)
            merged.index.name = "as_of_date"
            merged["ticker"] = ticker
            records.append(merged.reset_index())

        all_samples = pd.concat(records, ignore_index=True)
        if self.settings.step_days > 1:
            selector = all_samples.groupby("ticker").cumcount() % self.settings.step_days == 0
            all_samples = all_samples.loc[selector].reset_index(drop=True)
        return all_samples.reset_index(drop=True)

    def _build_targets(
        self,
        cleaned: pd.DataFrame,
        indicator_frame: pd.DataFrame,
        feature_frame: pd.DataFrame,
        scores_df: pd.DataFrame,
    ) -> pd.DataFrame:
        transition_horizon = self.settings.transition_horizon
        max_horizon = transition_horizon
        close = cleaned["close"]
        low = cleaned["low"]
        high = cleaned["high"]
        atr = indicator_frame["atr"]

        predicted_regime = scores_df["regime_label"].map(
            {
                "strong_downtrend": -2,
                "weak_downtrend": -1,
                "sideways": 0,
                "weak_uptrend": 1,
                "strong_uptrend": 2,
            }
        )
        predicted_direction = pd.Series(
            np.sign(predicted_regime.fillna(0.0)),
            index=predicted_regime.index,
        )

        targets = pd.DataFrame(index=cleaned.index)
        current_state_targets = self._build_current_state_targets(
            indicator_frame=indicator_frame,
            feature_frame=feature_frame,
            predicted_regime=predicted_regime,
            predicted_direction=predicted_direction,
        )
        targets = targets.join(current_state_targets, how="left")

        future_close_transition = close.shift(-transition_horizon)
        future_return_transition = future_close_transition.div(close) - 1.0
        future_return_atr_transition = (future_close_transition - close).div(atr.replace(0.0, np.nan))
        future_min_low = low.shift(-1).iloc[::-1].rolling(window=transition_horizon, min_periods=transition_horizon).min().iloc[::-1]
        future_max_high = high.shift(-1).iloc[::-1].rolling(window=transition_horizon, min_periods=transition_horizon).max().iloc[::-1]
        actual_regime_transition = self._future_regime_labels(future_return_atr_transition)
        actual_direction_transition = np.sign(actual_regime_transition).astype(float)

        bullish_adverse = (future_min_low - close).div(atr.replace(0.0, np.nan))
        bearish_adverse = (close - future_max_high).div(atr.replace(0.0, np.nan))
        adverse_excursion_atr = np.where(
            predicted_direction > 0,
            bullish_adverse,
            np.where(predicted_direction < 0, bearish_adverse, np.nan),
        )
        transition_event = (
            (predicted_direction != 0)
            & (
                (predicted_direction != actual_direction_transition)
                | (pd.Series(adverse_excursion_atr, index=cleaned.index) <= -self.settings.transition_adverse_atr)
            )
        ).astype(float)

        targets["forward_return_transition_10d"] = future_return_transition
        targets["forward_return_atr_transition_10d"] = future_return_atr_transition
        targets["actual_regime_transition_10d"] = actual_regime_transition
        targets["actual_direction_transition_10d"] = actual_direction_transition
        targets["transition_event"] = transition_event
        targets = targets.join(
            self._build_state_transition_targets(
                current_reference_direction=current_state_targets["reference_direction_current"],
                horizon=transition_horizon,
            ),
            how="left",
        )

        targets = targets.iloc[self.settings.lookback_bars - 1 : -max_horizon if max_horizon > 0 else None]
        return targets

    def _build_state_transition_targets(
        self,
        current_reference_direction: pd.Series,
        horizon: int,
    ) -> pd.DataFrame:
        future_stable_state = self._future_stable_direction_state(
            direction_series=current_reference_direction,
            horizon=horizon,
            stable_window=min(5, horizon),
        )
        state_transition_event = (
            current_reference_direction.notna()
            & future_stable_state.notna()
            & (current_reference_direction != future_stable_state)
        ).astype(float)
        return pd.DataFrame(
            {
                "future_reference_direction_state_10d": future_stable_state,
                "state_transition_event_10d": state_transition_event,
            },
            index=current_reference_direction.index,
        )

    @staticmethod
    def _future_stable_direction_state(
        direction_series: pd.Series,
        horizon: int,
        stable_window: int,
    ) -> pd.Series:
        if horizon <= 0:
            return pd.Series(np.nan, index=direction_series.index, dtype=float)

        start_shift = max(1, horizon - stable_window + 1)
        window_shifts = list(range(start_shift, horizon + 1))
        shifted_arrays = [
            direction_series.shift(-shift).to_numpy(dtype=float)
            for shift in window_shifts
        ]
        output = np.full(len(direction_series), np.nan, dtype=float)
        state_order = (-1.0, 0.0, 1.0)

        for row_index in range(len(direction_series)):
            future_values = [
                values[row_index]
                for values in shifted_arrays
                if not np.isnan(values[row_index])
            ]
            if not future_values:
                continue
            counts = {state: future_values.count(state) for state in state_order}
            max_count = max(counts.values())
            winners = [state for state, count in counts.items() if count == max_count]
            if len(winners) == 1:
                output[row_index] = winners[0]
                continue

            last_value = direction_series.shift(-horizon).iloc[row_index]
            if last_value in winners:
                output[row_index] = float(last_value)
            else:
                output[row_index] = float(winners[len(winners) // 2])

        return pd.Series(output, index=direction_series.index, dtype=float)

    def _future_regime_labels(self, standardized_forward_return: pd.Series) -> pd.Series:
        strong = self.settings.direction_strong_atr
        weak = self.settings.direction_weak_atr
        output = pd.Series(0.0, index=standardized_forward_return.index)
        output = output.mask(standardized_forward_return >= strong, 2.0)
        output = output.mask(
            (standardized_forward_return >= weak) & (standardized_forward_return < strong),
            1.0,
        )
        output = output.mask(standardized_forward_return <= -strong, -2.0)
        output = output.mask(
            (standardized_forward_return <= -weak) & (standardized_forward_return > -strong),
            -1.0,
        )
        return output

    def _build_current_state_targets(
        self,
        indicator_frame: pd.DataFrame,
        feature_frame: pd.DataFrame,
        predicted_regime: pd.Series,
        predicted_direction: pd.Series,
    ) -> pd.DataFrame:
        close = indicator_frame["close"]
        ema20 = indicator_frame["ema20"]
        ema50 = indicator_frame["ema50"]
        sma200 = indicator_frame["sma200"]
        tenkan = indicator_frame["ichimoku_tenkan"]
        kijun = indicator_frame["ichimoku_kijun"]
        cloud_a = indicator_frame["ichimoku_cloud_a"]
        cloud_b = indicator_frame["ichimoku_cloud_b"]
        future_span_a = indicator_frame["ichimoku_span_a_raw"]
        future_span_b = indicator_frame["ichimoku_span_b_raw"]
        rsi = indicator_frame["rsi"]
        macd_line = indicator_frame["macd_line"]
        macd_signal = indicator_frame["macd_signal"]
        adx = indicator_frame["adx"]
        plus_di = indicator_frame["plus_di"]
        minus_di = indicator_frame["minus_di"]

        ema_vote = (
            close.gt(ema20).astype(float)
            + ema20.gt(ema50).astype(float)
            + (sma200.isna() | ema50.gt(sma200)).astype(float)
            - close.lt(ema20).astype(float)
            - ema20.lt(ema50).astype(float)
            - (~sma200.isna() & ema50.lt(sma200)).astype(float)
        )

        cloud_top = pd.concat([cloud_a, cloud_b], axis=1).max(axis=1)
        cloud_bottom = pd.concat([cloud_a, cloud_b], axis=1).min(axis=1)
        ichimoku_vote = (
            close.gt(kijun).astype(float)
            + tenkan.gt(kijun).astype(float)
            + close.gt(cloud_top).astype(float)
            + future_span_a.gt(future_span_b).astype(float)
            - close.lt(kijun).astype(float)
            - tenkan.lt(kijun).astype(float)
            - close.lt(cloud_bottom).astype(float)
            - future_span_a.lt(future_span_b).astype(float)
        )

        momentum_vote = (
            ((rsi >= self.base_config.feature_thresholds.rsi_bullish) & (macd_line > macd_signal)).astype(float)
            - ((rsi <= self.base_config.feature_thresholds.rsi_bearish) & (macd_line < macd_signal)).astype(float)
        )

        di_vote = (
            (plus_di > minus_di).astype(float)
            - (plus_di < minus_di).astype(float)
        )

        direction_vote = ema_vote + ichimoku_vote + momentum_vote + di_vote
        strength_points = (
            (adx >= self.base_config.feature_thresholds.adx_trending).astype(float)
            + (feature_frame["cloud_thickness_norm"] >= 1.0).astype(float)
            + (feature_frame["trend_persistence_20"].abs() >= 40.0).astype(float)
            + (feature_frame["breakout_persistence"].abs() >= 1.0).astype(float)
            + (feature_frame["di_spread_norm"].abs() >= 10.0).astype(float)
        )

        reference_regime = pd.Series(0.0, index=indicator_frame.index)
        strong_up = (direction_vote >= 4.0) & (strength_points >= 3.0)
        weak_up = (direction_vote >= 2.0) & ~strong_up
        strong_down = (direction_vote <= -4.0) & (strength_points >= 3.0)
        weak_down = (direction_vote <= -2.0) & ~strong_down

        reference_regime = reference_regime.mask(strong_up, 2.0)
        reference_regime = reference_regime.mask(weak_up, 1.0)
        reference_regime = reference_regime.mask(strong_down, -2.0)
        reference_regime = reference_regime.mask(weak_down, -1.0)

        low_consensus = (direction_vote.abs() <= 1.0) | (strength_points <= 1.0)
        reference_regime = reference_regime.mask(low_consensus, 0.0)
        reference_direction = np.sign(reference_regime).astype(float)
        reference_consensus = (
            (direction_vote.abs().clip(0.0, 6.0) / 6.0) * 70.0
            + (strength_points.clip(0.0, 5.0) / 5.0) * 30.0
        ).clip(0.0, 100.0)
        reference_signed_score = reference_direction * reference_consensus

        exact_match = (predicted_regime == reference_regime).astype(float)
        sign_match = (predicted_direction == reference_direction).astype(float)
        diagnosis_match = (
            ((predicted_direction == reference_direction) & ((predicted_regime - reference_regime).abs() <= 1))
            | ((predicted_regime == 0) & (reference_regime == 0))
        ).astype(float)

        return pd.DataFrame(
            {
                "reference_regime_current": reference_regime,
                "reference_direction_current": reference_direction,
                "reference_consensus_current": reference_consensus,
                "reference_signed_score_current": reference_signed_score,
                "exact_regime_correct_current": exact_match,
                "sign_correct_current": sign_match,
                "diagnosis_correct_current": diagnosis_match,
            },
            index=indicator_frame.index,
        )

    def _evaluate_head_wfo(
        self,
        samples: pd.DataFrame,
        head: str,
        trial_id: int,
    ) -> tuple[pd.DataFrame, dict[str, float]]:
        split_plan = self._walk_forward_splits(samples["as_of_date"])
        records: list[dict[str, Any]] = []

        for fold_number, fold in enumerate(split_plan["validation_folds"], start=1):
            train_df = samples[samples["as_of_date"].isin(fold["train_dates"])].copy()
            validation_df = samples[samples["as_of_date"].isin(fold["validation_dates"])].copy()
            train_metrics = self._head_metrics(train_df, head=head)
            validation_metrics = self._head_metrics(validation_df, head=head)
            record: dict[str, Any] = {
                "trial_id": trial_id,
                "head": head,
                "fold": fold_number,
                "train_start": fold["train_start"],
                "train_end": fold["train_end"],
                "validation_start": fold["validation_start"],
                "validation_end": fold["validation_end"],
                "train_samples": len(train_df),
                "validation_samples": len(validation_df),
            }
            for key, value in train_metrics.items():
                record[f"train_{key}"] = value
            for key, value in validation_metrics.items():
                record[f"validation_{key}"] = value
            records.append(record)

        fold_df = pd.DataFrame(records)
        summary = self._build_selection_summary(fold_df, head=head)
        summary["wfo_folds"] = float(len(fold_df))
        return fold_df, summary

    def _evaluate_best_trials(
        self,
        frames: dict[str, pd.DataFrame],
        spec_map: dict[int, TrialSpec],
        best_trial_ids: dict[str, int],
        trials_df: pd.DataFrame,
    ) -> pd.DataFrame:
        rows: list[dict[str, Any]] = []
        for head, trial_id in best_trial_ids.items():
            spec = spec_map[trial_id]
            config = self.base_config.with_overrides(
                self._merge_overrides(spec.sampled["shared"], spec.sampled[head])
            )
            samples = self._evaluate_config(frames, config)
            split_plan = self._walk_forward_splits(samples["as_of_date"])
            test_dates = split_plan["test_dates"]
            test_metrics = self._head_metrics(
                samples[samples["as_of_date"].isin(test_dates)].copy(),
                head=head,
            )
            trial_row = trials_df[trials_df["trial_id"] == trial_id].iloc[0].to_dict()
            summary_row = {
                "head": head,
                "trial_id": trial_id,
                "direction_family": trial_row.get("direction_family"),
                "validation_quality": trial_row[f"{head}_quality"],
                "validation_accuracy": trial_row[f"{head}_accuracy"],
                "validation_mean_quality": trial_row[f"{head}_validation_mean_quality"],
                "validation_median_quality": trial_row[f"{head}_validation_median_quality"],
                "validation_worst_quality": trial_row[f"{head}_validation_worst_quality"],
                "test_start": split_plan["test_start"],
                "test_end": split_plan["test_end"],
                "test_quality": test_metrics[f"{head}_quality"],
                "test_accuracy": test_metrics[f"{head}_accuracy"],
                "selected_stage_name": spec.stage_name,
                "selected_stage_trial_id": spec.stage_trial_id,
                "selected_seed": spec.seed,
                "selected_parent_trial_id": spec.parent_trial_id,
                "selected_source_head": spec.source_head,
            }
            if head == "direction":
                summary_row["test_sign_accuracy"] = test_metrics["direction_sign_accuracy"]
            if head == "transition":
                summary_row["test_auc"] = test_metrics["transition_auc"]
                summary_row["test_state_transition_auc"] = test_metrics["state_transition_auc"]
                summary_row["test_state_transition_accuracy"] = test_metrics["state_transition_accuracy"]
            if head == "confidence":
                summary_row["test_rank_corr"] = test_metrics["confidence_rank_corr"]

            flattened = self._flatten_trial_overrides(spec.sampled)
            for key, value in flattened.items():
                if key.startswith(f"{head}.") or key.startswith("shared."):
                    summary_row[key] = value
            rows.append(summary_row)
        return pd.DataFrame(rows)

    def _build_direction_family_comparison(self, trials_df: pd.DataFrame) -> pd.DataFrame:
        if trials_df.empty or "direction_family" not in trials_df.columns:
            return pd.DataFrame()

        top_n = max(10, int(len(trials_df) * 0.10))
        top_trial_ids = set(trials_df.nlargest(top_n, "direction_quality")["trial_id"].astype(int))
        rows: list[dict[str, Any]] = []

        for family, family_df in trials_df.groupby("direction_family", dropna=False):
            best_row = family_df.sort_values(
                [
                    "direction_quality",
                    "direction_validation_median_quality",
                    "direction_accuracy",
                    "direction_sign_accuracy",
                ],
                ascending=False,
            ).iloc[0]
            rows.append(
                {
                    "direction_family": family,
                    "trial_count": int(len(family_df)),
                    "mean_direction_quality": float(family_df["direction_quality"].mean()),
                    "median_direction_quality": float(family_df["direction_quality"].median()),
                    "mean_direction_accuracy": float(family_df["direction_accuracy"].mean()),
                    "mean_direction_sign_accuracy": float(family_df["direction_sign_accuracy"].mean()),
                    "best_direction_quality": float(best_row["direction_quality"]),
                    "best_direction_accuracy": float(best_row["direction_accuracy"]),
                    "best_direction_sign_accuracy": float(best_row["direction_sign_accuracy"]),
                    "best_trial_id": int(best_row["trial_id"]),
                    "best_stage_name": str(best_row["stage_name"]),
                    "top_direction_hits": int(family_df["trial_id"].isin(top_trial_ids).sum()),
                }
            )

        return pd.DataFrame(rows).sort_values(
            ["median_direction_quality", "mean_direction_quality", "best_direction_quality"],
            ascending=False,
        ).reset_index(drop=True)

    def _build_state_transition_calibration(
        self,
        frames: dict[str, pd.DataFrame],
        spec_map: dict[int, TrialSpec],
        best_trial_ids: dict[str, int],
    ) -> tuple[pd.DataFrame, dict[str, float]]:
        merged_config = self._merge_best_trial_configs(spec_map, best_trial_ids)
        samples = self._evaluate_config(frames, merged_config)
        calibrator = StateTransitionCalibrator.from_samples(
            samples,
            bins=self.settings.state_transition_calibration_bins,
        )
        calibrated_samples = calibrator.apply(samples)
        metrics = self._state_transition_probability_metrics(calibrated_samples)
        return calibrator.to_frame(), metrics

    def _merge_best_trial_configs(
        self,
        spec_map: dict[int, TrialSpec],
        best_trial_ids: dict[str, int],
    ) -> EngineConfig:
        merged_overrides: dict[str, Any] = {}

        def _deep_merge(base: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
            for key, value in extra.items():
                if isinstance(value, dict) and isinstance(base.get(key), dict):
                    _deep_merge(base[key], value)
                else:
                    base[key] = copy.deepcopy(value)
            return base

        for head in ("direction", "transition", "confidence"):
            spec = spec_map[best_trial_ids[head]]
            relevant = self._merge_overrides(spec.sampled["shared"], spec.sampled[head])
            _deep_merge(merged_overrides, relevant)
        return self.base_config.with_overrides(merged_overrides)

    def _state_transition_probability_metrics(self, samples: pd.DataFrame) -> dict[str, float]:
        valid = samples.dropna(subset=["state_transition_probability_10d", "state_transition_event_10d"])
        valid = valid[valid["state_transition_event_10d"].isin([0.0, 1.0])]
        if valid.empty:
            return {
                "state_transition_auc": 0.5,
                "state_transition_accuracy": 0.0,
                "state_transition_brier": 1.0,
                "state_transition_event_rate": 0.0,
            }

        auc = self._roc_auc(
            valid["state_transition_probability_10d"],
            valid["state_transition_event_10d"],
        )
        top_n = max(1, int(len(valid) * self.settings.transition_top_fraction))
        top_precision = float(
            valid.nlargest(top_n, "state_transition_probability_10d")["state_transition_event_10d"].mean()
        )
        probabilities = valid["state_transition_probability_10d"].astype(float) / 100.0
        labels = valid["state_transition_event_10d"].astype(float)
        brier = float(((probabilities - labels) ** 2).mean())
        return {
            "state_transition_auc": auc,
            "state_transition_accuracy": top_precision,
            "state_transition_brier": brier,
            "state_transition_event_rate": float(labels.mean()),
        }

    def _render_optimizer_report(
        self,
        summary_df: pd.DataFrame,
        best_params_df: pd.DataFrame,
        family_comparison_df: pd.DataFrame,
        trials_df: pd.DataFrame,
        calibration_metrics: dict[str, float],
    ) -> str:
        summary = summary_df.iloc[0].to_dict()
        best_rows = best_params_df.set_index("head")

        overall_family = "n/a"
        pure_family = "n/a"
        if not family_comparison_df.empty:
            overall_family = str(family_comparison_df.iloc[0]["direction_family"])
            pure_candidates = family_comparison_df[
                family_comparison_df["direction_family"].isin(["ema", "ichimoku"])
            ]
            if not pure_candidates.empty:
                pure_family = str(pure_candidates.iloc[0]["direction_family"])

        report_lines = [
            "# Optimizer Report",
            "",
            "## 실행 개요",
            f"- 티커: {summary['tickers']}",
            f"- 기간: {summary['period']}",
            f"- Lookback: {summary['lookback_bars']} bars",
            "- Direction 평가: current-state reference label",
            f"- Transition 평가: {summary['transition_horizon']}일 구조 붕괴 위험",
            f"- State transition probability: {summary['transition_horizon']}일 3단계 상태 전환 확률",
            f"- WFO folds: {summary['actual_wfo_folds']}",
            f"- 총 trial: {summary['total_trials_evaluated']}",
            "",
            "## Head별 최종 선택",
        ]

        for head in ("direction", "transition", "confidence"):
            if head not in best_rows.index:
                continue
            row = best_rows.loc[head]
            report_lines.extend(
                [
                    f"### {head}",
                    f"- 선택 trial: {int(row['trial_id'])}",
                    f"- direction family: {row.get('direction_family', 'n/a')}",
                    f"- validation quality: {float(row['validation_quality']):.4f}",
                    f"- validation accuracy: {float(row['validation_accuracy']):.4f}",
                    f"- test quality: {float(row['test_quality']):.4f}",
                    f"- test accuracy: {float(row['test_accuracy']):.4f}",
                ]
            )
            if head == "direction" and "test_sign_accuracy" in row:
                report_lines.append(f"- test sign accuracy: {float(row['test_sign_accuracy']):.4f}")
            if head == "transition" and "test_auc" in row:
                report_lines.append(f"- test AUC: {float(row['test_auc']):.4f}")
                report_lines.append(
                    f"- test state-transition AUC: {float(row.get('test_state_transition_auc', 0.5)):.4f}"
                )
                report_lines.append(
                    f"- test state-transition top accuracy: {float(row.get('test_state_transition_accuracy', 0.0)):.4f}"
                )
            if head == "confidence" and "test_rank_corr" in row:
                report_lines.append(f"- test rank corr: {float(row['test_rank_corr']):.4f}")
            report_lines.append("")

        report_lines.extend(
            [
                "## Direction Family 비교",
                "",
                "| family | trials | mean quality | median quality | mean accuracy | mean sign acc | best quality | top hits |",
                "|---|---:|---:|---:|---:|---:|---:|---:|",
            ]
        )
        if family_comparison_df.empty:
            report_lines.append("| n/a | 0 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |")
        else:
            for row in family_comparison_df.to_dict("records"):
                report_lines.append(
                    "| "
                    f"{row['direction_family']} | "
                    f"{int(row['trial_count'])} | "
                    f"{float(row['mean_direction_quality']):.4f} | "
                    f"{float(row['median_direction_quality']):.4f} | "
                    f"{float(row['mean_direction_accuracy']):.4f} | "
                    f"{float(row['mean_direction_sign_accuracy']):.4f} | "
                    f"{float(row['best_direction_quality']):.4f} | "
                    f"{int(row['top_direction_hits'])} |"
                )

        direction_best = trials_df.sort_values("direction_quality", ascending=False).iloc[0]
        report_lines.extend(
            [
                "",
                "## 상태 전환 확률 보정",
                f"- 전체 보정 AUC: {calibration_metrics['state_transition_auc']:.4f}",
                f"- 상위 위험구간 실제 전환 비율: {calibration_metrics['state_transition_accuracy']:.4f}",
                f"- Brier score: {calibration_metrics['state_transition_brier']:.4f}",
                f"- 평균 10일 상태 전환 발생률: {calibration_metrics['state_transition_event_rate']:.4f}",
                "",
                "## 해석",
                f"- 전체 direction 기준으로는 `{overall_family}` family가 가장 강했습니다. (median direction quality 기준)",
                f"- EMA vs Ichimoku 순수 비교에서는 `{pure_family}` 쪽이 더 우세했습니다.",
                (
                    f"- 전체 최고 direction trial은 #{int(direction_best['trial_id'])}이고 "
                    f"family는 `{direction_best['direction_family']}`였습니다."
                ),
                "",
                "## 파일 안내",
                "- `optimizer_direction_family_comparison.csv`: family별 집계 비교",
                "- `optimizer_best_params_by_head.csv`: head별 최종 선택 파라미터",
                "- `optimizer_state_transition_calibration.csv`: 10일 상태 전환 확률 보정표",
                "- `optimizer_trials.csv`: 모든 trial 결과",
            ]
        )
        return "\n".join(report_lines) + "\n"

    def _head_metrics(self, samples: pd.DataFrame, head: str) -> dict[str, float]:
        if head == "direction":
            return self._direction_metrics(samples)
        if head == "transition":
            return self._transition_metrics(samples)
        if head == "confidence":
            return self._confidence_metrics(samples)
        raise ValueError(f"Unknown head: {head}")

    def _direction_metrics(self, samples: pd.DataFrame) -> dict[str, float]:
        valid = samples.dropna(
            subset=[
                "reference_regime_current",
                "reference_signed_score_current",
                "composite_trend_score",
                "exact_regime_correct_current",
                "sign_correct_current",
            ]
        )
        if valid.empty:
            return {
                "direction_quality": 0.0,
                "direction_accuracy": 0.0,
                "direction_sign_accuracy": 0.0,
                "direction_rank_corr": 0.0,
            }
        exact_accuracy = float(valid["exact_regime_correct_current"].mean())
        sign_accuracy = float(valid["sign_correct_current"].mean())
        rank_corr = self._spearman_correlation(valid["composite_trend_score"], valid["reference_signed_score_current"])
        quality = (0.45 * exact_accuracy) + (0.35 * sign_accuracy) + (0.20 * self._corr_to_quality(rank_corr))
        return {
            "direction_quality": quality,
            "direction_accuracy": exact_accuracy,
            "direction_sign_accuracy": sign_accuracy,
            "direction_rank_corr": rank_corr,
        }

    def _transition_metrics(self, samples: pd.DataFrame) -> dict[str, float]:
        valid = samples.dropna(subset=["transition_risk_score", "transition_event"])
        valid = valid[valid["transition_event"].isin([0.0, 1.0])]
        state_valid = samples.dropna(subset=["transition_risk_score", "state_transition_event_10d"])
        state_valid = state_valid[state_valid["state_transition_event_10d"].isin([0.0, 1.0])]
        if valid.empty:
            return {
                "transition_quality": 0.0,
                "transition_accuracy": 0.0,
                "transition_auc": 0.5,
                "state_transition_quality": 0.0,
                "state_transition_accuracy": 0.0,
                "state_transition_auc": 0.5,
            }
        auc = self._roc_auc(valid["transition_risk_score"], valid["transition_event"])
        top_n = max(1, int(len(valid) * self.settings.transition_top_fraction))
        top_precision = float(valid.nlargest(top_n, "transition_risk_score")["transition_event"].mean())
        quality = (0.70 * auc) + (0.30 * top_precision)
        if state_valid.empty:
            state_auc = 0.5
            state_top_precision = 0.0
            state_quality = 0.0
        else:
            state_auc = self._roc_auc(state_valid["transition_risk_score"], state_valid["state_transition_event_10d"])
            state_top_n = max(1, int(len(state_valid) * self.settings.transition_top_fraction))
            state_top_precision = float(
                state_valid.nlargest(state_top_n, "transition_risk_score")["state_transition_event_10d"].mean()
            )
            state_quality = (0.70 * state_auc) + (0.30 * state_top_precision)
        return {
            "transition_quality": quality,
            "transition_accuracy": top_precision,
            "transition_auc": auc,
            "state_transition_quality": state_quality,
            "state_transition_accuracy": state_top_precision,
            "state_transition_auc": state_auc,
        }

    def _confidence_metrics(self, samples: pd.DataFrame) -> dict[str, float]:
        valid = samples.dropna(subset=["confidence_score", "diagnosis_correct_current", "reference_consensus_current"])
        if valid.empty:
            return {
                "confidence_quality": 0.0,
                "confidence_accuracy": 0.0,
                "confidence_rank_corr": 0.0,
            }
        top_n = max(1, int(len(valid) * self.settings.confidence_top_fraction))
        top_accuracy = float(valid.nlargest(top_n, "confidence_score")["diagnosis_correct_current"].mean())
        overall_accuracy = float(valid["diagnosis_correct_current"].mean())
        alignment_signal = valid["reference_consensus_current"] * valid["diagnosis_correct_current"]
        rank_corr = self._spearman_correlation(valid["confidence_score"], alignment_signal)
        quality = (0.50 * top_accuracy) + (0.30 * overall_accuracy) + (0.20 * self._corr_to_quality(rank_corr))
        return {
            "confidence_quality": quality,
            "confidence_accuracy": top_accuracy,
            "confidence_rank_corr": rank_corr,
        }

    def _build_selection_summary(self, fold_df: pd.DataFrame, head: str) -> dict[str, float]:
        validation_quality_col = f"validation_{head}_quality"
        validation_accuracy_col = f"validation_{head}_accuracy"
        qualities = fold_df[validation_quality_col] if validation_quality_col in fold_df else pd.Series(dtype=float)
        accuracies = fold_df[validation_accuracy_col] if validation_accuracy_col in fold_df else pd.Series(dtype=float)

        if qualities.empty:
            return {
                "selection_score": 0.0,
                "validation_mean_quality": 0.0,
                "validation_median_quality": 0.0,
                "validation_worst_quality": 0.0,
                "validation_accuracy_mean": 0.0,
                "validation_sign_accuracy_mean": 0.0,
                "validation_auc_mean": 0.5,
                "validation_rank_corr_mean": 0.0,
            }

        summary = {
            "selection_score": self._robust_selection_score(qualities),
            "validation_mean_quality": float(qualities.mean()),
            "validation_median_quality": float(qualities.median()),
            "validation_worst_quality": float(qualities.min()),
            "validation_accuracy_mean": float(accuracies.mean()) if not accuracies.empty else 0.0,
            "validation_sign_accuracy_mean": 0.0,
            "validation_auc_mean": 0.5,
            "validation_state_transition_auc_mean": 0.5,
            "validation_state_transition_accuracy_mean": 0.0,
            "validation_rank_corr_mean": 0.0,
        }
        if head == "direction":
            column = "validation_direction_sign_accuracy"
            summary["validation_sign_accuracy_mean"] = self._metric_mean(fold_df, column)
        if head == "transition":
            column = "validation_transition_auc"
            summary["validation_auc_mean"] = self._metric_mean(fold_df, column, default=0.5)
            summary["validation_state_transition_auc_mean"] = self._metric_mean(
                fold_df,
                "validation_state_transition_auc",
                default=0.5,
            )
            summary["validation_state_transition_accuracy_mean"] = self._metric_mean(
                fold_df,
                "validation_state_transition_accuracy",
                default=0.0,
            )
        if head == "confidence":
            column = "validation_confidence_rank_corr"
            summary["validation_rank_corr_mean"] = self._metric_mean(fold_df, column)
        return summary

    def _walk_forward_splits(self, date_series: pd.Series) -> dict[str, Any]:
        unique_dates = pd.Index(sorted(pd.Series(date_series).dropna().unique()))
        minimum_required = (
            self.settings.train_days
            + self.settings.purge_days
            + self.settings.validation_days
            + self.settings.test_days
        )
        if len(unique_dates) < minimum_required:
            raise ValueError(
                "Not enough daily samples for the configured walk-forward split. "
                f"Need at least {minimum_required} unique dates, got {len(unique_dates)}."
            )

        pre_test_dates = unique_dates[: -self.settings.test_days]
        test_dates = unique_dates[-self.settings.test_days :]
        folds: list[dict[str, Any]] = []
        train_start = 0

        while True:
            train_end = train_start + self.settings.train_days
            validation_start = train_end + self.settings.purge_days
            validation_end = validation_start + self.settings.validation_days
            if validation_end > len(pre_test_dates):
                break
            train_dates = pre_test_dates[train_start:train_end]
            validation_dates = pre_test_dates[validation_start:validation_end]
            folds.append(
                {
                    "train_dates": train_dates,
                    "validation_dates": validation_dates,
                    "train_start": str(train_dates[0]),
                    "train_end": str(train_dates[-1]),
                    "validation_start": str(validation_dates[0]),
                    "validation_end": str(validation_dates[-1]),
                }
            )
            train_start += self.settings.validation_days

        if self.settings.max_wfo_folds is not None and len(folds) > self.settings.max_wfo_folds:
            folds = folds[-self.settings.max_wfo_folds :]

        if not folds:
            raise ValueError(
                "The configured train/validation/test windows do not produce any walk-forward folds. "
                "Reduce train_days or validation_days, or provide more history."
            )

        return {
            "validation_folds": folds,
            "test_dates": test_dates,
            "test_start": str(test_dates[0]),
            "test_end": str(test_dates[-1]),
        }

    def _robust_selection_score(self, values: pd.Series) -> float:
        if values.empty:
            return 0.0
        return float(
            (self.settings.selection_median_weight * values.median())
            + (self.settings.selection_mean_weight * values.mean())
            + (self.settings.selection_worst_weight * values.min())
        )

    @staticmethod
    def _metric_mean(frame: pd.DataFrame, column: str, default: float = 0.0) -> float:
        if column not in frame:
            return default
        values = frame[column]
        if values.empty:
            return default
        mean_value = values.mean()
        return default if pd.isna(mean_value) else float(mean_value)

    @staticmethod
    def _spearman_correlation(left: pd.Series, right: pd.Series) -> float:
        if left.nunique(dropna=True) <= 1 or right.nunique(dropna=True) <= 1:
            return 0.0
        value = left.rank().corr(right.rank())
        return 0.0 if pd.isna(value) else float(value)

    @staticmethod
    def _corr_to_quality(correlation: float) -> float:
        return (correlation + 1.0) / 2.0

    @staticmethod
    def _roc_auc(scores: pd.Series, labels: pd.Series) -> float:
        positives = labels == 1
        negatives = labels == 0
        positive_count = int(positives.sum())
        negative_count = int(negatives.sum())
        if positive_count == 0 or negative_count == 0:
            return 0.5
        ranks = scores.rank(method="average")
        auc = (ranks[positives].sum() - (positive_count * (positive_count + 1) / 2)) / (positive_count * negative_count)
        return float(auc)

    @staticmethod
    def _flatten_trial_overrides(sampled: dict[str, dict[str, Any]]) -> dict[str, Any]:
        flattened: dict[str, Any] = {}

        def _flatten(prefix: str, payload: dict[str, Any]) -> None:
            for key, value in payload.items():
                next_prefix = f"{prefix}.{key}"
                if isinstance(value, dict):
                    _flatten(next_prefix, value)
                else:
                    flattened[next_prefix] = json.dumps(value) if isinstance(value, (list, tuple, dict)) else value

        for head_name, overrides in sampled.items():
            _flatten(head_name, overrides)
        return flattened

    def _sample_local_neighbor(
        self,
        rng: random.Random,
        base_sampled: dict[str, dict[str, Any]],
        target_head: str,
    ) -> dict[str, dict[str, Any]]:
        neighbor = copy.deepcopy(base_sampled)
        mutated = False

        mutated |= self._mutate_segment_locally(
            rng=rng,
            segment_payload=neighbor["shared"],
            segment_space=self._shared_space(),
            min_mutations=1,
            max_mutations=2,
        )
        mutated |= self._mutate_segment_locally(
            rng=rng,
            segment_payload=neighbor[target_head],
            segment_space=self._head_space(target_head),
            min_mutations=1,
            max_mutations=2,
        )

        if not mutated:
            mutated = self._force_single_local_mutation(
                rng=rng,
                segment_payload=neighbor[target_head],
                segment_space=self._head_space(target_head),
            )
        if not mutated:
            self._force_single_local_mutation(
                rng=rng,
                segment_payload=neighbor["shared"],
                segment_space=self._shared_space(),
            )
        return neighbor

    def _mutate_segment_locally(
        self,
        rng: random.Random,
        segment_payload: dict[str, Any],
        segment_space: dict[str, list[Any]],
        min_mutations: int,
        max_mutations: int,
    ) -> bool:
        keys = list(segment_space.keys())
        if not keys:
            return False
        mutation_count = min(len(keys), rng.randint(min_mutations, max_mutations))
        selected_paths = rng.sample(keys, k=mutation_count)
        mutated = False
        for path in selected_paths:
            current_value = self._nested_get(segment_payload, path)
            next_value = self._sample_adjacent_value(
                rng=rng,
                candidates=segment_space[path],
                current_value=current_value,
            )
            if next_value is None:
                continue
            self._nested_set(segment_payload, path, copy.deepcopy(next_value))
            mutated = True
        return mutated

    def _force_single_local_mutation(
        self,
        rng: random.Random,
        segment_payload: dict[str, Any],
        segment_space: dict[str, list[Any]],
    ) -> bool:
        shuffled_paths = list(segment_space.keys())
        rng.shuffle(shuffled_paths)
        for path in shuffled_paths:
            current_value = self._nested_get(segment_payload, path)
            next_value = self._sample_adjacent_value(
                rng=rng,
                candidates=segment_space[path],
                current_value=current_value,
            )
            if next_value is None:
                continue
            self._nested_set(segment_payload, path, copy.deepcopy(next_value))
            return True
        return False

    @staticmethod
    def _sample_adjacent_value(
        rng: random.Random,
        candidates: list[Any],
        current_value: Any,
    ) -> Any | None:
        if not candidates:
            return None
        current_index = None
        for index, candidate in enumerate(candidates):
            if candidate == current_value:
                current_index = index
                break
        if current_index is None:
            return rng.choice(candidates)

        adjacent_indices = []
        if current_index - 1 >= 0:
            adjacent_indices.append(current_index - 1)
        if current_index + 1 < len(candidates):
            adjacent_indices.append(current_index + 1)
        if not adjacent_indices:
            return None
        return candidates[rng.choice(adjacent_indices)]

    @staticmethod
    def _nested_get(payload: dict[str, Any], path: str) -> Any:
        current: Any = payload
        for part in path.split("."):
            current = current[part]
        return current

    @staticmethod
    def _nested_set(payload: dict[str, Any], path: str, value: Any) -> None:
        current = payload
        parts = path.split(".")
        for part in parts[:-1]:
            current = current[part]
        current[parts[-1]] = value

    @staticmethod
    def _sample_signature(sampled: dict[str, dict[str, Any]]) -> str:
        return json.dumps(sampled, sort_keys=True)

    @staticmethod
    def _infer_direction_family(direction_weights: dict[str, float]) -> str:
        ema_weight = sum(
            float(direction_weights.get(key, 0.0))
            for key in ("close_vs_ema20", "close_vs_ema50", "close_vs_sma200", "ema_alignment_state")
        )
        ichimoku_weight = sum(
            float(direction_weights.get(key, 0.0))
            for key in ("close_vs_kijun", "tenkan_kijun_state", "cloud_position_state")
        )
        if ema_weight >= max(ichimoku_weight * 1.5, 0.15):
            return "ema"
        if ichimoku_weight >= max(ema_weight * 1.5, 0.15):
            return "ichimoku"
        return "hybrid"

    def _head_space(self, head: str) -> dict[str, list[Any]]:
        if head == "direction":
            return self._direction_space()
        if head == "transition":
            return self._transition_space()
        if head == "confidence":
            return self._confidence_space()
        raise ValueError(f"Unknown optimization head: {head}")

    def _shared_space(self) -> dict[str, list[Any]]:
        return {}

    def _direction_space(self) -> dict[str, list[Any]]:
        return {
            "category_weights.trend_direction": self._direction_weight_profiles(),
            "category_weights.trend_strength": self._trend_strength_profiles(),
            "category_weights.momentum": self._momentum_profiles(),
            "category_weights.volatility_regime": self._volatility_profiles(),
            "category_weights.volume_confirmation": self._volume_profiles(),
            "composite_weights": self._direction_composite_profiles(),
        }

    def _transition_space(self) -> dict[str, list[Any]]:
        return {
            "category_weights.transition_risk": self._transition_profiles(),
        }

    def _confidence_space(self) -> dict[str, list[Any]]:
        return {
            "confidence": self._confidence_profiles(),
        }

    def _direction_weight_profiles(self) -> list[dict[str, float]]:
        return [
            {
                "close_vs_ema20": 0.18,
                "close_vs_ema50": 0.16,
                "close_vs_sma200": 0.14,
                "ema_alignment_state": 0.18,
                "close_vs_kijun": 0.00,
                "tenkan_kijun_state": 0.00,
                "cloud_position_state": 0.00,
                "linear_regression_slope_50": 0.14,
                "di_spread_norm": 0.20,
            },
            {
                "close_vs_ema20": 0.12,
                "close_vs_ema50": 0.12,
                "close_vs_sma200": 0.14,
                "ema_alignment_state": 0.14,
                "close_vs_kijun": 0.08,
                "tenkan_kijun_state": 0.10,
                "cloud_position_state": 0.10,
                "linear_regression_slope_50": 0.10,
                "di_spread_norm": 0.10,
            },
            {
                "close_vs_ema20": 0.00,
                "close_vs_ema50": 0.04,
                "close_vs_sma200": 0.10,
                "ema_alignment_state": 0.04,
                "close_vs_kijun": 0.20,
                "tenkan_kijun_state": 0.18,
                "cloud_position_state": 0.22,
                "linear_regression_slope_50": 0.10,
                "di_spread_norm": 0.12,
            },
            {
                "close_vs_ema20": 0.10,
                "close_vs_ema50": 0.10,
                "close_vs_sma200": 0.12,
                "ema_alignment_state": 0.12,
                "close_vs_kijun": 0.12,
                "tenkan_kijun_state": 0.12,
                "cloud_position_state": 0.12,
                "linear_regression_slope_50": 0.10,
                "di_spread_norm": 0.10,
            },
        ]

    def _trend_strength_profiles(self) -> list[dict[str, float]]:
        return [
            {
                "adx_regime": 0.40,
                "trend_persistence_20": 0.22,
                "breakout_persistence": 0.20,
                "di_spread_norm": 0.10,
                "cloud_thickness_norm": 0.08,
            },
            {
                "adx_regime": 0.34,
                "trend_persistence_20": 0.26,
                "breakout_persistence": 0.24,
                "di_spread_norm": 0.08,
                "cloud_thickness_norm": 0.08,
            },
            {
                "adx_regime": 0.38,
                "trend_persistence_20": 0.18,
                "breakout_persistence": 0.18,
                "di_spread_norm": 0.10,
                "cloud_thickness_norm": 0.16,
            },
            {
                "adx_regime": 0.36,
                "trend_persistence_20": 0.22,
                "breakout_persistence": 0.20,
                "di_spread_norm": 0.12,
                "cloud_thickness_norm": 0.10,
            },
        ]

    def _momentum_profiles(self) -> list[dict[str, float]]:
        return [
            {
                "rsi_zone_score": 0.45,
                "rsi_slope_5": 0.10,
                "macd_state": 0.25,
                "macd_hist_slope_3": 0.20,
            },
            {
                "rsi_zone_score": 0.30,
                "rsi_slope_5": 0.08,
                "macd_state": 0.34,
                "macd_hist_slope_3": 0.28,
            },
            {
                "rsi_zone_score": 0.40,
                "rsi_slope_5": 0.12,
                "macd_state": 0.28,
                "macd_hist_slope_3": 0.20,
            },
            {
                "rsi_zone_score": 0.34,
                "rsi_slope_5": 0.18,
                "macd_state": 0.24,
                "macd_hist_slope_3": 0.24,
            },
        ]

    def _volatility_profiles(self) -> list[dict[str, float]]:
        return [
            {
                "bb_width_relative": 0.30,
                "atr_regime": 0.25,
                "squeeze_flag": 0.15,
                "expansion_flag": 0.15,
                "donchian_breakout_context": 0.15,
            },
            {
                "bb_width_relative": 0.24,
                "atr_regime": 0.22,
                "squeeze_flag": 0.10,
                "expansion_flag": 0.20,
                "donchian_breakout_context": 0.24,
            },
            {
                "bb_width_relative": 0.34,
                "atr_regime": 0.26,
                "squeeze_flag": 0.20,
                "expansion_flag": 0.08,
                "donchian_breakout_context": 0.12,
            },
        ]

    def _volume_profiles(self) -> list[dict[str, float]]:
        return [
            {
                "volume_ratio_20": 0.40,
                "obv_slope_20": 0.35,
                "breakout_volume_support": 0.25,
            },
            {
                "volume_ratio_20": 0.50,
                "obv_slope_20": 0.30,
                "breakout_volume_support": 0.20,
            },
            {
                "volume_ratio_20": 0.25,
                "obv_slope_20": 0.45,
                "breakout_volume_support": 0.30,
            },
        ]

    def _direction_composite_profiles(self) -> list[dict[str, float]]:
        return [
            {
                "direction": 0.40,
                "signed_strength": 0.20,
                "momentum": 0.20,
                "volatility": 0.10,
                "volume": 0.10,
            },
            {
                "direction": 0.45,
                "signed_strength": 0.20,
                "momentum": 0.20,
                "volatility": 0.08,
                "volume": 0.07,
            },
            {
                "direction": 0.35,
                "signed_strength": 0.20,
                "momentum": 0.25,
                "volatility": 0.10,
                "volume": 0.10,
            },
            {
                "direction": 0.38,
                "signed_strength": 0.24,
                "momentum": 0.18,
                "volatility": 0.10,
                "volume": 0.10,
            },
        ]

    def _transition_profiles(self) -> list[dict[str, float]]:
        return [
            {
                "overextension_ema20_atr": 0.20,
                "overextension_ema50_atr": 0.05,
                "macd_momentum_fade": 0.18,
                "adx_rollover": 0.14,
                "failed_breakout_flag": 0.13,
                "failed_breakdown_flag": 0.13,
                "hostile_volatility_spike": 0.07,
                "exhaustion_flag": 0.10,
            },
            {
                "overextension_ema20_atr": 0.12,
                "overextension_ema50_atr": 0.04,
                "macd_momentum_fade": 0.14,
                "adx_rollover": 0.10,
                "failed_breakout_flag": 0.22,
                "failed_breakdown_flag": 0.22,
                "hostile_volatility_spike": 0.08,
                "exhaustion_flag": 0.08,
            },
            {
                "overextension_ema20_atr": 0.24,
                "overextension_ema50_atr": 0.08,
                "macd_momentum_fade": 0.14,
                "adx_rollover": 0.12,
                "failed_breakout_flag": 0.10,
                "failed_breakdown_flag": 0.10,
                "hostile_volatility_spike": 0.06,
                "exhaustion_flag": 0.16,
            },
            {
                "overextension_ema20_atr": 0.12,
                "overextension_ema50_atr": 0.04,
                "macd_momentum_fade": 0.22,
                "adx_rollover": 0.18,
                "failed_breakout_flag": 0.10,
                "failed_breakdown_flag": 0.10,
                "hostile_volatility_spike": 0.14,
                "exhaustion_flag": 0.10,
            },
        ]

    def _confidence_profiles(self) -> list[dict[str, float]]:
        return [
            {
                "composite_abs_weight": 0.45,
                "strength_weight": 0.25,
                "coverage_weight": 0.20,
                "agreement_weight": 0.10,
                "transition_penalty_weight": 0.35,
            },
            {
                "composite_abs_weight": 0.50,
                "strength_weight": 0.25,
                "coverage_weight": 0.15,
                "agreement_weight": 0.10,
                "transition_penalty_weight": 0.30,
            },
            {
                "composite_abs_weight": 0.38,
                "strength_weight": 0.20,
                "coverage_weight": 0.20,
                "agreement_weight": 0.22,
                "transition_penalty_weight": 0.30,
            },
            {
                "composite_abs_weight": 0.35,
                "strength_weight": 0.25,
                "coverage_weight": 0.25,
                "agreement_weight": 0.15,
                "transition_penalty_weight": 0.20,
            },
            {
                "composite_abs_weight": 0.42,
                "strength_weight": 0.30,
                "coverage_weight": 0.15,
                "agreement_weight": 0.13,
                "transition_penalty_weight": 0.40,
            },
        ]

    def _resolve_parallel_jobs(self) -> int:
        configured = int(self.settings.parallel_jobs)
        available = os.cpu_count() or 1
        return max(1, min(configured, available))

    def _notify_trial_progress(self, completed: int, total: int, trial_row: dict[str, Any]) -> None:
        stage_name = str(trial_row.get("stage_name", "trial"))
        self._notify(
            "Completed trial "
            f"{int(trial_row['trial_id'])}/{total} "
            f"[{stage_name}] "
            f"(direction={trial_row['direction_quality']:.4f}, "
            f"transition={trial_row['transition_quality']:.4f}, "
            f"confidence={trial_row['confidence_quality']:.4f})",
            event_type="trial_progress",
            completed=completed,
            total=total,
            trial_id=int(trial_row["trial_id"]),
            stage_name=stage_name,
            stage_trial_id=trial_row.get("stage_trial_id"),
            direction_quality=float(trial_row["direction_quality"]),
            transition_quality=float(trial_row["transition_quality"]),
            confidence_quality=float(trial_row["confidence_quality"]),
        )

    def _notify(self, message: str, event_type: str = "message", **payload: Any) -> None:
        if self.progress_callback is not None:
            self.progress_callback(message)
        if self.progress_event_callback is not None:
            event = {
                "type": event_type,
                "message": message,
            }
            event.update(payload)
            self.progress_event_callback(event)


_OPTIMIZER_WORKER_CONTEXT: dict[str, Any] = {}


def _init_optimizer_worker(
    base_config: EngineConfig,
    settings: OptimizationSettings,
    frames: dict[str, pd.DataFrame],
) -> None:
    """Initialize per-process worker state for parallel trial execution."""

    global _OPTIMIZER_WORKER_CONTEXT
    _OPTIMIZER_WORKER_CONTEXT = {
        "base_config": base_config,
        "settings": settings,
        "frames": frames,
    }


def _run_optimizer_trial(
    spec: TrialSpec,
) -> TrialEvaluationResult:
    """Run one trial inside a worker process."""

    optimizer = TrendParameterOptimizer(
        base_config=_OPTIMIZER_WORKER_CONTEXT["base_config"],
        settings=_OPTIMIZER_WORKER_CONTEXT["settings"],
    )
    frames: dict[str, pd.DataFrame] = _OPTIMIZER_WORKER_CONTEXT["frames"]
    return optimizer._evaluate_trial(frames=frames, spec=spec)
