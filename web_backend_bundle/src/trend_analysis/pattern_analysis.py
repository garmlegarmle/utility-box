"""Rule-based chart pattern ranking for daily OHLCV windows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .config import EngineConfig
from .indicators import IndicatorEngine
from .models import PatternAnalysisResult, PatternCandidate
from .utils import clamp, linear_regression_slope, safe_divide


@dataclass(slots=True)
class _Pivot:
    """Internal swing-point representation."""

    position: int
    timestamp: Any
    price: float


class ChartPatternAnalyzer:
    """Score likely chart patterns from a recent OHLCV window."""

    def __init__(self, config: EngineConfig | None = None) -> None:
        self.config = config or EngineConfig()
        self.indicator_engine = IndicatorEngine(self.config)

    def analyze(
        self,
        frame: pd.DataFrame,
        indicator_frame: pd.DataFrame | None = None,
        trend_context: dict[str, Any] | None = None,
    ) -> PatternAnalysisResult:
        """Return the highest-scoring pattern candidates for the current window."""

        pattern_cfg = self.config.patterns
        window = frame.tail(pattern_cfg.analysis_window_bars).copy()
        indicators = indicator_frame.loc[window.index].copy() if indicator_frame is not None else self.indicator_engine.compute(window)
        context = self._build_context(window, indicators, trend_context or {})

        candidates = self._score_structure_and_trend(context)
        candidates.extend(self._score_reversal_patterns(context))
        candidates.extend(self._score_continuation_patterns(context))
        candidates.extend(self._score_volatility_patterns(context))
        candidates.extend(self._score_candle_patterns(context))
        candidates.extend(self._score_volume_patterns(context))

        filtered = [candidate for candidate in candidates if candidate.score >= pattern_cfg.min_candidate_score]
        ranked = sorted(filtered, key=lambda item: (-item.score, item.pattern_name))
        if not ranked:
            ranked = [self._fallback_candidate(context)]

        primary = ranked[0] if ranked else None
        secondary = ranked[1] if len(ranked) > 1 else None
        summary = self._build_summary(primary, secondary, context)

        return PatternAnalysisResult(
            as_of_date=self._as_of_datetime(window.index[-1]),
            summary_text_ko=summary,
            candidates=ranked[: max(pattern_cfg.top_candidates, 8)],
            primary_candidate=primary,
            secondary_candidate=secondary,
            diagnostics=self._diagnostics(context, ranked),
        )

    def analyze_csv(
        self,
        path: str | Path,
        date_column: str = "date",
    ) -> PatternAnalysisResult:
        """Convenience wrapper that loads a CSV and runs pattern analysis."""

        raw_frame = pd.read_csv(path)
        normalized = raw_frame.copy()
        normalized.columns = [str(column).strip().lower() for column in normalized.columns]
        if date_column and date_column.strip().lower() in normalized.columns:
            date_key = date_column.strip().lower()
            normalized[date_key] = pd.to_datetime(normalized[date_key], errors="coerce")
            normalized = normalized.set_index(date_key)
        if not isinstance(normalized.index, pd.DatetimeIndex):
            normalized.index = pd.to_datetime(normalized.index, errors="coerce")
        normalized = normalized.sort_index()
        return self.analyze(normalized)

    def _build_context(
        self,
        window: pd.DataFrame,
        indicators: pd.DataFrame,
        trend_context: dict[str, Any],
    ) -> dict[str, Any]:
        cfg = self.config.patterns
        close = window["close"].astype(float)
        open_ = window["open"].astype(float)
        high = window["high"].astype(float)
        low = window["low"].astype(float)
        volume = window["volume"].astype(float)

        atr_series = indicators.get("atr", (high - low).rolling(window=14, min_periods=5).mean()).bfill()
        atr_value = float(atr_series.iloc[-1]) if not atr_series.empty and not pd.isna(atr_series.iloc[-1]) else float((high - low).tail(20).mean())
        atr_value = max(atr_value, 1e-6)
        bb_width = indicators.get("bb_width", pd.Series(dtype=float)).copy()
        bb_window = bb_width.tail(cfg.squeeze_window).dropna()
        bb_width_rank = float(bb_window.rank(pct=True).iloc[-1]) if not bb_window.empty else 0.5

        volume_avg_20 = indicators.get("volume_avg_20", volume.rolling(window=20, min_periods=5).mean()).bfill()
        volume_ratio = safe_divide(volume.iloc[-1], volume_avg_20.iloc[-1], default=1.0)

        prev_close = close.shift(1)
        up_volume = volume.where(close > prev_close, 0.0)
        down_volume = volume.where(close < prev_close, 0.0)
        up_volume_ratio = safe_divide(up_volume.tail(20).mean(), max(volume.tail(20).mean(), 1e-6), default=0.0)
        down_volume_ratio = safe_divide(down_volume.tail(20).mean(), max(volume.tail(20).mean(), 1e-6), default=0.0)

        pivots_high = self._pivot_points(high, span=cfg.pivot_span, mode="high")
        pivots_low = self._pivot_points(low, span=cfg.pivot_span, mode="low")
        pivots_high = [pivot for pivot in pivots_high if pivot.position >= max(0, len(window) - cfg.pivot_lookback_bars)]
        pivots_low = [pivot for pivot in pivots_low if pivot.position >= max(0, len(window) - cfg.pivot_lookback_bars)]

        triangle_high = high.tail(cfg.triangle_window)
        triangle_low = low.tail(cfg.triangle_window)
        range_window = cfg.range_window
        recent_range_high = float(high.tail(range_window).max())
        recent_range_low = float(low.tail(range_window).min())
        previous_range_high = float(high.iloc[-(range_window + 1) : -1].max()) if len(high) > range_window else recent_range_high
        previous_range_low = float(low.iloc[-(range_window + 1) : -1].min()) if len(low) > range_window else recent_range_low

        pole_slice = close.iloc[-(cfg.flag_window_max + cfg.flag_pole_bars) : -cfg.flag_window_max] if len(close) > (cfg.flag_window_max + cfg.flag_pole_bars) else close.head(0)
        flag_slice = close.tail(cfg.flag_window_max)
        pole_volume = volume.iloc[-(cfg.flag_window_max + cfg.flag_pole_bars) : -cfg.flag_window_max] if len(volume) > (cfg.flag_window_max + cfg.flag_pole_bars) else volume.head(0)
        flag_volume = volume.tail(cfg.flag_window_max)

        breakdown_level = previous_range_low
        breakout_level = previous_range_high
        breakout_up = bool(close.iloc[-1] > breakout_level * (1.0 + cfg.breakout_buffer_pct / 100.0))
        breakout_down = bool(close.iloc[-1] < breakdown_level * (1.0 - cfg.breakout_buffer_pct / 100.0))

        gap_up_atr = safe_divide(open_.iloc[-1] - high.iloc[-2], atr_value, default=0.0) if len(window) >= 2 else 0.0
        gap_down_atr = safe_divide(low.iloc[-2] - open_.iloc[-1], atr_value, default=0.0) if len(window) >= 2 else 0.0

        return {
            "window": window,
            "indicators": indicators,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
            "atr": atr_value,
            "avg_range_20": float((high - low).tail(20).mean()),
            "last_range": float((high.iloc[-1] - low.iloc[-1])),
            "last_close": float(close.iloc[-1]),
            "last_open": float(open_.iloc[-1]),
            "last_high": float(high.iloc[-1]),
            "last_low": float(low.iloc[-1]),
            "volume_ratio": float(volume_ratio),
            "volume_avg_20": float(volume_avg_20.iloc[-1]),
            "up_volume_ratio": float(up_volume_ratio),
            "down_volume_ratio": float(down_volume_ratio),
            "bb_width_rank": bb_width_rank,
            "bb_width_last": float(bb_width.iloc[-1]) if not bb_width.empty and not pd.isna(bb_width.iloc[-1]) else 0.0,
            "close_position_20": self._range_position(close.iloc[-1], recent_range_low, recent_range_high),
            "range_pct_10": self._range_pct(high.tail(10), low.tail(10), close.iloc[-1]),
            "range_pct_20": self._range_pct(high.tail(20), low.tail(20), close.iloc[-1]),
            "range_pct_40": self._range_pct(high.tail(40), low.tail(40), close.iloc[-1]),
            "compression_ratio": safe_divide(
                self._range_pct(high.tail(10), low.tail(10), close.iloc[-1]),
                max(self._range_pct(high.tail(40), low.tail(40), close.iloc[-1]), 1e-6),
                default=1.0,
            ),
            "return_5": self._window_return(close, 5),
            "return_10": self._window_return(close, 10),
            "return_20": self._window_return(close, 20),
            "return_40": self._window_return(close, 40),
            "slope_10": self._trend_percent(close.tail(10)),
            "slope_20": self._trend_percent(close.tail(20)),
            "slope_40": self._trend_percent(close.tail(40)),
            "high_slope_triangle": self._trend_percent(triangle_high),
            "low_slope_triangle": self._trend_percent(triangle_low),
            "triangle_width_ratio": safe_divide(
                float(triangle_high.max() - triangle_low.min()),
                max(float(high.iloc[-cfg.triangle_window : -1].max() - low.iloc[-cfg.triangle_window : -1].min()), 1e-6),
                default=1.0,
            )
            if len(window) > cfg.triangle_window
            else 1.0,
            "pivots_high": pivots_high,
            "pivots_low": pivots_low,
            "breakout_level": breakout_level,
            "breakdown_level": breakdown_level,
            "breakout_up": breakout_up,
            "breakout_down": breakout_down,
            "gap_up_atr": float(gap_up_atr),
            "gap_down_atr": float(gap_down_atr),
            "pole_return": self._window_return(pole_slice, len(pole_slice)) if len(pole_slice) >= 2 else 0.0,
            "flag_return": self._window_return(flag_slice, len(flag_slice)) if len(flag_slice) >= 2 else 0.0,
            "flag_slope": self._trend_percent(flag_slice),
            "flag_volume_ratio": safe_divide(flag_volume.mean(), max(pole_volume.mean(), 1e-6), default=1.0) if len(flag_volume) and len(pole_volume) else 1.0,
            "obv_slope_20": self._obv_slope(close, volume, 20),
            "ema20": float(indicators["ema20"].iloc[-1]) if "ema20" in indicators else float(close.tail(20).mean()),
            "ema50": float(indicators["ema50"].iloc[-1]) if "ema50" in indicators else float(close.tail(50).mean()),
            "trend_state_label": str(trend_context.get("trend_state_label") or self._infer_trend_state(close, indicators)),
            "regime_label": str(trend_context.get("regime_label") or "sideways"),
            "trend_direction_score": float(trend_context.get("trend_direction_score", 0.0)),
            "trend_strength_score": float(trend_context.get("trend_strength_score", 0.0)),
            "momentum_score": float(trend_context.get("momentum_score", 0.0)),
            "transition_risk_score": float(trend_context.get("transition_risk_score", 0.0)),
        }

    def _score_structure_and_trend(self, ctx: dict[str, Any]) -> list[PatternCandidate]:
        candidates: list[PatternCandidate] = []
        candidates.extend(
            [
                self._score_higher_high_higher_low(ctx),
                self._score_lower_high_lower_low(ctx),
                self._score_trend_acceleration(ctx),
                self._score_downtrend_continuation(ctx),
                self._score_trend_break(ctx),
                self._score_range_to_trend(ctx),
                self._score_trend_to_range(ctx),
                self._score_symmetrical_triangle(ctx),
                self._score_ascending_triangle(ctx),
                self._score_descending_triangle(ctx),
                self._score_rising_wedge(ctx),
                self._score_falling_wedge(ctx),
                self._score_range(ctx),
                self._score_consolidation(ctx),
                self._score_accumulation(ctx),
                self._score_distribution(ctx),
            ]
        )
        return [candidate for candidate in candidates if candidate is not None]

    def _score_reversal_patterns(self, ctx: dict[str, Any]) -> list[PatternCandidate]:
        candidates: list[PatternCandidate] = []
        candidates.extend(
            [
                self._score_double_top(ctx),
                self._score_double_bottom(ctx),
                self._score_head_and_shoulders(ctx),
                self._score_inverse_head_and_shoulders(ctx),
                self._score_v_bottom(ctx),
                self._score_rounded_bottom(ctx),
                self._score_rounded_top(ctx),
                self._score_higher_low_conversion(ctx),
                self._score_lower_high_conversion(ctx),
                self._score_blow_off_top(ctx),
                self._score_spike_reversal(ctx),
                self._score_exhaustion_move(ctx),
            ]
        )
        return [candidate for candidate in candidates if candidate is not None]

    def _score_continuation_patterns(self, ctx: dict[str, Any]) -> list[PatternCandidate]:
        candidates: list[PatternCandidate] = []
        candidates.extend(
            [
                self._score_bull_flag(ctx),
                self._score_bear_flag(ctx),
                self._score_bull_pennant(ctx),
                self._score_bear_pennant(ctx),
                self._score_pullback_continuation(ctx),
                self._score_throwback(ctx),
                self._score_breakout_retest(ctx),
            ]
        )
        return [candidate for candidate in candidates if candidate is not None]

    def _score_volatility_patterns(self, ctx: dict[str, Any]) -> list[PatternCandidate]:
        candidates: list[PatternCandidate] = []
        candidates.extend(
            [
                self._score_vcp(ctx),
                self._score_squeeze(ctx),
                self._score_tight_range(ctx),
                self._score_volatility_expansion(ctx),
                self._score_breakout_expansion(ctx),
                self._score_wide_range_bars(ctx),
                *self._score_gap_patterns(ctx),
            ]
        )
        return [candidate for candidate in candidates if candidate is not None]

    def _score_candle_patterns(self, ctx: dict[str, Any]) -> list[PatternCandidate]:
        candidates: list[PatternCandidate] = []
        candidates.extend(
            [
                self._score_hammer(ctx),
                self._score_hanging_man(ctx),
                self._score_shooting_star(ctx),
                self._score_doji(ctx),
                self._score_long_legged_doji(ctx),
                self._score_marubozu(ctx),
                self._score_bullish_engulfing(ctx),
                self._score_bearish_engulfing(ctx),
                self._score_morning_star(ctx),
                self._score_evening_star(ctx),
                self._score_three_white_soldiers(ctx),
                self._score_three_black_crows(ctx),
                self._score_inside_bar(ctx),
                self._score_outside_bar(ctx),
            ]
        )
        return [candidate for candidate in candidates if candidate is not None]

    def _score_volume_patterns(self, ctx: dict[str, Any]) -> list[PatternCandidate]:
        candidates: list[PatternCandidate] = []
        candidates.extend(
            [
                self._score_volume_surge_breakout(ctx),
                self._score_accumulation_volume_pattern(ctx),
                self._score_volume_dry_up(ctx),
                self._score_distribution_volume(ctx),
                self._score_climax_volume(ctx),
                self._score_volume_divergence(ctx),
            ]
        )
        return [candidate for candidate in candidates if candidate is not None]

    def _score_higher_high_higher_low(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        highs = ctx["pivots_high"]
        lows = ctx["pivots_low"]
        if len(highs) < 2 or len(lows) < 2:
            return None
        high_break = self._relative_change_pct(highs[-1].price, highs[-2].price)
        low_break = self._relative_change_pct(lows[-1].price, lows[-2].price)
        score = self._weighted_score(
            (self._score_between(high_break, 0.5, 6.0), 0.30),
            (self._score_between(low_break, 0.5, 6.0), 0.30),
            (self._score_between(ctx["slope_20"], 1.0, 12.0), 0.20),
            (self._bool_score(ctx["last_close"] > ctx["ema20"] > ctx["ema50"]), 0.20),
        )
        return self._candidate(
            "Higher High + Higher Low",
            "추세 구조",
            "bullish",
            score,
            [
                "최근 스윙 고점이 이전 고점보다 높다.",
                "최근 스윙 저점이 이전 저점보다 높다.",
                "가격이 단기/중기 이동평균 위에서 유지된다." if ctx["last_close"] > ctx["ema20"] > ctx["ema50"] else "이동평균 정렬은 아직 완전하지 않다.",
            ],
            "상승 추세 구조가 유지되는 모습으로 해석된다.",
            "보통은 눌림 이후 재상승이나 고점 재돌파 시도가 뒤따를 가능성이 있다.",
            "직전 고점 돌파 실패와 함께 최근 higher low가 무너지면 구조 해석은 약해진다.",
            diagnostics={"high_break_pct": high_break, "low_break_pct": low_break},
        )

    def _score_lower_high_lower_low(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        highs = ctx["pivots_high"]
        lows = ctx["pivots_low"]
        if len(highs) < 2 or len(lows) < 2:
            return None
        high_break = -self._relative_change_pct(highs[-1].price, highs[-2].price)
        low_break = -self._relative_change_pct(lows[-1].price, lows[-2].price)
        score = self._weighted_score(
            (self._score_between(high_break, 0.5, 6.0), 0.30),
            (self._score_between(low_break, 0.5, 6.0), 0.30),
            (self._score_between(-ctx["slope_20"], 1.0, 12.0), 0.20),
            (self._bool_score(ctx["last_close"] < ctx["ema20"] < ctx["ema50"]), 0.20),
        )
        return self._candidate(
            "Lower High + Lower Low",
            "추세 구조",
            "bearish",
            score,
            [
                "최근 스윙 고점이 낮아지고 있다.",
                "최근 스윙 저점도 낮아지고 있다.",
                "가격이 단기/중기 이동평균 아래에 위치한다." if ctx["last_close"] < ctx["ema20"] < ctx["ema50"] else "이동평균 정렬은 아직 완전하지 않다.",
            ],
            "하락 추세 구조가 유지되는 모습으로 해석된다.",
            "보통은 약한 반등이 나오더라도 lower high를 만든 뒤 재차 눌릴 가능성이 있다.",
            "최근 lower high를 돌파하고 EMA50 위로 회복하면 구조 해석은 약해진다.",
            diagnostics={"high_break_pct": high_break, "low_break_pct": low_break},
        )

    def _score_trend_acceleration(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        slope_ratio = safe_divide(ctx["slope_10"], max(ctx["slope_40"], 0.25), default=0.0)
        score = self._weighted_score(
            (self._score_between(ctx["slope_10"], 2.0, 14.0), 0.35),
            (self._score_between(slope_ratio, 1.1, 2.2), 0.25),
            (self._score_between(ctx["volume_ratio"], 1.0, 1.8), 0.20),
            (self._score_between(ctx["momentum_score"], 10.0, 60.0), 0.20),
        )
        return self._candidate(
            "Trend Acceleration",
            "추세 구조",
            "bullish" if ctx["slope_10"] >= 0 else "bearish",
            score,
            [
                "단기 기울기가 중기 기울기보다 가파르다.",
                "거래량이 평균 이상으로 동반되고 있다." if ctx["volume_ratio"] >= 1.0 else "거래량 동반은 제한적이다.",
                "모멘텀도 같은 방향으로 붙고 있다." if abs(ctx["momentum_score"]) >= 10.0 else "모멘텀 확인은 중립에 가깝다.",
            ],
            "기존 추세가 한 단계 더 빨라지는 구간으로 보인다.",
            "가속이 유지되면 짧은 조정 뒤에도 같은 방향 확장 파동이 이어질 가능성이 있다.",
            "거래량 없이 장대봉만 반복되거나 직전 가속 저점이 깨지면 가속 해석은 약해진다.",
            diagnostics={"slope_ratio": slope_ratio},
        )

    def _score_downtrend_continuation(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(-ctx["return_20"], 3.0, 18.0), 0.35),
            (self._score_between(-ctx["slope_20"], 1.0, 12.0), 0.25),
            (self._score_between(ctx["close_position_20"], 0.0, 0.35, invert=True), 0.20),
            (self._bool_score(ctx["last_close"] < ctx["ema20"] < ctx["ema50"]), 0.20),
        )
        return self._candidate(
            "Downtrend Continuation",
            "추세 구조",
            "bearish",
            score,
            [
                "최근 20봉 수익률이 음수다.",
                "가격이 최근 박스 하단 쪽에서 움직인다.",
                "EMA20 아래에서 반등이 약하게 제한된다." if ctx["last_close"] < ctx["ema20"] else "단기 평균 위 회복은 아직 불안정하다.",
            ],
            "하락 추세가 단순 반등 없이 이어지는 흐름으로 보인다.",
            "보통은 약한 반등 후 재차 저점 테스트가 나올 가능성이 있다.",
            "최근 lower high 상단과 EMA50을 회복하면 지속형 해석은 약해진다.",
        )

    def _score_trend_break(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        prior = ctx["return_40"] - ctx["return_10"]
        reversal = abs(ctx["slope_10"]) + abs(ctx["slope_20"])
        score = self._weighted_score(
            (self._score_between(abs(prior), 4.0, 18.0), 0.30),
            (self._score_between(reversal, 3.0, 18.0), 0.25),
            (self._score_between(ctx["transition_risk_score"], 25.0, 80.0), 0.25),
            (self._bool_score((ctx["return_40"] > 0 and ctx["slope_10"] < 0) or (ctx["return_40"] < 0 and ctx["slope_10"] > 0)), 0.20),
        )
        direction_bias = "bearish" if ctx["return_40"] > 0 else "bullish"
        return self._candidate(
            "Trend Break",
            "추세 구조",
            direction_bias,
            score,
            [
                "이전 중기 추세와 최근 단기 기울기가 충돌한다.",
                "전환 위험 점수가 올라와 있다." if ctx["transition_risk_score"] >= 35 else "전환 위험은 아직 중립 수준이다.",
                "추세가 이어지기보다 구조가 흔들리는 구간에 가깝다.",
            ],
            "기존 추세의 구조가 깨지기 시작하는 전환 구간으로 해석된다.",
            "추세 붕괴가 확정되면 추세 종료 후 반대 방향 혹은 박스권 전환이 나올 가능성이 있다.",
            "최근 깨진 구조를 다시 회복하면 붕괴 해석은 약해진다.",
            diagnostics={"prior_return_minus_short": prior},
        )

    def _score_range_to_trend(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        breakout_score = self._bool_score(ctx["breakout_up"] or ctx["breakout_down"])
        score = self._weighted_score(
            (self._score_between(ctx["compression_ratio"], 0.0, 0.45, invert=True), 0.30),
            (breakout_score, 0.30),
            (self._score_between(ctx["volume_ratio"], 1.0, 1.9), 0.20),
            (self._score_between(abs(ctx["slope_10"]), 1.0, 10.0), 0.20),
        )
        direction_bias = "bullish" if ctx["breakout_up"] else "bearish" if ctx["breakout_down"] else "neutral"
        return self._candidate(
            "Range → Trend 전환",
            "추세 구조",
            direction_bias,
            score,
            [
                "좁아진 박스 뒤에 방향성 이탈이 나타난다." if breakout_score > 0 else "아직 명확한 박스 이탈은 없다.",
                "거래량이 붙으며 추세 전환 가능성을 높인다." if ctx["volume_ratio"] >= 1.0 else "거래량 확인은 보통 수준이다.",
            ],
            "횡보 구간이 끝나고 방향성 추세가 시작되는 초기 신호로 보인다.",
            "이탈 방향이 유지되면 새로운 추세 구간으로 확장될 가능성이 있다.",
            "재진입으로 다시 박스 안에 들어오면 전환 해석은 약해진다.",
        )

    def _score_trend_to_range(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(abs(ctx["return_40"]), 4.0, 18.0), 0.30),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.45, invert=True), 0.30),
            (self._score_between(abs(ctx["slope_10"]), 0.0, 2.0, invert=True), 0.20),
            (self._score_between(ctx["bb_width_rank"], 0.0, 0.35, invert=True), 0.20),
        )
        return self._candidate(
            "Trend → Range 전환",
            "추세 구조",
            "neutral",
            score,
            [
                "직전 추세폭에 비해 최근 움직임이 둔화됐다.",
                "변동성이 수축되고 있다." if ctx["bb_width_rank"] <= 0.35 else "변동성 수축은 아직 약하다.",
                "기울기가 평평해지며 박스화 조짐이 보인다.",
            ],
            "추세 시장이 끝나고 횡보 박스로 넘어가는 구간처럼 보인다.",
            "당분간은 넓은 방향성보다 박스 상하단 테스트가 반복될 가능성이 있다.",
            "박스 형성 전에 추세 방향으로 다시 강한 돌파가 나오면 해석은 약해진다.",
        )

    def _score_symmetrical_triangle(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(-ctx["high_slope_triangle"], 0.3, 6.0), 0.30),
            (self._score_between(ctx["low_slope_triangle"], 0.3, 6.0), 0.30),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.50, invert=True), 0.25),
            (self._score_between(ctx["bb_width_rank"], 0.0, 0.45, invert=True), 0.15),
        )
        return self._candidate(
            "Symmetrical Triangle",
            "수렴/구조",
            "neutral",
            score,
            [
                "고점은 낮아지고 저점은 높아지며 범위가 수렴한다.",
                "변동성도 함께 줄어드는 편이다." if ctx["bb_width_rank"] <= 0.45 else "변동성 수축은 아직 제한적이다.",
            ],
            "대칭 삼각 수렴으로 보이며 방향성 에너지가 모이는 구간으로 해석된다.",
            "상단 혹은 하단 돌파가 나오면 그 방향으로 변동성이 확장될 가능성이 있다.",
            "수렴선이 아닌 반대편으로 먼저 이탈하면 삼각 수렴 해석은 약해진다.",
        )

    def _score_ascending_triangle(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(abs(ctx["high_slope_triangle"]), 0.0, 1.5, invert=True), 0.35),
            (self._score_between(ctx["low_slope_triangle"], 0.5, 6.0), 0.35),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.55, invert=True), 0.15),
            (self._score_between(ctx["close_position_20"], 0.55, 1.0), 0.15),
        )
        return self._candidate(
            "Ascending Triangle",
            "수렴/구조",
            "bullish",
            score,
            [
                "저점이 올라오면서 상단 저항을 반복 테스트한다.",
                "가격이 최근 박스 상단에 가깝다." if ctx["close_position_20"] >= 0.55 else "상단 재도전 전 단계에 가깝다.",
            ],
            "상단 저항을 압박하는 상승형 수렴으로 해석된다.",
            "상단 돌파가 확정되면 추세 지속형 상승으로 이어질 가능성이 있다.",
            "상승 추세선 하향 이탈과 함께 저점이 무너지면 패턴 해석은 약해진다.",
        )

    def _score_descending_triangle(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(abs(ctx["low_slope_triangle"]), 0.0, 1.5, invert=True), 0.35),
            (self._score_between(-ctx["high_slope_triangle"], 0.5, 6.0), 0.35),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.55, invert=True), 0.15),
            (self._score_between(ctx["close_position_20"], 0.0, 0.45, invert=True), 0.15),
        )
        return self._candidate(
            "Descending Triangle",
            "수렴/구조",
            "bearish",
            score,
            [
                "고점이 낮아지며 하단 지지대를 압박한다.",
                "가격이 최근 박스 하단에 가깝다." if ctx["close_position_20"] <= 0.45 else "하단 재시험 전 단계에 가깝다.",
            ],
            "하단 지지 테스트가 반복되는 하락형 수렴으로 해석된다.",
            "하단 이탈이 확정되면 추세 지속형 하락으로 이어질 가능성이 있다.",
            "하단 지지 방어 뒤 최근 lower high를 돌파하면 패턴 해석은 약해진다.",
        )

    def _score_rising_wedge(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(ctx["high_slope_triangle"], 0.5, 8.0), 0.25),
            (self._score_between(ctx["low_slope_triangle"], 0.8, 12.0), 0.35),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.65, invert=True), 0.20),
            (self._score_between(ctx["transition_risk_score"], 20.0, 75.0), 0.20),
        )
        score *= 1.0 if ctx["low_slope_triangle"] > ctx["high_slope_triangle"] else 0.65
        return self._candidate(
            "Rising Wedge",
            "수렴/구조",
            "bearish",
            score,
            [
                "고점과 저점이 함께 올라가지만 저점 상승 속도가 더 빠르다.",
                "쐐기 끝으로 갈수록 범위가 줄어든다.",
                "전환 위험 점수가 같이 올라오면 신뢰도가 높아진다." if ctx["transition_risk_score"] >= 35 else "전환 위험은 아직 중립적이다.",
            ],
            "상승 쐐기형으로 보이며 상승 추세 말기의 약화 구조로 해석된다.",
            "하단 추세선 이탈 시 단기 하락 전환이나 깊은 조정으로 이어질 가능성이 있다.",
            "상단 추세선을 강하게 돌파하면 쐐기형 약세 해석은 무효화되기 쉽다.",
        )

    def _score_falling_wedge(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        high_abs = abs(ctx["high_slope_triangle"])
        low_abs = abs(ctx["low_slope_triangle"])
        score = self._weighted_score(
            (self._score_between(high_abs, 0.8, 12.0), 0.35),
            (self._score_between(low_abs, 0.5, 8.0), 0.25),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.65, invert=True), 0.20),
            (self._score_between(ctx["transition_risk_score"], 20.0, 75.0), 0.20),
        )
        score *= 1.0 if high_abs > low_abs and ctx["high_slope_triangle"] < 0 and ctx["low_slope_triangle"] < 0 else 0.65
        return self._candidate(
            "Falling Wedge",
            "수렴/구조",
            "bullish",
            score,
            [
                "고점과 저점이 함께 낮아지지만 고점 하락 속도가 더 빠르다.",
                "쐐기 끝으로 갈수록 범위가 줄어든다.",
                "하락 압력이 점차 줄어드는 구간으로 볼 수 있다.",
            ],
            "하락 쐐기형으로 보이며 하락 추세 말기의 완화 구조에 가깝다.",
            "상단 추세선 돌파 시 반등 전환이나 숏커버링이 이어질 가능성이 있다.",
            "하단 추세선 아래로 재차 확장되면 쐐기형 반등 해석은 약해진다.",
        )

    def _score_range(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(abs(ctx["slope_20"]), 0.0, 2.0, invert=True), 0.35),
            (self._score_between(ctx["close_position_20"], 0.30, 0.70), 0.20),
            (self._score_between(ctx["range_pct_20"], 4.0, 18.0), 0.20),
            (self._score_between(ctx["bb_width_rank"], 0.15, 0.70), 0.25),
        )
        return self._candidate(
            "Range",
            "수렴/구조",
            "neutral",
            score,
            [
                "중기 기울기가 뚜렷하지 않다.",
                "가격이 상하단 중간 영역을 오가고 있다." if 0.30 <= ctx["close_position_20"] <= 0.70 else "현재는 박스 한쪽에 치우쳐 있다.",
            ],
            "명확한 추세보다 박스권 거래에 가까운 흐름으로 보인다.",
            "당분간은 상단 저항과 하단 지지 사이 왕복 가능성이 있다.",
            "박스 외부로 거래량 동반 돌파가 나오면 박스 해석은 약해진다.",
        )

    def _score_consolidation(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(ctx["compression_ratio"], 0.0, 0.40, invert=True), 0.40),
            (self._score_between(ctx["bb_width_rank"], 0.0, 0.30, invert=True), 0.30),
            (self._score_between(abs(ctx["slope_10"]), 0.0, 2.0, invert=True), 0.30),
        )
        return self._candidate(
            "Consolidation",
            "수렴/구조",
            "neutral",
            score,
            [
                "최근 변동폭이 이전보다 줄어들었다.",
                "단기 기울기도 거의 평평하다.",
            ],
            "횡보 압축 구간으로 보이며 다음 변동성 확장 전 정리 단계에 가깝다.",
            "압축 뒤 상하 어느 쪽으로든 이탈이 나오면 방향성이 새로 형성될 가능성이 있다.",
            "압축이 유지되지 않고 넓은 박스로 다시 퍼지면 해석은 약해진다.",
        )

    def _score_accumulation(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(ctx["compression_ratio"], 0.0, 0.70, invert=True), 0.25),
            (self._score_between(ctx["obv_slope_20"], 0.5, 6.0), 0.25),
            (self._score_between(ctx["up_volume_ratio"] - ctx["down_volume_ratio"], 0.02, 0.18), 0.25),
            (self._score_between(ctx["close_position_20"], 0.55, 1.0), 0.25),
        )
        return self._candidate(
            "Accumulation",
            "수렴/구조",
            "bullish",
            score,
            [
                "박스권 안에서도 OBV 기울기가 양수다.",
                "상승 마감일 쪽 거래량 비중이 상대적으로 높다." if ctx["up_volume_ratio"] >= ctx["down_volume_ratio"] else "거래량 우위는 아직 약하다.",
                "가격이 박스 상단 쪽에 붙어 있다." if ctx["close_position_20"] >= 0.55 else "아직 상단 장악은 제한적이다.",
            ],
            "매집형 박스로 보이며 상단 돌파 준비 과정일 가능성이 있다.",
            "상단 돌파와 함께 거래량이 붙으면 추세 전환형 상승으로 이어질 수 있다.",
            "하단 이탈과 함께 OBV가 꺾이면 매집 해석은 약해진다.",
        )

    def _score_distribution(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(ctx["compression_ratio"], 0.0, 0.70, invert=True), 0.25),
            (self._score_between(-ctx["obv_slope_20"], 0.5, 6.0), 0.25),
            (self._score_between(ctx["down_volume_ratio"] - ctx["up_volume_ratio"], 0.02, 0.18), 0.25),
            (self._score_between(ctx["close_position_20"], 0.0, 0.45, invert=True), 0.25),
        )
        return self._candidate(
            "Distribution",
            "수렴/구조",
            "bearish",
            score,
            [
                "박스권 안에서도 OBV 기울기가 음수다.",
                "하락 마감일 쪽 거래량 비중이 상대적으로 높다." if ctx["down_volume_ratio"] >= ctx["up_volume_ratio"] else "거래량 우위는 아직 약하다.",
                "가격이 박스 하단 쪽에 머문다." if ctx["close_position_20"] <= 0.45 else "아직 하단 장악은 제한적이다.",
            ],
            "분산형 박스로 보이며 하단 이탈 준비 과정일 가능성이 있다.",
            "하단 이탈이 확정되면 추세 전환형 하락으로 이어질 수 있다.",
            "상단 돌파와 OBV 반전이 나오면 분산 해석은 약해진다.",
        )

    def _score_double_top(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        pattern = self._best_double_pivot(ctx["pivots_high"], ctx["pivots_low"], bullish=False)
        if not pattern:
            return None
        score = self._weighted_score(
            (pattern["similarity_score"], 0.40),
            (pattern["depth_score"], 0.25),
            (pattern["trigger_score"], 0.20),
            (self._score_between(ctx["return_40"], 2.0, 18.0), 0.15),
        )
        return self._candidate(
            "Double Top",
            "반전",
            "bearish",
            score,
            [
                "두 개의 고점이 유사한 가격대에서 형성됐다.",
                "중간 눌림이 neckline 역할을 만든다.",
                "현재 가격이 neckline 아래로 내려오거나 재시험 중이다." if pattern["trigger_score"] >= 50.0 else "neckline 이탈은 아직 진행 중이다.",
            ],
            "쌍봉 반전 형태로 보이며 상단 저항이 강하게 작동하는 흐름에 가깝다.",
            "neckline 이탈이 확정되면 단기 하락 전환이나 이전 지지대 테스트 가능성이 있다.",
            "두 번째 고점을 강하게 돌파하면 쌍봉 해석은 약해진다.",
            diagnostics=pattern,
        )

    def _score_double_bottom(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        pattern = self._best_double_pivot(ctx["pivots_low"], ctx["pivots_high"], bullish=True)
        if not pattern:
            return None
        score = self._weighted_score(
            (pattern["similarity_score"], 0.40),
            (pattern["depth_score"], 0.25),
            (pattern["trigger_score"], 0.20),
            (self._score_between(-ctx["return_40"], 2.0, 18.0), 0.15),
        )
        return self._candidate(
            "Double Bottom",
            "반전",
            "bullish",
            score,
            [
                "두 개의 저점이 유사한 가격대에서 형성됐다.",
                "중간 반등 고점이 neckline 역할을 만든다.",
                "현재 가격이 neckline 위를 회복했거나 돌파를 시도한다." if pattern["trigger_score"] >= 50.0 else "neckline 돌파는 아직 진행 중이다.",
            ],
            "쌍바닥 반전 형태로 보이며 하단 지지가 반복 확인되는 모습에 가깝다.",
            "neckline 돌파가 확정되면 반등 추세 전환으로 이어질 가능성이 있다.",
            "두 번째 바닥 아래로 종가 이탈하면 쌍바닥 해석은 약해진다.",
            diagnostics=pattern,
        )

    def _score_head_and_shoulders(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        pattern = self._head_and_shoulders(ctx["pivots_high"], ctx["pivots_low"], inverse=False, current_price=ctx["last_close"])
        if not pattern:
            return None
        score = self._weighted_score(
            (pattern["shoulder_score"], 0.35),
            (pattern["head_score"], 0.25),
            (pattern["neckline_score"], 0.25),
            (self._score_between(ctx["transition_risk_score"], 20.0, 80.0), 0.15),
        )
        return self._candidate(
            "Head and Shoulders",
            "반전",
            "bearish",
            score,
            [
                "가운데 머리가 양쪽 어깨보다 높다.",
                "양쪽 어깨 높이가 비슷하다.",
                "neckline 이탈이 진행되면 신뢰도가 높아진다." if pattern["neckline_score"] >= 50.0 else "neckline 이탈은 아직 미완성이다.",
            ],
            "전형적인 고점 반전 헤드앤숄더로 보인다.",
            "neckline 이탈이 확정되면 추세 반전이나 추가 하락 파동 가능성이 커진다.",
            "오른쪽 어깨 위 재돌파가 나오면 패턴 해석은 약해진다.",
            diagnostics=pattern,
        )

    def _score_inverse_head_and_shoulders(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        pattern = self._head_and_shoulders(ctx["pivots_low"], ctx["pivots_high"], inverse=True, current_price=ctx["last_close"])
        if not pattern:
            return None
        score = self._weighted_score(
            (pattern["shoulder_score"], 0.35),
            (pattern["head_score"], 0.25),
            (pattern["neckline_score"], 0.25),
            (self._score_between(ctx["transition_risk_score"], 20.0, 80.0), 0.15),
        )
        return self._candidate(
            "Inverse Head and Shoulders",
            "반전",
            "bullish",
            score,
            [
                "가운데 바닥이 양쪽 어깨보다 더 깊다.",
                "양쪽 어깨 저점이 비슷하다.",
                "neckline 돌파가 진행되면 신뢰도가 높아진다." if pattern["neckline_score"] >= 50.0 else "neckline 돌파는 아직 미완성이다.",
            ],
            "역헤드앤숄더 저점 반전 형태로 보인다.",
            "neckline 돌파가 확정되면 상승 전환이나 숏커버링 확대로 이어질 가능성이 있다.",
            "오른쪽 어깨 아래 재이탈이 나오면 패턴 해석은 약해진다.",
            diagnostics=pattern,
        )

    def _score_v_bottom(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        close = ctx["close"].tail(24)
        if len(close) < 24:
            return None
        bottom_pos = int(np.argmin(close.to_numpy(dtype=float)))
        left = close.iloc[: bottom_pos + 1]
        right = close.iloc[bottom_pos:]
        drop = -self._window_return(left, len(left))
        rebound = self._window_return(right, len(right))
        recovery_ratio = safe_divide(rebound, max(drop, 1e-6), default=0.0)
        center_score = self._score_between(bottom_pos, 6, 18)
        score = self._weighted_score(
            (self._score_between(drop, 4.0, 18.0), 0.30),
            (self._score_between(rebound, 4.0, 20.0), 0.30),
            (self._score_between(recovery_ratio, 0.6, 1.5), 0.25),
            (center_score, 0.15),
        )
        return self._candidate(
            "V-bottom",
            "반전",
            "bullish",
            score,
            [
                "급락 뒤 빠른 속도로 반등이 이어진다.",
                "저점이 구간 중앙에 가깝게 형성됐다." if center_score >= 50.0 else "저점 위치는 다소 비대칭이다.",
            ],
            "급락 후 즉시 반전되는 V-bottom 구조에 가깝다.",
            "반등이 유지되면 숏커버링과 추세 전환 시도가 겹칠 가능성이 있다.",
            "반등 후 직전 저점을 다시 위협하면 V-bottom 해석은 약해진다.",
            diagnostics={"drop_pct": drop, "rebound_pct": rebound, "recovery_ratio": recovery_ratio},
        )

    def _score_rounded_bottom(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        return self._rounded_pattern(
            ctx,
            name="Rounded Bottom",
            bullish=True,
            interpretation="완만한 바닥을 다지는 소서형 반전 구조에 가깝다.",
            outcome="우측 상승 경사가 이어지면 추세 전환형 반등이 점진적으로 진행될 가능성이 있다.",
            invalidation="우측 상승 구간이 꺾이며 바닥권을 다시 이탈하면 둥근 바닥 해석은 약해진다.",
        )

    def _score_rounded_top(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        return self._rounded_pattern(
            ctx,
            name="Rounded Top",
            bullish=False,
            interpretation="완만한 둥근 천장 구조로 보이며 고점 분산에 가깝다.",
            outcome="우측 하락 경사가 이어지면 추세 약화 뒤 하락 전환으로 진행될 가능성이 있다.",
            invalidation="우측 하락부를 되돌리고 고점을 재돌파하면 둥근 천장 해석은 약해진다.",
        )

    def _score_higher_low_conversion(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        lows = ctx["pivots_low"]
        highs = ctx["pivots_high"]
        if len(lows) < 2:
            return None
        higher_low_pct = self._relative_change_pct(lows[-1].price, lows[-2].price)
        last_high_break = self._relative_change_pct(ctx["last_close"], highs[-1].price) if highs else 0.0
        score = self._weighted_score(
            (self._score_between(-ctx["return_40"], 3.0, 18.0), 0.25),
            (self._score_between(higher_low_pct, 0.4, 6.0), 0.30),
            (self._score_between(last_high_break, -1.0, 3.0), 0.20),
            (self._bool_score(ctx["last_close"] > ctx["ema20"]), 0.25),
        )
        return self._candidate(
            "Higher Low 전환 구조",
            "반전",
            "bullish",
            score,
            [
                "이전 하락 흐름 뒤 최근 저점이 높아졌다.",
                "가격이 단기 평균 회복을 시도한다." if ctx["last_close"] > ctx["ema20"] else "단기 평균 회복은 아직 미완성이다.",
            ],
            "하락 추세 말기에 higher low가 등장하는 초기 전환 구조로 보인다.",
            "직전 lower high를 넘기면 반전 구조가 더 명확해질 가능성이 있다.",
            "새 higher low가 깨지면 초기 전환 해석은 약해진다.",
            diagnostics={"higher_low_pct": higher_low_pct, "last_high_break_pct": last_high_break},
        )

    def _score_lower_high_conversion(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        highs = ctx["pivots_high"]
        lows = ctx["pivots_low"]
        if len(highs) < 2:
            return None
        lower_high_pct = -self._relative_change_pct(highs[-1].price, highs[-2].price)
        last_low_break = -self._relative_change_pct(ctx["last_close"], lows[-1].price) if lows else 0.0
        score = self._weighted_score(
            (self._score_between(ctx["return_40"], 3.0, 18.0), 0.25),
            (self._score_between(lower_high_pct, 0.4, 6.0), 0.30),
            (self._score_between(last_low_break, -1.0, 3.0), 0.20),
            (self._bool_score(ctx["last_close"] < ctx["ema20"]), 0.25),
        )
        return self._candidate(
            "Lower High 전환 구조",
            "반전",
            "bearish",
            score,
            [
                "이전 상승 흐름 뒤 최근 고점이 낮아졌다.",
                "가격이 단기 평균 아래로 밀린다." if ctx["last_close"] < ctx["ema20"] else "단기 평균 이탈은 아직 미완성이다.",
            ],
            "상승 추세 말기에 lower high가 등장하는 초기 전환 구조로 보인다.",
            "직전 higher low를 하향 이탈하면 반전 구조가 더 명확해질 가능성이 있다.",
            "최근 lower high를 다시 돌파하면 초기 전환 해석은 약해진다.",
            diagnostics={"lower_high_pct": lower_high_pct, "last_low_break_pct": last_low_break},
        )

    def _score_blow_off_top(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        upper_wick = self._upper_wick_ratio(ctx["last_open"], ctx["last_close"], ctx["last_high"], ctx["last_low"])
        score = self._weighted_score(
            (self._score_between(ctx["return_10"], 6.0, 25.0), 0.30),
            (self._score_between(ctx["volume_ratio"], self.config.patterns.climax_volume_ratio, 3.5), 0.25),
            (self._score_between(safe_divide(ctx["last_range"], max(ctx["avg_range_20"], 1e-6), default=0.0), 1.2, 3.0), 0.20),
            (self._score_between(upper_wick, 0.35, 0.8), 0.25),
        )
        return self._candidate(
            "Blow-off Top",
            "반전",
            "bearish",
            score,
            [
                "단기간 급등폭이 크다.",
                "거래량이 폭증하며 장대 변동이 나온다." if ctx["volume_ratio"] >= self.config.patterns.climax_volume_ratio else "거래량 폭증은 아직 제한적이다.",
                "윗꼬리 반전 흔적이 있다." if upper_wick >= 0.35 else "윗꼬리 반전 흔적은 약하다.",
            ],
            "과열 뒤 매도 압력이 급격히 나오는 blow-off top 가능성이 있다.",
            "고점이 확정되면 급한 조정이나 추세 둔화가 뒤따를 가능성이 있다.",
            "장대 양봉 종가 유지와 함께 재가속이 나오면 과열 고점 해석은 약해진다.",
            diagnostics={"upper_wick_ratio": upper_wick},
        )

    def _score_spike_reversal(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        if len(ctx["close"]) < 2:
            return None
        prev_move = safe_divide(ctx["close"].iloc[-2] - ctx["close"].iloc[-3], ctx["atr"], default=0.0) if len(ctx["close"]) >= 3 else 0.0
        last_move = safe_divide(ctx["close"].iloc[-1] - ctx["close"].iloc[-2], ctx["atr"], default=0.0)
        reversal_strength = abs(prev_move) + abs(last_move)
        opposite = prev_move * last_move < 0
        score = self._weighted_score(
            (self._score_between(abs(prev_move), 0.8, 3.0), 0.35),
            (self._score_between(abs(last_move), 0.8, 3.0), 0.35),
            (self._bool_score(opposite), 0.15),
            (self._score_between(reversal_strength, 2.0, 6.0), 0.15),
        )
        direction_bias = "bullish" if last_move > 0 else "bearish"
        return self._candidate(
            "Spike Reversal",
            "반전",
            direction_bias,
            score,
            [
                "직전 급격한 한 방향 움직임 뒤 바로 반대 방향 반전이 나왔다." if opposite else "급변동은 있으나 즉시 반전 강도는 제한적이다.",
                "ATR 대비 이동폭이 큰 편이다.",
            ],
            "짧은 시간 안에 방향이 뒤집히는 spike reversal 형태에 가깝다.",
            "후속봉이 같은 방향으로 이어지면 단기 스윙 반전으로 발전할 가능성이 있다.",
            "반전봉이 즉시 되돌려지면 spike reversal 해석은 약해진다.",
            diagnostics={"prev_move_atr": prev_move, "last_move_atr": last_move},
        )

    def _score_exhaustion_move(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(abs(ctx["return_10"]), 6.0, 24.0), 0.30),
            (self._score_between(ctx["volume_ratio"], self.config.patterns.climax_volume_ratio, 3.5), 0.25),
            (self._score_between(ctx["transition_risk_score"], 30.0, 90.0), 0.25),
            (self._score_between(safe_divide(ctx["last_range"], max(ctx["avg_range_20"], 1e-6), default=0.0), 1.2, 3.0), 0.20),
        )
        direction_bias = "bearish" if ctx["return_10"] > 0 else "bullish"
        return self._candidate(
            "Exhaustion Move",
            "반전",
            direction_bias,
            score,
            [
                "최근 단기 추세가 한 방향으로 과도하게 진행됐다.",
                "전환 위험과 거래량이 동시에 높아진다." if ctx["transition_risk_score"] >= 35 and ctx["volume_ratio"] >= 1.0 else "과열 확인은 중간 수준이다.",
            ],
            "마지막 힘이 과도하게 분출된 뒤 피로가 누적되는 exhaustion move로 해석된다.",
            "후속 확인이 붙으면 기존 추세 둔화나 반대 방향 반전이 나올 가능성이 있다.",
            "가격이 같은 방향으로 재가속되면 피로 누적 해석은 약해진다.",
        )

    def _score_bull_flag(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        pullback_ratio = abs(safe_divide(ctx["flag_return"], max(ctx["pole_return"], 1e-6), default=0.0))
        score = self._weighted_score(
            (self._score_between(ctx["pole_return"], 5.0, 22.0), 0.35),
            (self._score_between(-ctx["flag_slope"], 0.2, 4.0), 0.20),
            (self._score_between(pullback_ratio, 0.0, 0.45, invert=True), 0.25),
            (self._score_between(self.config.patterns.volume_dryup_ratio - ctx["flag_volume_ratio"], -0.3, 0.5), 0.20),
        )
        return self._candidate(
            "Bull Flag",
            "지속",
            "bullish",
            score,
            [
                "직전 급등 구간이 먼저 존재한다.",
                "최근 짧은 눌림이 완만한 하향 기울기로 진행된다.",
                "눌림 동안 거래량이 줄어드는 편이다." if ctx["flag_volume_ratio"] <= 1.0 else "눌림 동안 거래량 감소는 제한적이다.",
            ],
            "상승 추세 내 눌림형 Bull Flag로 해석된다.",
            "상단 돌파가 나오면 직전 상승 추세가 재개될 가능성이 있다.",
            "눌림이 깊어져 flag 하단과 EMA50을 함께 이탈하면 지속형 해석은 약해진다.",
            diagnostics={"pullback_ratio": pullback_ratio},
        )

    def _score_bear_flag(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        pole_return = -ctx["pole_return"]
        pullback_ratio = abs(safe_divide(ctx["flag_return"], max(pole_return, 1e-6), default=0.0))
        score = self._weighted_score(
            (self._score_between(pole_return, 5.0, 22.0), 0.35),
            (self._score_between(ctx["flag_slope"], 0.2, 4.0), 0.20),
            (self._score_between(pullback_ratio, 0.0, 0.45, invert=True), 0.25),
            (self._score_between(self.config.patterns.volume_dryup_ratio - ctx["flag_volume_ratio"], -0.3, 0.5), 0.20),
        )
        return self._candidate(
            "Bear Flag",
            "지속",
            "bearish",
            score,
            [
                "직전 급락 구간이 먼저 존재한다.",
                "최근 짧은 반등이 완만한 상향 기울기로 진행된다.",
                "반등 동안 거래량이 줄어드는 편이다." if ctx["flag_volume_ratio"] <= 1.0 else "반등 동안 거래량 감소는 제한적이다.",
            ],
            "하락 추세 내 반등형 Bear Flag로 해석된다.",
            "하단 재이탈이 나오면 직전 하락 추세가 재개될 가능성이 있다.",
            "반등이 깊어져 flag 상단과 EMA50을 함께 회복하면 지속형 해석은 약해진다.",
            diagnostics={"pullback_ratio": pullback_ratio},
        )

    def _score_bull_pennant(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(ctx["pole_return"], 5.0, 22.0), 0.30),
            (self._score_between(-ctx["high_slope_triangle"], 0.2, 4.0), 0.20),
            (self._score_between(ctx["low_slope_triangle"], 0.2, 4.0), 0.20),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.55, invert=True), 0.15),
            (self._score_between(self.config.patterns.volume_dryup_ratio - ctx["flag_volume_ratio"], -0.3, 0.5), 0.15),
        )
        return self._candidate(
            "Bull Pennant",
            "지속",
            "bullish",
            score,
            [
                "강한 상승 pole 뒤 짧은 삼각 수렴이 나온다.",
                "수렴이 짧고 조정폭이 크지 않다.",
            ],
            "상승 추세의 에너지를 잠시 압축하는 Bull Pennant에 가깝다.",
            "상단 돌파 시 추세 재개가 빠르게 나올 가능성이 있다.",
            "하단 추세선 이탈과 함께 수렴이 길어지면 pennant 해석은 약해진다.",
        )

    def _score_bear_pennant(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(-ctx["pole_return"], 5.0, 22.0), 0.30),
            (self._score_between(-ctx["high_slope_triangle"], 0.2, 4.0), 0.20),
            (self._score_between(ctx["low_slope_triangle"], 0.2, 4.0), 0.20),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.55, invert=True), 0.15),
            (self._score_between(self.config.patterns.volume_dryup_ratio - ctx["flag_volume_ratio"], -0.3, 0.5), 0.15),
        )
        return self._candidate(
            "Bear Pennant",
            "지속",
            "bearish",
            score,
            [
                "강한 하락 pole 뒤 짧은 삼각 수렴이 나온다.",
                "수렴이 짧고 반등폭이 크지 않다.",
            ],
            "하락 추세의 에너지를 잠시 압축하는 Bear Pennant에 가깝다.",
            "하단 이탈 시 추세 재개가 빠르게 나올 가능성이 있다.",
            "상단 추세선 회복과 함께 반등이 길어지면 pennant 해석은 약해진다.",
        )

    def _score_pullback_continuation(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        bullish = ctx["return_40"] > 0
        pullback_distance = self._relative_change_pct(ctx["last_close"], ctx["ema20"])
        pullback_score = self._score_between(abs(pullback_distance), 0.0, 3.0, invert=True)
        score = self._weighted_score(
            (self._score_between(abs(ctx["return_40"]), 4.0, 18.0), 0.30),
            (pullback_score, 0.25),
            (self._score_between(self.config.patterns.volume_dryup_ratio - ctx["volume_ratio"], -0.6, 0.5), 0.20),
            (self._score_between(abs(ctx["slope_10"]), 0.3, 4.0, invert=True), 0.25),
        )
        return self._candidate(
            "Pullback continuation",
            "지속",
            "bullish" if bullish else "bearish",
            score,
            [
                "기존 추세가 먼저 존재한다.",
                "최근 가격이 EMA20 근처까지만 되돌린다." if pullback_score >= 50.0 else "되돌림 위치는 다소 깊다.",
                "조정 중 거래량이 줄어드는 편이다." if ctx["volume_ratio"] <= 1.0 else "조정 중 거래량 감소는 약하다.",
            ],
            "기존 추세 안에서 소화성 되돌림이 진행되는 모습으로 보인다.",
            "추세 방향으로 재가속 신호가 붙으면 continuation 패턴으로 이어질 가능성이 있다.",
            "되돌림이 깊어져 최근 추세 구조를 깨면 지속형 해석은 약해진다.",
        )

    def _score_throwback(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        distance_to_breakout = abs(self._relative_change_pct(ctx["last_close"], ctx["breakout_level"]))
        score = self._weighted_score(
            (self._bool_score(ctx["breakout_up"]), 0.30),
            (self._score_between(distance_to_breakout, 0.0, 2.5, invert=True), 0.30),
            (self._score_between(ctx["close_position_20"], 0.55, 1.0), 0.20),
            (self._score_between(ctx["volume_ratio"], 0.8, 1.8), 0.20),
        )
        return self._candidate(
            "Throwback",
            "지속",
            "bullish",
            score,
            [
                "이전 상단 저항 돌파가 먼저 나타난다." if ctx["breakout_up"] else "명확한 상단 돌파 여부는 아직 약하다.",
                "현재 가격이 돌파 레벨 부근을 재시험한다." if distance_to_breakout <= 2.5 else "돌파 레벨과의 거리는 다소 크다.",
            ],
            "상단 돌파 뒤 되돌림으로 지지 전환을 확인하는 throwback 구조에 가깝다.",
            "지지 확인이 성공하면 상방 추세 재개 가능성이 있다.",
            "돌파 레벨 아래로 재안착하면 throwback 해석은 약해진다.",
            diagnostics={"distance_to_breakout_pct": distance_to_breakout},
        )

    def _score_breakout_retest(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        distance = abs(self._relative_change_pct(ctx["last_close"], ctx["breakout_level" if ctx["breakout_up"] else "breakdown_level"]))
        score = self._weighted_score(
            (self._bool_score(ctx["breakout_up"] or ctx["breakout_down"]), 0.35),
            (self._score_between(distance, 0.0, 2.5, invert=True), 0.35),
            (self._score_between(ctx["volume_ratio"], 0.8, 1.8), 0.15),
            (self._score_between(abs(ctx["slope_10"]), 0.3, 6.0), 0.15),
        )
        bias = "bullish" if ctx["breakout_up"] else "bearish" if ctx["breakout_down"] else "neutral"
        return self._candidate(
            "Breakout Retest",
            "지속",
            bias,
            score,
            [
                "방향성 이탈 뒤 해당 레벨을 재시험하는 흐름이다." if ctx["breakout_up"] or ctx["breakout_down"] else "아직 방향성 이탈은 미확정이다.",
                "가격이 돌파/이탈 레벨 근처에서 버티고 있다." if distance <= 2.5 else "재시험 레벨과 현재 가격 간 거리가 다소 있다.",
            ],
            "돌파 후 되돌림을 확인하는 retest 구조로 해석된다.",
            "지지/저항 전환이 확인되면 이탈 방향으로 추세가 한 번 더 이어질 가능성이 있다.",
            "레벨 안쪽으로 다시 깊게 복귀하면 retest 해석은 약해진다.",
            diagnostics={"distance_to_retest_pct": distance},
        )

    def _score_vcp(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        amplitudes = self._recent_pullback_amplitudes(ctx["pivots_high"], ctx["pivots_low"])
        if len(amplitudes) < 2:
            return None
        is_contracting = all(earlier > later for earlier, later in zip(amplitudes, amplitudes[1:]))
        score = self._weighted_score(
            (self._bool_score(is_contracting), 0.35),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.40, invert=True), 0.25),
            (self._score_between(ctx["bb_width_rank"], 0.0, 0.30, invert=True), 0.20),
            (self._score_between(self.config.patterns.volume_dryup_ratio - ctx["volume_ratio"], -0.6, 0.5), 0.20),
        )
        return self._candidate(
            "Volatility Contraction Pattern (VCP)",
            "변동성",
            "bullish" if ctx["close_position_20"] >= 0.5 else "neutral",
            score,
            [
                "최근 눌림 폭이 단계적으로 줄어드는 편이다." if is_contracting else "눌림 폭 축소는 아직 불규칙하다.",
                "변동성과 거래량이 함께 줄어드는 구간이다." if ctx["bb_width_rank"] <= 0.30 else "변동성 수축은 중간 수준이다.",
            ],
            "변동성 수축 패턴으로 보이며 에너지를 모으는 구조에 가깝다.",
            "상단 돌파와 거래량 증가가 동반되면 확장 국면으로 이어질 가능성이 있다.",
            "눌림 폭이 다시 커지거나 하단 이탈이 나오면 VCP 해석은 약해진다.",
            diagnostics={"pullback_amplitudes_pct": amplitudes},
        )

    def _score_squeeze(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(ctx["bb_width_rank"], 0.0, 0.20, invert=True), 0.45),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.45, invert=True), 0.35),
            (self._score_between(abs(ctx["slope_10"]), 0.0, 2.0, invert=True), 0.20),
        )
        return self._candidate(
            "Squeeze",
            "변동성",
            "neutral",
            score,
            [
                "볼린저 밴드 폭이 최근 기준으로 매우 좁다.",
                "가격 변동폭도 같이 줄었다.",
            ],
            "전형적인 변동성 압축 구간으로 보인다.",
            "압축이 끝나면 방향성 확장봉이 나올 가능성이 있다.",
            "수축이 아니라 넓은 박스로 다시 확산되면 squeeze 해석은 약해진다.",
        )

    def _score_tight_range(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(ctx["range_pct_10"], 0.0, 3.0, invert=True), 0.45),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.40, invert=True), 0.35),
            (self._score_between(abs(ctx["slope_10"]), 0.0, 1.5, invert=True), 0.20),
        )
        return self._candidate(
            "Tight Range",
            "변동성",
            "neutral",
            score,
            [
                "최근 10봉 가격 범위가 매우 좁다.",
                "단기 기울기도 크지 않다.",
            ],
            "짧은 기간의 타이트 레인지에 가깝다.",
            "좁은 범위가 깨질 때 단기 방향성이 빠르게 붙을 가능성이 있다.",
            "곧바로 넓은 박스로 재확대되면 tight range 해석은 약해진다.",
        )

    def _score_volatility_expansion(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        range_ratio = safe_divide(ctx["last_range"], max(ctx["avg_range_20"], 1e-6), default=0.0)
        score = self._weighted_score(
            (self._score_between(range_ratio, 1.2, 3.0), 0.40),
            (self._score_between(ctx["bb_width_rank"], 0.55, 1.0), 0.25),
            (self._score_between(ctx["volume_ratio"], 1.0, 2.2), 0.20),
            (self._score_between(abs(ctx["slope_10"]), 1.0, 10.0), 0.15),
        )
        return self._candidate(
            "Volatility Expansion",
            "변동성",
            "bullish" if ctx["slope_10"] >= 0 else "bearish",
            score,
            [
                "최근 봉의 범위가 평균보다 크게 넓다.",
                "밴드 폭도 커지는 쪽으로 이동한다." if ctx["bb_width_rank"] >= 0.55 else "밴드 폭 확대는 아직 중간 수준이다.",
            ],
            "압축이 끝나고 변동성이 실제로 확장되는 국면으로 보인다.",
            "확장 방향이 유지되면 단기 추세가 더 뚜렷해질 가능성이 있다.",
            "확장봉을 바로 되돌리면 단순 노이즈일 수 있다.",
            diagnostics={"range_ratio": range_ratio},
        )

    def _score_breakout_expansion(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        range_ratio = safe_divide(ctx["last_range"], max(ctx["avg_range_20"], 1e-6), default=0.0)
        score = self._weighted_score(
            (self._bool_score(ctx["breakout_up"] or ctx["breakout_down"]), 0.35),
            (self._score_between(range_ratio, 1.2, 3.2), 0.30),
            (self._score_between(ctx["volume_ratio"], 1.1, 2.4), 0.20),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.60, invert=True), 0.15),
        )
        return self._candidate(
            "Breakout Expansion",
            "변동성",
            "bullish" if ctx["breakout_up"] else "bearish" if ctx["breakout_down"] else "neutral",
            score,
            [
                "박스 또는 수렴 구간에서 방향성 이탈이 나타난다." if ctx["breakout_up"] or ctx["breakout_down"] else "아직 방향성 이탈은 미완성이다.",
                "이탈봉 범위가 평균보다 넓다." if range_ratio >= 1.2 else "이탈폭은 아직 평범하다.",
            ],
            "돌파와 동시에 변동성이 확장되는 패턴으로 해석된다.",
            "이탈 방향 유지 시 추세 구간으로 빠르게 연결될 가능성이 있다.",
            "돌파봉이 즉시 되돌려지면 가짜 돌파일 수 있다.",
            diagnostics={"range_ratio": range_ratio},
        )

    def _score_wide_range_bars(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        range_ratio = safe_divide(ctx["last_range"], max(ctx["avg_range_20"], 1e-6), default=0.0)
        score = self._weighted_score(
            (self._score_between(range_ratio, self.config.patterns.wide_range_bar_ratio, 3.5), 0.60),
            (self._score_between(ctx["volume_ratio"], 1.0, 2.4), 0.20),
            (self._score_between(abs(ctx["slope_10"]), 0.5, 8.0), 0.20),
        )
        return self._candidate(
            "Wide Range Bars",
            "변동성",
            "bullish" if ctx["last_close"] >= ctx["last_open"] else "bearish",
            score,
            [
                "최근 봉의 범위가 평균보다 크게 넓다.",
                "거래량까지 붙으면 의미가 더 커진다." if ctx["volume_ratio"] >= 1.0 else "거래량 확인은 약한 편이다.",
            ],
            "방향성 힘이 강하게 표현된 wide range bar 구간으로 보인다.",
            "후속봉이 같은 방향으로 이어지면 단기 추세 확장으로 연결될 가능성이 있다.",
            "장대봉을 바로 반대로 되돌리면 신호 신뢰도는 낮아진다.",
            diagnostics={"range_ratio": range_ratio},
        )

    def _score_gap_patterns(self, ctx: dict[str, Any]) -> list[PatternCandidate]:
        candidates: list[PatternCandidate] = []
        gap_threshold = self.config.patterns.gap_atr_threshold
        if ctx["gap_up_atr"] >= gap_threshold:
            is_breakaway = ctx["breakout_up"] and ctx["volume_ratio"] >= self.config.patterns.volume_surge_ratio
            is_exhaustion = ctx["return_10"] > 6.0 and ctx["transition_risk_score"] >= 50.0
            name = "Breakaway Gap" if is_breakaway else "Exhaustion Gap" if is_exhaustion else "Gap Up"
            candidates.append(
                self._candidate(
                    name,
                    "변동성",
                    "bullish" if not is_exhaustion else "bearish",
                    self._weighted_score(
                        (self._score_between(ctx["gap_up_atr"], gap_threshold, 2.5), 0.50),
                        (self._score_between(ctx["volume_ratio"], 1.0, 2.5), 0.25),
                        (self._score_between(abs(ctx["return_10"]), 2.0, 18.0), 0.25),
                    ),
                    [
                        "전일 고가 대비 위쪽 갭이 발생했다.",
                        "이탈과 거래량이 동반되면 breakaway 성격이 강해진다." if is_breakaway else "과열 말기라면 exhaustion 성격일 수 있다." if is_exhaustion else "현재로선 일반적인 gap up에 가깝다.",
                    ],
                    "상승 방향 갭으로 해석된다.",
                    "추세 초입의 breakaway면 추가 상승, 과열 말기의 exhaustion이면 되돌림 가능성이 있다.",
                    "갭을 빠르게 메우면 갭 신뢰도는 약해진다.",
                    diagnostics={"gap_up_atr": ctx["gap_up_atr"]},
                )
            )
        if ctx["gap_down_atr"] >= gap_threshold:
            is_breakaway = ctx["breakout_down"] and ctx["volume_ratio"] >= self.config.patterns.volume_surge_ratio
            is_exhaustion = ctx["return_10"] < -6.0 and ctx["transition_risk_score"] >= 50.0
            name = "Breakaway Gap" if is_breakaway else "Exhaustion Gap" if is_exhaustion else "Gap Down"
            candidates.append(
                self._candidate(
                    name,
                    "변동성",
                    "bearish" if not is_exhaustion else "bullish",
                    self._weighted_score(
                        (self._score_between(ctx["gap_down_atr"], gap_threshold, 2.5), 0.50),
                        (self._score_between(ctx["volume_ratio"], 1.0, 2.5), 0.25),
                        (self._score_between(abs(ctx["return_10"]), 2.0, 18.0), 0.25),
                    ),
                    [
                        "전일 저가 대비 아래쪽 갭이 발생했다.",
                        "이탈과 거래량이 동반되면 breakaway 성격이 강해진다." if is_breakaway else "과매도 말기라면 exhaustion 성격일 수 있다." if is_exhaustion else "현재로선 일반적인 gap down에 가깝다.",
                    ],
                    "하락 방향 갭으로 해석된다.",
                    "추세 초입의 breakaway면 추가 하락, 과매도 말기의 exhaustion이면 되돌림 가능성이 있다.",
                    "갭을 빠르게 메우면 갭 신뢰도는 약해진다.",
                    diagnostics={"gap_down_atr": ctx["gap_down_atr"]},
                )
            )
        if not candidates and abs(ctx["gap_up_atr"]) < gap_threshold and abs(ctx["gap_down_atr"]) < gap_threshold:
            gap_size = max(abs(ctx["gap_up_atr"]), abs(ctx["gap_down_atr"]))
            candidates.append(
                self._candidate(
                    "Common Gap",
                    "변동성",
                    "neutral",
                    self._weighted_score(
                        (self._score_between(gap_size, 0.15, gap_threshold), 0.55),
                        (self._score_between(abs(ctx["slope_10"]), 0.0, 2.5, invert=True), 0.25),
                        (self._score_between(ctx["compression_ratio"], 0.0, 0.75, invert=True), 0.20),
                    ),
                    [
                        "작은 갭이 발생했지만 추세 이탈 강도는 크지 않다.",
                        "대체로 박스나 중립 구간 내부 갭에 가깝다.",
                    ],
                    "일반적인 common gap 성격으로 보인다.",
                    "보통은 곧 메워지거나 박스 내부 소음으로 끝날 가능성이 있다.",
                    "갭 뒤에 강한 추세 이탈이 이어지면 common gap 해석은 약해진다.",
                    diagnostics={"gap_size_atr": gap_size},
                )
            )
        return candidates

    def _score_hammer(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        body, body_ratio, lower_wick, upper_wick = self._candle_shape(ctx)
        score = self._weighted_score(
            (self._score_between(lower_wick, self.config.patterns.candle_long_wick_ratio, 0.90), 0.45),
            (self._score_between(upper_wick, 0.0, 0.15, invert=True), 0.20),
            (self._score_between(body_ratio, 0.05, 0.35), 0.15),
            (self._score_between(-ctx["return_5"], 1.0, 8.0), 0.20),
        )
        return self._candidate(
            "Hammer",
            "캔들",
            "bullish",
            score,
            [
                "아랫꼬리가 길고 종가가 상단에 가깝다.",
                "직전 단기 약세 뒤에 나올수록 의미가 커진다." if ctx["return_5"] <= 0 else "직전 약세 맥락은 약하다.",
            ],
            "매도 압력을 장중에 흡수한 Hammer 형태에 가깝다.",
            "다음 봉 확인이 붙으면 단기 반등 시그널로 이어질 가능성이 있다.",
            "Hammer 저점이 바로 깨지면 반등 해석은 약해진다.",
        )

    def _score_hanging_man(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        body, body_ratio, lower_wick, upper_wick = self._candle_shape(ctx)
        score = self._weighted_score(
            (self._score_between(lower_wick, self.config.patterns.candle_long_wick_ratio, 0.90), 0.45),
            (self._score_between(upper_wick, 0.0, 0.15, invert=True), 0.20),
            (self._score_between(body_ratio, 0.05, 0.35), 0.15),
            (self._score_between(ctx["return_5"], 1.0, 8.0), 0.20),
        )
        return self._candidate(
            "Hanging Man",
            "캔들",
            "bearish",
            score,
            [
                "아랫꼬리가 길지만 상방 추세 끝에서 나타난다.",
                "직전 단기 강세 뒤에 나올수록 의미가 커진다." if ctx["return_5"] >= 0 else "직전 강세 맥락은 약하다.",
            ],
            "상승 말기 매수 피로를 보여주는 Hanging Man 가능성이 있다.",
            "다음 봉 약세 확인이 붙으면 단기 반전 가능성이 높아질 수 있다.",
            "고점을 바로 갱신하면 Hanging Man 해석은 약해진다.",
        )

    def _score_shooting_star(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        body, body_ratio, lower_wick, upper_wick = self._candle_shape(ctx)
        score = self._weighted_score(
            (self._score_between(upper_wick, self.config.patterns.candle_long_wick_ratio, 0.90), 0.45),
            (self._score_between(lower_wick, 0.0, 0.20, invert=True), 0.20),
            (self._score_between(body_ratio, 0.05, 0.35), 0.15),
            (self._score_between(ctx["return_5"], 1.0, 8.0), 0.20),
        )
        return self._candidate(
            "Shooting Star",
            "캔들",
            "bearish",
            score,
            [
                "윗꼬리가 길고 종가가 하단에 가깝다.",
                "직전 상승 이후 나올수록 의미가 커진다." if ctx["return_5"] >= 0 else "직전 상승 맥락은 약하다.",
            ],
            "고점 부근 매도 압력이 강하게 나온 Shooting Star 가능성이 있다.",
            "다음 봉 약세 확인이 붙으면 단기 고점 신호로 이어질 수 있다.",
            "윗꼬리 고점을 재돌파하면 Shooting Star 해석은 약해진다.",
        )

    def _score_doji(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        _, body_ratio, lower_wick, upper_wick = self._candle_shape(ctx)
        score = self._weighted_score(
            (self._score_between(body_ratio, 0.0, self.config.patterns.candle_body_doji_ratio, invert=True), 0.55),
            (self._score_between(lower_wick + upper_wick, 0.4, 1.5), 0.45),
        )
        return self._candidate(
            "Doji",
            "캔들",
            "neutral",
            score,
            [
                "시가와 종가 차이가 매우 작다.",
                "매수/매도 균형 구간으로 읽힌다.",
            ],
            "방향성 합의가 약한 Doji에 가깝다.",
            "중요 지지/저항 부근이면 이후 방향 선택 전 경계 신호로 작용할 수 있다.",
            "다음 봉이 한쪽으로 강하게 확정되면 Doji 해석은 그 방향의 트리거로 전환된다.",
        )

    def _score_long_legged_doji(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        _, body_ratio, lower_wick, upper_wick = self._candle_shape(ctx)
        score = self._weighted_score(
            (self._score_between(body_ratio, 0.0, self.config.patterns.candle_body_doji_ratio, invert=True), 0.40),
            (self._score_between(lower_wick, 0.35, 0.70), 0.30),
            (self._score_between(upper_wick, 0.35, 0.70), 0.30),
        )
        return self._candidate(
            "Long Legged Doji",
            "캔들",
            "neutral",
            score,
            [
                "시가/종가는 비슷하지만 양쪽 꼬리가 길다.",
                "장중 변동성은 컸지만 종가는 제자리 근처다.",
            ],
            "방향성 충돌이 강한 Long Legged Doji에 가깝다.",
            "중요 레벨에서는 변동성 확대 전 경고 신호가 될 수 있다.",
            "다음 봉 방향 확인이 없으면 단순 소음일 수 있다.",
        )

    def _score_marubozu(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        _, body_ratio, lower_wick, upper_wick = self._candle_shape(ctx)
        wick_total = lower_wick + upper_wick
        score = self._weighted_score(
            (self._score_between(body_ratio, 0.75, 1.0), 0.60),
            (self._score_between(wick_total, 0.0, 0.20, invert=True), 0.40),
        )
        return self._candidate(
            "Marubozu",
            "캔들",
            "bullish" if ctx["last_close"] >= ctx["last_open"] else "bearish",
            score,
            [
                "실체 비중이 크고 꼬리가 짧다.",
                "한 방향 압력이 강하게 작용한 봉이다.",
            ],
            "방향성이 강한 Marubozu에 가깝다.",
            "후속봉이 같은 방향이면 단기 추세 지속 신호가 될 수 있다.",
            "다음 봉에서 바로 반대 방향으로 크게 되돌리면 신뢰도는 낮아진다.",
        )

    def _score_bullish_engulfing(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        if len(ctx["close"]) < 2:
            return None
        prev_open = float(ctx["open"].iloc[-2])
        prev_close = float(ctx["close"].iloc[-2])
        engulf = ctx["last_open"] <= prev_close and ctx["last_close"] >= prev_open and prev_close < prev_open and ctx["last_close"] > ctx["last_open"]
        score = self._weighted_score(
            (self._bool_score(engulf), 0.55),
            (self._score_between(-ctx["return_5"], 1.0, 8.0), 0.25),
            (self._score_between(ctx["volume_ratio"], 0.9, 2.0), 0.20),
        )
        return self._candidate(
            "Bullish Engulfing",
            "캔들",
            "bullish",
            score,
            [
                "양봉 실체가 이전 음봉을 감싼다." if engulf else "실체 감싸기 조건은 일부만 충족한다.",
                "직전 약세 구간 뒤에 나올수록 의미가 커진다." if ctx["return_5"] <= 0 else "직전 약세 맥락은 약하다.",
            ],
            "단기 매수 역전이 나온 Bullish Engulfing 가능성이 있다.",
            "다음 봉 고점 돌파가 붙으면 반등 확인 시그널이 될 수 있다.",
            "Engulfing 저점을 이탈하면 신호는 약해진다.",
        )

    def _score_bearish_engulfing(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        if len(ctx["close"]) < 2:
            return None
        prev_open = float(ctx["open"].iloc[-2])
        prev_close = float(ctx["close"].iloc[-2])
        engulf = ctx["last_open"] >= prev_close and ctx["last_close"] <= prev_open and prev_close > prev_open and ctx["last_close"] < ctx["last_open"]
        score = self._weighted_score(
            (self._bool_score(engulf), 0.55),
            (self._score_between(ctx["return_5"], 1.0, 8.0), 0.25),
            (self._score_between(ctx["volume_ratio"], 0.9, 2.0), 0.20),
        )
        return self._candidate(
            "Bearish Engulfing",
            "캔들",
            "bearish",
            score,
            [
                "음봉 실체가 이전 양봉을 감싼다." if engulf else "실체 감싸기 조건은 일부만 충족한다.",
                "직전 강세 구간 뒤에 나올수록 의미가 커진다." if ctx["return_5"] >= 0 else "직전 강세 맥락은 약하다.",
            ],
            "단기 매도 역전이 나온 Bearish Engulfing 가능성이 있다.",
            "다음 봉 저점 이탈이 붙으면 반전 확인 신호가 될 수 있다.",
            "Engulfing 고점을 재돌파하면 신호는 약해진다.",
        )

    def _score_morning_star(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        if len(ctx["close"]) < 3:
            return None
        c1_open, c1_close = float(ctx["open"].iloc[-3]), float(ctx["close"].iloc[-3])
        c2_open, c2_close = float(ctx["open"].iloc[-2]), float(ctx["close"].iloc[-2])
        c3_open, c3_close = float(ctx["open"].iloc[-1]), float(ctx["close"].iloc[-1])
        first_bearish = c1_close < c1_open
        small_middle = abs(c2_close - c2_open) <= abs(c1_close - c1_open) * 0.5
        final_bullish = c3_close > c3_open and c3_close >= ((c1_open + c1_close) / 2.0)
        score = self._weighted_score(
            (self._bool_score(first_bearish and small_middle and final_bullish), 0.65),
            (self._score_between(-ctx["return_5"], 1.0, 8.0), 0.20),
            (self._score_between(ctx["volume_ratio"], 0.9, 2.0), 0.15),
        )
        return self._candidate(
            "Morning Star",
            "캔들",
            "bullish",
            score,
            [
                "큰 음봉 뒤 작은 중립 봉, 그 뒤 강한 양봉이 이어진다." if first_bearish and small_middle and final_bullish else "전형적 3봉 구조는 일부만 충족한다.",
                "하락 말기에 나올수록 의미가 커진다." if ctx["return_5"] <= 0 else "직전 약세 맥락은 약하다.",
            ],
            "저점 반전형 Morning Star 가능성이 있다.",
            "세 번째 봉 이후 고점 갱신이 붙으면 반등 전환 신호가 강화될 수 있다.",
            "세 번째 봉 중간값 아래로 다시 밀리면 해석은 약해진다.",
        )

    def _score_evening_star(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        if len(ctx["close"]) < 3:
            return None
        c1_open, c1_close = float(ctx["open"].iloc[-3]), float(ctx["close"].iloc[-3])
        c2_open, c2_close = float(ctx["open"].iloc[-2]), float(ctx["close"].iloc[-2])
        c3_open, c3_close = float(ctx["open"].iloc[-1]), float(ctx["close"].iloc[-1])
        first_bullish = c1_close > c1_open
        small_middle = abs(c2_close - c2_open) <= abs(c1_close - c1_open) * 0.5
        final_bearish = c3_close < c3_open and c3_close <= ((c1_open + c1_close) / 2.0)
        score = self._weighted_score(
            (self._bool_score(first_bullish and small_middle and final_bearish), 0.65),
            (self._score_between(ctx["return_5"], 1.0, 8.0), 0.20),
            (self._score_between(ctx["volume_ratio"], 0.9, 2.0), 0.15),
        )
        return self._candidate(
            "Evening Star",
            "캔들",
            "bearish",
            score,
            [
                "큰 양봉 뒤 작은 중립 봉, 그 뒤 강한 음봉이 이어진다." if first_bullish and small_middle and final_bearish else "전형적 3봉 구조는 일부만 충족한다.",
                "상승 말기에 나올수록 의미가 커진다." if ctx["return_5"] >= 0 else "직전 강세 맥락은 약하다.",
            ],
            "고점 반전형 Evening Star 가능성이 있다.",
            "세 번째 봉 이후 저점 이탈이 붙으면 반전 신호가 강화될 수 있다.",
            "세 번째 봉 중간값 위로 다시 회복하면 해석은 약해진다.",
        )

    def _score_three_white_soldiers(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        if len(ctx["close"]) < 3:
            return None
        opens = ctx["open"].tail(3).to_list()
        closes = ctx["close"].tail(3).to_list()
        bullish = all(close_value > open_value for open_value, close_value in zip(opens, closes))
        ascending = closes[0] < closes[1] < closes[2]
        score = self._weighted_score(
            (self._bool_score(bullish and ascending), 0.70),
            (self._score_between(ctx["volume_ratio"], 0.9, 2.0), 0.15),
            (self._score_between(-ctx["return_5"], 0.0, 5.0), 0.15),
        )
        return self._candidate(
            "Three White Soldiers",
            "캔들",
            "bullish",
            score,
            [
                "연속 3개 양봉이 단계적으로 종가를 높인다." if bullish and ascending else "전형적 3연속 양봉 조건은 일부만 충족한다.",
                "저점 부근에서 나올수록 의미가 커진다.",
            ],
            "강한 저점 반전형 Three White Soldiers 가능성이 있다.",
            "고점 돌파가 붙으면 추세 반전 초기 가속으로 이어질 수 있다.",
            "3봉 중 첫 봉의 시가 아래로 밀리면 신호는 약해진다.",
        )

    def _score_three_black_crows(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        if len(ctx["close"]) < 3:
            return None
        opens = ctx["open"].tail(3).to_list()
        closes = ctx["close"].tail(3).to_list()
        bearish = all(close_value < open_value for open_value, close_value in zip(opens, closes))
        descending = closes[0] > closes[1] > closes[2]
        score = self._weighted_score(
            (self._bool_score(bearish and descending), 0.70),
            (self._score_between(ctx["volume_ratio"], 0.9, 2.0), 0.15),
            (self._score_between(ctx["return_5"], 0.0, 5.0), 0.15),
        )
        return self._candidate(
            "Three Black Crows",
            "캔들",
            "bearish",
            score,
            [
                "연속 3개 음봉이 단계적으로 종가를 낮춘다." if bearish and descending else "전형적 3연속 음봉 조건은 일부만 충족한다.",
                "고점 부근에서 나올수록 의미가 커진다.",
            ],
            "강한 고점 반전형 Three Black Crows 가능성이 있다.",
            "저점 이탈이 붙으면 하락 전환 초기 가속으로 이어질 수 있다.",
            "3봉 중 첫 봉의 시가 위로 회복하면 신호는 약해진다.",
        )

    def _score_inside_bar(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        if len(ctx["high"]) < 2:
            return None
        inside = ctx["high"].iloc[-1] <= ctx["high"].iloc[-2] and ctx["low"].iloc[-1] >= ctx["low"].iloc[-2]
        score = self._weighted_score(
            (self._bool_score(inside), 0.60),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.60, invert=True), 0.25),
            (self._score_between(abs(ctx["slope_10"]), 0.0, 4.0), 0.15),
        )
        return self._candidate(
            "Inside Bar",
            "캔들",
            "neutral",
            score,
            [
                "최근 봉이 이전 봉 범위 안에 완전히 들어왔다." if inside else "완전한 inside bar 조건은 아니다.",
                "단기 압축 신호로 읽을 수 있다.",
            ],
            "방향성 선택 직전의 Inside Bar 압축에 가깝다.",
            "모봉 상단/하단 돌파 방향으로 단기 변동성이 붙을 가능성이 있다.",
            "모봉 내부에서 계속 맴돌면 신호 해석은 약해진다.",
        )

    def _score_outside_bar(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        if len(ctx["high"]) < 2:
            return None
        outside = ctx["high"].iloc[-1] >= ctx["high"].iloc[-2] and ctx["low"].iloc[-1] <= ctx["low"].iloc[-2]
        score = self._weighted_score(
            (self._bool_score(outside), 0.60),
            (self._score_between(safe_divide(ctx["last_range"], max(ctx["avg_range_20"], 1e-6), default=0.0), 1.0, 3.0), 0.25),
            (self._score_between(ctx["volume_ratio"], 0.9, 2.2), 0.15),
        )
        return self._candidate(
            "Outside Bar",
            "캔들",
            "bullish" if ctx["last_close"] >= ctx["last_open"] else "bearish",
            score,
            [
                "최근 봉이 이전 봉 고저 범위를 모두 확장했다." if outside else "완전한 outside bar 조건은 아니다.",
                "변동성 확대와 방향성 충돌이 동시에 나타난다.",
            ],
            "단기 힘싸움이 크게 벌어진 Outside Bar에 가깝다.",
            "종가 방향으로 후속 확인이 붙으면 짧은 스윙 신호가 될 수 있다.",
            "종가 방향을 바로 되돌리면 신호 신뢰도는 낮아진다.",
        )

    def _score_volume_surge_breakout(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._bool_score(ctx["breakout_up"] or ctx["breakout_down"]), 0.35),
            (self._score_between(ctx["volume_ratio"], self.config.patterns.volume_surge_ratio, 3.0), 0.40),
            (self._score_between(abs(ctx["slope_10"]), 1.0, 10.0), 0.25),
        )
        return self._candidate(
            "Volume Surge Breakout",
            "거래량",
            "bullish" if ctx["breakout_up"] else "bearish" if ctx["breakout_down"] else "neutral",
            score,
            [
                "방향성 이탈과 함께 거래량이 급증한다." if ctx["breakout_up"] or ctx["breakout_down"] else "거래량 급증은 있으나 명확한 이탈은 미완성이다.",
                "평균 대비 거래량이 충분히 높을수록 신뢰도가 커진다.",
            ],
            "거래량이 뒷받침되는 돌파 패턴으로 해석된다.",
            "이탈 방향 유지 시 추세 시작 또는 추세 재개로 이어질 가능성이 있다.",
            "돌파 직후 거래량만 많고 가격이 다시 박스 안으로 복귀하면 신호는 약해진다.",
        )

    def _score_accumulation_volume_pattern(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(ctx["obv_slope_20"], 0.5, 6.0), 0.35),
            (self._score_between(ctx["up_volume_ratio"] - ctx["down_volume_ratio"], 0.02, 0.18), 0.35),
            (self._score_between(ctx["close_position_20"], 0.55, 1.0), 0.30),
        )
        return self._candidate(
            "Accumulation Volume Pattern",
            "거래량",
            "bullish",
            score,
            [
                "OBV가 우상향하며 누적 매수 압력이 보인다.",
                "상승일 거래량 우위가 나타난다." if ctx["up_volume_ratio"] >= ctx["down_volume_ratio"] else "거래량 우위는 아직 약하다.",
            ],
            "가격보다 거래량 구조가 먼저 개선되는 매집형 패턴에 가깝다.",
            "가격이 상단을 돌파하면 거래량 선행 신호가 본격 상승으로 연결될 수 있다.",
            "OBV가 꺾이고 하단으로 밀리면 매집 해석은 약해진다.",
        )

    def _score_volume_dry_up(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(self.config.patterns.volume_dryup_ratio - ctx["volume_ratio"], -0.4, 0.5), 0.55),
            (self._score_between(ctx["compression_ratio"], 0.0, 0.50, invert=True), 0.25),
            (self._score_between(abs(ctx["slope_10"]), 0.0, 3.0, invert=True), 0.20),
        )
        return self._candidate(
            "Volume Dry-up",
            "거래량",
            "neutral",
            score,
            [
                "최근 거래량이 20일 평균보다 낮다.",
                "압축 구간에서 나타나면 의미가 커진다." if ctx["compression_ratio"] <= 0.50 else "압축 정도는 중간 수준이다.",
            ],
            "조정 또는 박스 과정에서 거래량이 마르는 구간으로 보인다.",
            "방향성 돌파 시 오히려 추세 재개 신호의 바탕이 될 수 있다.",
            "거래량 없이 하단 이탈만 나오면 단순 유동성 저하일 수도 있다.",
        )

    def _score_distribution_volume(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(-ctx["obv_slope_20"], 0.5, 6.0), 0.35),
            (self._score_between(ctx["down_volume_ratio"] - ctx["up_volume_ratio"], 0.02, 0.18), 0.35),
            (self._score_between(ctx["close_position_20"], 0.0, 0.45, invert=True), 0.30),
        )
        return self._candidate(
            "Distribution Volume",
            "거래량",
            "bearish",
            score,
            [
                "OBV가 우하향하며 누적 매도 압력이 보인다.",
                "하락일 거래량 우위가 나타난다." if ctx["down_volume_ratio"] >= ctx["up_volume_ratio"] else "거래량 우위는 아직 약하다.",
            ],
            "가격보다 거래량 구조가 먼저 악화되는 분산형 패턴에 가깝다.",
            "하단 이탈이 나오면 거래량 선행 신호가 본격 하락으로 연결될 수 있다.",
            "OBV가 반전하고 상단을 회복하면 분산 해석은 약해진다.",
        )

    def _score_climax_volume(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        score = self._weighted_score(
            (self._score_between(ctx["volume_ratio"], self.config.patterns.climax_volume_ratio, 4.0), 0.50),
            (self._score_between(abs(ctx["return_10"]), 5.0, 25.0), 0.25),
            (self._score_between(ctx["transition_risk_score"], 25.0, 85.0), 0.25),
        )
        return self._candidate(
            "Climax Volume",
            "거래량",
            "bearish" if ctx["return_10"] > 0 else "bullish",
            score,
            [
                "거래량이 평균 대비 극단적으로 커졌다.",
                "짧은 기간 가격 이동폭도 크다.",
            ],
            "클라이맥스 거래량 구간으로 보이며 추세 막바지 소진 신호일 가능성이 있다.",
            "후속 확인이 약하면 기존 추세가 둔화되거나 반전될 가능성이 있다.",
            "클라이맥스 뒤에도 같은 방향으로 안정적 추세가 이어지면 단순 강세 거래량일 수 있다.",
        )

    def _score_volume_divergence(self, ctx: dict[str, Any]) -> PatternCandidate | None:
        divergence = abs(ctx["slope_20"]) > 0.5 and np.sign(ctx["slope_20"]) != np.sign(ctx["obv_slope_20"])
        score = self._weighted_score(
            (self._bool_score(divergence), 0.55),
            (self._score_between(abs(ctx["slope_20"]), 1.0, 10.0), 0.20),
            (self._score_between(abs(ctx["obv_slope_20"]), 0.5, 8.0), 0.25),
        )
        bias = "bearish" if ctx["slope_20"] > 0 and ctx["obv_slope_20"] < 0 else "bullish"
        return self._candidate(
            "Volume Divergence",
            "거래량",
            bias,
            score,
            [
                "가격 기울기와 OBV 기울기 방향이 어긋난다." if divergence else "가격과 OBV 방향 불일치는 약하다.",
                "가격 움직임에 비해 거래량 확인이 뒤따르지 않는다.",
            ],
            "가격과 거래량의 비동조가 나타나는 divergence 구간으로 보인다.",
            "후속 가격 확인이 약하면 현재 추세가 힘을 잃을 가능성이 있다.",
            "OBV가 가격 방향으로 다시 동행하면 divergence 해석은 약해진다.",
            diagnostics={"price_slope": ctx["slope_20"], "obv_slope": ctx["obv_slope_20"]},
        )

    def _rounded_pattern(
        self,
        ctx: dict[str, Any],
        name: str,
        bullish: bool,
        interpretation: str,
        outcome: str,
        invalidation: str,
    ) -> PatternCandidate | None:
        window = ctx["close"].tail(self.config.patterns.rounded_window)
        if len(window) < self.config.patterns.rounded_window:
            return None
        first = window.iloc[:20]
        middle = window.iloc[20:40]
        last = window.iloc[40:]
        first_slope = self._trend_percent(first)
        middle_slope = self._trend_percent(middle)
        last_slope = self._trend_percent(last)
        if bullish:
            slope_score = self._weighted_score(
                (self._score_between(-first_slope, 1.0, 10.0), 0.35),
                (self._score_between(abs(middle_slope), 0.0, 2.0, invert=True), 0.20),
                (self._score_between(last_slope, 1.0, 10.0), 0.35),
                (self._score_between(ctx["close_position_20"], 0.45, 1.0), 0.10),
            )
        else:
            slope_score = self._weighted_score(
                (self._score_between(first_slope, 1.0, 10.0), 0.35),
                (self._score_between(abs(middle_slope), 0.0, 2.0, invert=True), 0.20),
                (self._score_between(-last_slope, 1.0, 10.0), 0.35),
                (self._score_between(ctx["close_position_20"], 0.0, 0.55, invert=True), 0.10),
            )
        evidence = [
            "초반 기울기와 후반 기울기가 서로 반대 방향으로 바뀐다.",
            "중간 구간은 상대적으로 완만하다.",
        ]
        return self._candidate(
            name,
            "반전",
            "bullish" if bullish else "bearish",
            slope_score,
            evidence,
            interpretation,
            outcome,
            invalidation,
            diagnostics={
                "first_slope": first_slope,
                "middle_slope": middle_slope,
                "last_slope": last_slope,
            },
        )

    def _best_double_pivot(
        self,
        primary: list[_Pivot],
        opposing: list[_Pivot],
        bullish: bool,
    ) -> dict[str, float] | None:
        if len(primary) < 2:
            return None
        best: dict[str, float] | None = None
        tolerance = self.config.patterns.price_similarity_tolerance_pct
        for left, right in zip(primary[:-1], primary[1:]):
            if right.position - left.position < 4:
                continue
            midpoint_candidates = [pivot for pivot in opposing if left.position < pivot.position < right.position]
            midpoint_prices = [pivot.price for pivot in midpoint_candidates]
            if not midpoint_prices:
                continue
            midpoint_pivot = min(midpoint_candidates, key=lambda pivot: pivot.price) if not bullish else max(
                midpoint_candidates,
                key=lambda pivot: pivot.price,
            )
            midpoint = midpoint_pivot.price
            similarity = self._match_score(left.price, right.price, tolerance)
            depth_pct = self._relative_change_pct(min(left.price, right.price), midpoint) if not bullish else self._relative_change_pct(midpoint, max(left.price, right.price))
            depth_score = self._score_between(abs(depth_pct), 0.8, 12.0)
            trigger_distance = self._relative_change_pct(midpoint, right.price) if bullish else self._relative_change_pct(right.price, midpoint)
            trigger_score = self._score_between(abs(trigger_distance), 0.2, 5.0)
            current = {
                "similarity_score": similarity,
                "depth_score": depth_score,
                "trigger_score": trigger_score,
                "left_price": left.price,
                "right_price": right.price,
                "midpoint": midpoint,
                "left_position": left.position,
                "right_position": right.position,
                "midpoint_position": midpoint_pivot.position,
                "depth_pct": depth_pct,
            }
            if best is None or (current["similarity_score"] + current["depth_score"] + current["trigger_score"]) > (
                best["similarity_score"] + best["depth_score"] + best["trigger_score"]
            ):
                best = current
        return best

    def _head_and_shoulders(
        self,
        primary: list[_Pivot],
        opposing: list[_Pivot],
        inverse: bool,
        current_price: float,
    ) -> dict[str, float] | None:
        if len(primary) < 3:
            return None
        best: dict[str, float] | None = None
        shoulder_tolerance = self.config.patterns.shoulder_tolerance_pct
        for left, head, right in zip(primary[:-2], primary[1:-1], primary[2:]):
            if right.position - left.position < 8:
                continue
            if inverse:
                if not (head.price < left.price and head.price < right.price):
                    continue
            else:
                if not (head.price > left.price and head.price > right.price):
                    continue
            opposing_points = [pivot.price for pivot in opposing if left.position < pivot.position < right.position]
            opposing_pivots = [pivot for pivot in opposing if left.position < pivot.position < right.position]
            if len(opposing_points) < 2:
                continue
            neckline = np.mean(opposing_points[-2:])
            neckline_left = opposing_pivots[-2]
            neckline_right = opposing_pivots[-1]
            shoulder_score = self._match_score(left.price, right.price, shoulder_tolerance)
            head_prominence = self._relative_change_pct(max(left.price, right.price), head.price) if inverse else self._relative_change_pct(head.price, min(left.price, right.price))
            head_score = self._score_between(abs(head_prominence), 1.0, 10.0)
            if inverse:
                neckline_break = self._relative_change_pct(current_price, neckline)
            else:
                neckline_break = self._relative_change_pct(neckline, current_price)
            neckline_score = self._score_between(abs(neckline_break), 0.0, 4.0)
            current = {
                "shoulder_score": shoulder_score,
                "head_score": head_score,
                "neckline_score": neckline_score,
                "left_shoulder": left.price,
                "head": head.price,
                "right_shoulder": right.price,
                "left_position": left.position,
                "head_position": head.position,
                "right_position": right.position,
                "neckline": neckline,
                "neckline_left_position": neckline_left.position,
                "neckline_left_price": neckline_left.price,
                "neckline_right_position": neckline_right.position,
                "neckline_right_price": neckline_right.price,
            }
            if best is None or (current["shoulder_score"] + current["head_score"] + current["neckline_score"]) > (
                best["shoulder_score"] + best["head_score"] + best["neckline_score"]
            ):
                best = current
        return best

    def _recent_pullback_amplitudes(self, highs: list[_Pivot], lows: list[_Pivot]) -> list[float]:
        amplitudes: list[float] = []
        if len(highs) < 2 or len(lows) < 2:
            return amplitudes
        merged: list[tuple[str, _Pivot]] = [( "high", pivot) for pivot in highs] + [( "low", pivot) for pivot in lows]
        merged = sorted(merged, key=lambda item: item[1].position)
        for index in range(1, len(merged)):
            prev_kind, prev_pivot = merged[index - 1]
            kind, pivot = merged[index]
            if prev_kind == "high" and kind == "low":
                amplitudes.append(abs(self._relative_change_pct(prev_pivot.price, pivot.price)))
        return amplitudes[-3:]

    def _score_between(self, value: float, low: float, high: float, invert: bool = False) -> float:
        if pd.isna(value):
            return 0.0
        if high <= low:
            return 0.0
        clipped = clamp((value - low) / (high - low), 0.0, 1.0)
        score = 100.0 * (1.0 - clipped if invert else clipped)
        return clamp(score, 0.0, 100.0)

    @staticmethod
    def _weighted_score(*parts: tuple[float, float]) -> float:
        total_weight = sum(weight for _, weight in parts)
        if total_weight <= 0:
            return 0.0
        return clamp(sum(score * weight for score, weight in parts) / total_weight, 0.0, 100.0)

    @staticmethod
    def _bool_score(condition: bool) -> float:
        return 100.0 if condition else 0.0

    def _candidate(
        self,
        pattern_name: str,
        category: str,
        direction_bias: str,
        score: float,
        evidence: list[str],
        interpretation: str,
        outcome: str,
        invalidation: str,
        diagnostics: dict[str, Any] | None = None,
    ) -> PatternCandidate:
        return PatternCandidate(
            pattern_name=pattern_name,
            category=category,
            direction_bias=direction_bias,
            score=clamp(score * self._category_multiplier(category), 0.0, 100.0),
            interpretation_ko=interpretation,
            likely_outcome_ko=outcome,
            invalidation_ko=invalidation,
            evidence=evidence,
            diagnostics=diagnostics or {},
        )

    @staticmethod
    def _category_multiplier(category: str) -> float:
        multipliers = {
            "추세 구조": 1.00,
            "반전": 1.02,
            "지속": 1.02,
            "수렴/구조": 0.98,
            "변동성": 0.95,
            "캔들": 0.92,
            "거래량": 0.88,
        }
        return multipliers.get(category, 1.0)

    def _fallback_candidate(self, ctx: dict[str, Any]) -> PatternCandidate:
        if abs(ctx["slope_20"]) <= 1.5:
            return self._candidate(
                "Range",
                "수렴/구조",
                "neutral",
                40.0,
                ["명확한 구조 패턴보다 박스성 흐름이 우세하다."],
                "현재는 뚜렷한 단일 패턴보다 중립 박스에 더 가깝다.",
                "상하단 이탈이 나오기 전까지는 추세보다는 범위 대응 가능성이 크다.",
                "박스 외부 돌파가 나오면 해석을 업데이트해야 한다.",
            )
        return self._candidate(
            "Higher High + Higher Low" if ctx["slope_20"] > 0 else "Lower High + Lower Low",
            "추세 구조",
            "bullish" if ctx["slope_20"] > 0 else "bearish",
            40.0,
            ["명확한 고전 패턴보다 현재 추세 구조가 더 우세하다."],
            "현재 차트는 복합 패턴보다 추세 구조 해석이 더 적절하다.",
            "추세가 유지되면 같은 방향의 연장 시도가 이어질 가능성이 있다.",
            "직전 추세 구조가 깨지면 해석을 다시 볼 필요가 있다.",
        )

    def _build_summary(
        self,
        primary: PatternCandidate | None,
        secondary: PatternCandidate | None,
        ctx: dict[str, Any],
    ) -> str:
        if primary is None:
            return "현재 구간에서는 유의미한 패턴 후보를 충분히 추리지 못했다."
        first = (
            f"1순위는 {primary.pattern_name} ({primary.score:.1f}점)로 보인다. "
            f"{primary.interpretation_ko} {primary.likely_outcome_ko}"
        )
        second = ""
        if secondary is not None:
            second = (
                f" 2순위는 {secondary.pattern_name} ({secondary.score:.1f}점)다. "
                f"{secondary.interpretation_ko} {secondary.likely_outcome_ko}"
            )
        context_tail = (
            f" 현재 추세 상태는 {ctx['trend_state_label']}이며 전환 위험 점수는 {ctx['transition_risk_score']:.1f}다."
        )
        return f"{first}{second}{context_tail}".strip()

    def _diagnostics(self, ctx: dict[str, Any], ranked: list[PatternCandidate]) -> dict[str, Any]:
        return {
            "analysis_window_bars": len(ctx["window"]),
            "breakout_up": ctx["breakout_up"],
            "breakout_down": ctx["breakout_down"],
            "bb_width_rank": ctx["bb_width_rank"],
            "compression_ratio": ctx["compression_ratio"],
            "volume_ratio": ctx["volume_ratio"],
            "top_scores": {candidate.pattern_name: candidate.score for candidate in ranked[:5]},
        }

    @staticmethod
    def _pivot_points(series: pd.Series, span: int, mode: str) -> list[_Pivot]:
        window = span * 2 + 1
        if len(series) < window:
            return []
        roller = series.rolling(window=window, center=True)
        reference = roller.max() if mode == "high" else roller.min()
        mask = series.eq(reference)
        points: list[_Pivot] = []
        for position, (timestamp, value, is_pivot) in enumerate(zip(series.index, series.to_list(), mask.to_list())):
            if not is_pivot or pd.isna(value):
                continue
            points.append(_Pivot(position=position, timestamp=timestamp, price=float(value)))
        return points

    @staticmethod
    def _window_return(series: pd.Series, bars: int) -> float:
        if bars <= 1 or len(series) < 2:
            return 0.0
        series = series.tail(bars)
        start = float(series.iloc[0])
        end = float(series.iloc[-1])
        return safe_divide(end - start, start, default=0.0) * 100.0

    @staticmethod
    def _trend_percent(series: pd.Series) -> float:
        values = series.dropna().to_numpy(dtype=float)
        if len(values) < 3:
            return 0.0
        slope = linear_regression_slope(values)
        scale = max(abs(float(np.nanmean(values))), 1e-6)
        return safe_divide(slope * (len(values) - 1), scale, default=0.0) * 100.0

    @staticmethod
    def _obv_slope(close: pd.Series, volume: pd.Series, bars: int) -> float:
        direction = np.sign(close.diff().fillna(0.0))
        obv = (direction * volume).fillna(0.0).cumsum().tail(bars)
        scale = max(volume.tail(bars).mean(), 1e-6)
        return safe_divide(linear_regression_slope(obv.to_numpy(dtype=float)) * max(len(obv) - 1, 1), scale, default=0.0)

    @staticmethod
    def _range_position(price: float, low_value: float, high_value: float) -> float:
        if high_value <= low_value:
            return 0.5
        return clamp((price - low_value) / (high_value - low_value), 0.0, 1.0)

    @staticmethod
    def _range_pct(high: pd.Series, low: pd.Series, close_value: float) -> float:
        if high.empty or low.empty:
            return 0.0
        return safe_divide(float(high.max() - low.min()), close_value, default=0.0) * 100.0

    @staticmethod
    def _relative_change_pct(current: float, baseline: float) -> float:
        return safe_divide(current - baseline, baseline, default=0.0) * 100.0

    @staticmethod
    def _match_score(left: float, right: float, tolerance_pct: float) -> float:
        if left == 0.0 and right == 0.0:
            return 100.0
        diff_pct = abs(safe_divide(left - right, max((left + right) / 2.0, 1e-6), default=0.0) * 100.0)
        return clamp((1.0 - safe_divide(diff_pct, tolerance_pct, default=1.0)) * 100.0, 0.0, 100.0)

    def _candle_shape(self, ctx: dict[str, Any]) -> tuple[float, float, float, float]:
        candle_range = max(ctx["last_high"] - ctx["last_low"], 1e-6)
        body = abs(ctx["last_close"] - ctx["last_open"])
        body_ratio = body / candle_range
        lower_wick = self._lower_wick_ratio(ctx["last_open"], ctx["last_close"], ctx["last_high"], ctx["last_low"])
        upper_wick = self._upper_wick_ratio(ctx["last_open"], ctx["last_close"], ctx["last_high"], ctx["last_low"])
        return body, body_ratio, lower_wick, upper_wick

    @staticmethod
    def _lower_wick_ratio(open_value: float, close_value: float, high_value: float, low_value: float) -> float:
        candle_range = max(high_value - low_value, 1e-6)
        return clamp((min(open_value, close_value) - low_value) / candle_range, 0.0, 1.0)

    @staticmethod
    def _upper_wick_ratio(open_value: float, close_value: float, high_value: float, low_value: float) -> float:
        candle_range = max(high_value - low_value, 1e-6)
        return clamp((high_value - max(open_value, close_value)) / candle_range, 0.0, 1.0)

    @staticmethod
    def _infer_trend_state(close: pd.Series, indicators: pd.DataFrame) -> str:
        if "ema20" in indicators and "ema50" in indicators:
            ema20 = float(indicators["ema20"].iloc[-1])
            ema50 = float(indicators["ema50"].iloc[-1])
            last_close = float(close.iloc[-1])
            if last_close > ema20 > ema50:
                return "bullish"
            if last_close < ema20 < ema50:
                return "bearish"
        slope = ChartPatternAnalyzer._trend_percent(close.tail(20))
        if slope > 1.0:
            return "bullish"
        if slope < -1.0:
            return "bearish"
        return "sideways"

    @staticmethod
    def _as_of_datetime(timestamp: pd.Timestamp) -> datetime:
        return timestamp.to_pydatetime() if isinstance(timestamp, pd.Timestamp) else pd.Timestamp(timestamp).to_pydatetime()
