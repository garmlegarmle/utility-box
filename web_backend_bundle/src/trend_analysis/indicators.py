"""Raw indicator calculations for the trend analysis engine."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import EngineConfig
from .utils import rolling_linear_regression_slope


class IndicatorEngine:
    """Compute reusable indicators from daily OHLCV data."""

    def __init__(self, config: EngineConfig) -> None:
        self.config = config

    def compute(self, frame: pd.DataFrame) -> pd.DataFrame:
        """Return a dataframe with indicator columns appended."""

        indicator_cfg = self.config.indicators
        df = frame.copy()

        close = df["close"]
        high = df["high"]
        low = df["low"]
        volume = df["volume"]

        df["ema20"] = close.ewm(span=indicator_cfg.ema_fast, adjust=False).mean()
        df["ema50"] = close.ewm(span=indicator_cfg.ema_slow, adjust=False).mean()
        df["sma200"] = close.rolling(
            window=indicator_cfg.sma_long,
            min_periods=indicator_cfg.sma_long,
        ).mean()
        df["ichimoku_tenkan"] = (
            high.rolling(
                window=indicator_cfg.ichimoku_tenkan_length,
                min_periods=indicator_cfg.ichimoku_tenkan_length,
            ).max()
            + low.rolling(
                window=indicator_cfg.ichimoku_tenkan_length,
                min_periods=indicator_cfg.ichimoku_tenkan_length,
            ).min()
        ) / 2.0
        df["ichimoku_kijun"] = (
            high.rolling(
                window=indicator_cfg.ichimoku_kijun_length,
                min_periods=indicator_cfg.ichimoku_kijun_length,
            ).max()
            + low.rolling(
                window=indicator_cfg.ichimoku_kijun_length,
                min_periods=indicator_cfg.ichimoku_kijun_length,
            ).min()
        ) / 2.0
        df["ichimoku_span_a_raw"] = (df["ichimoku_tenkan"] + df["ichimoku_kijun"]) / 2.0
        df["ichimoku_span_b_raw"] = (
            high.rolling(
                window=indicator_cfg.ichimoku_span_b_length,
                min_periods=indicator_cfg.ichimoku_span_b_length,
            ).max()
            + low.rolling(
                window=indicator_cfg.ichimoku_span_b_length,
                min_periods=indicator_cfg.ichimoku_span_b_length,
            ).min()
        ) / 2.0
        # Current cloud view uses spans that were projected forward in standard Ichimoku charts.
        df["ichimoku_cloud_a"] = df["ichimoku_span_a_raw"].shift(indicator_cfg.ichimoku_kijun_length)
        df["ichimoku_cloud_b"] = df["ichimoku_span_b_raw"].shift(indicator_cfg.ichimoku_kijun_length)
        df["linear_regression_slope_50"] = rolling_linear_regression_slope(
            close,
            indicator_cfg.regression_window,
        )

        df["macd_line"] = (
            close.ewm(span=indicator_cfg.macd_fast, adjust=False).mean()
            - close.ewm(span=indicator_cfg.macd_slow, adjust=False).mean()
        )
        df["macd_signal"] = df["macd_line"].ewm(
            span=indicator_cfg.macd_signal,
            adjust=False,
        ).mean()
        df["macd_hist"] = df["macd_line"] - df["macd_signal"]

        previous_close = close.shift(1)
        true_range = pd.concat(
            [
                high - low,
                (high - previous_close).abs(),
                (low - previous_close).abs(),
            ],
            axis=1,
        ).max(axis=1)
        df["true_range"] = true_range
        df["atr"] = true_range.ewm(
            alpha=1 / indicator_cfg.atr_length,
            adjust=False,
            min_periods=indicator_cfg.atr_length,
        ).mean()
        df["atr_pct"] = df["atr"].div(close.replace(0.0, np.nan)).replace([np.inf, -np.inf], np.nan) * 100.0

        up_move = high.diff()
        down_move = -low.diff()
        plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
        minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
        plus_dm_series = pd.Series(plus_dm, index=df.index)
        minus_dm_series = pd.Series(minus_dm, index=df.index)

        plus_dm_smoothed = plus_dm_series.ewm(
            alpha=1 / indicator_cfg.adx_length,
            adjust=False,
            min_periods=indicator_cfg.adx_length,
        ).mean()
        minus_dm_smoothed = minus_dm_series.ewm(
            alpha=1 / indicator_cfg.adx_length,
            adjust=False,
            min_periods=indicator_cfg.adx_length,
        ).mean()
        df["plus_di"] = plus_dm_smoothed.div(df["atr"]).replace([np.inf, -np.inf], np.nan) * 100.0
        df["minus_di"] = minus_dm_smoothed.div(df["atr"]).replace([np.inf, -np.inf], np.nan) * 100.0
        directional_sum = (df["plus_di"] + df["minus_di"]).replace(0.0, np.nan)
        df["dx"] = (
            (df["plus_di"] - df["minus_di"]).abs().div(directional_sum).replace([np.inf, -np.inf], np.nan)
            * 100.0
        )
        df["adx"] = df["dx"].ewm(
            alpha=1 / indicator_cfg.adx_length,
            adjust=False,
            min_periods=indicator_cfg.adx_length,
        ).mean()

        delta = close.diff()
        gains = delta.clip(lower=0.0)
        losses = -delta.clip(upper=0.0)
        average_gain = gains.ewm(
            alpha=1 / indicator_cfg.rsi_length,
            adjust=False,
            min_periods=indicator_cfg.rsi_length,
        ).mean()
        average_loss = losses.ewm(
            alpha=1 / indicator_cfg.rsi_length,
            adjust=False,
            min_periods=indicator_cfg.rsi_length,
        ).mean()
        rs = average_gain.div(average_loss.replace(0.0, np.nan))
        df["rsi"] = 100.0 - (100.0 / (1.0 + rs))
        df.loc[average_loss == 0, "rsi"] = 100.0
        df.loc[(average_gain == 0) & (average_loss == 0), "rsi"] = 50.0

        df["roc10"] = close.pct_change(periods=indicator_cfg.roc_length) * 100.0

        df["bb_mid"] = close.rolling(window=indicator_cfg.bb_length, min_periods=indicator_cfg.bb_length).mean()
        df["bb_std"] = close.rolling(window=indicator_cfg.bb_length, min_periods=indicator_cfg.bb_length).std(ddof=0)
        df["bb_upper"] = df["bb_mid"] + indicator_cfg.bb_std * df["bb_std"]
        df["bb_lower"] = df["bb_mid"] - indicator_cfg.bb_std * df["bb_std"]
        df["bb_width"] = (df["bb_upper"] - df["bb_lower"]).div(df["bb_mid"]).replace(
            [np.inf, -np.inf],
            np.nan,
        ) * 100.0

        df["donchian_high"] = high.rolling(
            window=indicator_cfg.donchian_length,
            min_periods=indicator_cfg.donchian_length,
        ).max()
        df["donchian_low"] = low.rolling(
            window=indicator_cfg.donchian_length,
            min_periods=indicator_cfg.donchian_length,
        ).min()
        df["donchian_mid"] = (df["donchian_high"] + df["donchian_low"]) / 2.0

        df["volume_avg_20"] = volume.rolling(
            window=indicator_cfg.volume_average_length,
            min_periods=indicator_cfg.volume_average_length,
        ).mean()

        obv_direction = np.sign(close.diff().fillna(0.0))
        df["obv"] = (obv_direction * volume).fillna(0.0).cumsum()

        return df
