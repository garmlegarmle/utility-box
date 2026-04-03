"""Recent event timeline engine."""

from __future__ import annotations

from typing import Any

import pandas as pd

from ..utils import clamp
from .config import ChartInterpretationConfig
from .models import MarketEvent, PatternSignal, SwingPoint


class EventEngine:
    """Build recent chart events from structure, patterns, and price action."""

    def __init__(self, config: ChartInterpretationConfig) -> None:
        self.config = config

    def analyze(
        self,
        frame: pd.DataFrame,
        structure: dict[str, Any],
        zones: list[dict[str, Any]],
        swings: dict[str, list[SwingPoint]],
        patterns: list[PatternSignal],
        confirmation: dict[str, Any],
    ) -> list[MarketEvent]:
        latest_time = pd.Timestamp(frame.index[-1]).to_pydatetime()
        events: list[MarketEvent] = []
        major_swings = swings.get("major", [])
        last_high = next((s for s in reversed(major_swings) if s.kind == "high"), None)
        last_low = next((s for s in reversed(major_swings) if s.kind == "low"), None)
        close = float(frame["close"].iloc[-1])

        if last_high and close > last_high.price:
            events.append(MarketEvent(latest_time, "breakout above prior swing high", 0.80, 1.0, "Current close is above the latest major swing high."))
        if last_low and close < last_low.price:
            events.append(MarketEvent(latest_time, "breakout below prior swing low", 0.80, 1.0, "Current close is below the latest major swing low."))
        if structure.get("break_of_structure"):
            events.append(MarketEvent(latest_time, "structure break", 0.85, 1.0, f"{structure['break_of_structure']} break of structure is active."))
        if structure.get("compression"):
            events.append(MarketEvent(latest_time, "volatility compression", 0.60, 0.95, "Recent swing amplitude has contracted."))
        if confirmation["relative_volume"] >= 1.3 and confirmation["breakout_quality"] >= 0.65:
            events.append(MarketEvent(latest_time, "volume-confirmed breakout", 0.75, 1.0, "Breakout bar quality and relative volume are both strong."))
        if confirmation["upper_wick_ratio"] >= 0.45:
            events.append(MarketEvent(latest_time, "rejection from resistance zone", 0.58, 0.90, "Upper wick indicates overhead rejection."))
        for signal in confirmation.get("candlestick_signals", [])[:2]:
            events.append(MarketEvent(latest_time, signal["pattern_name"], signal["confidence"], 1.0, signal["explanation"]))

        for pattern in patterns[:3]:
            events.append(
                MarketEvent(
                    latest_time,
                    pattern.pattern_name,
                    pattern.confidence,
                    pattern.freshness,
                    " ".join(pattern.explanation[:2]),
                )
            )

        events = sorted(events, key=lambda item: (-item.freshness, -item.strength, item.event_type))
        return events[: self.config.events.max_events]
