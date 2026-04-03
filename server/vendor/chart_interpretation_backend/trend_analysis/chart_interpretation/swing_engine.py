"""Swing detection engine."""

from __future__ import annotations

from typing import Any

import pandas as pd

from ..utils import safe_divide
from .config import ChartInterpretationConfig, SwingScaleConfig
from .models import SwingPoint


class SwingEngine:
    """Detect multi-scale swing highs and lows."""

    def __init__(self, config: ChartInterpretationConfig) -> None:
        self.config = config

    def analyze(self, indicator_frame: pd.DataFrame) -> dict[str, list[SwingPoint]]:
        output: dict[str, list[SwingPoint]] = {}
        for scale in self.config.swings.scales:
            output[scale.name] = self._detect_scale(indicator_frame, scale)[-self.config.swings.max_points_per_scale :]
        return output

    def _detect_scale(self, frame: pd.DataFrame, scale: SwingScaleConfig) -> list[SwingPoint]:
        highs = frame["high"]
        lows = frame["low"]
        atr = frame["atr"].bfill().fillna((highs - lows).rolling(10, min_periods=1).mean())
        window = scale.left_bars + scale.right_bars + 1

        high_mask = highs.eq(highs.rolling(window, center=True, min_periods=window).max())
        low_mask = lows.eq(lows.rolling(window, center=True, min_periods=window).min())

        candidates: list[tuple[int, str, float]] = []
        for position, (_, is_high, is_low, high_price, low_price) in enumerate(
            zip(frame.index, high_mask.to_list(), low_mask.to_list(), highs.to_list(), lows.to_list())
        ):
            if is_high:
                candidates.append((position, "high", float(high_price)))
            if is_low:
                candidates.append((position, "low", float(low_price)))
        candidates.sort(key=lambda item: item[0])

        accepted: list[tuple[int, str, float]] = []
        for candidate in candidates:
            if not accepted:
                accepted.append(candidate)
                continue
            last_position, last_kind, last_price = accepted[-1]
            position, kind, price = candidate
            if kind == last_kind:
                if (kind == "high" and price >= last_price) or (kind == "low" and price <= last_price):
                    accepted[-1] = candidate
                continue
            atr_value = float(atr.iloc[position]) if position < len(atr) else float(atr.iloc[-1])
            min_move = atr_value * scale.atr_multiple
            if abs(price - last_price) < min_move:
                continue
            if position - last_position < scale.right_bars:
                continue
            accepted.append(candidate)

        output: list[SwingPoint] = []
        for idx, (position, kind, price) in enumerate(accepted):
            atr_value = float(atr.iloc[position]) if position < len(atr) else float(atr.iloc[-1])
            prev_price = accepted[idx - 1][2] if idx > 0 else price
            output.append(
                SwingPoint(
                    timestamp=pd.Timestamp(frame.index[position]).to_pydatetime(),
                    price=price,
                    kind=kind,
                    scale=scale.name,
                    bar_index=position,
                    strength_atr=abs(safe_divide(price - prev_price, atr_value, default=0.0)),
                )
            )
        return output
