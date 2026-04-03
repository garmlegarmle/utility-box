"""Configuration objects for the trend analysis engine."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields, is_dataclass
from typing import Any


@dataclass(slots=True)
class DataConfig:
    """Input validation and rolling analysis settings."""

    required_columns: tuple[str, ...] = ("open", "high", "low", "close", "volume")
    max_bars: int = 200
    min_bars: int = 60
    dedupe_keep: str = "last"


@dataclass(slots=True)
class IndicatorConfig:
    """Lookbacks for raw indicator calculations."""

    ema_fast: int = 20
    ema_slow: int = 50
    sma_long: int = 200
    ichimoku_tenkan_length: int = 9
    ichimoku_kijun_length: int = 26
    ichimoku_span_b_length: int = 52
    regression_window: int = 50
    macd_fast: int = 12
    macd_slow: int = 26
    macd_signal: int = 9
    adx_length: int = 14
    rsi_length: int = 14
    roc_length: int = 10
    atr_length: int = 14
    bb_length: int = 20
    bb_std: float = 2.0
    donchian_length: int = 20
    volume_average_length: int = 20
    obv_slope_window: int = 20
    bb_percentile_window: int = 60
    slope_change_window: int = 5
    macd_hist_slope_window: int = 3
    persistence_window: int = 20
    breakout_signal_lookback: int = 5
    hostile_vol_window: int = 20


@dataclass(slots=True)
class FeatureThresholdConfig:
    """Thresholds that convert raw indicators into interpretable features."""

    adx_trending: float = 20.0
    adx_strong: float = 35.0
    rsi_bullish: float = 55.0
    rsi_bearish: float = 45.0
    rsi_overbought: float = 70.0
    rsi_oversold: float = 30.0
    volume_confirm_ratio: float = 1.20
    volume_weak_ratio: float = 0.90
    bb_squeeze_percentile: float = 0.25
    bb_expansion_percentile: float = 0.75
    overextension_warn_atr: float = 2.0
    overextension_extreme_atr: float = 3.0
    hostile_volatility_ratio: float = 1.50
    breakout_close_buffer: float = 0.002
    price_range_position_high: float = 0.80
    price_range_position_low: float = 0.20
    neutral_score_epsilon: float = 10.0


@dataclass(slots=True)
class FeatureFormulaConfig:
    """Constants used while deriving interpretable features from indicators."""

    bb_width_median_min_periods: int = 20
    atr_pct_median_min_periods: int = 10
    rsi_neutral: float = 50.0
    rsi_zone_multiplier: float = 2.5
    trend_bias_ema_alignment_weight: float = 0.25
    trend_bias_di_spread_weight: float = 0.20
    trend_bias_macd_weight: float = 0.20
    trend_bias_cloud_position_weight: float = 0.20
    trend_bias_tenkan_kijun_weight: float = 0.15
    ema_alignment_partial_value: float = 60.0
    ema_alignment_full_value: float = 100.0
    macd_state_partial_value: float = 50.0
    macd_state_full_value: float = 100.0
    ichimoku_state_partial_value: float = 60.0
    ichimoku_state_full_value: float = 100.0
    ichimoku_inside_cloud_value: float = 20.0
    donchian_breakout_value: float = 100.0
    donchian_midpoint: float = 0.50
    donchian_position_scale: float = 200.0
    breakout_volume_ratio_center: float = 1.0
    breakout_volume_ratio_scale: float = 0.5
    macd_momentum_fade_scale: float = 50.0
    macd_momentum_fade_min_hist_abs: float = 1e-6
    adx_rollover_scale: float = 4.0
    hostile_volatility_scale: float = 100.0
    momentum_divergence_rsi_scale: float = 3.0
    momentum_divergence_macd_scale: float = 20.0


@dataclass(slots=True)
class CategoryWeightConfig:
    """Feature weights inside each scoring category."""

    trend_direction: dict[str, float] = field(
        default_factory=lambda: {
            "close_vs_ema20": 0.10,
            "close_vs_ema50": 0.10,
            "close_vs_sma200": 0.12,
            "ema_alignment_state": 0.12,
            "close_vs_kijun": 0.12,
            "tenkan_kijun_state": 0.12,
            "cloud_position_state": 0.12,
            "linear_regression_slope_50": 0.10,
            "di_spread_norm": 0.10,
        }
    )
    trend_strength: dict[str, float] = field(
        default_factory=lambda: {
            "adx_regime": 0.40,
            "trend_persistence_20": 0.20,
            "breakout_persistence": 0.20,
            "di_spread_norm": 0.10,
            "cloud_thickness_norm": 0.10,
        }
    )
    momentum: dict[str, float] = field(
        default_factory=lambda: {
            "rsi_zone_score": 0.40,
            "rsi_slope_5": 0.10,
            "macd_state": 0.30,
            "macd_hist_slope_3": 0.20,
        }
    )
    volatility_regime: dict[str, float] = field(
        default_factory=lambda: {
            "bb_width_relative": 0.30,
            "atr_regime": 0.25,
            "squeeze_flag": 0.15,
            "expansion_flag": 0.15,
            "donchian_breakout_context": 0.15,
        }
    )
    volume_confirmation: dict[str, float] = field(
        default_factory=lambda: {
            "volume_ratio_20": 0.40,
            "obv_slope_20": 0.35,
            "breakout_volume_support": 0.25,
        }
    )
    transition_risk: dict[str, float] = field(
        default_factory=lambda: {
            "overextension_ema20_atr": 0.18,
            "macd_momentum_fade": 0.18,
            "adx_rollover": 0.12,
            "failed_breakout_flag": 0.14,
            "failed_breakdown_flag": 0.14,
            "hostile_volatility_spike": 0.07,
            "exhaustion_flag": 0.12,
            "overextension_ema50_atr": 0.05,
        }
    )


@dataclass(slots=True)
class CompositeWeightConfig:
    """Category weights for final regime classification."""

    direction: float = 0.40
    signed_strength: float = 0.20
    momentum: float = 0.20
    volatility: float = 0.10
    volume: float = 0.10


@dataclass(slots=True)
class NormalizationConfig:
    """Scales and bounds used to normalize features into component scores."""

    direction_close_vs_ema20_scale: float = 5.0
    direction_close_vs_ema50_scale: float = 8.0
    direction_close_vs_sma200_scale: float = 12.0
    direction_close_vs_kijun_scale: float = 6.0
    direction_ema20_slope_scale: float = 2.0
    direction_ema50_slope_scale: float = 1.5
    direction_regression_slope_scale: float = 0.15
    strength_adx_high: float = 45.0
    strength_breakout_persistence_scale: float = 5.0
    strength_ema20_slope_scale: float = 2.0
    strength_ema50_slope_scale: float = 1.5
    strength_cloud_thickness_scale: float = 4.0
    momentum_rsi_slope_scale: float = 10.0
    momentum_roc_scale: float = 10.0
    momentum_macd_hist_slope_scale: float = 1.0
    volatility_bb_width_center: float = 1.0
    volatility_bb_width_scale: float = 0.5
    volatility_atr_low_cutoff: float = 0.7
    volatility_atr_mid_cutoff: float = 1.6
    volatility_atr_high_cap: float = 2.6
    volatility_atr_compression_max: float = 0.5
    volatility_squeeze_score: float = 40.0
    volatility_expansion_score: float = 40.0
    volatility_context_bias_neutral: float = 0.5
    volatility_context_signal_neutral: float = 5.0
    volatility_context_misaligned_multiplier: float = 0.5
    volume_ratio_center: float = 1.0
    volume_ratio_scale: float = 0.5
    obv_slope_scale: float = 0.5
    transition_ema20_extreme_buffer: float = 1.0
    transition_ema50_warn_offset: float = 0.5
    transition_ema50_extreme_offset: float = 1.5
    transition_warning_count_low: float = 1.0
    transition_warning_count_high: float = 5.0


@dataclass(slots=True)
class ClassifierConfig:
    """Label thresholds and composite sign handling."""

    strong_uptrend_threshold: float = 55.0
    weak_uptrend_threshold: float = 20.0
    weak_downtrend_threshold: float = -20.0
    strong_downtrend_threshold: float = -55.0
    strong_direction_threshold: float = 40.0
    strong_strength_threshold: float = 60.0
    sideways_strength_max: float = 35.0
    sideways_requires_neutral_composite_and_low_strength: bool = True
    transition_low_max: float = 34.0
    transition_moderate_max: float = 64.0
    composite_sign_neutral_threshold: float = 10.0


@dataclass(slots=True)
class AgreementConfig:
    """Thresholds for cross-category agreement calculations."""

    fallback_composite_neutral_threshold: float = 5.0
    score_signal_neutral_threshold: float = 10.0
    structure_signal_neutral_threshold: float = 5.0
    default_agreement_score: float = 50.0


@dataclass(slots=True)
class ConfidenceConfig:
    """Weights and thresholds for confidence estimation."""

    composite_abs_weight: float = 0.45
    strength_weight: float = 0.25
    coverage_weight: float = 0.20
    agreement_weight: float = 0.10
    transition_penalty_weight: float = 0.35


@dataclass(slots=True)
class TagConfig:
    """Thresholds that drive regime tags and summary tone."""

    reversal_risk_rising_threshold: float = 60.0
    breakout_watch_direction_max: float = 40.0
    breakout_watch_momentum_min: float = 15.0
    breakout_watch_direction_min: float = 15.0
    breakout_watch_context_min: float = 20.0
    exhaustion_transition_min: float = 45.0
    volume_unconfirmed_direction_min: float = 40.0
    volume_unconfirmed_volume_abs_max: float = 15.0
    trend_accelerating_signal_neutral: float = 10.0
    trend_accelerating_strength_min: float = 55.0
    trend_accelerating_macd_hist_neutral: float = 0.05
    trend_weakening_persistence_abs_max: float = 40.0
    summary_momentum_positive_min: float = 25.0
    summary_momentum_negative_max: float = -25.0
    summary_strength_healthy_min: float = 60.0
    summary_strength_limited_max: float = 35.0


@dataclass(slots=True)
class SummaryConfig:
    """Language and templates for the natural-language summary."""

    language: str = "en"
    regime_text: dict[str, str] = field(
        default_factory=lambda: {
            "strong_uptrend": "strong uptrend",
            "weak_uptrend": "weak uptrend",
            "sideways": "sideways market",
            "weak_downtrend": "weak downtrend",
            "strong_downtrend": "strong downtrend",
        }
    )
    transition_text: dict[str, str] = field(
        default_factory=lambda: {
            "low": "low",
            "moderate": "moderate",
            "high": "high",
        }
    )


@dataclass(slots=True)
class PatternConfig:
    """Thresholds and lookbacks used by the chart pattern analyzer."""

    analysis_window_bars: int = 140
    pivot_span: int = 3
    pivot_lookback_bars: int = 90
    min_candidate_score: float = 35.0
    top_candidates: int = 2
    price_similarity_tolerance_pct: float = 2.5
    shoulder_tolerance_pct: float = 4.0
    neckline_break_buffer_pct: float = 0.4
    breakout_buffer_pct: float = 0.3
    breakout_lookback_bars: int = 20
    flag_pole_bars: int = 20
    flag_window_min: int = 6
    flag_window_max: int = 15
    triangle_window: int = 24
    range_window: int = 20
    squeeze_window: int = 40
    rounded_window: int = 60
    volume_surge_ratio: float = 1.5
    volume_dryup_ratio: float = 0.8
    climax_volume_ratio: float = 2.0
    wide_range_bar_ratio: float = 1.8
    gap_atr_threshold: float = 0.6
    vcp_pullback_tolerance: float = 0.12
    candle_body_doji_ratio: float = 0.12
    candle_long_wick_ratio: float = 0.55


@dataclass(slots=True)
class EngineConfig:
    """Top-level configuration container.

    This object is intentionally serializable with :func:`dataclasses.asdict`
    so a future rolling optimizer can iterate over parameter grids without
    changing the analysis engine interface.
    """

    data: DataConfig = field(default_factory=DataConfig)
    indicators: IndicatorConfig = field(default_factory=IndicatorConfig)
    feature_thresholds: FeatureThresholdConfig = field(default_factory=FeatureThresholdConfig)
    feature_formulas: FeatureFormulaConfig = field(default_factory=FeatureFormulaConfig)
    category_weights: CategoryWeightConfig = field(default_factory=CategoryWeightConfig)
    composite_weights: CompositeWeightConfig = field(default_factory=CompositeWeightConfig)
    normalization: NormalizationConfig = field(default_factory=NormalizationConfig)
    classifier: ClassifierConfig = field(default_factory=ClassifierConfig)
    agreement: AgreementConfig = field(default_factory=AgreementConfig)
    confidence: ConfidenceConfig = field(default_factory=ConfidenceConfig)
    tags: TagConfig = field(default_factory=TagConfig)
    summary: SummaryConfig = field(default_factory=SummaryConfig)
    patterns: PatternConfig = field(default_factory=PatternConfig)

    def to_dict(self) -> dict[str, object]:
        """Return a nested plain dictionary for inspection or future optimization."""

        return asdict(self)

    def flatten(self) -> dict[str, Any]:
        """Return a dot-notated flat parameter map for optimizers.

        Example key: ``indicators.ema_fast``.
        """

        flattened: dict[str, Any] = {}

        def _flatten(prefix: str, value: Any) -> None:
            if isinstance(value, dict):
                for child_key, child_value in value.items():
                    next_prefix = f"{prefix}.{child_key}" if prefix else str(child_key)
                    _flatten(next_prefix, child_value)
                return
            flattened[prefix] = value

        nested = self.to_dict()
        for key, value in nested.items():
            _flatten(key, value)
        return flattened

    def with_overrides(self, overrides: dict[str, Any]) -> EngineConfig:
        """Return a new config with nested overrides applied.

        This is intended for future parameter optimizers that want to clone a
        base config and modify only a small subset of keys per trial.
        """

        return _apply_overrides(self, overrides)

    @classmethod
    def from_dict(cls, values: dict[str, Any]) -> EngineConfig:
        """Construct a config from a nested dictionary."""

        return _apply_overrides(cls(), values)


def _apply_overrides(instance: Any, overrides: dict[str, Any]) -> Any:
    if not is_dataclass(instance):
        raise TypeError("Overrides can only be applied to dataclass instances.")

    payload: dict[str, Any] = {}
    for field_info in fields(instance):
        current_value = getattr(instance, field_info.name)
        if field_info.name not in overrides:
            payload[field_info.name] = current_value
            continue

        override_value = overrides[field_info.name]
        if is_dataclass(current_value) and isinstance(override_value, dict):
            payload[field_info.name] = _apply_overrides(current_value, override_value)
        else:
            payload[field_info.name] = override_value
    return instance.__class__(**payload)
