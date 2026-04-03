"""Shared numeric helpers used across the analysis pipeline."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def clamp(value: float, low: float, high: float) -> float:
    """Clamp a numeric value into a fixed range."""

    return float(max(low, min(high, value)))


def safe_divide(numerator: float, denominator: float, default: float = 0.0) -> float:
    """Divide safely while handling zero and missing values."""

    if denominator in (0, 0.0) or pd.isna(denominator):
        return float(default)
    if pd.isna(numerator):
        return float(default)
    return float(numerator / denominator)


def sign(value: float, neutral_threshold: float = 0.0) -> int:
    """Return -1, 0, or 1 with an optional neutral zone."""

    if pd.isna(value) or abs(value) <= neutral_threshold:
        return 0
    return 1 if value > 0 else -1


def percent_distance(current: float, baseline: float) -> float:
    """Percent distance from a baseline."""

    if pd.isna(current) or pd.isna(baseline):
        return np.nan
    return safe_divide(current - baseline, baseline, default=0.0) * 100.0


def atr_distance(current: float, baseline: float, atr_value: float) -> float:
    """Distance between two prices in ATR units."""

    if pd.isna(current) or pd.isna(baseline) or pd.isna(atr_value):
        return np.nan
    return safe_divide(current - baseline, atr_value, default=0.0)


def linear_regression_slope(values: np.ndarray) -> float:
    """Slope of a series against a simple `0..n-1` x-axis."""

    if len(values) < 2 or np.isnan(values).any():
        return np.nan
    x_axis = np.arange(len(values), dtype=float)
    x_centered = x_axis - x_axis.mean()
    y_centered = values - values.mean()
    denominator = np.sum(x_centered ** 2)
    if denominator == 0:
        return np.nan
    return float(np.sum(x_centered * y_centered) / denominator)


def rolling_linear_regression_slope(series: pd.Series, window: int) -> pd.Series:
    """Rolling linear regression slope for a price or feature series."""

    return series.rolling(window=window, min_periods=window).apply(
        lambda window_values: linear_regression_slope(window_values.to_numpy(dtype=float)),
        raw=False,
    )


def rolling_percentile_rank(series: pd.Series, window: int) -> pd.Series:
    """Percentile rank of the last item within each rolling window."""

    def _percentile(window_values: pd.Series) -> float:
        ranked = window_values.rank(pct=True)
        return float(ranked.iloc[-1])

    return series.rolling(window=window, min_periods=window).apply(_percentile, raw=False)


def consecutive_streak(condition: pd.Series) -> pd.Series:
    """Return the current consecutive-true streak length for each row."""

    streaks: list[int] = []
    current = 0
    for item in condition.fillna(False).astype(bool).to_list():
        if item:
            current += 1
        else:
            current = 0
        streaks.append(current)
    return pd.Series(streaks, index=condition.index, dtype=float)


def normalize_signed(value: float, scale: float) -> float:
    """Map a raw value into approximately -100..100."""

    if pd.isna(value) or scale == 0:
        return 0.0
    return clamp((value / scale) * 100.0, -100.0, 100.0)


def normalize_positive(value: float, low: float, high: float) -> float:
    """Map a raw value into 0..100."""

    if pd.isna(value):
        return 0.0
    if high <= low:
        return 0.0
    normalized = (value - low) / (high - low)
    return clamp(normalized * 100.0, 0.0, 100.0)


def series_sign(series: pd.Series, neutral_threshold: float = 0.0) -> pd.Series:
    """Vectorized sign function with a neutral threshold."""

    output = pd.Series(0.0, index=series.index)
    output = output.mask(series > neutral_threshold, 1.0)
    output = output.mask(series < -neutral_threshold, -1.0)
    output = output.where(~series.isna(), np.nan)
    return output


def series_normalize_signed(series: pd.Series, scale: float) -> pd.Series:
    """Vectorized signed normalization into approximately -100..100."""

    if scale == 0:
        return pd.Series(0.0, index=series.index)
    normalized = (series / scale) * 100.0
    return normalized.clip(-100.0, 100.0)


def series_normalize_positive(series: pd.Series, low: float, high: float) -> pd.Series:
    """Vectorized positive normalization into 0..100."""

    if high <= low:
        return pd.Series(0.0, index=series.index)
    normalized = ((series - low) / (high - low)) * 100.0
    return normalized.clip(0.0, 100.0)


def to_builtin(value: Any) -> Any:
    """Recursively convert numpy and pandas objects to builtin Python types."""

    if isinstance(value, dict):
        return {str(key): to_builtin(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_builtin(item) for item in value]
    if isinstance(value, tuple):
        return [to_builtin(item) for item in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        if np.isnan(value):
            return None
        return float(value)
    if isinstance(value, (pd.Timestamp,)):
        return value.to_pydatetime()
    if isinstance(value, (pd.Series,)):
        return {str(index): to_builtin(item) for index, item in value.items()}
    if pd.isna(value):
        return None
    return value


def collapse_regime_label(regime_label: str) -> str:
    """Collapse a five-state regime label into bullish/sideways/bearish."""

    if regime_label in {"strong_uptrend", "weak_uptrend"}:
        return "bullish"
    if regime_label in {"strong_downtrend", "weak_downtrend"}:
        return "bearish"
    return "sideways"


def trend_state_label_ko(trend_state_label: str) -> str:
    """Return a Korean display label for the three-state trend label."""

    mapping = {
        "bullish": "상승 우위",
        "sideways": "횡보",
        "bearish": "하락 우위",
    }
    return mapping.get(trend_state_label, trend_state_label)
