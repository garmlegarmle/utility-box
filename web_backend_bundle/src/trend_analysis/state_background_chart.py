"""Render per-ticker price charts with trend-state background shading."""

from __future__ import annotations

import os
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
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
import pandas as pd

from .config import EngineConfig
from .engine import TrendAnalysisEngine
from .history_report import load_optimized_config


STATE_COLORS = {
    "bullish": "#fee2e2",
    "sideways": "#fef9c3",
    "bearish": "#dbeafe",
}

@dataclass(slots=True)
class TrendStateBackgroundArtifacts:
    """Rendered background-shaded charts."""

    output_dir: Path
    chart_paths: list[Path]

    def to_dict(self) -> dict[str, Any]:
        return {
            "output_dir": str(self.output_dir),
            "chart_paths": [str(path) for path in self.chart_paths],
        }


class TrendStateBackgroundChartRenderer:
    """Render black price charts with daily trend-state background overlays."""

    def __init__(
        self,
        config: EngineConfig | None = None,
        config_source: str = "default",
        transition_highlight_quantile: float = 0.95,
        transition_highlight_min_score: float = 15.0,
    ) -> None:
        self.config = config or EngineConfig()
        self.engine = TrendAnalysisEngine(self.config)
        self.config_source = config_source
        self.transition_highlight_quantile = transition_highlight_quantile
        self.transition_highlight_min_score = transition_highlight_min_score

    @classmethod
    def from_best_params_csv(
        cls,
        best_params_csv: str | Path,
        base_config: EngineConfig | None = None,
        transition_highlight_quantile: float = 0.95,
        transition_highlight_min_score: float = 15.0,
    ) -> TrendStateBackgroundChartRenderer:
        config, _metadata = load_optimized_config(best_params_csv, base_config=base_config)
        return cls(
            config=config,
            config_source=str(Path(best_params_csv).expanduser().resolve()),
            transition_highlight_quantile=transition_highlight_quantile,
            transition_highlight_min_score=transition_highlight_min_score,
        )

    def build_from_csv(
        self,
        csv_path: str | Path,
        output_dir: str | Path,
        date_column: str = "date",
        ticker: str | None = None,
    ) -> Path:
        """Render one ticker chart from one CSV."""

        csv_path = Path(csv_path).expanduser().resolve()
        output_dir = Path(output_dir).expanduser().resolve()
        output_dir.mkdir(parents=True, exist_ok=True)

        raw_frame = pd.read_csv(csv_path)
        normalized_date_column = date_column.strip()
        if normalized_date_column != "date" and normalized_date_column in raw_frame.columns:
            raw_frame = raw_frame.rename(columns={normalized_date_column: "date"})

        ticker_label = ticker or self._infer_ticker(csv_path)
        history_df = self.engine.build_history_frame(raw_frame, date_column="date")
        history_df["as_of_date"] = pd.to_datetime(history_df["as_of_date"])
        history_df = history_df.sort_values("as_of_date").reset_index(drop=True)

        chart_path = output_dir / f"{ticker_label}_trend_state_overlay.png"
        self._render_chart(history_df=history_df, ticker=ticker_label, output_path=chart_path)
        return chart_path

    def build_from_directory(
        self,
        input_dir: str | Path,
        output_dir: str | Path,
        pattern: str = "*_daily_10y.csv",
        date_column: str = "date",
    ) -> TrendStateBackgroundArtifacts:
        """Render one chart per CSV in a directory."""

        input_dir = Path(input_dir).expanduser().resolve()
        output_dir = Path(output_dir).expanduser().resolve()
        output_dir.mkdir(parents=True, exist_ok=True)

        chart_paths: list[Path] = []
        for csv_path in sorted(input_dir.glob(pattern)):
            chart_paths.append(
                self.build_from_csv(
                    csv_path=csv_path,
                    output_dir=output_dir,
                    date_column=date_column,
                )
            )
        return TrendStateBackgroundArtifacts(output_dir=output_dir, chart_paths=chart_paths)

    def _render_chart(
        self,
        history_df: pd.DataFrame,
        ticker: str,
        output_path: Path,
    ) -> None:
        fig, ax = plt.subplots(figsize=(18, 6.5))
        self._shade_states(ax=ax, history_df=history_df)

        ax.plot(
            history_df["as_of_date"],
            history_df["close"],
            color="#111111",
            linewidth=1.4,
            label="Close",
            zorder=3,
        )
        high_transition_mask = self._high_transition_mask(history_df)
        if bool(high_transition_mask.any()):
            ax.scatter(
                history_df.loc[high_transition_mask, "as_of_date"],
                history_df.loc[high_transition_mask, "close"],
                s=16,
                color="#dc2626",
                edgecolors="white",
                linewidths=0.4,
                alpha=0.95,
                zorder=4,
            )
        ax.set_title(
            f"{ticker} | Daily Trend-State Background Overlay | "
            f"{history_df['as_of_date'].min():%Y-%m-%d} ~ {history_df['as_of_date'].max():%Y-%m-%d}"
        )
        ax.set_ylabel("Price")
        ax.set_xlabel("Date")
        ax.grid(True, alpha=0.15, linewidth=0.6)

        legend_handles = [
            Patch(facecolor=STATE_COLORS["bullish"], edgecolor="none", label="Bullish"),
            Patch(facecolor=STATE_COLORS["sideways"], edgecolor="none", label="Sideways"),
            Patch(facecolor=STATE_COLORS["bearish"], edgecolor="none", label="Bearish"),
            Line2D([0], [0], color="#111111", linewidth=1.4, label="Close"),
            Line2D(
                [0],
                [0],
                marker="o",
                color="none",
                markerfacecolor="#dc2626",
                markeredgecolor="white",
                markeredgewidth=0.4,
                markersize=6,
                label=f"High transition risk ({int(self.transition_highlight_quantile * 100)}th pct+)",
            ),
        ]
        ax.legend(handles=legend_handles, loc="upper left", ncol=5, frameon=False)

        ax.xaxis.set_major_locator(mdates.YearLocator())
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y"))
        fig.autofmt_xdate()
        fig.savefig(output_path, dpi=180, bbox_inches="tight")
        plt.close(fig)

    @staticmethod
    def _shade_states(ax: plt.Axes, history_df: pd.DataFrame) -> None:
        dates = pd.to_datetime(history_df["as_of_date"]).tolist()
        states = history_df["trend_state_label"].fillna("sideways").astype(str).tolist()
        if not dates:
            return

        date_nums = mdates.date2num(dates)
        if len(date_nums) == 1:
            ax.axvspan(
                date_nums[0] - 0.5,
                date_nums[0] + 0.5,
                color=STATE_COLORS.get(states[0], STATE_COLORS["sideways"]),
                alpha=0.45,
                linewidth=0,
                zorder=0,
            )
            return

        midpoints = [(date_nums[index] + date_nums[index + 1]) / 2.0 for index in range(len(date_nums) - 1)]
        starts = [date_nums[0] - (midpoints[0] - date_nums[0]), *midpoints]
        ends = [*midpoints, date_nums[-1] + (date_nums[-1] - midpoints[-1])]

        segment_start = starts[0]
        current_state = states[0]
        for index in range(1, len(states)):
            if states[index] == current_state:
                continue
            ax.axvspan(
                segment_start,
                ends[index - 1],
                color=STATE_COLORS.get(current_state, STATE_COLORS["sideways"]),
                alpha=0.45,
                linewidth=0,
                zorder=0,
            )
            segment_start = starts[index]
            current_state = states[index]

        ax.axvspan(
            segment_start,
            ends[-1],
            color=STATE_COLORS.get(current_state, STATE_COLORS["sideways"]),
            alpha=0.45,
            linewidth=0,
            zorder=0,
        )

    def _high_transition_mask(self, history_df: pd.DataFrame) -> pd.Series:
        scores = history_df["transition_risk_score"].fillna(0.0).astype(float)
        if scores.empty:
            return pd.Series(dtype=bool)
        threshold = max(
            float(scores.quantile(self.transition_highlight_quantile)),
            self.transition_highlight_min_score,
        )
        return scores >= threshold

    @staticmethod
    def _infer_ticker(csv_path: Path) -> str:
        stem = csv_path.stem
        return stem.split("_")[0].upper() if "_" in stem else stem.upper()
