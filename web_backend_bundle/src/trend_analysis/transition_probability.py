"""Calibration helpers for 10-day 3-state transition probability."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .utils import clamp

VALID_TREND_STATES = ("bullish", "sideways", "bearish")
ALL_STATES_BUCKET = "__all__"


@dataclass(slots=True)
class StateTransitionCalibrator:
    """Map breakdown-risk scores to empirical 10-day state transition probabilities."""

    calibration_table: pd.DataFrame
    default_probability: float
    fallback_score_probability: bool = True

    @classmethod
    def from_samples(
        cls,
        samples: pd.DataFrame,
        bins: int = 6,
        score_col: str = "transition_risk_score",
        event_col: str = "state_transition_event_10d",
        state_col: str = "trend_state_label",
    ) -> StateTransitionCalibrator:
        """Build a calibrator from historical samples."""

        valid = samples.dropna(subset=[score_col, event_col, state_col]).copy()
        valid = valid[valid[event_col].isin([0.0, 1.0])]
        if valid.empty:
            return cls(
                calibration_table=pd.DataFrame(),
                default_probability=0.0,
            )

        rows: list[dict[str, Any]] = []
        overall_default = float(valid[event_col].mean() * 100.0)

        for bucket in (ALL_STATES_BUCKET, *VALID_TREND_STATES):
            bucket_df = valid if bucket == ALL_STATES_BUCKET else valid[valid[state_col] == bucket]
            if bucket_df.empty:
                continue

            series = bucket_df[score_col].astype(float)
            unique_scores = int(series.nunique(dropna=True))
            quantiles = min(bins, unique_scores)
            if quantiles < 2:
                rows.append(
                    {
                        "state_bucket": bucket,
                        "bin_index": 0,
                        "score_min": float(series.min()),
                        "score_max": float(series.max()),
                        "mean_score": float(series.mean()),
                        "sample_count": int(len(bucket_df)),
                        "event_rate": float(bucket_df[event_col].mean()),
                        "event_rate_monotonic": float(bucket_df[event_col].mean()),
                    }
                )
                continue

            qcut = pd.qcut(series, q=quantiles, duplicates="drop")
            grouped = bucket_df.groupby(qcut, observed=True)
            bucket_rows: list[dict[str, Any]] = []
            for index, (_, group) in enumerate(grouped):
                bucket_rows.append(
                    {
                        "state_bucket": bucket,
                        "bin_index": index,
                        "score_min": float(group[score_col].min()),
                        "score_max": float(group[score_col].max()),
                        "mean_score": float(group[score_col].mean()),
                        "sample_count": int(len(group)),
                        "event_rate": float(group[event_col].mean()),
                    }
                )

            bucket_rows.sort(key=lambda row: row["mean_score"])
            if len(bucket_rows) <= 1:
                bucket_rows[0]["event_rate_monotonic"] = bucket_rows[0]["event_rate"]
                rows.extend(bucket_rows)
                continue

            mean_scores = pd.Series([row["mean_score"] for row in bucket_rows])
            event_rates = pd.Series([row["event_rate"] for row in bucket_rows])
            corr = mean_scores.rank().corr(event_rates.rank())
            corr = 0.0 if pd.isna(corr) else float(corr)

            if corr >= 0.0:
                running_rate = 0.0
                for row in bucket_rows:
                    running_rate = max(running_rate, row["event_rate"])
                    row["event_rate_monotonic"] = running_rate
            else:
                running_rate = 0.0
                smoothed: list[float] = []
                for row in reversed(bucket_rows):
                    running_rate = max(running_rate, row["event_rate"])
                    smoothed.append(running_rate)
                for row, smoothed_rate in zip(bucket_rows, reversed(smoothed), strict=False):
                    row["event_rate_monotonic"] = smoothed_rate
            rows.extend(bucket_rows)

        table = pd.DataFrame(rows).sort_values(["state_bucket", "mean_score"]).reset_index(drop=True)
        return cls(
            calibration_table=table,
            default_probability=overall_default,
        )

    @classmethod
    def from_csv(cls, path: str | Path) -> StateTransitionCalibrator:
        """Load a saved calibration table from CSV."""

        csv_path = Path(path).expanduser().resolve()
        table = pd.read_csv(csv_path)
        default_probability = float(table.attrs.get("default_probability", np.nan))
        if np.isnan(default_probability):
            overall = table[table["state_bucket"] == ALL_STATES_BUCKET]
            if overall.empty:
                default_probability = 0.0
            else:
                default_probability = float(
                    np.average(
                        overall["event_rate_monotonic"] * 100.0,
                        weights=overall["sample_count"].clip(lower=1),
                    )
                )
        return cls(
            calibration_table=table,
            default_probability=default_probability,
        )

    def to_frame(self) -> pd.DataFrame:
        """Return the underlying calibration table."""

        return self.calibration_table.copy()

    def estimate(self, score: float, trend_state_label: str | None = None) -> float:
        """Estimate 10-day state transition probability in 0-100 space."""

        if self.calibration_table.empty or np.isnan(score):
            if self.fallback_score_probability:
                return clamp(float(score), 0.0, 100.0)
            return self.default_probability

        subset = self.calibration_table[self.calibration_table["state_bucket"] == str(trend_state_label)]
        if subset.empty:
            subset = self.calibration_table[self.calibration_table["state_bucket"] == ALL_STATES_BUCKET]
        if subset.empty:
            if self.fallback_score_probability:
                return clamp(float(score), 0.0, 100.0)
            return self.default_probability

        score = float(score)
        in_bucket = subset[(subset["score_min"] <= score) & (subset["score_max"] >= score)]
        if in_bucket.empty:
            nearest_idx = (subset["mean_score"] - score).abs().idxmin()
            probability = float(subset.loc[nearest_idx, "event_rate_monotonic"] * 100.0)
        else:
            probability = float(in_bucket.iloc[0]["event_rate_monotonic"] * 100.0)
        return clamp(probability, 0.0, 100.0)

    def apply(
        self,
        frame: pd.DataFrame,
        score_col: str = "transition_risk_score",
        state_col: str = "trend_state_label",
        output_col: str = "state_transition_probability_10d",
    ) -> pd.DataFrame:
        """Attach calibrated 10-day state transition probability to a frame."""

        result = frame.copy()
        result[output_col] = [
            self.estimate(score=score, trend_state_label=state)
            for score, state in zip(
                result.get(score_col, pd.Series(dtype=float)),
                result.get(state_col, pd.Series(dtype=object)),
                strict=False,
            )
        ]
        return result


def load_state_transition_calibrator(best_params_csv: str | Path) -> StateTransitionCalibrator | None:
    """Load sibling calibration output if it exists next to a best-params CSV."""

    best_params_path = Path(best_params_csv).expanduser().resolve()
    calibration_path = best_params_path.with_name("optimizer_state_transition_calibration.csv")
    if not calibration_path.exists():
        return None
    return StateTransitionCalibrator.from_csv(calibration_path)
