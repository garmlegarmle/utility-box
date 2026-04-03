"""Configuration for the chart interpretation engine."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class PreprocessConfig:
    """Input cleaning and normalization settings."""

    required_columns: tuple[str, ...] = ("open", "high", "low", "close", "volume")
    timestamp_aliases: tuple[str, ...] = ("timestamp", "date", "datetime", "time")
    min_rows: int = 260
    outlier_window: int = 20
    outlier_range_multiple: float = 8.0
    dedupe_keep: str = "last"


@dataclass(slots=True)
class TrendConfig:
    """Trend engine settings."""

    ema_fast: int = 20
    ema_medium: int = 50
    ema_slow: int = 200
    ichimoku_tenkan: int = 9
    ichimoku_kijun: int = 26
    ichimoku_senkou_b: int = 52
    ichimoku_cloud_proximity_atr: float = 0.80
    regression_windows: tuple[int, int] = (20, 50)
    adx_length: int = 14
    efficiency_window: int = 20
    higher_timeframe_rule: str = "W-FRI"


@dataclass(slots=True)
class SwingScaleConfig:
    """One swing scale configuration."""

    name: str
    left_bars: int
    right_bars: int
    atr_multiple: float


@dataclass(slots=True)
class SwingConfig:
    """Multi-scale swing detection settings."""

    scales: tuple[SwingScaleConfig, ...] = (
        SwingScaleConfig("short", 2, 2, 0.45),
        SwingScaleConfig("medium", 4, 4, 0.8),
        SwingScaleConfig("major", 7, 7, 1.2),
    )
    max_points_per_scale: int = 40


@dataclass(slots=True)
class StructureConfig:
    """Market-structure interpretation settings."""

    recent_swings: int = 8
    bos_atr_buffer: float = 0.20
    compression_amplitude_ratio: float = 0.78
    range_tolerance_pct: float = 2.0


@dataclass(slots=True)
class ZoneConfig:
    """Zone building and location settings."""

    zone_half_atr: float = 0.35
    merge_distance_atr: float = 0.60
    price_bin_count: int = 24
    recent_box_bars: int = 20
    location_threshold_atr: float = 0.60
    overextended_atr: float = 2.4
    visible_zones_per_side: int = 1


@dataclass(slots=True)
class PatternConfig:
    """Rule-based pattern settings."""

    double_tolerance_pct: float = 1.5
    triangle_flat_tolerance_pct: float = 0.8
    breakout_buffer_atr: float = 0.20
    retest_window_bars: int = 10
    pullback_atr_tolerance: float = 1.0
    vcp_window_bars: int = 40
    range_box_bars: int = 28
    flag_window_bars: int = 30
    wedge_window_bars: int = 36
    min_pattern_confidence: float = 0.42
    stale_pattern_freshness: float = 0.35
    freshness_bars: int = 15


@dataclass(slots=True)
class ConfirmationConfig:
    """Indicator confirmation settings."""

    rsi_length: int = 14
    divergence_lookback_swings: int = 3
    volume_expansion_ratio: float = 1.30
    breakout_close_percentile: float = 0.75
    candlestick_signal_min_confidence: float = 0.55
    candlestick_lookback_bars: int = 3


@dataclass(slots=True)
class EventConfig:
    """Event timeline settings."""

    recent_bars: int = 30
    max_events: int = 12


@dataclass(slots=True)
class ScenarioConfig:
    """Scenario engine settings."""

    projection_horizon_bars: int = 20
    analog_lookback_bars: int = 30
    analog_candidates: int = 5
    min_analog_history_bars: int = 220


@dataclass(slots=True)
class NarrativeConfig:
    """Narrative style settings."""

    use_pop_culture_analogies: bool = True
    use_dry_analyst_tone: bool = True


@dataclass(slots=True)
class RenderConfig:
    """Chart rendering settings."""

    history_bars: int = 180
    chart_display_bars: int = 100
    min_display_bars: int = 80
    max_display_bars: int = 160
    extend_window_for_active_pattern: bool = True
    show_debug_json: bool = False
    show_ema: bool = True
    show_ichimoku: str = "always"
    show_macd: bool = True
    show_candlestick_signals: bool = True
    show_pattern_lines: bool = True
    show_trendlines: bool = True
    show_structure_levels: bool = True
    show_projection: bool = True
    max_patterns_displayed: int = 1
    max_drawn_patterns: int = 1
    max_drawn_zones: int = 2
    projection_bars: int = 20
    dpi: int = 150
    figure_width: float = 16.0
    figure_height: float = 10.0


@dataclass(slots=True)
class ChartInterpretationConfig:
    """Top-level config for the chart interpretation system."""

    preprocess: PreprocessConfig = field(default_factory=PreprocessConfig)
    trend: TrendConfig = field(default_factory=TrendConfig)
    swings: SwingConfig = field(default_factory=SwingConfig)
    structure: StructureConfig = field(default_factory=StructureConfig)
    zones: ZoneConfig = field(default_factory=ZoneConfig)
    patterns: PatternConfig = field(default_factory=PatternConfig)
    confirmations: ConfirmationConfig = field(default_factory=ConfirmationConfig)
    events: EventConfig = field(default_factory=EventConfig)
    scenarios: ScenarioConfig = field(default_factory=ScenarioConfig)
    narrative: NarrativeConfig = field(default_factory=NarrativeConfig)
    render: RenderConfig = field(default_factory=RenderConfig)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
