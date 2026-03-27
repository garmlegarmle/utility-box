"""Historical evaluation charts for trend analysis results."""

from __future__ import annotations

import os
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MPLCONFIGDIR = Path(os.environ.get("MPLCONFIGDIR", Path.cwd() / ".matplotlib-cache"))
MPLCONFIGDIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(MPLCONFIGDIR))

import matplotlib

matplotlib.use("Agg")

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import pandas as pd

from .config import EngineConfig
from .optimizer import OptimizationSettings, TrendParameterOptimizer
from .transition_probability import StateTransitionCalibrator, load_state_transition_calibrator
from .utils import collapse_regime_label


REGIME_TO_NUMERIC = {
    "strong_downtrend": -2.0,
    "weak_downtrend": -1.0,
    "sideways": 0.0,
    "weak_uptrend": 1.0,
    "strong_uptrend": 2.0,
}

NUMERIC_TO_REGIME = {
    -2.0: "strong_downtrend",
    -1.0: "weak_downtrend",
    0.0: "sideways",
    1.0: "weak_uptrend",
    2.0: "strong_uptrend",
}

REGIME_COLORS = {
    "strong_uptrend": "#15803d",
    "weak_uptrend": "#86efac",
    "sideways": "#d4d4d8",
    "weak_downtrend": "#fca5a5",
    "strong_downtrend": "#b91c1c",
}


@dataclass(slots=True)
class HistoricalReportArtifacts:
    """Generated files for one historical visualization run."""

    output_dir: Path
    analysis_csv: Path
    chart_png: Path
    summary_md: Path
    metrics_json: Path

    def to_dict(self) -> dict[str, str]:
        return {
            "output_dir": str(self.output_dir),
            "analysis_csv": str(self.analysis_csv),
            "chart_png": str(self.chart_png),
            "summary_md": str(self.summary_md),
            "metrics_json": str(self.metrics_json),
        }


