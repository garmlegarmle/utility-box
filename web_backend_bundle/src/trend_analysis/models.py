"""Dataclasses used across the trend analysis engine."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class FeatureSnapshot:
    """Interpretable feature values derived from raw indicators."""

    values: dict[str, Any]
    coverage_ratio: float
    available_features: int
    total_features: int
    missing_features: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ScoreDetail:
    """Detailed score output for one category."""

    score: float
    contributions: dict[str, float]
    available_weight: float
    total_weight: float
    missing_features: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ComponentScores:
    """Category-level score bundle."""

    trend_direction: ScoreDetail
    trend_strength: ScoreDetail
    momentum: ScoreDetail
    volatility_regime: ScoreDetail
    volume_confirmation: ScoreDetail
    transition_risk: ScoreDetail
    composite_trend_score: float
    signed_strength: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class PatternCandidate:
    """One scored chart-pattern hypothesis."""

    pattern_name: str
    category: str
    direction_bias: str
    score: float
    interpretation_ko: str
    likely_outcome_ko: str
    invalidation_ko: str
    evidence: list[str] = field(default_factory=list)
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class PatternAnalysisResult:
    """Top-ranked pattern candidates and natural-language interpretation."""

    as_of_date: datetime
    summary_text_ko: str
    candidates: list[PatternCandidate] = field(default_factory=list)
    primary_candidate: PatternCandidate | None = None
    secondary_candidate: PatternCandidate | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["as_of_date"] = self.as_of_date.isoformat()
        return payload


@dataclass(slots=True)
class OverlayShape:
    """Drawable overlay shape in bar-index / price coordinates."""

    shape_type: str
    label: str
    points: list[tuple[float, float]] = field(default_factory=list)
    color: str = "#2563eb"
    style: str = "solid"
    width: float = 1.8
    alpha: float = 0.95

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ImageChartAnalysisResult:
    """Analysis result derived from a chart screenshot or uploaded chart image."""

    source_image_path: str
    annotated_image_path: str | None
    extracted_bars: int
    extraction_confidence: float
    chart_bbox: tuple[int, int, int, int]
    trend_result: TrendAnalysisResult
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["trend_result"] = self.trend_result.to_dict()
        return payload


@dataclass(slots=True)
class TrendAnalysisResult:
    """Structured current-state market diagnosis."""

    as_of_date: datetime
    regime_label: str
    trend_state_label: str
    bullish_score: float
    bearish_score: float
    confidence_score: float
    transition_risk_score: float
    transition_risk_label: str
    trend_direction_score: float
    trend_strength_score: float
    momentum_score: float
    volatility_regime_score: float
    volume_confirmation_score: float
    tags: list[str]
    summary_text: str
    raw_feature_snapshot: dict[str, Any]
    indicator_snapshot: dict[str, Any]
    diagnostics: dict[str, Any]
    component_scores: ComponentScores
    pattern_analysis: PatternAnalysisResult | None = None
    state_transition_probability_10d: float | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["as_of_date"] = self.as_of_date.isoformat()
        return payload
