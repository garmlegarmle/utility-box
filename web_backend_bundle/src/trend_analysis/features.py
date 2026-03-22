"""Derived, interpretable feature extraction built on raw indicators."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .config import EngineConfig
from .models import FeatureSnapshot
from .utils import (
    atr_distance,
    clamp,
    consecutive_streak,
    percent_distance,
    rolling_percentile_rank,
    series_normalize_signed,
    series_sign,
    to_builtin,
)


class FeatureEngine:
    """Convert indicator data into interpretable scored features."""

    FEATURE_COLUMNS = [
        "close_vs_ema20",
        "close_vs_ema50",
        "close_vs_sma200",
        "ema_alignment_state",
        "close_vs_kijun",
        "tenkan_kijun_state",
        "cloud_position_state",
        "ema20_slope_norm",
        "ema50_slope_norm",
        "linear_regression_slope_50",
        "cloud_thickness_norm",
        "price_position_within_range_20",
        "adx_regime",
        "di_spread_norm",
        "trend_persistence_20",
        "breakout_persistence",
        "rsi_zone_score",
        "rsi_slope_5",
        "roc10_norm",
        "macd_state",
        "macd_hist_slope_3",
        "atr_pct",
        "atr_regime",
        "bb_width_relative",
        "bb_width_percentile",
        "squeeze_flag",
        "expansion_flag",
        "donchian_breakout_context",
        "volume_ratio_20",
        "obv_slope_20",
        "breakout_volume_support",
        "overextension_ema20_atr",
        "overextension_ema50_atr",
        "macd_momentum_fade",
        "adx_rollover",
        "failed_breakout_flag",
        "failed_breakdown_flag",
        "hostile_volatility_spike",
        "exhaustion_flag",
        "reversal_warning_count",
        "momentum_divergence_proxy",
        "directional_bias",
        "bull_breakout_active",
        "bear_breakdown_active",
    ]

    def __init__(self, config: EngineConfig) -> None:
        self.config = config

    def compute(self, frame: pd.DataFrame) -> FeatureSnapshot:
        """Build a feature snapshot from the latest row and recent context."""

        if frame.empty:
            raise ValueError("Indicator frame is empty.")

        feature_frame = self.compute_frame(frame)
        latest_values = feature_frame.iloc[-1].to_dict()
        missing_features = [
            name
            for name, value in latest_values.items()
            if value is None or pd.isna(value)
        ]
        total_features = len(latest_values)
        available_features = total_features - len(missing_features)
        coverage_ratio = available_features / total_features if total_features else 0.0

        return FeatureSnapshot(
            values=to_builtin(latest_values),
            coverage_ratio=coverage_ratio,
            available_features=available_features,
            total_features=total_features,
            missing_features=missing_features,
        )

    def compute_frame(self, frame: pd.DataFrame) -> pd.DataFrame:
        """Build the full historical feature frame for every available bar."""

        if frame.empty:
            raise ValueError("Indicator frame is empty.")

        indicator_cfg = self.config.indicators
        thresholds = self.config.feature_thresholds
        formulas = self.config.feature_formulas

        feature_frame = pd.DataFrame(index=frame.index)

        close = frame["close"]
        open_ = frame["open"]
        ema20 = frame["ema20"]
        ema50 = frame["ema50"]
        sma200 = frame["sma200"]
        ichimoku_tenkan = frame["ichimoku_tenkan"]
        ichimoku_kijun = frame["ichimoku_kijun"]
        ichimoku_span_a_raw = frame["ichimoku_span_a_raw"]
        ichimoku_span_b_raw = frame["ichimoku_span_b_raw"]
        ichimoku_cloud_a = frame["ichimoku_cloud_a"]
        ichimoku_cloud_b = frame["ichimoku_cloud_b"]
        atr = frame["atr"]
        rsi = frame["rsi"]
        macd_line = frame["macd_line"]
        macd_signal = frame["macd_signal"]
        macd_hist = frame["macd_hist"]
        plus_di = frame["plus_di"]
        minus_di = frame["minus_di"]
        donchian_high = frame["donchian_high"]
        donchian_low = frame["donchian_low"]
        bb_width = frame["bb_width"]
        atr_pct = frame["atr_pct"]
        volume_avg_20 = frame["volume_avg_20"]
        obv = frame["obv"]

        slope_window = indicator_cfg.slope_change_window
        macd_slope_window = indicator_cfg.macd_hist_slope_window

        bb_width_percentile = rolling_percentile_rank(
            bb_width,
            indicator_cfg.bb_percentile_window,
        )
        bb_width_median = bb_width.rolling(
            window=indicator_cfg.bb_percentile_window,
            min_periods=formulas.bb_width_median_min_periods,
        ).median()
        atr_pct_median = atr_pct.rolling(
            window=indicator_cfg.hostile_vol_window,
            min_periods=formulas.atr_pct_median_min_periods,
        ).median()

        prior_donchian_high = donchian_high.shift(1)
        prior_donchian_low = donchian_low.shift(1)
        bull_breakout = close > (prior_donchian_high * (1.0 + thresholds.breakout_close_buffer))
        bear_breakdown = close < (prior_donchian_low * (1.0 - thresholds.breakout_close_buffer))
        bull_breakout_streak = consecutive_streak(bull_breakout)
        bear_breakdown_streak = consecutive_streak(bear_breakdown)

        ema20_prev = ema20.shift(slope_window)
        ema50_prev = ema50.shift(slope_window)
        rsi_prev = rsi.shift(slope_window)
        macd_hist_prev = macd_hist.shift(macd_slope_window)
        adx_prev = frame["adx"].shift(slope_window)

        price_range = donchian_high - donchian_low
        price_position = (close - donchian_low).div(price_range.replace(0.0, np.nan))

        feature_frame["close_vs_ema20"] = (close - ema20).div(ema20.replace(0.0, np.nan)) * 100.0
        feature_frame["close_vs_ema50"] = (close - ema50).div(ema50.replace(0.0, np.nan)) * 100.0
        feature_frame["close_vs_sma200"] = (close - sma200).div(sma200.replace(0.0, np.nan)) * 100.0
        feature_frame["close_vs_kijun"] = (close - ichimoku_kijun).div(ichimoku_kijun.replace(0.0, np.nan)) * 100.0
        feature_frame["ema20_slope_norm"] = (ema20 - ema20_prev).div(ema20_prev.replace(0.0, np.nan)) * 100.0
        feature_frame["ema50_slope_norm"] = (ema50 - ema50_prev).div(ema50_prev.replace(0.0, np.nan)) * 100.0
        feature_frame["linear_regression_slope_50"] = (
            frame["linear_regression_slope_50"].div(close.replace(0.0, np.nan)) * 100.0
        )
        feature_frame["cloud_thickness_norm"] = (
            (ichimoku_cloud_a - ichimoku_cloud_b).abs().div(atr.replace(0.0, np.nan))
        )

        directional_sum = (plus_di + minus_di).replace(0.0, np.nan)
        feature_frame["di_spread_norm"] = ((plus_di - minus_di).div(directional_sum)) * 100.0
        feature_frame["adx_regime"] = frame["adx"]
        feature_frame["price_position_within_range_20"] = price_position

        feature_frame["ema_alignment_state"] = self._ema_alignment_series(
            close=close,
            ema20=ema20,
            ema50=ema50,
            sma200=sma200,
        )
        feature_frame["tenkan_kijun_state"] = self._tenkan_kijun_state_series(
            close=close,
            tenkan=ichimoku_tenkan,
            kijun=ichimoku_kijun,
        )
        feature_frame["cloud_position_state"] = self._cloud_position_state_series(
            close=close,
            cloud_a=ichimoku_cloud_a,
            cloud_b=ichimoku_cloud_b,
            future_span_a=ichimoku_span_a_raw,
            future_span_b=ichimoku_span_b_raw,
        )
        feature_frame["trend_persistence_20"] = (
            close.gt(ema20).rolling(window=indicator_cfg.persistence_window, min_periods=1).mean()
            - close.lt(ema20).rolling(window=indicator_cfg.persistence_window, min_periods=1).mean()
        ) * 100.0
        feature_frame["breakout_persistence"] = bull_breakout_streak - bear_breakdown_streak

        feature_frame["rsi_zone_score"] = (
            (rsi - formulas.rsi_neutral) * formulas.rsi_zone_multiplier
        ).clip(-100.0, 100.0)
        feature_frame["rsi_slope_5"] = rsi - rsi_prev
        feature_frame["roc10_norm"] = frame["roc10"]
        feature_frame["macd_state"] = self._macd_state_series(macd_line, macd_signal)
        feature_frame["macd_hist_slope_3"] = (macd_hist - macd_hist_prev).div(atr.replace(0.0, np.nan))

        feature_frame["atr_pct"] = atr_pct
        feature_frame["atr_regime"] = atr_pct.div(atr_pct_median.replace(0.0, np.nan))
        feature_frame["bb_width_relative"] = bb_width.div(bb_width_median.replace(0.0, np.nan))
        feature_frame["bb_width_percentile"] = bb_width_percentile
        feature_frame["squeeze_flag"] = (bb_width_percentile <= thresholds.bb_squeeze_percentile).astype(float)
        feature_frame["expansion_flag"] = (bb_width_percentile >= thresholds.bb_expansion_percentile).astype(float)
        feature_frame["donchian_breakout_context"] = self._donchian_context_series(
            close=close,
            prior_high=prior_donchian_high,
            prior_low=prior_donchian_low,
            price_position=price_position,
        )

        feature_frame["volume_ratio_20"] = frame["volume"].div(volume_avg_20.replace(0.0, np.nan))
        feature_frame["obv_slope_20"] = (
            (obv - obv.shift(indicator_cfg.obv_slope_window)).div(
                (volume_avg_20 * indicator_cfg.obv_slope_window).replace(0.0, np.nan)
            )
        )

        trend_bias_score = (
            feature_frame["ema_alignment_state"].fillna(0.0) * formulas.trend_bias_ema_alignment_weight
            + feature_frame["di_spread_norm"].fillna(0.0) * formulas.trend_bias_di_spread_weight
            + feature_frame["macd_state"].fillna(0.0) * formulas.trend_bias_macd_weight
            + feature_frame["cloud_position_state"].fillna(0.0) * formulas.trend_bias_cloud_position_weight
            + feature_frame["tenkan_kijun_state"].fillna(0.0) * formulas.trend_bias_tenkan_kijun_weight
        )
        feature_frame["directional_bias"] = series_sign(
            trend_bias_score,
            neutral_threshold=thresholds.neutral_score_epsilon,
        )
        feature_frame["bull_breakout_active"] = bull_breakout.astype(float)
        feature_frame["bear_breakdown_active"] = bear_breakdown.astype(float)
        feature_frame["breakout_volume_support"] = self._breakout_volume_support_series(
            bull_breakout=bull_breakout,
            bear_breakdown=bear_breakdown,
            volume_ratio=feature_frame["volume_ratio_20"],
        )

        feature_frame["overextension_ema20_atr"] = (close - ema20).div(atr.replace(0.0, np.nan))
        feature_frame["overextension_ema50_atr"] = (close - ema50).div(atr.replace(0.0, np.nan))
        feature_frame["macd_momentum_fade"] = self._macd_momentum_fade_series(
            trend_bias=feature_frame["directional_bias"],
            macd_hist=macd_hist,
            macd_hist_slope=feature_frame["macd_hist_slope_3"],
        )
        feature_frame["adx_rollover"] = self._adx_rollover_series(
            adx_current=frame["adx"],
            adx_previous=adx_prev,
        )
        feature_frame["failed_breakout_flag"] = self._failed_breakout_series(
            recent_breakouts=bull_breakout,
            latest_close=close,
            prior_high=prior_donchian_high,
            ema20=ema20,
            lookback=indicator_cfg.breakout_signal_lookback,
        )
        feature_frame["failed_breakdown_flag"] = self._failed_breakdown_series(
            recent_breakdowns=bear_breakdown,
            latest_close=close,
            prior_low=prior_donchian_low,
            ema20=ema20,
            lookback=indicator_cfg.breakout_signal_lookback,
        )
        feature_frame["hostile_volatility_spike"] = self._hostile_volatility_spike_series(
            atr_regime=feature_frame["atr_regime"],
            trend_bias=feature_frame["directional_bias"],
            candle_open=open_,
            candle_close=close,
        )
        feature_frame["momentum_divergence_proxy"] = self._momentum_divergence_proxy_series(
            trend_bias=feature_frame["directional_bias"],
            price_position=price_position,
            rsi_slope=feature_frame["rsi_slope_5"],
            macd_hist_slope=feature_frame["macd_hist_slope_3"],
        )
        feature_frame["exhaustion_flag"] = self._exhaustion_flag_series(
            trend_bias=feature_frame["directional_bias"],
            rsi=rsi,
            overextension_ema20_atr=feature_frame["overextension_ema20_atr"],
            macd_momentum_fade=feature_frame["macd_momentum_fade"],
        )
        feature_frame["reversal_warning_count"] = (
            (feature_frame["macd_momentum_fade"] > 0).astype(float)
            + (feature_frame["adx_rollover"] > 0).astype(float)
            + feature_frame["failed_breakout_flag"]
            + feature_frame["failed_breakdown_flag"]
            + (feature_frame["hostile_volatility_spike"] > 0).astype(float)
            + feature_frame["exhaustion_flag"]
            + (feature_frame["momentum_divergence_proxy"] > 0).astype(float)
        )

        return feature_frame[self.FEATURE_COLUMNS]

    def _ema_alignment_series(
        self,
        close: pd.Series,
        ema20: pd.Series,
        ema50: pd.Series,
        sma200: pd.Series,
    ) -> pd.Series:
        formulas = self.config.feature_formulas
        output = pd.Series(0.0, index=close.index)
        bullish_full = (close > ema20) & (ema20 > ema50) & (sma200.isna() | (ema50 > sma200))
        bearish_full = (close < ema20) & (ema20 < ema50) & (sma200.isna() | (ema50 < sma200))
        bullish_partial = (close > ema20) & (ema20 > ema50) & ~bullish_full
        bearish_partial = (close < ema20) & (ema20 < ema50) & ~bearish_full

        output = output.mask(bullish_full, formulas.ema_alignment_full_value)
        output = output.mask(bearish_full, -formulas.ema_alignment_full_value)
        output = output.mask(bullish_partial, formulas.ema_alignment_partial_value)
        output = output.mask(bearish_partial, -formulas.ema_alignment_partial_value)
        invalid = close.isna() | ema20.isna() | ema50.isna()
        return output.where(~invalid, np.nan)

    def _tenkan_kijun_state_series(
        self,
        close: pd.Series,
        tenkan: pd.Series,
        kijun: pd.Series,
    ) -> pd.Series:
        formulas = self.config.feature_formulas
        output = pd.Series(0.0, index=close.index)
        bullish_full = (tenkan > kijun) & (close > kijun)
        bearish_full = (tenkan < kijun) & (close < kijun)
        bullish_partial = (tenkan > kijun) & ~bullish_full
        bearish_partial = (tenkan < kijun) & ~bearish_full

        output = output.mask(bullish_full, formulas.ichimoku_state_full_value)
        output = output.mask(bearish_full, -formulas.ichimoku_state_full_value)
        output = output.mask(bullish_partial, formulas.ichimoku_state_partial_value)
        output = output.mask(bearish_partial, -formulas.ichimoku_state_partial_value)
        invalid = close.isna() | tenkan.isna() | kijun.isna()
        return output.where(~invalid, np.nan)

    def _cloud_position_state_series(
        self,
        close: pd.Series,
        cloud_a: pd.Series,
        cloud_b: pd.Series,
        future_span_a: pd.Series,
        future_span_b: pd.Series,
    ) -> pd.Series:
        formulas = self.config.feature_formulas
        cloud_top = pd.concat([cloud_a, cloud_b], axis=1).max(axis=1)
        cloud_bottom = pd.concat([cloud_a, cloud_b], axis=1).min(axis=1)
        cloud_mid = (cloud_top + cloud_bottom) / 2.0
        future_cloud_bias = np.sign(future_span_a - future_span_b)

        above_cloud = close > cloud_top
        below_cloud = close < cloud_bottom
        inside_upper = (~above_cloud) & (~below_cloud) & (close >= cloud_mid)
        inside_lower = (~above_cloud) & (~below_cloud) & (close < cloud_mid)

        output = pd.Series(0.0, index=close.index)
        output = output.mask(
            above_cloud & (future_cloud_bias > 0),
            formulas.ichimoku_state_full_value,
        )
        output = output.mask(
            above_cloud & ((future_cloud_bias <= 0) | future_cloud_bias.isna()),
            formulas.ichimoku_state_partial_value,
        )
        output = output.mask(
            below_cloud & (future_cloud_bias < 0),
            -formulas.ichimoku_state_full_value,
        )
        output = output.mask(
            below_cloud & ((future_cloud_bias >= 0) | future_cloud_bias.isna()),
            -formulas.ichimoku_state_partial_value,
        )
        output = output.mask(inside_upper, formulas.ichimoku_inside_cloud_value)
        output = output.mask(inside_lower, -formulas.ichimoku_inside_cloud_value)
        invalid = close.isna() | cloud_top.isna() | cloud_bottom.isna()
        return output.where(~invalid, np.nan)

    def _macd_state_series(self, macd_line: pd.Series, macd_signal: pd.Series) -> pd.Series:
        formulas = self.config.feature_formulas
        output = pd.Series(0.0, index=macd_line.index)
        output = output.mask((macd_line > macd_signal) & (macd_line > 0), formulas.macd_state_full_value)
        output = output.mask((macd_line > macd_signal) & (macd_line <= 0), formulas.macd_state_partial_value)
        output = output.mask((macd_line < macd_signal) & (macd_line < 0), -formulas.macd_state_full_value)
        output = output.mask((macd_line < macd_signal) & (macd_line >= 0), -formulas.macd_state_partial_value)
        invalid = macd_line.isna() | macd_signal.isna()
        return output.where(~invalid, np.nan)

    def _donchian_context_series(
        self,
        close: pd.Series,
        prior_high: pd.Series,
        prior_low: pd.Series,
        price_position: pd.Series,
    ) -> pd.Series:
        formulas = self.config.feature_formulas
        output = ((price_position - formulas.donchian_midpoint) * formulas.donchian_position_scale).clip(-100.0, 100.0)
        output = output.mask((prior_high.notna()) & (close > prior_high), formulas.donchian_breakout_value)
        output = output.mask((prior_low.notna()) & (close < prior_low), -formulas.donchian_breakout_value)
        return output.where(~price_position.isna(), np.nan)

    def _breakout_volume_support_series(
        self,
        bull_breakout: pd.Series,
        bear_breakdown: pd.Series,
        volume_ratio: pd.Series,
    ) -> pd.Series:
        formulas = self.config.feature_formulas
        normalized = series_normalize_signed(
            volume_ratio - formulas.breakout_volume_ratio_center,
            formulas.breakout_volume_ratio_scale,
        )
        output = pd.Series(0.0, index=volume_ratio.index)
        output = output.mask(bull_breakout, normalized.clip(lower=0.0))
        output = output.mask(bear_breakdown, (-normalized).clip(upper=0.0))
        return output.where(~volume_ratio.isna(), np.nan)

    def _macd_momentum_fade_series(
        self,
        trend_bias: pd.Series,
        macd_hist: pd.Series,
        macd_hist_slope: pd.Series,
    ) -> pd.Series:
        formulas = self.config.feature_formulas
        baseline = macd_hist.abs().clip(lower=formulas.macd_momentum_fade_min_hist_abs)
        fade = (macd_hist_slope.abs().div(baseline) * formulas.macd_momentum_fade_scale).clip(0.0, 100.0)
        fading_bull = (trend_bias > 0) & (macd_hist > 0) & (macd_hist_slope < 0)
        fading_bear = (trend_bias < 0) & (macd_hist < 0) & (macd_hist_slope > 0)
        output = pd.Series(0.0, index=trend_bias.index)
        output = output.mask(fading_bull | fading_bear, fade)
        invalid = trend_bias.isna() | macd_hist.isna() | macd_hist_slope.isna()
        return output.where(~invalid, 0.0)

    def _adx_rollover_series(self, adx_current: pd.Series, adx_previous: pd.Series) -> pd.Series:
        formulas = self.config.feature_formulas
        drop = ((adx_previous - adx_current) * formulas.adx_rollover_scale).clip(lower=0.0, upper=100.0)
        output = drop.where(adx_current < adx_previous, 0.0)
        invalid = adx_current.isna() | adx_previous.isna()
        return output.where(~invalid, 0.0)

    @staticmethod
    def _failed_breakout_series(
        recent_breakouts: pd.Series,
        latest_close: pd.Series,
        prior_high: pd.Series,
        ema20: pd.Series,
        lookback: int,
    ) -> pd.Series:
        recent_any = recent_breakouts.fillna(False).rolling(window=lookback, min_periods=1).max().astype(bool)
        output = (
            recent_any
            & prior_high.notna()
            & ema20.notna()
            & (latest_close < prior_high)
            & (latest_close < ema20)
        ).astype(float)
        return output

    @staticmethod
    def _failed_breakdown_series(
        recent_breakdowns: pd.Series,
        latest_close: pd.Series,
        prior_low: pd.Series,
        ema20: pd.Series,
        lookback: int,
    ) -> pd.Series:
        recent_any = recent_breakdowns.fillna(False).rolling(window=lookback, min_periods=1).max().astype(bool)
        output = (
            recent_any
            & prior_low.notna()
            & ema20.notna()
            & (latest_close > prior_low)
            & (latest_close > ema20)
        ).astype(float)
        return output

    def _hostile_volatility_spike_series(
        self,
        atr_regime: pd.Series,
        trend_bias: pd.Series,
        candle_open: pd.Series,
        candle_close: pd.Series,
    ) -> pd.Series:
        thresholds = self.config.feature_thresholds
        formulas = self.config.feature_formulas
        against_trend = ((trend_bias > 0) & (candle_close < candle_open)) | (
            (trend_bias < 0) & (candle_close > candle_open)
        )
        spike = ((atr_regime - thresholds.hostile_volatility_ratio) * formulas.hostile_volatility_scale).clip(0.0, 100.0)
        output = spike.where((trend_bias != 0) & against_trend & (atr_regime >= thresholds.hostile_volatility_ratio), 0.0)
        return output.where(~atr_regime.isna(), 0.0)

    def _momentum_divergence_proxy_series(
        self,
        trend_bias: pd.Series,
        price_position: pd.Series,
        rsi_slope: pd.Series,
        macd_hist_slope: pd.Series,
    ) -> pd.Series:
        thresholds = self.config.feature_thresholds
        formulas = self.config.feature_formulas
        divergence_strength = (
            rsi_slope.abs() * formulas.momentum_divergence_rsi_scale
            + macd_hist_slope.abs() * formulas.momentum_divergence_macd_scale
        ).clip(0.0, 100.0)
        bullish_divergence = (
            (trend_bias > 0)
            & (price_position >= thresholds.price_range_position_high)
            & (rsi_slope < 0)
            & (macd_hist_slope < 0)
        )
        bearish_divergence = (
            (trend_bias < 0)
            & (price_position <= thresholds.price_range_position_low)
            & (rsi_slope > 0)
            & (macd_hist_slope > 0)
        )
        output = pd.Series(0.0, index=trend_bias.index)
        output = output.mask(bullish_divergence | bearish_divergence, divergence_strength)
        invalid = trend_bias.isna() | price_position.isna() | rsi_slope.isna() | macd_hist_slope.isna()
        return output.where(~invalid, 0.0)

    def _exhaustion_flag_series(
        self,
        trend_bias: pd.Series,
        rsi: pd.Series,
        overextension_ema20_atr: pd.Series,
        macd_momentum_fade: pd.Series,
    ) -> pd.Series:
        thresholds = self.config.feature_thresholds
        bullish = (
            (trend_bias > 0)
            & (rsi >= thresholds.rsi_overbought)
            & (overextension_ema20_atr >= thresholds.overextension_warn_atr)
            & (macd_momentum_fade > 0)
        )
        bearish = (
            (trend_bias < 0)
            & (rsi <= thresholds.rsi_oversold)
            & (overextension_ema20_atr <= -thresholds.overextension_warn_atr)
            & (macd_momentum_fade > 0)
        )
        return (bullish | bearish).astype(float)
