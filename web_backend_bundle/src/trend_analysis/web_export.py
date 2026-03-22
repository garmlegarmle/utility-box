"""Web-ready payload export for the optimized trend analysis engine."""

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

import matplotlib.pyplot as plt
import pandas as pd

from .config import EngineConfig
from .engine import TrendAnalysisEngine
from .best_params import load_optimized_config
from .utils import clamp, collapse_regime_label, trend_state_label_ko


TREND_STATE_COLORS = {
    "bullish": "#16a34a",
    "sideways": "#a1a1aa",
    "bearish": "#dc2626",
}


@dataclass(slots=True)
class WebExportArtifacts:
    """Generated files for one web-ready export."""

    output_dir: Path
    payload_json: Path
    chart_png: Path
    summary_md: Path

    def to_dict(self) -> dict[str, str]:
        return {
            "output_dir": str(self.output_dir),
            "payload_json": str(self.payload_json),
            "chart_png": str(self.chart_png),
            "summary_md": str(self.summary_md),
        }


class WebAnalysisExporter:
    """Build a current-state payload and 200-bar chart for web integration."""

    def __init__(
        self,
        config: EngineConfig | None = None,
        config_source: str = "default",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self.config = config or EngineConfig()
        self.config_source = config_source
        self.metadata = metadata or {}
        self.engine = TrendAnalysisEngine(self.config)

    @classmethod
    def from_best_params_csv(
        cls,
        best_params_csv: str | Path,
        base_config: EngineConfig | None = None,
    ) -> WebAnalysisExporter:
        config, metadata = load_optimized_config(best_params_csv, base_config=base_config)
        return cls(
            config=config,
            config_source=str(Path(best_params_csv).expanduser().resolve()),
            metadata=metadata,
        )

    def export_from_csv(
        self,
        csv_path: str | Path,
        output_dir: str | Path,
        date_column: str = "date",
        ticker: str | None = None,
        window_bars: int = 200,
    ) -> WebExportArtifacts:
        csv_path = Path(csv_path).expanduser().resolve()
        output_dir = Path(output_dir).expanduser().resolve()
        output_dir.mkdir(parents=True, exist_ok=True)

        raw_frame = pd.read_csv(csv_path)
        normalized_date_column = date_column.strip()
        if normalized_date_column != "date" and normalized_date_column in raw_frame.columns:
            raw_frame = raw_frame.rename(columns={normalized_date_column: "date"})

        ticker_label = ticker or self._infer_ticker(csv_path)
        current_result = self.engine.analyze_csv(csv_path, date_column=normalized_date_column)
        history_df = self.engine.build_history_frame(raw_frame, date_column="date")
        history_df["as_of_date"] = pd.to_datetime(history_df["as_of_date"])
        chart_df = history_df.tail(window_bars).copy()

        payload = self._build_payload(
            ticker=ticker_label,
            current_result=current_result.to_dict(),
            chart_df=chart_df,
        )

        artifacts = WebExportArtifacts(
            output_dir=output_dir,
            payload_json=output_dir / f"{ticker_label}_web_payload.json",
            chart_png=output_dir / f"{ticker_label}_current_200d.png",
            summary_md=output_dir / f"{ticker_label}_web_summary.md",
        )
        artifacts.payload_json.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
        artifacts.summary_md.write_text(self._render_summary(payload, artifacts), encoding="utf-8")
        self._render_chart(chart_df, ticker_label, artifacts.chart_png)
        return artifacts

    def _build_payload(
        self,
        ticker: str,
        current_result: dict[str, Any],
        chart_df: pd.DataFrame,
    ) -> dict[str, Any]:
        trend_state_label = str(current_result["trend_state_label"])
        trend_strength_score = float(current_result["trend_strength_score"])
        transition_risk_score = float(current_result["transition_risk_score"])
        confidence_score = float(current_result["confidence_score"])
        composite_score = float(current_result["diagnostics"]["classification"]["composite_trend_score"])

        interpretation_ko = self._interpretation_text_ko(
            trend_state_label=trend_state_label,
            trend_strength_score=trend_strength_score,
            transition_risk_score=transition_risk_score,
            confidence_score=confidence_score,
            tags=list(current_result.get("tags", [])),
        )

        chart_rows = []
        for row in chart_df.to_dict("records"):
            chart_rows.append(
                {
                    "date": pd.Timestamp(row["as_of_date"]).date().isoformat(),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(row["volume"]),
                    "trend_state_label": str(row["trend_state_label"]),
                    "regime_label": str(row["regime_label"]),
                    "trend_strength_score": float(row["trend_strength_score"]),
                    "transition_risk_score": float(row["transition_risk_score"]),
                    "confidence_score": float(row["confidence_score"]),
                    "composite_trend_score": float(row["composite_trend_score"]),
                }
            )

        payload = {
            "meta": {
                "ticker": ticker,
                "as_of_date": current_result["as_of_date"],
                "config_source": self.config_source,
                "best_direction_family": self.metadata.get("direction_direction_family"),
                "window_bars": len(chart_rows),
                "window_start": chart_rows[0]["date"] if chart_rows else None,
                "window_end": chart_rows[-1]["date"] if chart_rows else None,
            },
            "current_state": {
                "trend_state_label": trend_state_label,
                "trend_state_label_ko": trend_state_label_ko(trend_state_label),
                "regime_label_internal": current_result["regime_label"],
                "trend_strength_score": trend_strength_score,
                "trend_conviction_score": abs(composite_score),
                "transition_risk_score": transition_risk_score,
                "transition_risk_label": current_result["transition_risk_label"],
                "confidence_score": confidence_score,
                "direction_score": float(current_result["trend_direction_score"]),
                "momentum_score": float(current_result["momentum_score"]),
                "volatility_regime_score": float(current_result["volatility_regime_score"]),
                "volume_confirmation_score": float(current_result["volume_confirmation_score"]),
                "tags": list(current_result.get("tags", [])),
                "summary_text": current_result["summary_text"],
                "interpretation_text_ko": interpretation_ko,
            },
            "chart_200d": {
                "candles": chart_rows,
            },
            "raw_feature_snapshot": current_result["raw_feature_snapshot"],
            "indicator_snapshot": current_result["indicator_snapshot"],
            "component_scores": current_result["component_scores"],
        }
        return payload

    def _render_summary(self, payload: dict[str, Any], artifacts: WebExportArtifacts) -> str:
        current = payload["current_state"]
        meta = payload["meta"]
        lines = [
            f"# {meta['ticker']} Web Export Summary",
            "",
            "## 현재 상태",
            f"- 기준일: {meta['as_of_date']}",
            f"- 3단계 추세: {current['trend_state_label']} ({current['trend_state_label_ko']})",
            f"- 추세 강도: {current['trend_strength_score']:.1f}",
            f"- 추세 확신도: {current['trend_conviction_score']:.1f}",
            f"- 전환 위험: {current['transition_risk_score']:.1f} ({current['transition_risk_label']})",
            f"- 신뢰도: {current['confidence_score']:.1f}",
            f"- 해석: {current['interpretation_text_ko']}",
            "",
            "## 파일",
            f"- JSON payload: `{artifacts.payload_json.name}`",
            f"- 200일 차트: `{artifacts.chart_png.name}`",
        ]
        return "\n".join(lines) + "\n"

    def _render_chart(self, chart_df: pd.DataFrame, ticker: str, output_path: Path) -> None:
        fig, axes = plt.subplots(
            3,
            1,
            figsize=(16, 10),
            sharex=True,
            gridspec_kw={"height_ratios": [3.0, 1.3, 1.3]},
        )
        fig.subplots_adjust(hspace=0.08)

        dates = chart_df["as_of_date"]
        close = chart_df["close"]

        self._shade_trend_states(axes[0], chart_df)
        axes[0].plot(dates, close, color="#111827", linewidth=1.25, label="Close")
        axes[0].set_title(f"{ticker} | Last {len(chart_df)} bars | 3-state trend + strength")
        axes[0].set_ylabel("Price")
        axes[0].legend(loc="upper left")

        axes[1].plot(dates, chart_df["trend_strength_score"], color="#1d4ed8", linewidth=1.1, label="Trend strength")
        axes[1].plot(
            dates,
            chart_df["composite_trend_score"].abs(),
            color="#7c3aed",
            linewidth=1.0,
            label="Trend conviction",
        )
        axes[1].set_ylim(0, 100)
        axes[1].set_ylabel("0-100")
        axes[1].legend(loc="upper left", ncol=2)

        axes[2].plot(dates, chart_df["transition_risk_score"], color="#dc2626", linewidth=1.1, label="Transition risk")
        axes[2].plot(dates, chart_df["confidence_score"], color="#15803d", linewidth=1.0, label="Confidence")
        axes[2].axhline(60.0, color="#ef4444", linestyle="--", linewidth=0.8, alpha=0.6)
        axes[2].set_ylim(0, 100)
        axes[2].set_ylabel("0-100")
        axes[2].legend(loc="upper left", ncol=2)

        for axis in axes:
            axis.grid(True, alpha=0.18, linewidth=0.6)

        fig.savefig(output_path, dpi=180, bbox_inches="tight")
        plt.close(fig)

    @staticmethod
    def _shade_trend_states(axis: plt.Axes, chart_df: pd.DataFrame) -> None:
        dates = list(chart_df["as_of_date"])
        states = list(chart_df["trend_state_label"])
        if not dates:
            return

        segment_start = dates[0]
        current_state = states[0]
        for index in range(1, len(dates)):
            if states[index] == current_state:
                continue
            axis.axvspan(
                segment_start,
                dates[index],
                color=TREND_STATE_COLORS.get(current_state, "#d4d4d8"),
                alpha=0.10,
                linewidth=0,
            )
            segment_start = dates[index]
            current_state = states[index]

        axis.axvspan(
            segment_start,
            dates[-1],
            color=TREND_STATE_COLORS.get(current_state, "#d4d4d8"),
            alpha=0.10,
            linewidth=0,
        )

    @staticmethod
    def _interpretation_text_ko(
        trend_state_label: str,
        trend_strength_score: float,
        transition_risk_score: float,
        confidence_score: float,
        tags: list[str],
    ) -> str:
        state_ko = trend_state_label_ko(trend_state_label)
        if transition_risk_score >= 65:
            transition_clause = "전환 위험이 높은 상태입니다."
        elif transition_risk_score >= 35:
            transition_clause = "전환 위험이 중간 수준입니다."
        else:
            transition_clause = "전환 위험은 낮은 편입니다."

        if trend_strength_score >= 60:
            strength_clause = "추세 강도는 강한 편입니다."
        elif trend_strength_score >= 35:
            strength_clause = "추세 강도는 중간 수준입니다."
        else:
            strength_clause = "추세 강도는 약한 편입니다."

        confidence_clause = f"현재 판독 신뢰도는 {clamp(confidence_score, 0.0, 100.0):.1f}입니다."

        tag_parts: list[str] = []
        if "reversal_risk_rising" in tags:
            tag_parts.append("반전 위험이 올라오고 있습니다.")
        if "trend_accelerating" in tags:
            tag_parts.append("추세 가속 신호가 동반됩니다.")
        if "trend_weakening" in tags:
            tag_parts.append("추세 약화 신호가 보입니다.")
        if "volume_unconfirmed" in tags:
            tag_parts.append("거래량 확인은 약합니다.")
        if "exhaustion_risk" in tags:
            tag_parts.append("단기 과열 가능성이 있습니다.")

        tail = " ".join(tag_parts)
        return f"현재 상태는 {state_ko}입니다. {strength_clause} {transition_clause} {confidence_clause} {tail}".strip()

    @staticmethod
    def _infer_ticker(csv_path: Path) -> str:
        stem = csv_path.stem
        return stem.split("_")[0].upper() if "_" in stem else stem.upper()
