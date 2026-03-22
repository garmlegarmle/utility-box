"""Transparent category scoring for the trend analysis engine."""

from __future__ import annotations

from typing import Any, Callable

from .config import EngineConfig
from .models import ComponentScores, FeatureSnapshot, ScoreDetail
from .utils import clamp, normalize_positive, normalize_signed, sign


Normalizer = Callable[[str, Any, dict[str, Any]], float]


class ScoringEngine:
    """Compute capped, interpretable component scores from derived features."""

    def __init__(self, config: EngineConfig) -> None:
        self.config = config

    def score(self, feature_snapshot: FeatureSnapshot) -> ComponentScores:
        """Score every category and compute the composite trend score."""

        return self.score_values(feature_snapshot.values)

    def score_values(self, features: dict[str, Any]) -> ComponentScores:
        """Score a plain feature mapping without wrapping it as a snapshot."""

        category_weights = self.config.category_weights

        trend_direction = self._aggregate_signed_score(
            features,
            category_weights.trend_direction,
            self._normalize_direction_feature,
        )
        trend_strength = self._aggregate_positive_score(
            features,
            category_weights.trend_strength,
            self._normalize_strength_feature,
        )
        momentum = self._aggregate_signed_score(
            features,
            category_weights.momentum,
            self._normalize_momentum_feature,
        )
        volatility_regime = self._aggregate_signed_score(
            features,
            category_weights.volatility_regime,
            self._normalize_volatility_feature,
        )
        volume_confirmation = self._aggregate_signed_score(
            features,
            category_weights.volume_confirmation,
            self._normalize_volume_feature,
        )
        transition_risk = self._aggregate_positive_score(
            features,
            category_weights.transition_risk,
            self._normalize_transition_feature,
        )

        composite_weights = self.config.composite_weights
        direction_sign = sign(
            trend_direction.score,
            neutral_threshold=self.config.classifier.composite_sign_neutral_threshold,
        )
        signed_strength = trend_strength.score * direction_sign if direction_sign != 0 else 0.0
        composite_trend_score = clamp(
            (composite_weights.direction * trend_direction.score)
            + (composite_weights.signed_strength * signed_strength)
            + (composite_weights.momentum * momentum.score)
            + (composite_weights.volatility * volatility_regime.score)
            + (composite_weights.volume * volume_confirmation.score),
            -100.0,
            100.0,
        )

        return ComponentScores(
            trend_direction=trend_direction,
            trend_strength=trend_strength,
            momentum=momentum,
            volatility_regime=volatility_regime,
            volume_confirmation=volume_confirmation,
            transition_risk=transition_risk,
            composite_trend_score=composite_trend_score,
            signed_strength=signed_strength,
        )

    def _aggregate_signed_score(
        self,
        features: dict[str, Any],
        weights: dict[str, float],
        normalizer: Normalizer,
    ) -> ScoreDetail:
        contributions: dict[str, float] = {}
        missing_features: list[str] = []
        weighted_sum = 0.0
        available_weight = 0.0
        total_weight = sum(weights.values())

        for feature_name, weight in weights.items():
            value = features.get(feature_name)
            if value is None:
                missing_features.append(feature_name)
                continue
            normalized = normalizer(feature_name, value, features)
            contributions[feature_name] = round(normalized * weight, 4)
            weighted_sum += normalized * weight
            available_weight += weight

        score = clamp(weighted_sum / available_weight, -100.0, 100.0) if available_weight else 0.0
        return ScoreDetail(
            score=score,
            contributions=contributions,
            available_weight=available_weight,
            total_weight=total_weight,
            missing_features=missing_features,
        )

    def _aggregate_positive_score(
        self,
        features: dict[str, Any],
        weights: dict[str, float],
        normalizer: Normalizer,
    ) -> ScoreDetail:
        contributions: dict[str, float] = {}
        missing_features: list[str] = []
        weighted_sum = 0.0
        available_weight = 0.0
        total_weight = sum(weights.values())

        for feature_name, weight in weights.items():
            value = features.get(feature_name)
            if value is None:
                missing_features.append(feature_name)
                continue
            normalized = normalizer(feature_name, value, features)
            contributions[feature_name] = round(normalized * weight, 4)
            weighted_sum += normalized * weight
            available_weight += weight

        score = clamp(weighted_sum / available_weight, 0.0, 100.0) if available_weight else 0.0
        return ScoreDetail(
            score=score,
            contributions=contributions,
            available_weight=available_weight,
            total_weight=total_weight,
            missing_features=missing_features,
        )

    def _normalize_direction_feature(self, name: str, value: Any, _: dict[str, Any]) -> float:
        normalization = self.config.normalization
        if name == "close_vs_ema20":
            return normalize_signed(float(value), normalization.direction_close_vs_ema20_scale)
        if name == "close_vs_ema50":
            return normalize_signed(float(value), normalization.direction_close_vs_ema50_scale)
        if name == "close_vs_sma200":
            return normalize_signed(float(value), normalization.direction_close_vs_sma200_scale)
        if name == "close_vs_kijun":
            return normalize_signed(float(value), normalization.direction_close_vs_kijun_scale)
        if name == "ema_alignment_state":
            return clamp(float(value), -100.0, 100.0)
        if name == "tenkan_kijun_state":
            return clamp(float(value), -100.0, 100.0)
        if name == "cloud_position_state":
            return clamp(float(value), -100.0, 100.0)
        if name == "ema20_slope_norm":
            return normalize_signed(float(value), normalization.direction_ema20_slope_scale)
        if name == "ema50_slope_norm":
            return normalize_signed(float(value), normalization.direction_ema50_slope_scale)
        if name == "linear_regression_slope_50":
            return normalize_signed(float(value), normalization.direction_regression_slope_scale)
        if name == "di_spread_norm":
            return clamp(float(value), -100.0, 100.0)
        return 0.0

    def _normalize_strength_feature(self, name: str, value: Any, _: dict[str, Any]) -> float:
        thresholds = self.config.feature_thresholds
        normalization = self.config.normalization
        if name == "adx_regime":
            return normalize_positive(float(value), thresholds.adx_trending, normalization.strength_adx_high)
        if name == "trend_persistence_20":
            return clamp(abs(float(value)), 0.0, 100.0)
        if name == "breakout_persistence":
            return clamp(
                abs(float(value)) / normalization.strength_breakout_persistence_scale * 100.0,
                0.0,
                100.0,
            )
        if name == "cloud_thickness_norm":
            return clamp(float(value) / normalization.strength_cloud_thickness_scale * 100.0, 0.0, 100.0)
        if name == "ema20_slope_norm":
            return clamp(abs(float(value)) / normalization.strength_ema20_slope_scale * 100.0, 0.0, 100.0)
        if name == "ema50_slope_norm":
            return clamp(abs(float(value)) / normalization.strength_ema50_slope_scale * 100.0, 0.0, 100.0)
        if name == "di_spread_norm":
            return clamp(abs(float(value)), 0.0, 100.0)
        return 0.0

    def _normalize_momentum_feature(self, name: str, value: Any, _: dict[str, Any]) -> float:
        normalization = self.config.normalization
        if name == "rsi_zone_score":
            return clamp(float(value), -100.0, 100.0)
        if name == "rsi_slope_5":
            return normalize_signed(float(value), normalization.momentum_rsi_slope_scale)
        if name == "roc10_norm":
            return normalize_signed(float(value), normalization.momentum_roc_scale)
        if name == "macd_state":
            return clamp(float(value), -100.0, 100.0)
        if name == "macd_hist_slope_3":
            return normalize_signed(float(value), normalization.momentum_macd_hist_slope_scale)
        return 0.0

    def _normalize_volatility_feature(self, name: str, value: Any, features: dict[str, Any]) -> float:
        normalization = self.config.normalization
        if name == "bb_width_relative":
            return normalize_signed(
                float(value) - normalization.volatility_bb_width_center,
                normalization.volatility_bb_width_scale,
            )
        if name == "atr_regime":
            atr_regime = float(value)
            if atr_regime < normalization.volatility_atr_low_cutoff:
                return -normalize_positive(
                    normalization.volatility_atr_low_cutoff - atr_regime,
                    0.0,
                    normalization.volatility_atr_compression_max,
                )
            if atr_regime <= normalization.volatility_atr_mid_cutoff:
                return normalize_positive(
                    atr_regime,
                    normalization.volatility_atr_low_cutoff,
                    normalization.volatility_atr_mid_cutoff,
                )
            return -normalize_positive(
                atr_regime,
                normalization.volatility_atr_mid_cutoff,
                normalization.volatility_atr_high_cap,
            )
        if name == "squeeze_flag":
            return -normalization.volatility_squeeze_score * float(value)
        if name == "expansion_flag":
            return normalization.volatility_expansion_score * float(value)
        if name == "donchian_breakout_context":
            bias = sign(
                float(features.get("directional_bias", 0.0)),
                neutral_threshold=normalization.volatility_context_bias_neutral,
            )
            context_value = float(value)
            if bias != 0 and sign(context_value, neutral_threshold=normalization.volatility_context_signal_neutral) == bias:
                return clamp(context_value, -100.0, 100.0)
            return clamp(context_value * normalization.volatility_context_misaligned_multiplier, -100.0, 100.0)
        return 0.0

    def _normalize_volume_feature(self, name: str, value: Any, features: dict[str, Any]) -> float:
        normalization = self.config.normalization
        trend_bias = sign(
            float(features.get("directional_bias", 0.0)),
            neutral_threshold=normalization.volatility_context_bias_neutral,
        )
        if name == "volume_ratio_20":
            if trend_bias == 0:
                return 0.0
            return normalize_signed(
                (float(value) - normalization.volume_ratio_center) * trend_bias,
                normalization.volume_ratio_scale,
            )
        if name == "obv_slope_20":
            return normalize_signed(float(value), normalization.obv_slope_scale)
        if name == "breakout_volume_support":
            return clamp(float(value), -100.0, 100.0)
        return 0.0

    def _normalize_transition_feature(self, name: str, value: Any, _: dict[str, Any]) -> float:
        thresholds = self.config.feature_thresholds
        normalization = self.config.normalization
        if name == "overextension_ema20_atr":
            return normalize_positive(
                abs(float(value)),
                thresholds.overextension_warn_atr,
                thresholds.overextension_extreme_atr + normalization.transition_ema20_extreme_buffer,
            )
        if name == "overextension_ema50_atr":
            return normalize_positive(
                abs(float(value)),
                thresholds.overextension_warn_atr + normalization.transition_ema50_warn_offset,
                thresholds.overextension_extreme_atr + normalization.transition_ema50_extreme_offset,
            )
        if name == "macd_momentum_fade":
            return clamp(float(value), 0.0, 100.0)
        if name == "adx_rollover":
            return clamp(float(value), 0.0, 100.0)
        if name == "failed_breakout_flag":
            return 100.0 if float(value) > 0 else 0.0
        if name == "failed_breakdown_flag":
            return 100.0 if float(value) > 0 else 0.0
        if name == "hostile_volatility_spike":
            return clamp(float(value), 0.0, 100.0)
        if name == "exhaustion_flag":
            return 100.0 if float(value) > 0 else 0.0
        if name == "reversal_warning_count":
            return normalize_positive(
                float(value),
                normalization.transition_warning_count_low,
                normalization.transition_warning_count_high,
            )
        if name == "momentum_divergence_proxy":
            return clamp(float(value), 0.0, 100.0)
        return 0.0
