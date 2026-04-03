"""Market-structure engine."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .config import ChartInterpretationConfig
from .models import SwingPoint


class MarketStructureEngine:
    """Interpret recent swing relationships and structure state."""

    def __init__(self, config: ChartInterpretationConfig) -> None:
        self.config = config

    def analyze(
        self,
        frame: pd.DataFrame,
        trend_result: dict[str, Any],
        swings: dict[str, list[SwingPoint]],
    ) -> dict[str, Any]:
        medium_swings = swings.get("medium") or swings.get("major") or []
        major_swings = swings.get("major") or medium_swings
        high_relations = self._same_kind_relations(medium_swings, "high")
        low_relations = self._same_kind_relations(medium_swings, "low")
        structure_sequence = high_relations[-2:] + low_relations[-2:]

        latest_close = float(frame["close"].iloc[-1])
        latest_atr = float(frame["atr"].iloc[-1]) if "atr" in frame else float((frame["high"] - frame["low"]).tail(20).mean())
        last_major_high = next((s for s in reversed(major_swings) if s.kind == "high"), None)
        last_major_low = next((s for s in reversed(major_swings) if s.kind == "low"), None)

        bullish_intact = bool(high_relations and low_relations and high_relations[-1] == "HH" and low_relations[-1] == "HL")
        bearish_intact = bool(high_relations and low_relations and high_relations[-1] == "LH" and low_relations[-1] == "LL")
        compression = self._is_compression(medium_swings)
        range_state = self._is_range(medium_swings)
        weakening = not bullish_intact and not bearish_intact and trend_result["label"] in {"uptrend", "downtrend"}

        bos_up = bool(last_major_high and latest_close > last_major_high.price + latest_atr * self.config.structure.bos_atr_buffer)
        bos_down = bool(last_major_low and latest_close < last_major_low.price - latest_atr * self.config.structure.bos_atr_buffer)
        choch = (trend_result["label"] == "downtrend" and bos_up) or (trend_result["label"] == "uptrend" and bos_down)

        if choch:
            label = "change of character"
        elif bos_up or bos_down:
            label = "break of structure"
        elif bullish_intact:
            label = "bullish structure intact"
        elif bearish_intact:
            label = "bearish structure intact"
        elif compression:
            label = "compression"
        elif range_state:
            label = "range structure"
        elif weakening:
            label = "structure weakening"
        else:
            label = "transition"

        return {
            "label": label,
            "bullish_structure_intact": bullish_intact,
            "bearish_structure_intact": bearish_intact,
            "range_structure": range_state,
            "compression": compression,
            "structure_weakening": weakening,
            "break_of_structure": "bullish" if bos_up else "bearish" if bos_down else None,
            "change_of_character": bool(choch),
            "swing_sequence": structure_sequence,
            "features": {
                "high_relations": high_relations[-4:],
                "low_relations": low_relations[-4:],
                "last_major_high": last_major_high.to_dict() if last_major_high else None,
                "last_major_low": last_major_low.to_dict() if last_major_low else None,
            },
        }

    @staticmethod
    def _same_kind_relations(swings: list[SwingPoint], kind: str) -> list[str]:
        filtered = [s for s in swings if s.kind == kind]
        relations: list[str] = []
        for prev, curr in zip(filtered[:-1], filtered[1:]):
            if kind == "high":
                relations.append("HH" if curr.price > prev.price else "LH")
            else:
                relations.append("HL" if curr.price > prev.price else "LL")
        return relations

    def _is_compression(self, swings: list[SwingPoint]) -> bool:
        if len(swings) < 6:
            return False
        amplitudes = [abs(curr.price - prev.price) for prev, curr in zip(swings[-6:-1], swings[-5:])]
        if len(amplitudes) < 3:
            return False
        first_half = float(np.mean(amplitudes[:2]))
        second_half = float(np.mean(amplitudes[-2:]))
        return second_half < first_half * self.config.structure.compression_amplitude_ratio

    def _is_range(self, swings: list[SwingPoint]) -> bool:
        highs = [s.price for s in swings[-6:] if s.kind == "high"]
        lows = [s.price for s in swings[-6:] if s.kind == "low"]
        if len(highs) < 2 or len(lows) < 2:
            return False
        high_spread = (max(highs) - min(highs)) / max(highs)
        low_spread = (max(lows) - min(lows)) / max(lows)
        return high_spread * 100.0 <= self.config.structure.range_tolerance_pct and low_spread * 100.0 <= self.config.structure.range_tolerance_pct
