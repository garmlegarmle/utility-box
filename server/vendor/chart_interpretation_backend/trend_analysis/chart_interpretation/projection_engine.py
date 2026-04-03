"""Projection engine for scenario paths."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .config import ChartInterpretationConfig
from .models import PatternSignal, ProjectionBundle, ProjectionPath, ScenarioCandidate


class ProjectionEngine:
    """Generate structural scenario paths and widening projection bands."""

    def __init__(self, config: ChartInterpretationConfig) -> None:
        self.config = config

    def analyze(
        self,
        frame: pd.DataFrame,
        primary: ScenarioCandidate,
        bullish_alt: ScenarioCandidate | None,
        bearish_alt: ScenarioCandidate | None,
        *,
        zones: dict[str, Any] | None = None,
        patterns: list[PatternSignal] | None = None,
    ) -> ProjectionBundle:
        horizon = self.config.scenarios.projection_horizon_bars
        last_price = float(frame["close"].iloc[-1])
        atr = float(frame["atr"].iloc[-1]) if "atr" in frame else float((frame["high"] - frame["low"]).tail(20).mean())
        dates = pd.bdate_range(pd.Timestamp(frame.index[-1]) + pd.offsets.BDay(), periods=horizon)
        analog_base = self._analog_base_path(frame, horizon)

        zone_context = zones or {}
        all_zones = zone_context.get("zones", [])
        support = zone_context.get("key_support_zone") or self._nearest_zone(all_zones, last_price, below=True)
        resistance = zone_context.get("key_resistance_zone") or self._nearest_zone(all_zones, last_price, below=False)
        lead_pattern = patterns[0].pattern_name if patterns else None

        bullish_source = primary if primary.direction == "bullish" else bullish_alt
        bearish_source = primary if primary.direction == "bearish" else bearish_alt
        bullish_target_1 = (bullish_source.target_zone_1 if bullish_source else None) or {"mid": last_price * 1.03}
        bullish_target_2 = (bullish_source.target_zone_2 if bullish_source else None) or {"mid": last_price * 1.07}
        bearish_target_1 = (bearish_source.target_zone_1 if bearish_source else None) or {"mid": last_price * 0.97}
        bearish_target_2 = (bearish_source.target_zone_2 if bearish_source else None) or {"mid": last_price * 0.93}

        bullish_path = self._scenario_path(
            dates,
            last_price,
            float(bullish_target_1["mid"]),
            float(bullish_target_2["mid"]),
            direction="bullish",
            atr=atr,
            support=support,
            resistance=resistance,
            scenario_name=bullish_source.name if bullish_source else "bullish continuation after pullback",
            pattern_name=lead_pattern,
        )
        bearish_path = self._scenario_path(
            dates,
            last_price,
            float(bearish_target_1["mid"]),
            float(bearish_target_2["mid"]),
            direction="bearish",
            atr=atr,
            support=support,
            resistance=resistance,
            scenario_name=bearish_source.name if bearish_source else "bearish continuation",
            pattern_name=lead_pattern,
        )
        base_path = self._blend_base_path(dates, last_price, analog_base, primary, bullish_path, bearish_path)

        upper_band_points: list[dict[str, Any]] = []
        lower_band_points: list[dict[str, Any]] = []
        for step, point in enumerate(base_path.points, start=1):
            band = atr * (0.85 + 0.16 * step)
            upper_band_points.append({"timestamp": point["timestamp"], "price": point["price"] + band})
            lower_band_points.append({"timestamp": point["timestamp"], "price": point["price"] - band})

        return ProjectionBundle(
            base_path=base_path,
            bullish_path=bullish_path,
            bearish_path=bearish_path,
            upper_band=ProjectionPath(upper_band_points),
            lower_band=ProjectionPath(lower_band_points),
            target_zone_1=primary.target_zone_1,
            target_zone_2=primary.target_zone_2,
        )

    def _analog_base_path(self, frame: pd.DataFrame, horizon: int) -> list[float] | None:
        cfg = self.config.scenarios
        if len(frame) < cfg.min_analog_history_bars:
            return None
        lookback = cfg.analog_lookback_bars
        close = frame["close"].astype(float).to_numpy()
        current = close[-lookback:]
        current_norm = current / current[0]
        matches: list[tuple[float, np.ndarray]] = []
        for start in range(0, len(close) - lookback - horizon - 10):
            candidate = close[start : start + lookback]
            future = close[start + lookback : start + lookback + horizon]
            candidate_norm = candidate / candidate[0]
            corr = np.corrcoef(current_norm, candidate_norm)[0, 1]
            if np.isnan(corr):
                continue
            future_returns = (future / candidate[-1]) - 1.0
            matches.append((float(corr), future_returns))
        if not matches:
            return None
        top = sorted(matches, key=lambda item: item[0], reverse=True)[: cfg.analog_candidates]
        return list(np.mean([future for _, future in top], axis=0))

    def _scenario_path(
        self,
        dates: pd.DatetimeIndex,
        last_price: float,
        target_1: float,
        target_2: float,
        *,
        direction: str,
        atr: float,
        support: dict[str, Any] | None,
        resistance: dict[str, Any] | None,
        scenario_name: str,
        pattern_name: str | None,
    ) -> ProjectionPath:
        if not len(dates):
            return ProjectionPath([])

        total = len(dates)
        q1 = max(1, total // 5)
        q2 = max(2, total // 2)
        q3 = max(3, (total * 3) // 4)
        end = total - 1

        support_mid = self._zone_mid(support)
        resistance_mid = self._zone_mid(resistance)

        if direction == "bullish":
            checkpoints = self._bullish_checkpoints(
                last_price=last_price,
                target_1=target_1,
                target_2=target_2,
                support_mid=support_mid,
                resistance_mid=resistance_mid,
                atr=atr,
                q1=q1,
                q2=q2,
                q3=q3,
                end=end,
                scenario_name=scenario_name,
                pattern_name=pattern_name,
            )
        else:
            checkpoints = self._bearish_checkpoints(
                last_price=last_price,
                target_1=target_1,
                target_2=target_2,
                support_mid=support_mid,
                resistance_mid=resistance_mid,
                atr=atr,
                q1=q1,
                q2=q2,
                q3=q3,
                end=end,
                scenario_name=scenario_name,
                pattern_name=pattern_name,
            )
        return ProjectionPath(self._interpolate_checkpoints(dates, checkpoints))

    def _blend_base_path(
        self,
        dates: pd.DatetimeIndex,
        last_price: float,
        analog_base: list[float] | None,
        primary: ScenarioCandidate,
        bullish_path: ProjectionPath,
        bearish_path: ProjectionPath,
    ) -> ProjectionPath:
        if not len(dates):
            return ProjectionPath([])

        reference = bullish_path if primary.direction == "bullish" else bearish_path if primary.direction == "bearish" else None
        if reference is None:
            reference_points = [
                (float(bullish_path.points[idx]["price"]) + float(bearish_path.points[idx]["price"])) / 2.0
                for idx in range(len(dates))
            ]
            direction = "neutral"
        else:
            reference_points = [float(item["price"]) for item in reference.points]
            direction = primary.direction

        blended: list[tuple[int, float]] = []
        for idx, ref_price in enumerate(reference_points):
            if analog_base is not None and idx < len(analog_base):
                analog_price = last_price * (1.0 + float(analog_base[idx]))
                price = ref_price * 0.74 + analog_price * 0.26
            else:
                price = ref_price
            blended.append((idx, float(price)))
        checkpointed = self._base_checkpoints(last_price, blended, direction)
        return ProjectionPath(self._interpolate_checkpoints(dates, checkpointed))

    def _bullish_checkpoints(
        self,
        *,
        last_price: float,
        target_1: float,
        target_2: float,
        support_mid: float | None,
        resistance_mid: float | None,
        atr: float,
        q1: int,
        q2: int,
        q3: int,
        end: int,
        scenario_name: str,
        pattern_name: str | None,
    ) -> list[tuple[int, float]]:
        first_leg = max(target_1 - last_price, atr * 1.2)
        if "breakout" in scenario_name:
            push = last_price + first_leg * 0.34
            retest_level = resistance_mid if resistance_mid is not None and resistance_mid <= push else last_price + first_leg * 0.14
            retest = max(retest_level, last_price - atr * 0.25)
            continuation = max(push, target_1 - atr * 0.18)
            final = max(target_2, continuation + atr * 0.9)
            return [(0, last_price), (q1, push), (q2, retest), (q3, continuation), (end, final)]

        dip_floor = support_mid if support_mid is not None else last_price - max(atr * 0.8, first_leg * 0.22)
        dip = min(last_price - atr * 0.25, max(dip_floor, last_price - first_leg * 0.28))
        bounce = last_price + first_leg * 0.58
        retest = max(last_price + atr * 0.18, bounce - max(atr * 0.55, first_leg * 0.18))
        if pattern_name in {"bull flag", "ascending triangle", "falling wedge"}:
            retest = max(retest, target_1 - atr * 0.22)
        final = max(target_2, target_1 + max(atr * 0.8, abs(target_2 - target_1) * 0.92))
        return [(0, last_price), (q1, dip), (q2, bounce), (q3, retest), (end, final)]

    def _bearish_checkpoints(
        self,
        *,
        last_price: float,
        target_1: float,
        target_2: float,
        support_mid: float | None,
        resistance_mid: float | None,
        atr: float,
        q1: int,
        q2: int,
        q3: int,
        end: int,
        scenario_name: str,
        pattern_name: str | None,
    ) -> list[tuple[int, float]]:
        first_leg = max(last_price - target_1, atr * 1.2)
        if "breakout" in scenario_name or "continuation" in scenario_name:
            bounce_cap = resistance_mid if resistance_mid is not None else last_price + max(atr * 0.8, first_leg * 0.22)
            bounce = max(last_price + atr * 0.25, min(bounce_cap, last_price + first_leg * 0.26))
            selloff = last_price - first_leg * 0.56
            retest = min(last_price - atr * 0.18, selloff + max(atr * 0.55, first_leg * 0.16))
            if pattern_name in {"bear flag", "descending triangle", "rising wedge"}:
                retest = min(retest, target_1 + atr * 0.20)
            final = min(target_2, target_1 - max(atr * 0.8, abs(target_1 - target_2) * 0.92))
            return [(0, last_price), (q1, bounce), (q2, selloff), (q3, retest), (end, final)]

        support_retest = support_mid if support_mid is not None else last_price - first_leg * 0.28
        first_push = last_price - first_leg * 0.34
        bounce = min(last_price + atr * 0.20, support_retest + atr * 0.45)
        continuation = min(first_push, target_1 + atr * 0.18)
        final = min(target_2, continuation - atr * 0.9)
        return [(0, last_price), (q1, first_push), (q2, bounce), (q3, continuation), (end, final)]

    @staticmethod
    def _base_checkpoints(last_price: float, points: list[tuple[int, float]], direction: str) -> list[tuple[int, float]]:
        if not points:
            return []
        total = len(points)
        anchors = [0, max(1, total // 4), max(2, total // 2), max(3, (total * 3) // 4), total - 1]
        checkpointed = [(0, last_price)]
        if direction == "bullish":
            multipliers = [-0.08, 0.06, -0.05]
        elif direction == "bearish":
            multipliers = [0.08, -0.06, 0.05]
        else:
            multipliers = [-0.04, 0.04, -0.03]
        for idx, anchor in enumerate(anchors[1:-1]):
            price = points[anchor][1]
            wobble = abs(price - last_price) * multipliers[idx]
            checkpointed.append((anchor, price + wobble))
        checkpointed.append((total - 1, points[-1][1]))
        return checkpointed

    @staticmethod
    def _nearest_zone(zones: list[dict[str, Any]], current_price: float, *, below: bool) -> dict[str, Any] | None:
        if below:
            candidates = [zone for zone in zones if float(zone["upper_bound"]) <= current_price]
        else:
            candidates = [zone for zone in zones if float(zone["lower_bound"]) >= current_price]
        if not candidates:
            return None
        return min(
            candidates,
            key=lambda zone: abs(((float(zone["lower_bound"]) + float(zone["upper_bound"])) / 2.0) - current_price),
        )

    @staticmethod
    def _zone_mid(zone: dict[str, Any] | None) -> float | None:
        if not zone:
            return None
        return (float(zone["lower_bound"]) + float(zone["upper_bound"])) / 2.0

    @staticmethod
    def _interpolate_checkpoints(dates: pd.DatetimeIndex, checkpoints: list[tuple[int, float]]) -> list[dict[str, Any]]:
        deduped: list[tuple[int, float]] = []
        for index, price in checkpoints:
            index = max(0, min(index, len(dates) - 1))
            if deduped and deduped[-1][0] == index:
                deduped[-1] = (index, price)
            else:
                deduped.append((index, price))

        points: list[dict[str, Any]] = []
        for (start_index, start_price), (end_index, end_price) in zip(deduped[:-1], deduped[1:]):
            span = max(end_index - start_index, 1)
            for step in range(span):
                ratio = step / span
                price = start_price + (end_price - start_price) * ratio
                timestamp = pd.Timestamp(dates[start_index + step]).date().isoformat()
                points.append({"timestamp": timestamp, "price": float(price)})
        final_index, final_price = deduped[-1]
        points.append({"timestamp": pd.Timestamp(dates[final_index]).date().isoformat(), "price": float(final_price)})
        return points
