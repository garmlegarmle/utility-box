"""Confirmation engine for secondary indicator checks."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from ..utils import clamp, rolling_percentile_rank, safe_divide
from .config import ChartInterpretationConfig
from .models import SwingPoint


class ConfirmationEngine:
    """Secondary confirmation logic built from indicators and candle behavior."""

    def __init__(self, config: ChartInterpretationConfig) -> None:
        self.config = config

    def analyze(self, frame: pd.DataFrame, swings: dict[str, list[SwingPoint]]) -> dict[str, Any]:
        latest = frame.iloc[-1]
        candle_range = max(float(latest["high"] - latest["low"]), 1e-6)
        body = float(latest["close"] - latest["open"])
        close_location = safe_divide(float(latest["close"] - latest["low"]), candle_range, default=0.5)
        upper_wick = safe_divide(float(latest["high"] - max(latest["close"], latest["open"])), candle_range, default=0.0)
        lower_wick = safe_divide(float(min(latest["close"], latest["open"]) - latest["low"]), candle_range, default=0.0)
        relative_volume = safe_divide(float(latest["volume"]), float(latest["volume_avg_20"]), default=1.0)
        bb_width_rank = float(rolling_percentile_rank(frame["bb_width"], 60).iloc[-1]) if len(frame) >= 60 else 0.5
        bullish_divergence, bearish_divergence = self._divergence_checks(frame, swings)
        candlestick_signals = self._candlestick_signals(frame, relative_volume)
        bullish_candle_score = max((signal["confidence"] for signal in candlestick_signals if signal["direction"] == "bullish"), default=0.0)
        bearish_candle_score = max((signal["confidence"] for signal in candlestick_signals if signal["direction"] == "bearish"), default=0.0)

        return {
            "rsi": float(latest["rsi"]),
            "rsi_bias": clamp((float(latest["rsi"]) - 50.0) / 20.0, -1.0, 1.0),
            "macd_hist": float(latest["macd_hist"]),
            "macd_hist_bias": clamp(float(latest["macd_hist"]) / max(float(latest["atr"]), 1e-6), -1.0, 1.0),
            "bb_width": float(latest["bb_width"]),
            "bb_width_rank": bb_width_rank,
            "relative_volume": relative_volume,
            "candle_body_strength": clamp(body / candle_range, -1.0, 1.0),
            "upper_wick_ratio": upper_wick,
            "lower_wick_ratio": lower_wick,
            "breakout_quality": clamp(close_location * 0.6 + relative_volume * 0.2 + abs(body / candle_range) * 0.2, 0.0, 1.0),
            "bullish_divergence": bullish_divergence,
            "bearish_divergence": bearish_divergence,
            "candlestick_signals": candlestick_signals,
            "bullish_candle_score": bullish_candle_score,
            "bearish_candle_score": bearish_candle_score,
            "summary": self._summary(float(latest["rsi"]), relative_volume, close_location, bullish_divergence, bearish_divergence, candlestick_signals),
        }

    def _divergence_checks(self, frame: pd.DataFrame, swings: dict[str, list[SwingPoint]]) -> tuple[bool, bool]:
        major = swings.get("major", [])
        lows = [s for s in major if s.kind == "low"][-2:]
        highs = [s for s in major if s.kind == "high"][-2:]
        bullish = False
        bearish = False
        if len(lows) == 2:
            prev, curr = lows
            prev_rsi = float(frame["rsi"].iloc[prev.bar_index])
            curr_rsi = float(frame["rsi"].iloc[curr.bar_index])
            bullish = curr.price < prev.price and curr_rsi > prev_rsi
        if len(highs) == 2:
            prev, curr = highs
            prev_rsi = float(frame["rsi"].iloc[prev.bar_index])
            curr_rsi = float(frame["rsi"].iloc[curr.bar_index])
            bearish = curr.price > prev.price and curr_rsi < prev_rsi
        return bullish, bearish

    def _candlestick_signals(self, frame: pd.DataFrame, relative_volume: float) -> list[dict[str, Any]]:
        if len(frame) < 2:
            return []
        latest = frame.iloc[-1]
        prev = frame.iloc[-2]
        avg_range = float((frame["high"] - frame["low"]).tail(10).mean()) if len(frame) >= 10 else float((frame["high"] - frame["low"]).mean())
        signals: list[dict[str, Any]] = []

        latest_range = max(float(latest["high"] - latest["low"]), 1e-6)
        latest_body = float(latest["close"] - latest["open"])
        latest_body_ratio = abs(latest_body) / latest_range
        latest_upper_wick = safe_divide(float(latest["high"] - max(latest["close"], latest["open"])), latest_range, default=0.0)
        latest_lower_wick = safe_divide(float(min(latest["close"], latest["open"]) - latest["low"]), latest_range, default=0.0)

        prev_body_low = min(float(prev["open"]), float(prev["close"]))
        prev_body_high = max(float(prev["open"]), float(prev["close"]))
        latest_body_low = min(float(latest["open"]), float(latest["close"]))
        latest_body_high = max(float(latest["open"]), float(latest["close"]))

        if float(prev["close"]) < float(prev["open"]) and float(latest["close"]) > float(latest["open"]) and latest_body_low <= prev_body_low and latest_body_high >= prev_body_high:
            signals.append(self._signal(frame, "bullish engulfing", "bullish", 0.72 + latest_body_ratio * 0.15, "The latest bar has engulfed the prior bearish body."))
        if float(prev["close"]) > float(prev["open"]) and float(latest["close"]) < float(latest["open"]) and latest_body_low <= prev_body_low and latest_body_high >= prev_body_high:
            signals.append(self._signal(frame, "bearish engulfing", "bearish", 0.72 + latest_body_ratio * 0.15, "The latest bar has engulfed the prior bullish body."))
        if latest_body_ratio <= 0.35 and latest_lower_wick >= 0.55:
            signals.append(self._signal(frame, "pin bar", "bullish", 0.58 + latest_lower_wick * 0.18, "The candle rejected lower prices with a long lower wick."))
        if latest_body_ratio <= 0.35 and latest_upper_wick >= 0.55:
            signals.append(self._signal(frame, "pin bar", "bearish", 0.58 + latest_upper_wick * 0.18, "The candle rejected higher prices with a long upper wick."))
        if float(latest["high"]) <= float(prev["high"]) and float(latest["low"]) >= float(prev["low"]):
            signals.append(self._signal(frame, "inside bar", "neutral", 0.58, "The latest bar is contained inside the prior bar and reflects short-term compression."))

        if latest_range >= avg_range * 1.45:
            close_location = safe_divide(float(latest["close"] - latest["low"]), latest_range, default=0.5)
            if close_location >= 0.72:
                signals.append(self._signal(frame, "breakout candle", "bullish", 0.60 + min(relative_volume, 2.0) * 0.08, "The latest candle expanded its range and closed near the high."))
            elif close_location <= 0.28:
                signals.append(self._signal(frame, "breakout candle", "bearish", 0.60 + min(relative_volume, 2.0) * 0.08, "The latest candle expanded its range and closed near the low."))

        if latest_range >= avg_range * 1.35 and latest_body_ratio <= 0.40:
            if latest_upper_wick >= 0.45:
                signals.append(self._signal(frame, "exhaustion candle", "bearish", 0.56 + latest_upper_wick * 0.16, "The range expanded, but the upper wick shows fading upside acceptance."))
            elif latest_lower_wick >= 0.45:
                signals.append(self._signal(frame, "exhaustion candle", "bullish", 0.56 + latest_lower_wick * 0.16, "The range expanded, but the lower wick shows downside rejection."))

        threshold = self.config.confirmations.candlestick_signal_min_confidence
        filtered = [signal for signal in signals if signal["confidence"] >= threshold]
        return sorted(filtered, key=lambda item: (-item["confidence"], item["pattern_name"]))[:2]

    @staticmethod
    def _signal(frame: pd.DataFrame, pattern_name: str, direction: str, confidence: float, explanation: str) -> dict[str, Any]:
        return {
            "pattern_name": pattern_name,
            "direction": direction,
            "confidence": clamp(confidence, 0.0, 1.0),
            "timestamp": pd.Timestamp(frame.index[-1]).isoformat(),
            "bar_index": len(frame) - 1,
            "price": float(frame["close"].iloc[-1]),
            "explanation": explanation,
        }

    @staticmethod
    def _summary(
        rsi: float,
        relative_volume: float,
        close_location: float,
        bullish_divergence: bool,
        bearish_divergence: bool,
        candlestick_signals: list[dict[str, Any]],
    ) -> str:
        pieces = []
        pieces.append("momentum is stabilizing" if 45.0 <= rsi <= 60.0 else "momentum is extended")
        pieces.append("volume is expanding" if relative_volume >= 1.2 else "volume remains ordinary")
        pieces.append("the breakout bar closed strong" if close_location >= 0.75 else "bar quality is mixed")
        if bullish_divergence:
            pieces.append("bullish divergence is present")
        if bearish_divergence:
            pieces.append("bearish divergence is present")
        if candlestick_signals:
            lead = candlestick_signals[0]
            pieces.append(f"latest candle looks like {lead['pattern_name']}")
        return ", ".join(pieces)
