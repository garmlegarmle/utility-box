"""Pattern detection engine."""

from __future__ import annotations

from typing import Any

import pandas as pd

from ..utils import clamp
from .config import ChartInterpretationConfig
from .models import PatternSignal, SwingPoint, Zone


class PatternEngine:
    """Rule-based pattern detection built on structure and zones."""

    def __init__(self, config: ChartInterpretationConfig) -> None:
        self.config = config

    def analyze(
        self,
        frame: pd.DataFrame,
        trend_result: dict[str, Any],
        structure: dict[str, Any],
        zones: list[dict[str, Any]],
        swings: dict[str, list[SwingPoint]],
        confirmation: dict[str, Any],
    ) -> list[PatternSignal]:
        zone_objects = [Zone(**zone) for zone in zones]
        patterns: list[PatternSignal] = []
        for detector in (
            self._bull_flag,
            self._bear_flag,
            self._triangle_or_wedge,
            self._range_box,
            self._range_breakout,
            self._breakout_retest,
            self._trend_pullback_continuation,
            self._double_top,
            self._double_bottom,
            self._volatility_contraction_breakout,
            self._failed_breakout,
        ):
            signal = detector(frame, trend_result, structure, zone_objects, swings, confirmation)
            if signal is not None:
                patterns.append(signal)

        filtered = [pattern for pattern in patterns if pattern.confidence >= self.config.patterns.min_pattern_confidence]
        return sorted(filtered, key=lambda item: (-item.relevance, -item.confidence, item.pattern_name))

    def _bull_flag(
        self,
        frame: pd.DataFrame,
        trend: dict[str, Any],
        structure: dict[str, Any],
        _zones: list[Zone],
        swings: dict[str, list[SwingPoint]],
        confirmation: dict[str, Any],
    ) -> PatternSignal | None:
        if trend["label"] not in {"uptrend", "weak trend"}:
            return None
        recent = self._recent_swings(swings, "medium", len(frame), self.config.patterns.flag_window_bars)
        highs = [s for s in recent if s.kind == "high"]
        lows = [s for s in recent if s.kind == "low"]
        if len(highs) < 2 or len(lows) < 2:
            return None
        high_a, high_b = highs[-2], highs[-1]
        low_a, low_b = lows[-2], lows[-1]
        if not (high_b.price < high_a.price and low_b.price < low_a.price):
            return None

        pre_lows = [s for s in swings.get("medium", []) if s.kind == "low" and s.bar_index < high_a.bar_index]
        if not pre_lows:
            return None
        pole_low = pre_lows[-1]
        pole_height = high_a.price - pole_low.price
        flag_depth = high_a.price - min(low_a.price, low_b.price)
        atr = float(frame["atr"].iloc[-1])
        if pole_height < atr * 3.0 or flag_depth > pole_height * 0.7:
            return None

        current_bar = len(frame) - 1
        upper_now = self._project_line_value(high_a.bar_index, high_a.price, high_b.bar_index, high_b.price, current_bar)
        lower_now = self._project_line_value(low_a.bar_index, low_a.price, low_b.bar_index, low_b.price, current_bar)
        close = float(frame["close"].iloc[-1])
        if close < lower_now - atr * 0.35 or close > upper_now + atr:
            return None

        confidence = clamp(
            0.48
            + max(0.0, trend["score"]) * 0.16
            + max(0.0, confirmation["rsi_bias"]) * 0.08
            + clamp(1.0 - flag_depth / max(pole_height, 1e-6), 0.0, 1.0) * 0.12,
            0.0,
            1.0,
        )
        breakout_level = upper_now
        invalidation = min(low_a.price, low_b.price) - atr * 0.25
        return self._signal(
            frame=frame,
            pattern_name="bull flag",
            direction="bullish",
            confidence=confidence,
            latest_anchor=max(high_b.bar_index, low_b.bar_index),
            relevant_levels={"breakout_level": breakout_level, "flag_support": lower_now},
            target_estimation={
                "target_1": breakout_level + pole_height * 0.65,
                "target_2": breakout_level + pole_height,
            },
            breakout_level=breakout_level,
            invalidation_level=invalidation,
            anchor_points=[
                self._anchor_point(pole_low, "pole low"),
                self._anchor_point(high_a, "flag high 1"),
                self._anchor_point(low_a, "flag low 1"),
                self._anchor_point(high_b, "flag high 2"),
                self._anchor_point(low_b, "flag low 2"),
            ],
            draw_lines=[
                self._line(frame, high_a.bar_index, high_b.bar_index, high_a.price, high_b.price, "Flag upper", "resistance", "solid", True),
                self._line(frame, low_a.bar_index, low_b.bar_index, low_a.price, low_b.price, "Flag lower", "support", "solid", True),
            ],
            explanation=[
                "The prior impulse is still intact and the pullback has stayed controlled.",
                "Recent highs and lows are drifting lower in a contained channel rather than breaking trend support outright.",
            ],
        )

    def _bear_flag(
        self,
        frame: pd.DataFrame,
        trend: dict[str, Any],
        structure: dict[str, Any],
        _zones: list[Zone],
        swings: dict[str, list[SwingPoint]],
        confirmation: dict[str, Any],
    ) -> PatternSignal | None:
        if trend["label"] not in {"downtrend", "weak trend"}:
            return None
        recent = self._recent_swings(swings, "medium", len(frame), self.config.patterns.flag_window_bars)
        highs = [s for s in recent if s.kind == "high"]
        lows = [s for s in recent if s.kind == "low"]
        if len(highs) < 2 or len(lows) < 2:
            return None
        high_a, high_b = highs[-2], highs[-1]
        low_a, low_b = lows[-2], lows[-1]
        if not (high_b.price > high_a.price and low_b.price > low_a.price):
            return None

        pre_highs = [s for s in swings.get("medium", []) if s.kind == "high" and s.bar_index < low_a.bar_index]
        if not pre_highs:
            return None
        pole_high = pre_highs[-1]
        pole_height = pole_high.price - low_a.price
        flag_height = max(high_a.price, high_b.price) - low_a.price
        atr = float(frame["atr"].iloc[-1])
        if pole_height < atr * 3.0 or flag_height > pole_height * 0.7:
            return None

        current_bar = len(frame) - 1
        upper_now = self._project_line_value(high_a.bar_index, high_a.price, high_b.bar_index, high_b.price, current_bar)
        lower_now = self._project_line_value(low_a.bar_index, low_a.price, low_b.bar_index, low_b.price, current_bar)
        close = float(frame["close"].iloc[-1])
        if close > upper_now + atr * 0.35 or close < lower_now - atr:
            return None

        confidence = clamp(
            0.48
            + max(0.0, -trend["score"]) * 0.16
            + max(0.0, -confirmation["rsi_bias"]) * 0.08
            + clamp(1.0 - flag_height / max(pole_height, 1e-6), 0.0, 1.0) * 0.12,
            0.0,
            1.0,
        )
        breakout_level = lower_now
        invalidation = max(high_a.price, high_b.price) + atr * 0.25
        return self._signal(
            frame=frame,
            pattern_name="bear flag",
            direction="bearish",
            confidence=confidence,
            latest_anchor=max(high_b.bar_index, low_b.bar_index),
            relevant_levels={"breakout_level": breakout_level, "flag_resistance": upper_now},
            target_estimation={
                "target_1": breakout_level - pole_height * 0.65,
                "target_2": breakout_level - pole_height,
            },
            breakout_level=breakout_level,
            invalidation_level=invalidation,
            anchor_points=[
                self._anchor_point(pole_high, "pole high"),
                self._anchor_point(high_a, "flag high 1"),
                self._anchor_point(low_a, "flag low 1"),
                self._anchor_point(high_b, "flag high 2"),
                self._anchor_point(low_b, "flag low 2"),
            ],
            draw_lines=[
                self._line(frame, high_a.bar_index, high_b.bar_index, high_a.price, high_b.price, "Flag upper", "resistance", "solid", True),
                self._line(frame, low_a.bar_index, low_b.bar_index, low_a.price, low_b.price, "Flag lower", "support", "solid", True),
            ],
            explanation=[
                "The rebound has stayed contained and still looks corrective inside the larger decline.",
                "Recent highs and lows are lifting together, but the move has not repaired the broader downtrend.",
            ],
        )

    def _triangle_or_wedge(
        self,
        frame: pd.DataFrame,
        trend: dict[str, Any],
        structure: dict[str, Any],
        _zones: list[Zone],
        swings: dict[str, list[SwingPoint]],
        confirmation: dict[str, Any],
    ) -> PatternSignal | None:
        recent = self._recent_swings(swings, "medium", len(frame), self.config.patterns.wedge_window_bars)
        highs = [s for s in recent if s.kind == "high"][-3:]
        lows = [s for s in recent if s.kind == "low"][-3:]
        if len(highs) < 2 or len(lows) < 2:
            return None

        high_first, high_last = highs[0], highs[-1]
        low_first, low_last = lows[0], lows[-1]
        high_slope = self._slope(high_first, high_last)
        low_slope = self._slope(low_first, low_last)
        first_width = high_first.price - low_first.price
        last_width = high_last.price - low_last.price
        if first_width <= 0 or last_width <= 0 or last_width >= first_width * 0.92:
            return None

        flat_tolerance = self.config.patterns.triangle_flat_tolerance_pct / 100.0
        flat_highs = (max(s.price for s in highs) - min(s.price for s in highs)) / max(s.price for s in highs) <= flat_tolerance
        flat_lows = (max(s.price for s in lows) - min(s.price for s in lows)) / max(s.price for s in lows) <= flat_tolerance

        pattern_name = None
        direction = "neutral"
        if high_slope < 0 and low_slope > 0:
            if flat_highs and not flat_lows:
                pattern_name = "ascending triangle"
                direction = "bullish"
            elif flat_lows and not flat_highs:
                pattern_name = "descending triangle"
                direction = "bearish"
            else:
                pattern_name = "symmetrical triangle"
        elif high_slope > 0 and low_slope > 0 and low_slope > high_slope * 1.25:
            pattern_name = "rising wedge"
            direction = "bearish"
        elif high_slope < 0 and low_slope < 0 and abs(high_slope) > abs(low_slope) * 1.25:
            pattern_name = "falling wedge"
            direction = "bullish"
        if pattern_name is None:
            return None

        current_bar = len(frame) - 1
        upper_now = self._project_line_value(high_first.bar_index, high_first.price, high_last.bar_index, high_last.price, current_bar)
        lower_now = self._project_line_value(low_first.bar_index, low_first.price, low_last.bar_index, low_last.price, current_bar)
        close = float(frame["close"].iloc[-1])
        atr = float(frame["atr"].iloc[-1])
        if close > upper_now + atr or close < lower_now - atr:
            return None

        confidence = clamp(
            0.44
            + (0.10 if structure["label"] == "compression" else 0.0)
            + (0.08 if confirmation["bb_width_rank"] <= 0.35 else 0.0)
            + clamp((first_width - last_width) / max(first_width, 1e-6), 0.0, 1.0) * 0.14,
            0.0,
            1.0,
        )
        height = first_width
        breakout_level = upper_now if direction != "bearish" else lower_now
        invalidation = lower_now - atr * 0.25 if direction != "bearish" else upper_now + atr * 0.25
        return self._signal(
            frame=frame,
            pattern_name=pattern_name,
            direction=direction,
            confidence=confidence,
            latest_anchor=max(high_last.bar_index, low_last.bar_index),
            relevant_levels={"upper_boundary": upper_now, "lower_boundary": lower_now},
            target_estimation={
                "target_1": breakout_level + height * 0.7 if direction != "bearish" else breakout_level - height * 0.7,
                "target_2": breakout_level + height if direction != "bearish" else breakout_level - height,
            },
            breakout_level=breakout_level,
            invalidation_level=invalidation,
            anchor_points=[
                self._anchor_point(high_first, "upper 1"),
                self._anchor_point(high_last, "upper 2"),
                self._anchor_point(low_first, "lower 1"),
                self._anchor_point(low_last, "lower 2"),
            ],
            draw_lines=[
                self._line(frame, high_first.bar_index, high_last.bar_index, high_first.price, high_last.price, "Upper boundary", "resistance", "solid", True),
                self._line(frame, low_first.bar_index, low_last.bar_index, low_first.price, low_last.price, "Lower boundary", "support", "solid", True),
            ],
            explanation=[
                "The chart is narrowing into a tighter swing structure.",
                "A clean break from these converging boundaries would matter more than the indicators on their own.",
            ],
        )

    def _range_box(
        self,
        frame: pd.DataFrame,
        trend: dict[str, Any],
        structure: dict[str, Any],
        _zones: list[Zone],
        swings: dict[str, list[SwingPoint]],
        confirmation: dict[str, Any],
    ) -> PatternSignal | None:
        bars = min(self.config.patterns.range_box_bars, len(frame))
        recent = frame.tail(bars)
        box_high = float(recent["high"].max())
        box_low = float(recent["low"].min())
        width = box_high - box_low
        atr = float(frame["atr"].iloc[-1])
        if width < atr * 3.0:
            return None
        if structure["label"] not in {"range structure", "compression", "transition"} and abs(trend["score"]) > 0.28:
            return None
        confidence = clamp(
            0.42
            + (0.10 if structure["label"] == "range structure" else 0.0)
            + (0.06 if confirmation["bb_width_rank"] <= 0.45 else 0.0),
            0.0,
            1.0,
        )
        start_idx = len(frame) - bars
        end_idx = len(frame) - 1
        return self._signal(
            frame=frame,
            pattern_name="range box",
            direction="neutral",
            confidence=confidence,
            latest_anchor=end_idx,
            relevant_levels={"range_high": box_high, "range_low": box_low},
            target_estimation={"target_1": box_high, "target_2": box_low},
            breakout_level=box_high,
            invalidation_level=box_low,
            anchor_points=[
                {"timestamp": pd.Timestamp(frame.index[start_idx]).isoformat(), "bar_index": start_idx, "price": box_high, "label": "range start"},
                {"timestamp": pd.Timestamp(frame.index[end_idx]).isoformat(), "bar_index": end_idx, "price": box_low, "label": "range end"},
            ],
            draw_lines=[
                self._horizontal_line(frame, start_idx, end_idx, box_high, "Range high", "resistance", "solid"),
                self._horizontal_line(frame, start_idx, end_idx, box_low, "Range low", "support", "solid"),
            ],
            explanation=[
                "Price is still trading like a box rather than a clean directional trend.",
                "The range boundaries matter more than indicator drift while the market stays inside them.",
            ],
        )

    def _range_breakout(
        self,
        frame: pd.DataFrame,
        trend: dict[str, Any],
        structure: dict[str, Any],
        _zones: list[Zone],
        _swings: dict[str, list[SwingPoint]],
        confirmation: dict[str, Any],
    ) -> PatternSignal | None:
        if structure["label"] not in {"range structure", "compression", "break of structure"}:
            return None
        recent = frame.tail(20)
        range_high = float(recent["high"].max())
        range_low = float(recent["low"].min())
        close = float(frame["close"].iloc[-1])
        atr = float(frame["atr"].iloc[-1])
        if close <= range_high + atr * self.config.patterns.breakout_buffer_atr:
            return None
        confidence = clamp(0.48 + confirmation["relative_volume"] * 0.12 + confirmation["breakout_quality"] * 0.20, 0.0, 1.0)
        start_idx = len(frame) - len(recent)
        end_idx = len(frame) - 1
        return self._signal(
            frame=frame,
            pattern_name="range breakout",
            direction="bullish",
            confidence=confidence,
            latest_anchor=end_idx,
            relevant_levels={"range_high": range_high, "range_low": range_low},
            target_estimation={"target_1": range_high + (range_high - range_low), "target_2": range_high + (range_high - range_low) * 1.6},
            breakout_level=range_high,
            invalidation_level=range_low,
            anchor_points=[
                {"timestamp": pd.Timestamp(frame.index[start_idx]).isoformat(), "bar_index": start_idx, "price": range_high, "label": "box high"},
                {"timestamp": pd.Timestamp(frame.index[start_idx]).isoformat(), "bar_index": start_idx, "price": range_low, "label": "box low"},
            ],
            draw_lines=[
                self._horizontal_line(frame, start_idx, end_idx, range_high, "Breakout level", "resistance", "solid"),
                self._horizontal_line(frame, start_idx, end_idx, range_low, "Range floor", "support", "dashed"),
            ],
            explanation=[
                "Price has pushed through the recent box ceiling.",
                "The move looks more credible because the close is holding above the prior range high.",
            ],
        )

    def _breakout_retest(
        self,
        frame: pd.DataFrame,
        _trend: dict[str, Any],
        structure: dict[str, Any],
        zones: list[Zone],
        _swings: dict[str, list[SwingPoint]],
        confirmation: dict[str, Any],
    ) -> PatternSignal | None:
        direction = structure.get("break_of_structure")
        if direction not in {"bullish", "bearish"}:
            return None
        current = float(frame["close"].iloc[-1])
        atr = float(frame["atr"].iloc[-1])
        zone_types = {"support", "volume_node"} if direction == "bullish" else {"resistance", "volume_node"}
        candidates = [zone for zone in zones if zone.zone_type in zone_types]
        if not candidates:
            return None
        candidate = min(candidates, key=lambda zone: abs(zone.center() - current))
        if abs(candidate.center() - current) > atr * 0.9:
            return None
        breakout_level = candidate.center()
        invalidation = candidate.lower_bound - atr * 0.2 if direction == "bullish" else candidate.upper_bound + atr * 0.2
        target_1 = current + atr * 3.0 if direction == "bullish" else current - atr * 3.0
        target_2 = current + atr * 5.0 if direction == "bullish" else current - atr * 5.0
        start_idx = max(len(frame) - self.config.patterns.retest_window_bars, 0)
        end_idx = len(frame) - 1
        return self._signal(
            frame=frame,
            pattern_name="breakout retest",
            direction=direction,
            confidence=clamp(0.46 + abs(confirmation["candle_body_strength"]) * 0.10 + abs(confirmation["macd_hist_bias"]) * 0.08, 0.0, 1.0),
            latest_anchor=end_idx,
            relevant_levels={"retest_zone_mid": candidate.center()},
            target_estimation={"target_1": target_1, "target_2": target_2},
            breakout_level=breakout_level,
            invalidation_level=invalidation,
            anchor_points=[
                {"timestamp": pd.Timestamp(frame.index[end_idx]).isoformat(), "bar_index": end_idx, "price": candidate.center(), "label": "retest"},
            ],
            draw_lines=[
                self._horizontal_line(frame, start_idx, end_idx, candidate.center(), "Retest line", "support" if direction == "bullish" else "resistance", "solid"),
            ],
            explanation=[
                "Price is revisiting a prior break area instead of running straight away from it.",
                "This is the kind of test that often decides whether the move was real or premature.",
            ],
        )

    def _trend_pullback_continuation(
        self,
        frame: pd.DataFrame,
        trend: dict[str, Any],
        structure: dict[str, Any],
        _zones: list[Zone],
        swings: dict[str, list[SwingPoint]],
        confirmation: dict[str, Any],
    ) -> PatternSignal | None:
        if trend["label"] not in {"uptrend", "weak trend"} or structure["label"] not in {"bullish structure intact", "structure weakening", "compression"}:
            return None
        close = float(frame["close"].iloc[-1])
        ema20 = float(frame["ema20"].iloc[-1])
        atr = float(frame["atr"].iloc[-1])
        if abs(close - ema20) > atr * self.config.patterns.pullback_atr_tolerance:
            return None
        recent_lows = [s for s in self._recent_swings(swings, "medium", len(frame), 24) if s.kind == "low"]
        recent_highs = [s for s in self._recent_swings(swings, "medium", len(frame), 24) if s.kind == "high"]
        draw_lines: list[dict[str, Any]] = []
        if len(recent_lows) >= 2:
            draw_lines.append(self._line(frame, recent_lows[-2].bar_index, recent_lows[-1].bar_index, recent_lows[-2].price, recent_lows[-1].price, "Pullback support", "support", "dashed", True))
        if len(recent_highs) >= 2:
            draw_lines.append(self._line(frame, recent_highs[-2].bar_index, recent_highs[-1].bar_index, recent_highs[-2].price, recent_highs[-1].price, "Pullback cap", "resistance", "dashed", True))
        return self._signal(
            frame=frame,
            pattern_name="trend pullback continuation",
            direction="bullish",
            confidence=clamp(0.42 + max(0.0, trend["score"]) * 0.26 + max(0.0, confirmation["rsi_bias"]) * 0.08, 0.0, 1.0),
            latest_anchor=len(frame) - 1,
            relevant_levels={"ema20": ema20},
            target_estimation={"target_1": close + atr * 3.5, "target_2": close + atr * 6.0},
            breakout_level=float(frame["high"].tail(5).max()),
            invalidation_level=min(float(frame["low"].tail(5).min()), ema20 - atr * 0.4),
            anchor_points=[
                {"timestamp": pd.Timestamp(frame.index[-1]).isoformat(), "bar_index": len(frame) - 1, "price": ema20, "label": "ema20 pullback"},
            ],
            draw_lines=draw_lines,
            explanation=[
                "The move still looks more like a pullback into trend support than a full trend reversal.",
                "Price is working around the fast average and recent pullback boundaries instead of collapsing through them.",
            ],
        )

    def _double_top(
        self,
        frame: pd.DataFrame,
        _trend: dict[str, Any],
        _structure: dict[str, Any],
        _zones: list[Zone],
        swings: dict[str, list[SwingPoint]],
        _confirmation: dict[str, Any],
    ) -> PatternSignal | None:
        highs = [s for s in swings.get("major", []) if s.kind == "high"]
        lows = [s for s in swings.get("major", []) if s.kind == "low"]
        if len(highs) < 2 or not lows:
            return None
        left, right = highs[-2], highs[-1]
        tolerance = self.config.patterns.double_tolerance_pct / 100.0
        if abs(left.price - right.price) / max(left.price, right.price) > tolerance:
            return None
        middle_lows = [low for low in lows if left.bar_index < low.bar_index < right.bar_index]
        neckline_swing = max(middle_lows, key=lambda item: item.price, default=None)
        if neckline_swing is None:
            return None
        neckline = neckline_swing.price
        close = float(frame["close"].iloc[-1])
        if close > neckline:
            return None
        height = ((left.price + right.price) / 2.0) - neckline
        return self._signal(
            frame=frame,
            pattern_name="double top",
            direction="bearish",
            confidence=0.72,
            latest_anchor=right.bar_index,
            relevant_levels={"top": (left.price + right.price) / 2.0, "neckline": neckline},
            target_estimation={"target_1": neckline - height, "target_2": neckline - height * 1.5},
            breakout_level=neckline,
            invalidation_level=max(left.price, right.price),
            anchor_points=[
                self._anchor_point(left, "left top"),
                self._anchor_point(neckline_swing, "neckline"),
                self._anchor_point(right, "right top"),
            ],
            draw_lines=[
                self._horizontal_line(frame, left.bar_index, len(frame) - 1, neckline, "Neckline", "support", "solid"),
            ],
            explanation=[
                "The chart has failed to sustain a second push through the prior high area.",
                "Now the neckline is the key level separating a topping pattern from a messy consolidation.",
            ],
        )

    def _double_bottom(
        self,
        frame: pd.DataFrame,
        _trend: dict[str, Any],
        _structure: dict[str, Any],
        _zones: list[Zone],
        swings: dict[str, list[SwingPoint]],
        _confirmation: dict[str, Any],
    ) -> PatternSignal | None:
        highs = [s for s in swings.get("major", []) if s.kind == "high"]
        lows = [s for s in swings.get("major", []) if s.kind == "low"]
        if len(lows) < 2 or not highs:
            return None
        left, right = lows[-2], lows[-1]
        tolerance = self.config.patterns.double_tolerance_pct / 100.0
        if abs(left.price - right.price) / max(left.price, right.price) > tolerance:
            return None
        middle_highs = [high for high in highs if left.bar_index < high.bar_index < right.bar_index]
        neckline_swing = max(middle_highs, key=lambda item: item.price, default=None)
        if neckline_swing is None:
            return None
        neckline = neckline_swing.price
        close = float(frame["close"].iloc[-1])
        if close < neckline:
            return None
        height = neckline - ((left.price + right.price) / 2.0)
        return self._signal(
            frame=frame,
            pattern_name="double bottom",
            direction="bullish",
            confidence=0.72,
            latest_anchor=right.bar_index,
            relevant_levels={"bottom": (left.price + right.price) / 2.0, "neckline": neckline},
            target_estimation={"target_1": neckline + height, "target_2": neckline + height * 1.5},
            breakout_level=neckline,
            invalidation_level=min(left.price, right.price),
            anchor_points=[
                self._anchor_point(left, "left bottom"),
                self._anchor_point(neckline_swing, "neckline"),
                self._anchor_point(right, "right bottom"),
            ],
            draw_lines=[
                self._horizontal_line(frame, left.bar_index, len(frame) - 1, neckline, "Neckline", "resistance", "solid"),
            ],
            explanation=[
                "The chart has tested the same low area twice and recovered the neckline in between.",
                "That leaves the neckline as the level buyers still need to defend.",
            ],
        )

    def _volatility_contraction_breakout(
        self,
        frame: pd.DataFrame,
        _trend: dict[str, Any],
        _structure: dict[str, Any],
        _zones: list[Zone],
        swings: dict[str, list[SwingPoint]],
        confirmation: dict[str, Any],
    ) -> PatternSignal | None:
        if len(frame) < self.config.patterns.vcp_window_bars:
            return None
        recent = frame.tail(self.config.patterns.vcp_window_bars)
        amplitudes = []
        medium_swings = swings.get("medium", [])
        for prev, curr in zip(medium_swings[-6:-1], medium_swings[-5:]):
            amplitudes.append(abs(curr.price - prev.price))
        if len(amplitudes) < 3 or not all(earlier >= later for earlier, later in zip(amplitudes[:-1], amplitudes[1:])):
            return None
        close = float(frame["close"].iloc[-1])
        range_high = float(recent["high"].max())
        if close < range_high * 0.995 or confirmation["relative_volume"] < 1.0:
            return None
        atr = float(frame["atr"].iloc[-1])
        start_idx = len(frame) - len(recent)
        end_idx = len(frame) - 1
        return self._signal(
            frame=frame,
            pattern_name="volatility contraction breakout",
            direction="bullish",
            confidence=clamp(0.50 + confirmation["relative_volume"] * 0.10 + confirmation["breakout_quality"] * 0.12, 0.0, 1.0),
            latest_anchor=end_idx,
            relevant_levels={"breakout_level": range_high},
            target_estimation={"target_1": close + atr * 4.0, "target_2": close + atr * 7.0},
            breakout_level=range_high,
            invalidation_level=float(recent["low"].min()),
            anchor_points=[
                {"timestamp": pd.Timestamp(frame.index[start_idx]).isoformat(), "bar_index": start_idx, "price": range_high, "label": "contraction start"},
            ],
            draw_lines=[
                self._horizontal_line(frame, start_idx, end_idx, range_high, "VCP trigger", "resistance", "solid"),
            ],
            explanation=[
                "The swing amplitude has been tightening before the latest push higher.",
                "That kind of contraction tends to matter most when the breakout also arrives with better participation.",
            ],
        )

    def _failed_breakout(
        self,
        frame: pd.DataFrame,
        _trend: dict[str, Any],
        _structure: dict[str, Any],
        zones: list[Zone],
        _swings: dict[str, list[SwingPoint]],
        confirmation: dict[str, Any],
    ) -> PatternSignal | None:
        last = frame.iloc[-1]
        atr = float(frame["atr"].iloc[-1])
        current_close = float(last["close"])

        resistances = [zone for zone in zones if zone.zone_type == "resistance"]
        if resistances:
            zone = min(resistances, key=lambda item: abs(item.center() - current_close))
            if float(last["high"]) >= zone.upper_bound and current_close <= zone.upper_bound and confirmation["upper_wick_ratio"] >= 0.45:
                end_idx = len(frame) - 1
                start_idx = max(end_idx - 12, 0)
                return self._signal(
                    frame=frame,
                    pattern_name="failed breakout",
                    direction="bearish",
                    confidence=clamp(0.46 + confirmation["upper_wick_ratio"] * 0.22, 0.0, 1.0),
                    latest_anchor=end_idx,
                    relevant_levels={"failure_zone": zone.center()},
                    target_estimation={"target_1": current_close - atr * 2.5, "target_2": current_close - atr * 4.5},
                    breakout_level=zone.upper_bound,
                    invalidation_level=zone.upper_bound + atr * 0.2,
                    anchor_points=[
                        {"timestamp": pd.Timestamp(frame.index[end_idx]).isoformat(), "bar_index": end_idx, "price": zone.center(), "label": "failed high"},
                    ],
                    draw_lines=[
                        self._horizontal_line(frame, start_idx, end_idx, zone.upper_bound, "Failed breakout level", "resistance", "solid"),
                    ],
                    explanation=[
                        "Price briefly traded above resistance but could not hold the break into the close.",
                        "That kind of rejection often turns into a trap if follow-through selling appears next.",
                    ],
                )

        supports = [zone for zone in zones if zone.zone_type == "support"]
        if supports:
            zone = min(supports, key=lambda item: abs(item.center() - current_close))
            if float(last["low"]) <= zone.lower_bound and current_close >= zone.lower_bound and confirmation["lower_wick_ratio"] >= 0.45:
                end_idx = len(frame) - 1
                start_idx = max(end_idx - 12, 0)
                return self._signal(
                    frame=frame,
                    pattern_name="failed breakout",
                    direction="bullish",
                    confidence=clamp(0.46 + confirmation["lower_wick_ratio"] * 0.22, 0.0, 1.0),
                    latest_anchor=end_idx,
                    relevant_levels={"failure_zone": zone.center()},
                    target_estimation={"target_1": current_close + atr * 2.5, "target_2": current_close + atr * 4.5},
                    breakout_level=zone.lower_bound,
                    invalidation_level=zone.lower_bound - atr * 0.2,
                    anchor_points=[
                        {"timestamp": pd.Timestamp(frame.index[end_idx]).isoformat(), "bar_index": end_idx, "price": zone.center(), "label": "failed low"},
                    ],
                    draw_lines=[
                        self._horizontal_line(frame, start_idx, end_idx, zone.lower_bound, "Failed breakdown level", "support", "solid"),
                    ],
                    explanation=[
                        "Price briefly traded below support but recovered back through the level by the close.",
                        "That kind of downside rejection often forces a squeeze if buyers follow through.",
                    ],
                )
        return None

    def _signal(
        self,
        *,
        frame: pd.DataFrame,
        pattern_name: str,
        direction: str,
        confidence: float,
        latest_anchor: int,
        relevant_levels: dict[str, float],
        target_estimation: dict[str, float] | None,
        breakout_level: float | None,
        invalidation_level: float | None,
        anchor_points: list[dict[str, Any]],
        draw_lines: list[dict[str, Any]],
        explanation: list[str],
    ) -> PatternSignal:
        freshness = self._freshness(frame, latest_anchor)
        relevance = confidence * (0.7 + freshness * 0.3)
        return PatternSignal(
            pattern_name=pattern_name,
            direction=direction,
            confidence=confidence,
            freshness=freshness,
            relevance=relevance,
            relevant_levels=relevant_levels,
            target_estimation=target_estimation,
            breakout_level=breakout_level,
            invalidation_level=invalidation_level,
            anchor_points=anchor_points,
            draw_lines=draw_lines,
            explanation=explanation,
        )

    def _recent_swings(self, swings: dict[str, list[SwingPoint]], scale: str, frame_len: int, lookback_bars: int) -> list[SwingPoint]:
        return [swing for swing in swings.get(scale, []) if swing.bar_index >= frame_len - lookback_bars]

    def _freshness(self, frame: pd.DataFrame, latest_anchor: int) -> float:
        bars_ago = max((len(frame) - 1) - latest_anchor, 0)
        return clamp(1.0 - bars_ago / max(self.config.patterns.freshness_bars, 1), 0.05, 1.0)

    @staticmethod
    def _anchor_point(swing: SwingPoint, label: str) -> dict[str, Any]:
        return {
            "timestamp": pd.Timestamp(swing.timestamp).isoformat(),
            "bar_index": swing.bar_index,
            "price": float(swing.price),
            "label": label,
        }

    @staticmethod
    def _slope(left: SwingPoint, right: SwingPoint) -> float:
        bars = max(right.bar_index - left.bar_index, 1)
        return (right.price - left.price) / bars

    @staticmethod
    def _project_line_value(start_index: int, start_price: float, end_index: int, end_price: float, target_index: int) -> float:
        bars = max(end_index - start_index, 1)
        slope = (end_price - start_price) / bars
        return start_price + slope * (target_index - start_index)

    def _line(
        self,
        frame: pd.DataFrame,
        start_index: int,
        end_index: int,
        start_price: float,
        end_price: float,
        label: str,
        role: str,
        style: str,
        extend_right: bool,
    ) -> dict[str, Any]:
        return {
            "label": label,
            "role": role,
            "style": style,
            "extend_right": extend_right,
            "start_index": start_index,
            "end_index": end_index,
            "start_timestamp": pd.Timestamp(frame.index[start_index]).isoformat(),
            "end_timestamp": pd.Timestamp(frame.index[end_index]).isoformat(),
            "start_price": float(start_price),
            "end_price": float(end_price),
        }

    def _horizontal_line(
        self,
        frame: pd.DataFrame,
        start_index: int,
        end_index: int,
        price: float,
        label: str,
        role: str,
        style: str,
    ) -> dict[str, Any]:
        return self._line(frame, start_index, end_index, price, price, label, role, style, False)
