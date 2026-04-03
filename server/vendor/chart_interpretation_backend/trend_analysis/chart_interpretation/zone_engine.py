"""Support/resistance zone engine."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from ..utils import clamp
from .config import ChartInterpretationConfig
from .models import SwingPoint, Zone


class ZoneEngine:
    """Build price zones and current location state."""

    def __init__(self, config: ChartInterpretationConfig) -> None:
        self.config = config

    def analyze(
        self,
        frame: pd.DataFrame,
        swings: dict[str, list[SwingPoint]],
        structure: dict[str, Any],
    ) -> dict[str, Any]:
        major = swings.get("major", [])
        medium = swings.get("medium", [])
        atr = float(frame["atr"].iloc[-1]) if "atr" in frame else float((frame["high"] - frame["low"]).tail(20).mean())
        zones = []
        zones.extend(self._zones_from_swings(major or medium, atr, "major"))
        zones.extend(self._zones_from_swings(medium, atr, "medium"))
        zones.extend(self._box_zones(frame, atr))
        zones.extend(self._volume_nodes(frame, atr))

        merged = self._merge_zones(zones, atr)
        current_price = float(frame["close"].iloc[-1])
        location_state = self._location_state(current_price, merged, atr, structure, frame)
        key_support, key_resistance = self._key_zones(merged, current_price)
        return {
            "zones": [zone.to_dict() for zone in merged],
            "location_state": location_state,
            "key_support_zone": key_support.to_dict() if key_support else None,
            "key_resistance_zone": key_resistance.to_dict() if key_resistance else None,
        }

    def _zones_from_swings(self, swings: list[SwingPoint], atr: float, source: str) -> list[Zone]:
        output: list[Zone] = []
        half = atr * self.config.zones.zone_half_atr
        for swing in swings[-12:]:
            label = "Support" if swing.kind == "low" else "Resistance"
            zone_type = "support" if swing.kind == "low" else "resistance"
            output.append(
                Zone(
                    lower_bound=swing.price - half,
                    upper_bound=swing.price + half,
                    zone_type=zone_type,
                    touch_count=max(1, int(round(swing.strength_atr))),
                    strength_score=clamp(0.35 + swing.strength_atr / 4.0, 0.0, 1.0),
                    source=source,
                    label=label,
                    anchor_index=swing.bar_index,
                )
            )
        return output

    def _box_zones(self, frame: pd.DataFrame, atr: float) -> list[Zone]:
        bars = min(self.config.zones.recent_box_bars, len(frame))
        recent = frame.tail(bars)
        box_low = float(recent["low"].min())
        box_high = float(recent["high"].max())
        half = atr * self.config.zones.zone_half_atr
        return [
            Zone(box_low - half * 0.5, box_low + half * 0.5, "support", 2, 0.45, "box_range", "Box Support", anchor_index=len(frame) - 1),
            Zone(box_high - half * 0.5, box_high + half * 0.5, "resistance", 2, 0.45, "box_range", "Box Resistance", anchor_index=len(frame) - 1),
        ]

    def _volume_nodes(self, frame: pd.DataFrame, atr: float) -> list[Zone]:
        recent = frame.tail(80)
        typical = ((recent["high"] + recent["low"] + recent["close"]) / 3.0).to_numpy(dtype=float)
        volumes = recent["volume"].to_numpy(dtype=float)
        if len(typical) < 10:
            return []
        hist, edges = np.histogram(typical, bins=self.config.zones.price_bin_count, weights=volumes)
        if hist.sum() <= 0:
            return []
        top_bins = np.argsort(hist)[-2:]
        zones: list[Zone] = []
        for index in top_bins:
            lower = float(edges[index])
            upper = float(edges[index + 1])
            midpoint = (lower + upper) / 2.0
            zones.append(
                Zone(
                    lower_bound=midpoint - atr * 0.25,
                    upper_bound=midpoint + atr * 0.25,
                    zone_type="volume_node",
                    touch_count=1,
                    strength_score=clamp(float(hist[index] / hist.max()), 0.0, 1.0),
                    source="volume_profile",
                    label="Volume Node",
                    anchor_index=len(frame) - 1,
                )
            )
        return zones

    def _merge_zones(self, zones: list[Zone], atr: float) -> list[Zone]:
        if not zones:
            return []
        zones = sorted(zones, key=lambda zone: (zone.zone_type, zone.center()))
        merged: list[Zone] = []
        merge_distance = atr * self.config.zones.merge_distance_atr
        for zone in zones:
            if not merged:
                merged.append(zone)
                continue
            prev = merged[-1]
            same_side = prev.zone_type == zone.zone_type or {prev.zone_type, zone.zone_type} <= {"support", "volume_node"} or {prev.zone_type, zone.zone_type} <= {"resistance", "volume_node"}
            if same_side and abs(prev.center() - zone.center()) <= merge_distance:
                merged[-1] = Zone(
                    lower_bound=min(prev.lower_bound, zone.lower_bound),
                    upper_bound=max(prev.upper_bound, zone.upper_bound),
                    zone_type=prev.zone_type if prev.zone_type != "volume_node" else zone.zone_type,
                    touch_count=prev.touch_count + zone.touch_count,
                    strength_score=clamp((prev.strength_score + zone.strength_score) / 2.0 + 0.05, 0.0, 1.0),
                    source=f"{prev.source}+{zone.source}",
                    label=prev.label,
                    anchor_index=max(filter(lambda item: item is not None, [prev.anchor_index, zone.anchor_index]), default=None),
                )
            else:
                merged.append(zone)
        return sorted(merged, key=lambda zone: (-zone.strength_score, zone.center()))

    def _key_zones(self, zones: list[Zone], current_price: float) -> tuple[Zone | None, Zone | None]:
        supports = [zone for zone in zones if zone.zone_type in {"support", "volume_node"} and zone.center() <= current_price]
        resistances = [zone for zone in zones if zone.zone_type in {"resistance", "volume_node"} and zone.center() >= current_price]

        def _score(zone: Zone) -> tuple[float, int, float]:
            distance = abs(zone.center() - current_price)
            recency = zone.anchor_index or 0
            return (distance, -recency, -zone.touch_count - zone.strength_score)

        key_support = min(supports, key=_score, default=None)
        key_resistance = min(resistances, key=_score, default=None)
        return key_support, key_resistance

    def _location_state(self, current_price: float, zones: list[Zone], atr: float, structure: dict[str, Any], frame: pd.DataFrame) -> str:
        supports = [zone for zone in zones if zone.zone_type in {"support", "volume_node"} and zone.center() <= current_price]
        resistances = [zone for zone in zones if zone.zone_type in {"resistance", "volume_node"} and zone.center() >= current_price]
        nearest_support = min(supports, key=lambda zone: abs(zone.center() - current_price), default=None)
        nearest_resistance = min(resistances, key=lambda zone: abs(zone.center() - current_price), default=None)
        threshold = atr * self.config.zones.location_threshold_atr

        if abs(frame["close"].iloc[-1] - frame["ema20"].iloc[-1]) > atr * self.config.zones.overextended_atr:
            return "overextended zone"
        if nearest_support is not None and abs(nearest_support.center() - current_price) <= threshold:
            if structure.get("break_of_structure") == "bullish":
                return "retest zone"
            return "near support"
        if nearest_resistance is not None and abs(nearest_resistance.center() - current_price) <= threshold:
            if structure.get("break_of_structure") == "bearish":
                return "retest zone"
            return "near resistance"
        if structure.get("break_of_structure"):
            return "breakout zone"
        return "mid-range"
