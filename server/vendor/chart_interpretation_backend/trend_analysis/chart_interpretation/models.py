"""Data models for the chart interpretation engine."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class SwingPoint:
    """One detected swing point."""

    timestamp: datetime
    price: float
    kind: str
    scale: str
    bar_index: int
    strength_atr: float

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["timestamp"] = self.timestamp.isoformat()
        return payload


@dataclass(slots=True)
class Zone:
    """A support or resistance zone."""

    lower_bound: float
    upper_bound: float
    zone_type: str
    touch_count: int
    strength_score: float
    source: str
    label: str
    anchor_index: int | None = None

    def center(self) -> float:
        return (self.lower_bound + self.upper_bound) / 2.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class PatternSignal:
    """One interpretable chart pattern signal."""

    pattern_name: str
    direction: str
    confidence: float
    freshness: float
    relevance: float = 0.0
    relevant_levels: dict[str, float] = field(default_factory=dict)
    target_estimation: dict[str, float] | None = None
    breakout_level: float | None = None
    invalidation_level: float | None = None
    anchor_points: list[dict[str, Any]] = field(default_factory=list)
    draw_lines: list[dict[str, Any]] = field(default_factory=list)
    explanation: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class MarketEvent:
    """One recent market event."""

    timestamp: datetime
    event_type: str
    strength: float
    freshness: float
    details: str

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["timestamp"] = self.timestamp.isoformat()
        return payload


@dataclass(slots=True)
class ScenarioCandidate:
    """One ranked trading scenario."""

    name: str
    direction: str
    score: float
    confidence: float
    invalidation_level: float | None
    confirmation_needed: list[str] = field(default_factory=list)
    risk_flags: list[str] = field(default_factory=list)
    explanation: list[str] = field(default_factory=list)
    target_zone_1: dict[str, float] | None = None
    target_zone_2: dict[str, float] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ProjectionPath:
    """One future projection path."""

    points: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> list[dict[str, Any]]:
        return self.points


@dataclass(slots=True)
class ProjectionBundle:
    """Future scenario projection outputs."""

    base_path: ProjectionPath
    bullish_path: ProjectionPath
    bearish_path: ProjectionPath
    upper_band: ProjectionPath
    lower_band: ProjectionPath
    target_zone_1: dict[str, float] | None
    target_zone_2: dict[str, float] | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "base_path": self.base_path.to_dict(),
            "bullish_path": self.bullish_path.to_dict(),
            "bearish_path": self.bearish_path.to_dict(),
            "upper_band": self.upper_band.to_dict(),
            "lower_band": self.lower_band.to_dict(),
            "target_zone_1": self.target_zone_1,
            "target_zone_2": self.target_zone_2,
        }


@dataclass(slots=True)
class ChartInterpretationResult:
    """Top-level chart interpretation output."""

    trend_state: str
    market_structure: str
    location_state: str
    active_patterns: list[PatternSignal]
    recent_events: list[MarketEvent]
    primary_scenario: ScenarioCandidate
    bullish_alternative: ScenarioCandidate | None
    bearish_alternative: ScenarioCandidate | None
    confidence: float
    invalidation_level: float | None
    confirmation_needed: list[str]
    risk_flags: list[str]
    projection: ProjectionBundle
    explanation: list[str]
    summary_text: str
    confidence_label: str = ""
    strongest_alternative: ScenarioCandidate | None = None
    primary_scenario_explanation: str = ""
    alternative_scenario_explanation: str = ""
    risk_notes: list[str] = field(default_factory=list)
    confirmation_checklist: list[str] = field(default_factory=list)
    modules: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "trend_state": self.trend_state,
            "market_structure": self.market_structure,
            "location_state": self.location_state,
            "active_patterns": [item.to_dict() for item in self.active_patterns],
            "recent_events": [item.to_dict() for item in self.recent_events],
            "primary_scenario": self.primary_scenario.to_dict(),
            "bullish_alternative": self.bullish_alternative.to_dict() if self.bullish_alternative else None,
            "bearish_alternative": self.bearish_alternative.to_dict() if self.bearish_alternative else None,
            "confidence": self.confidence,
            "invalidation_level": self.invalidation_level,
            "confirmation_needed": self.confirmation_needed,
            "risk_flags": self.risk_flags,
            "projection": self.projection.to_dict(),
            "explanation": self.explanation,
            "summary_text": self.summary_text,
            "confidence_label": self.confidence_label,
            "strongest_alternative": self.strongest_alternative.to_dict() if self.strongest_alternative else None,
            "primary_scenario_explanation": self.primary_scenario_explanation,
            "alternative_scenario_explanation": self.alternative_scenario_explanation,
            "risk_notes": self.risk_notes,
            "confirmation_checklist": self.confirmation_checklist,
            "modules": self.modules,
        }
