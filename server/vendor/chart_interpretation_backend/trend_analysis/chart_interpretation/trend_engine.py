"""Trend engine for chart interpretation."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from ..config import EngineConfig
from ..indicators import IndicatorEngine
from ..utils import clamp, rolling_linear_regression_slope, safe_divide
from .config import ChartInterpretationConfig


class TrendEngine:
    """Build indicator context and an explainable trend-state interpretation."""

    def __init__(self, config: ChartInterpretationConfig) -> None:
        self.config = config
        self.base_indicator_engine = IndicatorEngine(EngineConfig())

    def compute_indicator_frame(self, frame: pd.DataFrame) -> pd.DataFrame:
        df = self.base_indicator_engine.compute(frame)
        trend_cfg = self.config.trend
        close = df["close"]
        high = df["high"]
        low = df["low"]

        df["ema20"] = close.ewm(span=trend_cfg.ema_fast, adjust=False).mean()
        df["ema50"] = close.ewm(span=trend_cfg.ema_medium, adjust=False).mean()
        df["ema200"] = close.ewm(span=trend_cfg.ema_slow, adjust=False).mean()
        df["ema20_slope_pct"] = df["ema20"].pct_change(5) * 100.0
        df["ema50_slope_pct"] = df["ema50"].pct_change(5) * 100.0
        df["ema200_slope_pct"] = df["ema200"].pct_change(10) * 100.0
        df["tenkan_sen"] = (high.rolling(trend_cfg.ichimoku_tenkan, min_periods=trend_cfg.ichimoku_tenkan).max() + low.rolling(trend_cfg.ichimoku_tenkan, min_periods=trend_cfg.ichimoku_tenkan).min()) / 2.0
        df["kijun_sen"] = (high.rolling(trend_cfg.ichimoku_kijun, min_periods=trend_cfg.ichimoku_kijun).max() + low.rolling(trend_cfg.ichimoku_kijun, min_periods=trend_cfg.ichimoku_kijun).min()) / 2.0
        df["senkou_span_a"] = ((df["tenkan_sen"] + df["kijun_sen"]) / 2.0).bfill()
        df["senkou_span_b"] = (
            high.rolling(trend_cfg.ichimoku_senkou_b, min_periods=trend_cfg.ichimoku_senkou_b).max()
            + low.rolling(trend_cfg.ichimoku_senkou_b, min_periods=trend_cfg.ichimoku_senkou_b).min()
        ) / 2.0
        df["senkou_span_b"] = df["senkou_span_b"].bfill()
        df["cloud_top"] = df[["senkou_span_a", "senkou_span_b"]].max(axis=1)
        df["cloud_bottom"] = df[["senkou_span_a", "senkou_span_b"]].min(axis=1)
        for window in trend_cfg.regression_windows:
            df[f"regression_slope_{window}"] = rolling_linear_regression_slope(close, window).div(close.replace(0.0, np.nan)) * 100.0
        df["trend_efficiency"] = self._trend_efficiency(close, trend_cfg.efficiency_window)
        df["net_move_pct"] = close.pct_change(trend_cfg.efficiency_window) * 100.0
        return df

    def analyze(self, indicator_frame: pd.DataFrame) -> dict[str, Any]:
        latest = indicator_frame.iloc[-1]
        direction_score = self._direction_score(latest)
        strength_score = self._strength_score(latest)
        trend_score = clamp(direction_score * 0.65 + np.sign(direction_score) * strength_score * 0.35, -1.0, 1.0)
        label = self._label(trend_score, latest)
        ema_context = self._ema_context(indicator_frame)
        ichimoku_context = self._ichimoku_context(indicator_frame)
        return {
            "score": trend_score,
            "direction_score": direction_score,
            "strength_score": strength_score,
            "label": label,
            "ema_context": ema_context,
            "ichimoku_context": ichimoku_context,
            "components": {
                "ema_alignment": self._ema_alignment_score(latest),
                "ema_slope": self._ema_slope_score(latest),
                "regression": self._regression_score(latest),
                "adx": self._adx_score(latest),
                "efficiency": self._efficiency_score(latest),
                "ema_context": ema_context,
                "ichimoku_context": ichimoku_context,
            },
        }

    def analyze_higher_timeframe(self, frame: pd.DataFrame) -> dict[str, Any] | None:
        resampled = frame.resample(self.config.trend.higher_timeframe_rule).agg(
            {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
        ).dropna(how="any")
        if len(resampled) < 60:
            return None
        return self.analyze(self.compute_indicator_frame(resampled))

    def _direction_score(self, latest: pd.Series) -> float:
        pieces = [
            self._ema_alignment_score(latest),
            self._ema_slope_score(latest),
            self._regression_score(latest),
            clamp(safe_divide(float(latest["plus_di"]) - float(latest["minus_di"]), 40.0, default=0.0), -1.0, 1.0),
        ]
        return float(np.nanmean(pieces))

    def _strength_score(self, latest: pd.Series) -> float:
        pieces = [self._adx_score(latest), self._efficiency_score(latest)]
        return float(np.nanmean(pieces))

    @staticmethod
    def _ema_alignment_score(latest: pd.Series) -> float:
        bullish = float(latest["ema20"] > latest["ema50"]) + float(latest["ema50"] > latest["ema200"]) + float(latest["close"] > latest["ema20"])
        bearish = float(latest["ema20"] < latest["ema50"]) + float(latest["ema50"] < latest["ema200"]) + float(latest["close"] < latest["ema20"])
        return clamp((bullish - bearish) / 3.0, -1.0, 1.0)

    @staticmethod
    def _ema_slope_score(latest: pd.Series) -> float:
        slopes = [float(latest.get("ema20_slope_pct", 0.0)), float(latest.get("ema50_slope_pct", 0.0)), float(latest.get("ema200_slope_pct", 0.0))]
        return clamp(float(np.nanmean(slopes)) / 1.4, -1.0, 1.0)

    @staticmethod
    def _regression_score(latest: pd.Series) -> float:
        slopes = [float(latest.get("regression_slope_20", 0.0)), float(latest.get("regression_slope_50", 0.0))]
        return clamp(float(np.nanmean(slopes)) / 0.8, -1.0, 1.0)

    @staticmethod
    def _adx_score(latest: pd.Series) -> float:
        adx = float(latest.get("adx", 0.0))
        return clamp((adx - 15.0) / 25.0, 0.0, 1.0)

    @staticmethod
    def _efficiency_score(latest: pd.Series) -> float:
        return clamp(float(latest.get("trend_efficiency", 0.0)) / 0.55, 0.0, 1.0)

    @staticmethod
    def _label(score: float, latest: pd.Series) -> str:
        efficiency = float(latest.get("trend_efficiency", 0.0))
        adx = float(latest.get("adx", 0.0))
        if adx < 17.0 and efficiency < 0.25:
            return "range"
        if abs(score) < 0.18:
            return "transition"
        if abs(score) < 0.35 or adx < 20.0:
            return "weak trend"
        return "uptrend" if score > 0 else "downtrend"

    @staticmethod
    def _trend_efficiency(close: pd.Series, window: int) -> pd.Series:
        net_move = close.diff(window).abs()
        realized = close.diff().abs().rolling(window, min_periods=window).sum()
        return net_move.div(realized.replace(0.0, np.nan)).fillna(0.0).clip(0.0, 1.0)

    def _ema_context(self, frame: pd.DataFrame) -> dict[str, Any]:
        latest = frame.iloc[-1]
        prev = frame.iloc[-2] if len(frame) > 1 else latest
        atr = max(float(latest.get("atr", (latest["high"] - latest["low"]))), 1e-6)
        close = float(latest["close"])
        ema20 = float(latest["ema20"])
        ema50 = float(latest["ema50"])
        ema200 = float(latest["ema200"])
        recent_above_ema50 = bool((frame["close"].tail(4) > frame["ema50"].tail(4)).sum() >= 3) if len(frame) >= 4 else close > ema50
        return {
            "ema20": ema20,
            "ema50": ema50,
            "ema200": ema200,
            "pullback_to_ema20": abs(close - ema20) <= atr * 0.60 and close >= ema50 * 0.995,
            "lost_ema50": close < ema50 and recent_above_ema50,
            "reclaimed_ema20": float(prev["close"]) < float(prev["ema20"]) and close > ema20,
            "above_ema200": close >= ema200,
            "below_ema200": close < ema200,
            "ema_stack_bullish": ema20 > ema50 > ema200,
            "ema_stack_bearish": ema20 < ema50 < ema200,
        }

    def _ichimoku_context(self, frame: pd.DataFrame) -> dict[str, Any]:
        latest = frame.iloc[-1]
        atr = max(float(latest.get("atr", (latest["high"] - latest["low"]))), 1e-6)
        close = float(latest["close"])
        cloud_top = float(latest.get("cloud_top", latest["close"]))
        cloud_bottom = float(latest.get("cloud_bottom", latest["close"]))
        if close > cloud_top:
            regime = "above cloud"
        elif close < cloud_bottom:
            regime = "below cloud"
        else:
            regime = "inside cloud"
        near_cloud = min(abs(close - cloud_top), abs(close - cloud_bottom)) <= atr * self.config.trend.ichimoku_cloud_proximity_atr
        return {
            "regime": regime,
            "near_cloud": near_cloud,
            "tenkan_sen": float(latest.get("tenkan_sen", close)),
            "kijun_sen": float(latest.get("kijun_sen", close)),
            "cloud_top": cloud_top,
            "cloud_bottom": cloud_bottom,
        }
