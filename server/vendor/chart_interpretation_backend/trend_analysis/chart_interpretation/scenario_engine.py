"""Scenario ranking engine."""

from __future__ import annotations

from typing import Any

from ..utils import clamp
from .config import ChartInterpretationConfig
from .models import PatternSignal, ScenarioCandidate


class ScenarioEngine:
    """Rank interpretable trading scenarios from structure-first evidence."""

    def __init__(self, config: ChartInterpretationConfig) -> None:
        self.config = config

    def analyze(
        self,
        *,
        current_price: float,
        trend_result: dict[str, Any],
        higher_timeframe_trend: dict[str, Any] | None,
        structure: dict[str, Any],
        location_state: str,
        zones: list[dict[str, Any]],
        patterns: list[PatternSignal],
        confirmation: dict[str, Any],
        recent_events: list[dict[str, Any]] | list[Any],
    ) -> dict[str, Any]:
        scenarios = [
            self._bullish_continuation(current_price, trend_result, higher_timeframe_trend, structure, location_state, zones, patterns, confirmation),
            self._breakout_in_progress(current_price, trend_result, higher_timeframe_trend, structure, location_state, zones, patterns, confirmation),
            self._breakout_likely_to_fail(current_price, trend_result, higher_timeframe_trend, structure, location_state, zones, patterns, confirmation),
            self._bearish_continuation(current_price, trend_result, higher_timeframe_trend, structure, location_state, zones, patterns, confirmation),
            self._reversal_candidate(current_price, trend_result, higher_timeframe_trend, structure, location_state, zones, patterns, confirmation),
            self._range_mean_reversion(current_price, trend_result, higher_timeframe_trend, structure, location_state, zones, patterns, confirmation),
        ]
        ranked = sorted(scenarios, key=lambda item: (-item.score, item.name))
        primary = ranked[0]
        strongest_alternative = ranked[1] if len(ranked) > 1 else None
        bullish_alt = next((item for item in ranked if item.direction == "bullish" and item.name != primary.name), None)
        bearish_alt = next((item for item in ranked if item.direction == "bearish" and item.name != primary.name), None)
        confidence = clamp(primary.confidence * 0.65 + max(0.0, primary.score - ranked[1].score) * 0.35, 0.0, 1.0) if len(ranked) > 1 else primary.confidence
        return {
            "primary": primary,
            "strongest_alternative": strongest_alternative,
            "bullish_alternative": bullish_alt,
            "bearish_alternative": bearish_alt,
            "confidence": confidence,
            "ranked": ranked,
        }

    def _bullish_continuation(self, current_price: float, trend: dict[str, Any], higher_tf: dict[str, Any] | None, structure: dict[str, Any], location_state: str, zones: list[dict[str, Any]], patterns: list[PatternSignal], confirmation: dict[str, Any]) -> ScenarioCandidate:
        support = self._nearest_zone(zones, current_price, {"support", "volume_node"}, below=True)
        ema_context = trend.get("ema_context", {})
        ichimoku = trend.get("ichimoku_context", {})
        bullish_pattern = self._best_pattern(
            patterns,
            {
                "trend pullback continuation",
                "breakout retest",
                "volatility contraction breakout",
                "double bottom",
                "range breakout",
                "bull flag",
                "ascending triangle",
                "falling wedge",
                "symmetrical triangle",
            },
        )
        score = 0.0
        score += 0.32 if structure["label"] == "bullish structure intact" else 0.14 if structure["label"] in {"compression", "structure weakening"} else 0.0
        score += 0.18 if location_state in {"near support", "retest zone"} else 0.06
        score += bullish_pattern.confidence * 0.24 if bullish_pattern else 0.0
        score += max(0.0, trend["score"]) * 0.16
        score += max(0.0, confirmation["rsi_bias"]) * 0.06
        score += 0.08 if ema_context.get("pullback_to_ema20") else 0.0
        score += 0.05 if ema_context.get("above_ema200") else 0.0
        score -= 0.06 if ema_context.get("lost_ema50") else 0.0
        score += 0.04 if ichimoku.get("regime") == "above cloud" else -0.02 if ichimoku.get("regime") == "inside cloud" else 0.0
        if location_state in {"near support", "retest zone"}:
            score += confirmation.get("bullish_candle_score", 0.0) * 0.08
        if higher_tf and higher_tf["label"] == "uptrend":
            score += 0.08
        invalidation = support["lower_bound"] if support else current_price * 0.96
        return ScenarioCandidate(
            name="bullish continuation after pullback",
            direction="bullish",
            score=clamp(score, 0.0, 1.0),
            confidence=clamp(score + 0.05, 0.0, 1.0),
            invalidation_level=invalidation,
            confirmation_needed=["Hold above the nearest support zone", "See stable or improving relative volume"],
            risk_flags=["Overhead resistance remains close"] if location_state == "near resistance" else [],
            explanation=[
                "Price structure still leans constructive.",
                "Price is near a support or retest area rather than extended from it.",
            ],
            target_zone_1=self._target_zone(current_price, current_price * 1.03),
            target_zone_2=self._target_zone(current_price * 1.05, current_price * 1.08),
        )

    def _breakout_in_progress(self, current_price: float, trend: dict[str, Any], higher_tf: dict[str, Any] | None, structure: dict[str, Any], location_state: str, zones: list[dict[str, Any]], patterns: list[PatternSignal], confirmation: dict[str, Any]) -> ScenarioCandidate:
        resistance = self._nearest_zone(zones, current_price, {"resistance"}, below=False)
        ema_context = trend.get("ema_context", {})
        ichimoku = trend.get("ichimoku_context", {})
        breakout_pattern = self._best_pattern(
            patterns,
            {
                "range breakout",
                "volatility contraction breakout",
                "ascending triangle",
                "symmetrical triangle",
                "bull flag",
            },
        )
        score = 0.0
        score += 0.28 if structure.get("break_of_structure") == "bullish" else 0.0
        score += 0.18 if location_state == "breakout zone" else 0.08 if location_state == "near resistance" else 0.0
        score += breakout_pattern.confidence * 0.28 if breakout_pattern else 0.0
        score += confirmation["breakout_quality"] * 0.16
        score += min(confirmation["relative_volume"], 2.0) * 0.06
        score += 0.05 if ema_context.get("ema_stack_bullish") else 0.0
        score += 0.04 if confirmation.get("bullish_candle_score", 0.0) and location_state in {"breakout zone", "near resistance"} else 0.0
        score += 0.04 if ichimoku.get("regime") == "above cloud" else -0.03 if ichimoku.get("regime") == "inside cloud" else 0.0
        if higher_tf and higher_tf["label"] == "uptrend":
            score += 0.06
        invalidation = resistance["lower_bound"] if resistance else current_price * 0.97
        return ScenarioCandidate(
            name="breakout in progress",
            direction="bullish",
            score=clamp(score, 0.0, 1.0),
            confidence=clamp(score, 0.0, 1.0),
            invalidation_level=invalidation,
            confirmation_needed=["A close that stays above the breakout zone", "Follow-through volume on the next bars"],
            risk_flags=["Fresh breakout can still retest"] if resistance is not None else [],
            explanation=["Price is attempting to leave the prior range or compression zone.", "Indicator confirmation is supportive but secondary to the price break."],
            target_zone_1=self._target_zone(current_price * 1.02, current_price * 1.04),
            target_zone_2=self._target_zone(current_price * 1.05, current_price * 1.09),
        )

    def _breakout_likely_to_fail(self, current_price: float, trend: dict[str, Any], higher_tf: dict[str, Any] | None, structure: dict[str, Any], location_state: str, zones: list[dict[str, Any]], patterns: list[PatternSignal], confirmation: dict[str, Any]) -> ScenarioCandidate:
        support = self._nearest_zone(zones, current_price, {"support", "volume_node"}, below=True)
        ema_context = trend.get("ema_context", {})
        ichimoku = trend.get("ichimoku_context", {})
        failure_pattern = self._best_pattern(patterns, {"failed breakout"})
        score = 0.12
        score += failure_pattern.confidence * 0.34 if failure_pattern else 0.0
        score += 0.12 if location_state == "near resistance" else 0.0
        score += 0.08 if confirmation["upper_wick_ratio"] >= 0.45 else 0.0
        score += 0.08 if trend["label"] == "transition" else 0.0
        score += confirmation.get("bearish_candle_score", 0.0) * 0.10
        score += 0.05 if ema_context.get("lost_ema50") else 0.0
        score += 0.04 if ichimoku.get("regime") in {"inside cloud", "below cloud"} else 0.0
        if higher_tf and higher_tf["label"] == "downtrend":
            score += 0.06
        invalidation = current_price * 1.03
        return ScenarioCandidate(
            name="breakout likely to fail",
            direction="bearish",
            score=clamp(score, 0.0, 1.0),
            confidence=clamp(score, 0.0, 1.0),
            invalidation_level=invalidation,
            confirmation_needed=["A close back inside the prior range", "Follow-through selling below the failed breakout bar"],
            risk_flags=["Failure setup is weaker if higher timeframe trend stays bullish"] if higher_tf and higher_tf["label"] == "uptrend" else [],
            explanation=["Upper-wick rejection and weak acceptance above resistance make the breakout vulnerable.", "This is a scenario path, not a guaranteed reversal."],
            target_zone_1=self._target_zone((support["lower_bound"] if support else current_price * 0.98), (support["upper_bound"] if support else current_price * 0.99)),
            target_zone_2=self._target_zone(current_price * 0.94, current_price * 0.97),
        )

    def _bearish_continuation(self, current_price: float, trend: dict[str, Any], higher_tf: dict[str, Any] | None, structure: dict[str, Any], location_state: str, zones: list[dict[str, Any]], patterns: list[PatternSignal], confirmation: dict[str, Any]) -> ScenarioCandidate:
        resistance = self._nearest_zone(zones, current_price, {"resistance", "volume_node"}, below=False)
        ema_context = trend.get("ema_context", {})
        ichimoku = trend.get("ichimoku_context", {})
        bearish_pattern = self._best_pattern(
            patterns,
            {
                "double top",
                "failed breakout",
                "bear flag",
                "descending triangle",
                "rising wedge",
                "symmetrical triangle",
            },
        )
        score = 0.0
        score += 0.32 if structure["label"] == "bearish structure intact" else 0.12 if structure["label"] == "structure weakening" else 0.0
        score += 0.18 if location_state in {"near resistance", "retest zone"} else 0.06
        score += bearish_pattern.confidence * 0.24 if bearish_pattern else 0.0
        score += max(0.0, -trend["score"]) * 0.16
        score += max(0.0, -confirmation["rsi_bias"]) * 0.06
        score += 0.08 if ema_context.get("ema_stack_bearish") else 0.0
        score += 0.05 if ema_context.get("below_ema200") else 0.0
        score += confirmation.get("bearish_candle_score", 0.0) * 0.08 if location_state in {"near resistance", "retest zone"} else 0.0
        score += 0.04 if ichimoku.get("regime") == "below cloud" else -0.02 if ichimoku.get("regime") == "inside cloud" else 0.0
        if higher_tf and higher_tf["label"] == "downtrend":
            score += 0.08
        invalidation = resistance["upper_bound"] if resistance else current_price * 1.04
        return ScenarioCandidate(
            name="bearish continuation",
            direction="bearish",
            score=clamp(score, 0.0, 1.0),
            confidence=clamp(score + 0.05, 0.0, 1.0),
            invalidation_level=invalidation,
            confirmation_needed=["Stay below the nearest resistance zone", "Keep seeing weak rebound quality"],
            risk_flags=["Support beneath price can slow the move"],
            explanation=["Structure remains vulnerable and price is not reclaiming resistance decisively.", "Continuation is favored only if lower highs keep forming."],
            target_zone_1=self._target_zone(current_price * 0.97, current_price * 0.99),
            target_zone_2=self._target_zone(current_price * 0.92, current_price * 0.95),
        )

    def _reversal_candidate(self, current_price: float, trend: dict[str, Any], higher_tf: dict[str, Any] | None, structure: dict[str, Any], _location_state: str, zones: list[dict[str, Any]], patterns: list[PatternSignal], confirmation: dict[str, Any]) -> ScenarioCandidate:
        ema_context = trend.get("ema_context", {})
        reversal_pattern = self._best_pattern(patterns, {"double bottom", "double top", "rising wedge", "falling wedge"})
        bullish_div = confirmation["bullish_divergence"]
        bearish_div = confirmation["bearish_divergence"]
        bullish = bool(reversal_pattern and reversal_pattern.direction == "bullish") or bullish_div
        score = 0.15
        score += reversal_pattern.confidence * 0.30 if reversal_pattern else 0.0
        score += 0.10 if structure.get("change_of_character") else 0.0
        score += 0.08 if bullish_div or bearish_div else 0.0
        score += max(confirmation.get("bullish_candle_score", 0.0), confirmation.get("bearish_candle_score", 0.0)) * 0.10
        score += 0.05 if ema_context.get("reclaimed_ema20") or ema_context.get("lost_ema50") else 0.0
        if higher_tf and higher_tf["label"] in {"uptrend", "downtrend"}:
            score -= 0.05
        direction = "bullish" if bullish else "bearish"
        invalidation = current_price * (0.97 if bullish else 1.03)
        return ScenarioCandidate(
            name="reversal candidate",
            direction=direction,
            score=clamp(score, 0.0, 1.0),
            confidence=clamp(score, 0.0, 1.0),
            invalidation_level=invalidation,
            confirmation_needed=["A confirmed break of the nearest structure pivot", "Better follow-through volume"],
            risk_flags=["Counter-trend reversal setups need stronger confirmation"],
            explanation=["A possible reversal signature is forming, but it is not yet dominant.", "Counter-trend setups should be treated as scenario candidates, not forecasts."],
            target_zone_1=self._target_zone(current_price * (1.02 if bullish else 0.98), current_price * (1.04 if bullish else 0.96)),
            target_zone_2=self._target_zone(current_price * (1.06 if bullish else 0.94), current_price * (1.09 if bullish else 0.91)),
        )

    def _range_mean_reversion(self, current_price: float, trend: dict[str, Any], _higher_tf: dict[str, Any] | None, structure: dict[str, Any], location_state: str, zones: list[dict[str, Any]], _patterns: list[PatternSignal], confirmation: dict[str, Any]) -> ScenarioCandidate:
        support = self._nearest_zone(zones, current_price, {"support", "volume_node"}, below=True)
        resistance = self._nearest_zone(zones, current_price, {"resistance"}, below=False)
        ichimoku = trend.get("ichimoku_context", {})
        direction = "bullish" if location_state == "near support" else "bearish" if location_state == "near resistance" else "neutral"
        score = 0.08
        score += 0.26 if structure["label"] == "range structure" else 0.0
        score += 0.16 if location_state in {"near support", "near resistance"} else 0.0
        score += 0.05 if abs(trend["score"]) < 0.2 else 0.0
        score += 0.04 if ichimoku.get("regime") == "inside cloud" else 0.0
        score += max(confirmation.get("bullish_candle_score", 0.0), confirmation.get("bearish_candle_score", 0.0)) * 0.04
        return ScenarioCandidate(
            name="range mean reversion",
            direction=direction,
            score=clamp(score, 0.0, 1.0),
            confidence=clamp(score, 0.0, 1.0),
            invalidation_level=(support["lower_bound"] if direction == "bullish" and support else resistance["upper_bound"] if resistance else None),
            confirmation_needed=["Price needs to stay inside the range", "No decisive breakout should appear"],
            risk_flags=["Mean reversion loses validity quickly once range boundaries break"],
            explanation=["The market is behaving more like a range than a directional trend.", "Location inside the box matters more than indicator momentum here."],
            target_zone_1=self._target_zone(self._zone_center(support) if support else current_price * 0.99, self._zone_center(resistance) if resistance else current_price * 1.01),
            target_zone_2=None,
        )

    @staticmethod
    def _nearest_zone(zones: list[dict[str, Any]], current_price: float, accepted_types: set[str], below: bool) -> dict[str, Any] | None:
        candidates = [zone for zone in zones if zone["zone_type"] in accepted_types and (zone["upper_bound"] <= current_price if below else zone["lower_bound"] >= current_price)]
        if not candidates:
            return None
        return min(candidates, key=lambda zone: abs(((zone["lower_bound"] + zone["upper_bound"]) / 2.0) - current_price))

    @staticmethod
    def _best_pattern(patterns: list[PatternSignal], accepted_names: set[str]) -> PatternSignal | None:
        filtered = [pattern for pattern in patterns if pattern.pattern_name in accepted_names]
        return sorted(filtered, key=lambda item: (-item.confidence, item.pattern_name))[0] if filtered else None

    @staticmethod
    def _target_zone(low: float, high: float) -> dict[str, float]:
        lower = min(low, high)
        upper = max(low, high)
        return {"low": lower, "high": upper, "mid": (lower + upper) / 2.0}

    @staticmethod
    def _zone_center(zone: dict[str, Any] | None) -> float:
        if zone is None:
            return 0.0
        return (float(zone["lower_bound"]) + float(zone["upper_bound"])) / 2.0
