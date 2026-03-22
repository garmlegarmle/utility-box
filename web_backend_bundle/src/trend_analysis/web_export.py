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
from .utils import clamp, trend_state_label_ko


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

        payload, chart_df = self.build_payload_from_csv(
            csv_path=csv_path,
            date_column=date_column,
            ticker=ticker,
            window_bars=window_bars,
        )
        ticker_label = str(payload["meta"]["ticker"])

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

    def build_payload_from_csv(
        self,
        csv_path: str | Path,
        date_column: str = "date",
        ticker: str | None = None,
        window_bars: int = 200,
    ) -> tuple[dict[str, Any], pd.DataFrame]:
        csv_path = Path(csv_path).expanduser().resolve()
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
        return payload, chart_df

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
        text_bundle = self._build_text_bundle(
            trend_state_label=trend_state_label,
            current_result=current_result,
            chart_df=chart_df,
        )

        chart_rows = []
        for row in chart_df.to_dict("records"):
            chart_rows.append(
                {
                    "date": pd.Timestamp(row["as_of_date"]).date().isoformat(),
                    "open": self._safe_float(row["open"]),
                    "high": self._safe_float(row["high"]),
                    "low": self._safe_float(row["low"]),
                    "close": self._safe_float(row["close"]),
                    "volume": self._safe_float(row["volume"]),
                    "trend_state_label": str(row["trend_state_label"]),
                    "regime_label": str(row["regime_label"]),
                    "trend_strength_score": self._safe_float(row["trend_strength_score"]),
                    "transition_risk_score": self._safe_float(row["transition_risk_score"]),
                    "confidence_score": self._safe_float(row["confidence_score"]),
                    "composite_trend_score": self._safe_float(row["composite_trend_score"]),
                    "ema20": self._safe_float(row.get("ema20")),
                    "ema50": self._safe_float(row.get("ema50")),
                    "sma200": self._safe_float(row.get("sma200")),
                    "ichimoku_tenkan": self._safe_float(row.get("ichimoku_tenkan")),
                    "ichimoku_kijun": self._safe_float(row.get("ichimoku_kijun")),
                    "ichimoku_cloud_a": self._safe_float(row.get("ichimoku_cloud_a")),
                    "ichimoku_cloud_b": self._safe_float(row.get("ichimoku_cloud_b")),
                    "macd_line": self._safe_float(row.get("macd_line")),
                    "macd_signal": self._safe_float(row.get("macd_signal")),
                    "macd_hist": self._safe_float(row.get("macd_hist")),
                    "rsi": self._safe_float(row.get("rsi")),
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
                "interpretation_text_en": text_bundle["interpretation_text_en"],
                "interpretation_text_ko": text_bundle["interpretation_text_ko"],
                "summary_brief_en": text_bundle["summary_brief_en"],
                "summary_brief_ko": text_bundle["summary_brief_ko"],
                "summary_bullets_en": text_bundle["summary_bullets_en"],
                "summary_bullets_ko": text_bundle["summary_bullets_ko"],
                "detail_sections_en": text_bundle["detail_sections_en"],
                "detail_sections_ko": text_bundle["detail_sections_ko"],
            },
            "chart_200d": {
                "candles": chart_rows,
            },
            "raw_feature_snapshot": current_result["raw_feature_snapshot"],
            "indicator_snapshot": current_result["indicator_snapshot"],
            "component_scores": current_result["component_scores"],
        }
        return payload

    @staticmethod
    def _safe_float(value: Any) -> float | None:
        if value is None or pd.isna(value):
            return None
        return float(value)

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
            f"- 해석 요약: {current['summary_brief_ko']}",
            f"- 상세 해석: {current['interpretation_text_ko']}",
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

    def _build_text_bundle(
        self,
        trend_state_label: str,
        current_result: dict[str, Any],
        chart_df: pd.DataFrame,
    ) -> dict[str, Any]:
        indicator_snapshot = current_result.get("indicator_snapshot", {}) or {}
        latest = chart_df.iloc[-1].to_dict() if not chart_df.empty else {}
        previous = chart_df.iloc[-2].to_dict() if len(chart_df) > 1 else {}
        tags = list(current_result.get("tags", []))

        state_en = self._trend_state_label_en(trend_state_label)
        state_ko = trend_state_label_ko(trend_state_label)
        transition_score = float(current_result["transition_risk_score"])
        confidence_score = clamp(float(current_result["confidence_score"]), 0.0, 100.0)
        strength_score = float(current_result["trend_strength_score"])
        conviction_score = abs(float(current_result["diagnostics"]["classification"]["composite_trend_score"]))
        direction_score = float(current_result["trend_direction_score"])
        momentum_score = float(current_result["momentum_score"])
        volatility_score = float(current_result["volatility_regime_score"])
        volume_score = float(current_result["volume_confirmation_score"])

        close = self._safe_float(indicator_snapshot.get("close"))
        ema20 = self._safe_float(indicator_snapshot.get("ema20"))
        ema50 = self._safe_float(indicator_snapshot.get("ema50"))
        sma200 = self._safe_float(indicator_snapshot.get("sma200"))
        tenkan = self._safe_float(indicator_snapshot.get("ichimoku_tenkan"))
        kijun = self._safe_float(indicator_snapshot.get("ichimoku_kijun"))
        cloud_a = self._safe_float(indicator_snapshot.get("ichimoku_cloud_a"))
        cloud_b = self._safe_float(indicator_snapshot.get("ichimoku_cloud_b"))
        rsi = self._safe_float(indicator_snapshot.get("rsi"))
        macd_line = self._safe_float(indicator_snapshot.get("macd_line"))
        macd_signal = self._safe_float(indicator_snapshot.get("macd_signal"))
        macd_hist = self._safe_float(indicator_snapshot.get("macd_hist"))
        adx = self._safe_float(indicator_snapshot.get("adx"))
        atr_pct = self._safe_float(indicator_snapshot.get("atr_pct"))

        prev_ema20 = self._safe_float(previous.get("ema20"))
        prev_ema50 = self._safe_float(previous.get("ema50"))
        prev_sma200 = self._safe_float(previous.get("sma200"))
        prev_tenkan = self._safe_float(previous.get("ichimoku_tenkan"))
        prev_kijun = self._safe_float(previous.get("ichimoku_kijun"))
        prev_macd_line = self._safe_float(previous.get("macd_line"))
        prev_macd_signal = self._safe_float(previous.get("macd_signal"))

        price_stack_en, price_stack_ko = self._price_stack_text(close, ema20, ema50, sma200)
        long_cross_en, long_cross_ko = self._cross_text(
            prev_fast=prev_ema50,
            prev_slow=prev_sma200,
            current_fast=ema50,
            current_slow=sma200,
            fresh_bull_en="A fresh 50/200 golden cross has just formed.",
            fresh_bear_en="A fresh 50/200 death cross has just formed.",
            state_bull_en="The 50-day average remains above the 200-day average, so the classic golden-cross structure is still in place.",
            state_bear_en="The 50-day average remains below the 200-day average, so the market is still in a death-cross structure.",
            fresh_bull_ko="50일선이 200일선을 상향 돌파해 골든 크로스가 새로 형성됐습니다.",
            fresh_bear_ko="50일선이 200일선을 하향 돌파해 데드 크로스가 새로 형성됐습니다.",
            state_bull_ko="50일선이 200일선 위에 있어 고전적인 골든 크로스 구조가 유지되고 있습니다.",
            state_bear_ko="50일선이 200일선 아래에 있어 데드 크로스 구조가 유지되고 있습니다.",
        )
        short_cross_en, short_cross_ko = self._cross_text(
            prev_fast=prev_ema20,
            prev_slow=prev_ema50,
            current_fast=ema20,
            current_slow=ema50,
            fresh_bull_en="EMA20 has just crossed above EMA50, which improves the short-term tone.",
            fresh_bear_en="EMA20 has just crossed below EMA50, which weakens the short-term tone.",
            state_bull_en="EMA20 remains above EMA50, so short-term momentum is still leading the medium-term baseline.",
            state_bear_en="EMA20 remains below EMA50, so short-term price action is still weaker than the medium-term baseline.",
            fresh_bull_ko="EMA20이 EMA50을 상향 돌파해 단기 톤이 개선되고 있습니다.",
            fresh_bear_ko="EMA20이 EMA50을 하향 돌파해 단기 톤이 약해지고 있습니다.",
            state_bull_ko="EMA20이 EMA50 위에 있어 단기 가격 흐름이 중기 기준선보다 강합니다.",
            state_bear_ko="EMA20이 EMA50 아래에 있어 단기 가격 흐름이 중기 기준선보다 약합니다.",
        )

        rsi_en, rsi_ko = self._rsi_text(rsi)
        macd_en, macd_ko = self._macd_text(
            prev_macd_line=prev_macd_line,
            prev_macd_signal=prev_macd_signal,
            macd_line=macd_line,
            macd_signal=macd_signal,
            macd_hist=macd_hist,
        )
        ichimoku_en, ichimoku_ko = self._ichimoku_text(
            close=close,
            cloud_a=cloud_a,
            cloud_b=cloud_b,
            prev_tenkan=prev_tenkan,
            prev_kijun=prev_kijun,
            tenkan=tenkan,
            kijun=kijun,
        )
        risk_en, risk_ko = self._risk_text(
            transition_score=transition_score,
            confidence_score=confidence_score,
            tags=tags,
        )
        condition_en, condition_ko = self._condition_text(
            adx=adx,
            atr_pct=atr_pct,
            volume_score=volume_score,
            volatility_score=volatility_score,
        )

        summary_brief_en = (
            f"{state_en} bias remains the base case. Strength is {strength_score:.1f}/100, "
            f"confidence is {confidence_score:.1f}/100, and transition risk is {transition_score:.1f}/100."
        )
        summary_brief_ko = (
            f"현재 기본 시나리오는 {state_ko}입니다. 추세 강도는 {strength_score:.1f}/100, "
            f"신뢰도는 {confidence_score:.1f}/100, 전환 위험은 {transition_score:.1f}/100입니다."
        )

        summary_bullets_en = [
            summary_brief_en,
            price_stack_en,
            f"{rsi_en} {macd_en}",
            ichimoku_en,
        ]
        summary_bullets_ko = [
            summary_brief_ko,
            price_stack_ko,
            f"{rsi_ko} {macd_ko}",
            ichimoku_ko,
        ]

        detail_sections_en = [
            (
                f"The model currently reads the chart as {state_en.lower()}. Direction score is {direction_score:.1f}, "
                f"trend conviction is {conviction_score:.1f}, and momentum score is {momentum_score:.1f}, so the directional bias "
                f"is not based on one indicator alone but on a broader combination of structure, momentum, and confirmation."
            ),
            f"{price_stack_en} {short_cross_en} {long_cross_en}",
            f"{rsi_en} {macd_en}",
            ichimoku_en,
            f"{condition_en} {risk_en}",
        ]
        detail_sections_ko = [
            (
                f"현재 모델은 차트를 {state_ko}으로 읽고 있습니다. 방향 점수는 {direction_score:.1f}, "
                f"추세 확신도는 {conviction_score:.1f}, 모멘텀 점수는 {momentum_score:.1f}로 계산되어, "
                f"하나의 지표가 아니라 구조, 모멘텀, 확인 신호를 함께 반영한 판독입니다."
            ),
            f"{price_stack_ko} {short_cross_ko} {long_cross_ko}",
            f"{rsi_ko} {macd_ko}",
            ichimoku_ko,
            f"{condition_ko} {risk_ko}",
        ]

        return {
            "summary_brief_en": summary_brief_en,
            "summary_brief_ko": summary_brief_ko,
            "summary_bullets_en": [item for item in summary_bullets_en if item],
            "summary_bullets_ko": [item for item in summary_bullets_ko if item],
            "detail_sections_en": [item for item in detail_sections_en if item],
            "detail_sections_ko": [item for item in detail_sections_ko if item],
            "interpretation_text_en": " ".join(item for item in detail_sections_en if item),
            "interpretation_text_ko": " ".join(item for item in detail_sections_ko if item),
        }

    @staticmethod
    def _trend_state_label_en(trend_state_label: str) -> str:
        mapping = {
            "bullish": "Bullish",
            "sideways": "Sideways",
            "bearish": "Bearish",
        }
        return mapping.get(trend_state_label, trend_state_label.replace("_", " ").title())

    @staticmethod
    def _price_stack_text(
        close: float | None,
        ema20: float | None,
        ema50: float | None,
        sma200: float | None,
    ) -> tuple[str, str]:
        if None in {close, ema20, ema50, sma200}:
            return (
                "The moving-average structure is only partially available, so this read should be treated with more caution.",
                "이동평균선 구조가 일부만 계산돼 있어, 해당 해석은 보수적으로 받아들이는 것이 좋습니다.",
            )
        assert close is not None and ema20 is not None and ema50 is not None and sma200 is not None
        if close > ema20 > ema50 > sma200:
            return (
                "Price is above EMA20, EMA50, and SMA200 in a clean bullish stack, which means short-, medium-, and long-term structure are aligned upward.",
                "가격이 EMA20, EMA50, SMA200 위에 순서대로 놓여 있어 단기, 중기, 장기 구조가 모두 상승 쪽으로 정렬돼 있습니다.",
            )
        if close < ema20 < ema50 < sma200:
            return (
                "Price is below EMA20, EMA50, and SMA200 in a clean bearish stack, which means the structure is weak across short, medium, and long horizons.",
                "가격이 EMA20, EMA50, SMA200 아래에 순서대로 놓여 있어 단기, 중기, 장기 구조가 모두 약한 상태입니다.",
            )
        return (
            "The moving-average stack is mixed rather than fully aligned, so the chart still contains conflicting structure between timeframes.",
            "이동평균선 배열이 완전히 정렬되지 않아 시간대별 구조가 서로 엇갈리는 혼합 구간으로 볼 수 있습니다.",
        )

    @staticmethod
    def _cross_text(
        prev_fast: float | None,
        prev_slow: float | None,
        current_fast: float | None,
        current_slow: float | None,
        fresh_bull_en: str,
        fresh_bear_en: str,
        state_bull_en: str,
        state_bear_en: str,
        fresh_bull_ko: str,
        fresh_bear_ko: str,
        state_bull_ko: str,
        state_bear_ko: str,
    ) -> tuple[str, str]:
        if current_fast is None or current_slow is None:
            return "", ""
        if prev_fast is not None and prev_slow is not None:
            if prev_fast <= prev_slow and current_fast > current_slow:
                return fresh_bull_en, fresh_bull_ko
            if prev_fast >= prev_slow and current_fast < current_slow:
                return fresh_bear_en, fresh_bear_ko
        if current_fast > current_slow:
            return state_bull_en, state_bull_ko
        if current_fast < current_slow:
            return state_bear_en, state_bear_ko
        return "", ""

    @staticmethod
    def _rsi_text(rsi: float | None) -> tuple[str, str]:
        if rsi is None:
            return (
                "RSI is not available yet, so overbought and oversold conditions cannot be judged reliably.",
                "RSI가 아직 계산되지 않아 과매수·과매도 판단을 확실하게 내리기 어렵습니다.",
            )
        if rsi >= 70:
            return (
                f"RSI is {rsi:.1f}, which is in overbought territory. That does not automatically mean an immediate reversal, but it does mean upside extension is already stretched.",
                f"RSI는 {rsi:.1f}로 과매수 구간입니다. 즉시 하락 반전을 뜻하진 않지만, 상승 폭이 이미 많이 늘어난 상태로 해석할 수 있습니다.",
            )
        if rsi <= 30:
            return (
                f"RSI is {rsi:.1f}, which is in oversold territory. That reflects heavy selling pressure, but it also means rebound odds can rise if selling starts to exhaust.",
                f"RSI는 {rsi:.1f}로 과매도 구간입니다. 매도 압력이 강하다는 뜻이지만, 매도 소진이 나타나면 반등 가능성도 함께 커질 수 있습니다.",
            )
        if rsi >= 60:
            return (
                f"RSI is {rsi:.1f}, which still supports bullish momentum without yet being fully overbought.",
                f"RSI는 {rsi:.1f}로 아직 극단적 과매수는 아니지만 상승 모멘텀이 유지되는 구간입니다.",
            )
        if rsi <= 40:
            return (
                f"RSI is {rsi:.1f}, which points to weak momentum and keeps the chart closer to bearish or defensive conditions.",
                f"RSI는 {rsi:.1f}로 모멘텀이 약하며 차트가 하락 또는 방어적 구간에 더 가깝다는 뜻입니다.",
            )
        return (
            f"RSI is {rsi:.1f}, which is near the middle of its range and suggests momentum is balanced rather than extreme.",
            f"RSI는 {rsi:.1f}로 중립대에 가까워 모멘텀이 한쪽으로 과도하게 치우치지는 않은 상태입니다.",
        )

    @staticmethod
    def _macd_text(
        prev_macd_line: float | None,
        prev_macd_signal: float | None,
        macd_line: float | None,
        macd_signal: float | None,
        macd_hist: float | None,
    ) -> tuple[str, str]:
        if macd_line is None or macd_signal is None:
            return (
                "MACD is unavailable, so momentum confirmation from the oscillator is incomplete.",
                "MACD가 계산되지 않아 오실레이터 기준 모멘텀 확인은 아직 제한적입니다.",
            )
        if prev_macd_line is not None and prev_macd_signal is not None:
            if prev_macd_line <= prev_macd_signal and macd_line > macd_signal:
                return (
                    "MACD has just crossed above its signal line, which is an early bullish momentum improvement signal.",
                    "MACD가 시그널선을 방금 상향 돌파해 초기 상승 모멘텀 개선 신호로 해석할 수 있습니다.",
                )
            if prev_macd_line >= prev_macd_signal and macd_line < macd_signal:
                return (
                    "MACD has just crossed below its signal line, which is an early warning that upside momentum is fading.",
                    "MACD가 시그널선을 방금 하향 돌파해 상승 탄력이 약해지고 있다는 초기 경고로 볼 수 있습니다.",
                )
        if macd_line > macd_signal and (macd_hist or 0.0) >= 0:
            return (
                "MACD remains above the signal line with a non-negative histogram, so momentum confirmation is still constructive.",
                "MACD가 시그널선 위에 있고 히스토그램도 음수가 아니어서 모멘텀 확인 신호는 아직 우호적입니다.",
            )
        if macd_line < macd_signal and (macd_hist or 0.0) <= 0:
            return (
                "MACD remains below the signal line with a non-positive histogram, so momentum confirmation is still weak.",
                "MACD가 시그널선 아래에 있고 히스토그램도 양수가 아니어서 모멘텀 확인 신호는 여전히 약합니다.",
            )
        return (
            "MACD and its signal line are close together, so momentum confirmation is mixed and can change quickly.",
            "MACD와 시그널선 간격이 크지 않아 모멘텀 확인 신호는 혼재되어 있고 빠르게 바뀔 수 있습니다.",
        )

    @staticmethod
    def _ichimoku_text(
        close: float | None,
        cloud_a: float | None,
        cloud_b: float | None,
        prev_tenkan: float | None,
        prev_kijun: float | None,
        tenkan: float | None,
        kijun: float | None,
    ) -> tuple[str, str]:
        if None in {close, cloud_a, cloud_b, tenkan, kijun}:
            return (
                "The Ichimoku read is incomplete, so cloud positioning should be treated as a secondary input for now.",
                "일목균형표 계산이 일부 비어 있어 현재는 구름대 해석을 보조 지표 수준으로만 보는 것이 좋습니다.",
            )
        assert close is not None and cloud_a is not None and cloud_b is not None and tenkan is not None and kijun is not None
        cloud_top = max(cloud_a, cloud_b)
        cloud_bottom = min(cloud_a, cloud_b)
        if close > cloud_top:
            cloud_en = "Price is above the Ichimoku cloud, which keeps the broader bias constructive."
            cloud_ko = "가격이 일목 구름대 위에 있어 큰 방향성은 비교적 우호적입니다."
        elif close < cloud_bottom:
            cloud_en = "Price is below the Ichimoku cloud, which keeps the broader bias defensive."
            cloud_ko = "가격이 일목 구름대 아래에 있어 큰 방향성은 방어적입니다."
        else:
            cloud_en = "Price is inside the Ichimoku cloud, which usually means the market is in a transition or neutral zone."
            cloud_ko = "가격이 일목 구름대 안에 있어 전환 구간 또는 중립 구간으로 해석하는 것이 일반적입니다."

        tenkan_cross_en, tenkan_cross_ko = WebAnalysisExporter._cross_text(
            prev_fast=prev_tenkan,
            prev_slow=prev_kijun,
            current_fast=tenkan,
            current_slow=kijun,
            fresh_bull_en="Tenkan has crossed above Kijun, which improves the short-term Ichimoku tone.",
            fresh_bear_en="Tenkan has crossed below Kijun, which weakens the short-term Ichimoku tone.",
            state_bull_en="Tenkan stays above Kijun, so the short-term Ichimoku signal is still positive.",
            state_bear_en="Tenkan stays below Kijun, so the short-term Ichimoku signal is still weak.",
            fresh_bull_ko="전환선이 기준선을 상향 돌파해 단기 일목 신호가 개선되고 있습니다.",
            fresh_bear_ko="전환선이 기준선을 하향 돌파해 단기 일목 신호가 약해지고 있습니다.",
            state_bull_ko="전환선이 기준선 위에 있어 단기 일목 신호는 아직 긍정적입니다.",
            state_bear_ko="전환선이 기준선 아래에 있어 단기 일목 신호는 아직 약합니다.",
        )
        return f"{cloud_en} {tenkan_cross_en}".strip(), f"{cloud_ko} {tenkan_cross_ko}".strip()

    @staticmethod
    def _risk_text(
        transition_score: float,
        confidence_score: float,
        tags: list[str],
    ) -> tuple[str, str]:
        if transition_score >= 65:
            risk_en = "Transition risk is high, so the current trend state is more vulnerable to sharp reversals or failed continuation."
            risk_ko = "전환 위험이 높아 현재 추세 상태가 급격한 반전이나 추세 실패에 더 취약합니다."
        elif transition_score >= 35:
            risk_en = "Transition risk is moderate, so the current move still deserves follow-through confirmation."
            risk_ko = "전환 위험이 중간 수준이어서 현재 움직임이 이어지는지 추가 확인이 필요합니다."
        else:
            risk_en = "Transition risk is low, so there is not much evidence yet that the current regime is immediately breaking."
            risk_ko = "전환 위험이 낮아 현재 국면이 당장 무너진다는 신호는 아직 크지 않습니다."

        confidence_en = f"Model confidence is {confidence_score:.1f}/100, which means this read is {'reasonably dependable' if confidence_score >= 60 else 'still tentative'}."
        confidence_ko = f"모델 신뢰도는 {confidence_score:.1f}/100으로, 이 판독은 {'비교적 신뢰할 만한 편' if confidence_score >= 60 else '아직은 가설 성격이 강한 편'}입니다."

        tag_parts_en: list[str] = []
        tag_parts_ko: list[str] = []
        if "reversal_risk_rising" in tags:
            tag_parts_en.append("Reversal pressure is rising.")
            tag_parts_ko.append("반전 압력이 올라오고 있습니다.")
        if "trend_accelerating" in tags:
            tag_parts_en.append("Trend acceleration is visible.")
            tag_parts_ko.append("추세 가속 신호가 보입니다.")
        if "trend_weakening" in tags:
            tag_parts_en.append("Some trend quality metrics are weakening.")
            tag_parts_ko.append("일부 추세 질 지표가 약해지고 있습니다.")
        if "volume_unconfirmed" in tags:
            tag_parts_en.append("Volume is not fully confirming the move.")
            tag_parts_ko.append("거래량이 움직임을 충분히 확인해 주지는 못하고 있습니다.")
        if "exhaustion_risk" in tags:
            tag_parts_en.append("Short-term exhaustion risk is visible.")
            tag_parts_ko.append("단기 소진 위험이 보입니다.")

        tail_en = " ".join(tag_parts_en)
        tail_ko = " ".join(tag_parts_ko)
        return f"{risk_en} {confidence_en} {tail_en}".strip(), f"{risk_ko} {confidence_ko} {tail_ko}".strip()

    @staticmethod
    def _condition_text(
        adx: float | None,
        atr_pct: float | None,
        volume_score: float,
        volatility_score: float,
    ) -> tuple[str, str]:
        adx_text_en = ""
        adx_text_ko = ""
        if adx is not None:
            if adx >= 35:
                adx_text_en = f"ADX is {adx:.1f}, which points to a strong trend environment rather than a sleepy range."
                adx_text_ko = f"ADX는 {adx:.1f}로, 지루한 박스권보다는 추세성이 강한 환경에 가깝습니다."
            elif adx >= 20:
                adx_text_en = f"ADX is {adx:.1f}, which suggests the market has some trend strength but is not in an extreme trend state."
                adx_text_ko = f"ADX는 {adx:.1f}로, 어느 정도 추세성은 있지만 극단적으로 강한 추세 상태는 아닙니다."
            else:
                adx_text_en = f"ADX is {adx:.1f}, which suggests the chart is still closer to a range or low-conviction move."
                adx_text_ko = f"ADX는 {adx:.1f}로, 차트가 아직은 박스권 또는 낮은 확신도의 움직임에 더 가깝습니다."

        atr_text_en = ""
        atr_text_ko = ""
        if atr_pct is not None:
            atr_text_en = f"ATR is about {atr_pct:.2f}% of price, so the current daily swing size is {'elevated' if atr_pct >= 3 else 'fairly contained'}."
            atr_text_ko = f"ATR은 가격 대비 약 {atr_pct:.2f}%로, 최근 일간 변동폭은 {'다소 큰 편' if atr_pct >= 3 else '비교적 통제된 편'}입니다."

        volume_text_en = (
            "Volume confirmation is supportive."
            if volume_score >= 25
            else "Volume confirmation is weak."
            if volume_score <= -25
            else "Volume confirmation is mixed."
        )
        volume_text_ko = (
            "거래량 확인 신호는 우호적입니다."
            if volume_score >= 25
            else "거래량 확인 신호는 약합니다."
            if volume_score <= -25
            else "거래량 확인 신호는 혼재되어 있습니다."
        )

        volatility_text_en = (
            "Volatility regime is elevated."
            if volatility_score >= 66
            else "Volatility regime is moderate."
            if volatility_score >= 33
            else "Volatility regime is quiet."
        )
        volatility_text_ko = (
            "변동성 환경은 높은 편입니다."
            if volatility_score >= 66
            else "변동성 환경은 중간 수준입니다."
            if volatility_score >= 33
            else "변동성 환경은 조용한 편입니다."
        )

        return (
            f"{adx_text_en} {atr_text_en} {volume_text_en} {volatility_text_en}".strip(),
            f"{adx_text_ko} {atr_text_ko} {volume_text_ko} {volatility_text_ko}".strip(),
        )

    @staticmethod
    def _infer_ticker(csv_path: Path) -> str:
        stem = csv_path.stem
        return stem.split("_")[0].upper() if "_" in stem else stem.upper()