class HistoricalAnalysisReporter:
    """Build a 10-year style history chart from one OHLCV CSV."""

    def __init__(
        self,
        config: EngineConfig | None = None,
        settings: OptimizationSettings | None = None,
        rolling_match_window: int = 60,
        config_source: str = "default",
        metadata: dict[str, Any] | None = None,
        state_transition_calibrator: StateTransitionCalibrator | None = None,
    ) -> None:
        self.config = config or EngineConfig()
        self.settings = settings or OptimizationSettings(lookback_bars=self.config.data.max_bars)
        self.optimizer = TrendParameterOptimizer(base_config=self.config, settings=self.settings)
        self.rolling_match_window = rolling_match_window
        self.config_source = config_source
        self.metadata = metadata or {}
        self.state_transition_calibrator = state_transition_calibrator

    @classmethod
    def from_best_params_csv(
        cls,
        best_params_csv: str | Path,
        rolling_match_window: int = 60,
        base_config: EngineConfig | None = None,
        settings: OptimizationSettings | None = None,
    ) -> HistoricalAnalysisReporter:
        """Build a reporter from the optimizer's chosen head-by-head parameters."""

        config, metadata = load_optimized_config(best_params_csv, base_config=base_config)
        calibrator = load_state_transition_calibrator(best_params_csv)
        effective_settings = settings or OptimizationSettings(
            lookback_bars=config.data.max_bars,
            transition_horizon=10,
        )
        return cls(
            config=config,
            settings=effective_settings,
            rolling_match_window=rolling_match_window,
            config_source=str(Path(best_params_csv).resolve()),
            metadata=metadata,
            state_transition_calibrator=calibrator,
        )

    def build_from_csv(
        self,
        csv_path: str | Path,
        output_dir: str | Path,
        date_column: str = "date",
        ticker: str | None = None,
    ) -> HistoricalReportArtifacts:
        """Analyze one CSV over time and write chart/data artifacts."""

        csv_path = Path(csv_path).expanduser().resolve()
        output_dir = Path(output_dir).expanduser().resolve()
        output_dir.mkdir(parents=True, exist_ok=True)

        raw_frame = pd.read_csv(csv_path)
        normalized_date_column = date_column.strip()
        if normalized_date_column != "date" and normalized_date_column in raw_frame.columns:
            raw_frame = raw_frame.rename(columns={normalized_date_column: "date"})

        ticker_label = ticker or self._infer_ticker(csv_path)
        samples = self.optimizer.build_evaluation_samples({ticker_label: raw_frame}, config=self.config)
        analysis_df = self._prepare_analysis_frame(samples)
        metrics = self._build_metrics(analysis_df, ticker_label)

        artifacts = HistoricalReportArtifacts(
            output_dir=output_dir,
            analysis_csv=output_dir / f"{ticker_label}_historical_analysis.csv",
            chart_png=output_dir / f"{ticker_label}_historical_analysis.png",
            summary_md=output_dir / f"{ticker_label}_historical_analysis.md",
            metrics_json=output_dir / f"{ticker_label}_historical_metrics.json",
        )

        analysis_df.to_csv(artifacts.analysis_csv, index=False)
        artifacts.metrics_json.write_text(json.dumps(metrics, indent=2, default=str), encoding="utf-8")
        artifacts.summary_md.write_text(self._render_summary(metrics, artifacts), encoding="utf-8")
        self._render_chart(analysis_df, metrics, artifacts.chart_png)
        return artifacts

    def _prepare_analysis_frame(self, samples: pd.DataFrame) -> pd.DataFrame:
        analysis_df = samples.copy().sort_values("as_of_date").reset_index(drop=True)
        analysis_df["as_of_date"] = pd.to_datetime(analysis_df["as_of_date"])
        analysis_df["trend_state_label"] = analysis_df["regime_label"].map(collapse_regime_label)
        if self.state_transition_calibrator is not None:
            analysis_df = self.state_transition_calibrator.apply(analysis_df)
        else:
            analysis_df["state_transition_probability_10d"] = analysis_df["transition_risk_score"].clip(0.0, 100.0)
        analysis_df["reference_trend_state_label_current"] = analysis_df["reference_direction_current"].map(
            {
                -1.0: "bearish",
                0.0: "sideways",
                1.0: "bullish",
            }
        )
        analysis_df["regime_numeric"] = analysis_df["regime_label"].map(REGIME_TO_NUMERIC)
        analysis_df["reference_regime_label_current"] = analysis_df["reference_regime_current"].map(NUMERIC_TO_REGIME)
        analysis_df["rolling_exact_accuracy_60"] = analysis_df["exact_regime_correct_current"].rolling(
            window=self.rolling_match_window,
            min_periods=max(10, self.rolling_match_window // 3),
        ).mean()
        analysis_df["rolling_sign_accuracy_60"] = analysis_df["sign_correct_current"].rolling(
            window=self.rolling_match_window,
            min_periods=max(10, self.rolling_match_window // 3),
        ).mean()
        analysis_df["rolling_diagnosis_accuracy_60"] = analysis_df["diagnosis_correct_current"].rolling(
            window=self.rolling_match_window,
            min_periods=max(10, self.rolling_match_window // 3),
        ).mean()
        return analysis_df

    def _build_metrics(self, analysis_df: pd.DataFrame, ticker: str) -> dict[str, Any]:
        direction_metrics = self.optimizer.calculate_head_metrics(analysis_df, "direction")
        transition_metrics = self.optimizer.calculate_head_metrics(analysis_df, "transition")
        confidence_metrics = self.optimizer.calculate_head_metrics(analysis_df, "confidence")
        state_transition_metrics = self.optimizer._state_transition_probability_metrics(analysis_df)

        test_start = self.metadata.get("test_start")
        test_end = self.metadata.get("test_end")
        test_mask = pd.Series(False, index=analysis_df.index)
        if test_start and test_end:
            start = pd.Timestamp(test_start)
            end = pd.Timestamp(test_end)
            test_mask = analysis_df["as_of_date"].between(start, end, inclusive="both")

        test_metrics: dict[str, Any] = {}
        if bool(test_mask.any()):
            test_df = analysis_df.loc[test_mask].copy()
            test_metrics = {
                "direction": self.optimizer.calculate_head_metrics(test_df, "direction"),
                "transition": self.optimizer.calculate_head_metrics(test_df, "transition"),
                "confidence": self.optimizer.calculate_head_metrics(test_df, "confidence"),
                "state_transition": self.optimizer._state_transition_probability_metrics(test_df),
            }

        regime_counts = analysis_df["regime_label"].value_counts(dropna=False).to_dict()
        reference_counts = analysis_df["reference_regime_label_current"].value_counts(dropna=False).to_dict()

        return {
            "ticker": ticker,
            "config_source": self.config_source,
            "sample_count": int(len(analysis_df)),
            "date_start": analysis_df["as_of_date"].min().isoformat(),
            "date_end": analysis_df["as_of_date"].max().isoformat(),
            "rolling_match_window": self.rolling_match_window,
            "direction": direction_metrics,
            "transition": transition_metrics,
            "state_transition": state_transition_metrics,
            "confidence": confidence_metrics,
            "test_window": {
                "start": test_start,
                "end": test_end,
            },
            "test_metrics": test_metrics,
            "regime_counts": regime_counts,
            "reference_regime_counts": reference_counts,
        }

    def _render_summary(self, metrics: dict[str, Any], artifacts: HistoricalReportArtifacts) -> str:
        direction = metrics["direction"]
        transition = metrics["transition"]
        state_transition = metrics["state_transition"]
        confidence = metrics["confidence"]
        test_window = metrics.get("test_window", {})
        test_metrics = metrics.get("test_metrics", {})

        lines = [
            f"# {metrics['ticker']} Historical Analysis Report",
            "",
            "## 개요",
            f"- 데이터 구간: {metrics['date_start']} ~ {metrics['date_end']}",
            f"- 샘플 수: {metrics['sample_count']}",
            f"- 설정 소스: {metrics['config_source']}",
            f"- Rolling match window: {metrics['rolling_match_window']} bars",
            "",
            "## 전체 기간 요약",
            f"- Direction quality: {direction['direction_quality']:.4f}",
            f"- Direction 3-state accuracy: {direction['direction_sign_accuracy']:.4f}",
            f"- Direction 5-state exact accuracy: {direction['direction_accuracy']:.4f}",
            f"- Transition quality: {transition['transition_quality']:.4f}",
            f"- Transition AUC: {transition['transition_auc']:.4f}",
            f"- 10d state-transition probability AUC: {state_transition['state_transition_auc']:.4f}",
            f"- 10d state-transition top accuracy: {state_transition['state_transition_accuracy']:.4f}",
            f"- Confidence quality: {confidence['confidence_quality']:.4f}",
            f"- Confidence accuracy: {confidence['confidence_accuracy']:.4f}",
            "",
        ]

        if test_window.get("start") and test_window.get("end") and test_metrics:
            lines.extend(
                [
                    "## 최종 테스트 구간",
                    f"- 테스트 기간: {test_window['start']} ~ {test_window['end']}",
                    f"- Direction test quality: {test_metrics['direction']['direction_quality']:.4f}",
                    f"- Direction test 3-state accuracy: {test_metrics['direction']['direction_sign_accuracy']:.4f}",
                    f"- Direction test 5-state exact accuracy: {test_metrics['direction']['direction_accuracy']:.4f}",
                    f"- Transition test AUC: {test_metrics['transition']['transition_auc']:.4f}",
                    f"- 10d state-transition test AUC: {test_metrics['state_transition']['state_transition_auc']:.4f}",
                    f"- Confidence test quality: {test_metrics['confidence']['confidence_quality']:.4f}",
                    "",
                ]
            )

        lines.extend(
            [
                "## 생성 파일",
                f"- 차트: `{artifacts.chart_png.name}`",
                f"- 분석 CSV: `{artifacts.analysis_csv.name}`",
                f"- 메트릭 JSON: `{artifacts.metrics_json.name}`",
            ]
        )
        return "\n".join(lines) + "\n"

    def _render_chart(
        self,
        analysis_df: pd.DataFrame,
        metrics: dict[str, Any],
        output_path: Path,
    ) -> None:
        dates = analysis_df["as_of_date"]
        close = analysis_df["close"]
        predicted_regime = analysis_df["regime_numeric"]
        reference_regime = analysis_df["reference_regime_current"]

        fig, axes = plt.subplots(
            5,
            1,
            figsize=(18, 16),
            sharex=True,
            gridspec_kw={"height_ratios": [3.2, 1.2, 1.6, 1.6, 1.4]},
        )
        fig.subplots_adjust(hspace=0.10)

        self._shade_regimes(axes[0], analysis_df)
        self._shade_test_window(axes, metrics)

        axes[0].plot(dates, close, color="#111827", linewidth=1.3, label="Close")
        axes[0].set_ylabel("Price")
        axes[0].legend(loc="upper left")
        axes[0].set_title(
            f"{metrics['ticker']} | "
            f"Direction 3-state {metrics['direction']['direction_sign_accuracy']:.1%} | "
            f"Direction 5-state {metrics['direction']['direction_accuracy']:.1%} | "
            f"Transition AUC {metrics['transition']['transition_auc']:.3f} | "
            f"State-change AUC {metrics['state_transition']['state_transition_auc']:.3f}"
        )

        axes[1].step(dates, predicted_regime, where="mid", color="#2563eb", linewidth=1.2, label="Predicted regime")
        axes[1].step(dates, reference_regime, where="mid", color="#dc2626", linewidth=1.0, alpha=0.8, label="Reference regime")
        axes[1].set_ylabel("Regime")
        axes[1].set_yticks([-2, -1, 0, 1, 2])
        axes[1].set_yticklabels(["SD", "WD", "SW", "WU", "SU"])
        axes[1].axhline(0.0, color="#94a3b8", linewidth=0.8)
        axes[1].legend(loc="upper left", ncol=2)

        axes[2].plot(dates, analysis_df["composite_trend_score"], color="#0f766e", linewidth=1.1, label="Composite trend")
        axes[2].plot(dates, analysis_df["trend_direction_score"], color="#1d4ed8", linewidth=0.9, alpha=0.9, label="Direction score")
        axes[2].plot(
            dates,
            analysis_df["reference_signed_score_current"],
            color="#7c3aed",
            linewidth=0.9,
            alpha=0.8,
            linestyle="--",
            label="Reference signed score",
        )
        axes[2].axhline(0.0, color="#94a3b8", linewidth=0.8)
        axes[2].set_ylabel("Score")
        axes[2].set_ylim(-100, 100)
        axes[2].legend(loc="upper left", ncol=3)

        axes[3].plot(dates, analysis_df["transition_risk_score"], color="#b91c1c", linewidth=1.1, label="Breakdown risk")
        axes[3].plot(
            dates,
            analysis_df["state_transition_probability_10d"],
            color="#ea580c",
            linewidth=1.0,
            label="10d state transition %",
        )
        axes[3].plot(dates, analysis_df["confidence_score"], color="#15803d", linewidth=1.0, label="Confidence")
        axes[3].axhline(60.0, color="#ef4444", linewidth=0.8, linestyle="--", alpha=0.7)
        axes[3].axhline(40.0, color="#16a34a", linewidth=0.8, linestyle=":", alpha=0.7)
        transition_events = analysis_df["transition_event"] == 1.0
        if bool(transition_events.any()):
            axes[3].scatter(
                dates[transition_events],
                analysis_df.loc[transition_events, "transition_risk_score"],
                color="#7f1d1d",
                s=12,
                alpha=0.8,
                label="Transition event",
            )
        axes[3].set_ylabel("0-100")
        axes[3].set_ylim(0, 100)
        state_change_events = analysis_df["state_transition_event_10d"] == 1.0
        if bool(state_change_events.any()):
            axes[3].scatter(
                dates[state_change_events],
                analysis_df.loc[state_change_events, "state_transition_probability_10d"],
                color="#9a3412",
                s=11,
                alpha=0.65,
                label="State change event",
            )
        axes[3].legend(loc="upper left", ncol=4)

        axes[4].plot(
            dates,
            analysis_df["rolling_sign_accuracy_60"] * 100.0,
            color="#0f766e",
            linewidth=1.0,
            label=f"Rolling 3-state ({self.rolling_match_window})",
        )
        axes[4].plot(
            dates,
            analysis_df["rolling_diagnosis_accuracy_60"] * 100.0,
            color="#7c3aed",
            linewidth=1.0,
            label=f"Rolling diagnosis ({self.rolling_match_window})",
        )
        axes[4].plot(
            dates,
            analysis_df["rolling_exact_accuracy_60"] * 100.0,
            color="#1d4ed8",
            linewidth=1.0,
            label=f"Rolling 5-state ({self.rolling_match_window})",
        )
        axes[4].set_ylabel("%")
        axes[4].set_ylim(0, 100)
        axes[4].legend(loc="upper left", ncol=3)

        axes[4].xaxis.set_major_locator(mdates.YearLocator())
        axes[4].xaxis.set_major_formatter(mdates.DateFormatter("%Y"))
        axes[4].set_xlabel("Date")

        for axis in axes:
            axis.grid(True, alpha=0.18, linewidth=0.6)

        fig.savefig(output_path, dpi=180, bbox_inches="tight")
        plt.close(fig)

    @staticmethod
    def _infer_ticker(csv_path: Path) -> str:
        stem = csv_path.stem
        return stem.split("_")[0].upper() if "_" in stem else stem.upper()

    @staticmethod
    def _shade_regimes(axis: plt.Axes, analysis_df: pd.DataFrame) -> None:
        dates = list(analysis_df["as_of_date"])
        regimes = list(analysis_df["regime_label"])
        if not dates:
            return

        segment_start = dates[0]
        current_regime = regimes[0]
        for index in range(1, len(dates)):
            if regimes[index] == current_regime:
                continue
            axis.axvspan(
                segment_start,
                dates[index],
                color=REGIME_COLORS.get(current_regime, "#d4d4d8"),
                alpha=0.10,
                linewidth=0,
            )
            segment_start = dates[index]
            current_regime = regimes[index]

        axis.axvspan(
            segment_start,
            dates[-1],
            color=REGIME_COLORS.get(current_regime, "#d4d4d8"),
            alpha=0.10,
            linewidth=0,
        )

    @staticmethod
    def _shade_test_window(axes: list[plt.Axes] | Any, metrics: dict[str, Any]) -> None:
        test_window = metrics.get("test_window", {})
        if not test_window.get("start") or not test_window.get("end"):
            return

        start = pd.Timestamp(test_window["start"])
        end = pd.Timestamp(test_window["end"])
        for index, axis in enumerate(axes):
            axis.axvspan(
                start,
                end,
                color="#cbd5e1",
                alpha=0.12,
                linewidth=0,
                label="Optimizer test window" if index == 0 else None,
            )


def load_optimized_config(
    best_params_csv: str | Path,
    base_config: EngineConfig | None = None,
) -> tuple[EngineConfig, dict[str, Any]]:
    """Merge head-wise best parameter rows into one effective engine config."""

    config = base_config or EngineConfig()
    best_params_csv = Path(best_params_csv).expanduser().resolve()
    best_df = pd.read_csv(best_params_csv)

    overrides: dict[str, Any] = {}
    metadata: dict[str, Any] = {}

    for row in best_df.to_dict("records"):
        head = str(row.get("head", "")).strip()
        if head:
            metadata[f"{head}_trial_id"] = row.get("trial_id")
            metadata[f"{head}_direction_family"] = row.get("direction_family")
        if not metadata.get("test_start") and row.get("test_start"):
            metadata["test_start"] = row.get("test_start")
        if not metadata.get("test_end") and row.get("test_end"):
            metadata["test_end"] = row.get("test_end")

        for key, value in row.items():
            if pd.isna(value):
                continue
            if key.startswith(("shared.", "direction.", "transition.", "confidence.")):
                normalized_path = _strip_head_prefix(key)
                _assign_nested_value(overrides, normalized_path, _coerce_scalar(value))

    return config.with_overrides(overrides), metadata


def _strip_head_prefix(path: str) -> str:
    for prefix in ("shared.", "direction.", "transition.", "confidence."):
        if path.startswith(prefix):
            return path[len(prefix) :]
    return path


def _assign_nested_value(target: dict[str, Any], path: str, value: Any) -> None:
    current = target
    parts = path.split(".")
    for part in parts[:-1]:
        current = current.setdefault(part, {})
    current[parts[-1]] = value


def _coerce_scalar(value: Any) -> Any:
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:  # noqa: BLE001
            return value
    return value
