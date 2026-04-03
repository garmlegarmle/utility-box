"""Top-level chart interpretation engine."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from ..downloader import DownloadRequest, YahooFinanceDownloader
from .config import ChartInterpretationConfig
from .confirmation_engine import ConfirmationEngine
from .event_engine import EventEngine
from .models import ChartInterpretationResult
from .narrative_engine import NarrativeEngine
from .pattern_engine import PatternEngine
from .preprocessing import OHLCVPreprocessor
from .projection_engine import ProjectionEngine
from .renderer import ChartInterpretationRenderer, InterpretationArtifacts
from .scenario_engine import ScenarioEngine
from .structure_engine import MarketStructureEngine
from .swing_engine import SwingEngine
from .trend_engine import TrendEngine
from .zone_engine import ZoneEngine


class ChartInterpretationEngine:
    """Structure-first chart interpretation engine."""

    def __init__(self, config: ChartInterpretationConfig | None = None) -> None:
        self.config = config or ChartInterpretationConfig()
        self.preprocessor = OHLCVPreprocessor(self.config)
        self.trend_engine = TrendEngine(self.config)
        self.swing_engine = SwingEngine(self.config)
        self.structure_engine = MarketStructureEngine(self.config)
        self.zone_engine = ZoneEngine(self.config)
        self.confirmation_engine = ConfirmationEngine(self.config)
        self.pattern_engine = PatternEngine(self.config)
        self.event_engine = EventEngine(self.config)
        self.scenario_engine = ScenarioEngine(self.config)
        self.projection_engine = ProjectionEngine(self.config)
        self.narrative_engine = NarrativeEngine(self.config)
        self.renderer = ChartInterpretationRenderer(self.config)
        self.downloader = YahooFinanceDownloader()

    def analyze_csv(self, path: str | Path) -> tuple[pd.DataFrame, ChartInterpretationResult]:
        prepared = self.preprocessor.prepare_csv(path)
        return prepared.frame, self.analyze_frame(prepared.frame, preprocessing=prepared.diagnostics)

    def analyze_frame(self, frame: pd.DataFrame, preprocessing: dict[str, Any] | None = None) -> ChartInterpretationResult:
        indicator_frame = self.trend_engine.compute_indicator_frame(frame)
        trend_result = self.trend_engine.analyze(indicator_frame)
        higher_tf = self.trend_engine.analyze_higher_timeframe(frame)
        swings = self.swing_engine.analyze(indicator_frame)
        structure = self.structure_engine.analyze(indicator_frame, trend_result, swings)
        zones = self.zone_engine.analyze(indicator_frame, swings, structure)
        confirmation = self.confirmation_engine.analyze(indicator_frame, swings)
        patterns = self.pattern_engine.analyze(indicator_frame, trend_result, structure, zones["zones"], swings, confirmation)
        recent_events = self.event_engine.analyze(indicator_frame, structure, zones["zones"], swings, patterns, confirmation)
        scenario_bundle = self.scenario_engine.analyze(
            current_price=float(indicator_frame["close"].iloc[-1]),
            trend_result=trend_result,
            higher_timeframe_trend=higher_tf,
            structure=structure,
            location_state=zones["location_state"],
            zones=zones["zones"],
            patterns=patterns,
            confirmation=confirmation,
            recent_events=[item.to_dict() for item in recent_events],
        )
        projection = self.projection_engine.analyze(
            indicator_frame,
            scenario_bundle["primary"],
            scenario_bundle["bullish_alternative"],
            scenario_bundle["bearish_alternative"],
            zones=zones,
            patterns=patterns,
        )
        strongest_alternative = scenario_bundle.get("strongest_alternative")
        narrative = self.narrative_engine.build(
            trend=trend_result,
            higher_tf=higher_tf,
            structure=structure,
            location_state=zones["location_state"],
            patterns=patterns,
            confirmation=confirmation,
            primary=scenario_bundle["primary"],
            strongest_alternative=strongest_alternative,
            confidence=scenario_bundle["confidence"],
        )
        invalidation_level = scenario_bundle["primary"].invalidation_level
        confirmation_needed = narrative["confirmation_checklist"]
        risk_flags = narrative["risk_notes"]

        return ChartInterpretationResult(
            trend_state=trend_result["label"],
            market_structure=structure["label"],
            location_state=zones["location_state"],
            active_patterns=patterns,
            recent_events=recent_events,
            primary_scenario=scenario_bundle["primary"],
            bullish_alternative=scenario_bundle["bullish_alternative"],
            bearish_alternative=scenario_bundle["bearish_alternative"],
            confidence=scenario_bundle["confidence"],
            invalidation_level=invalidation_level,
            confirmation_needed=confirmation_needed,
            risk_flags=risk_flags,
            projection=projection,
            explanation=narrative["explanation"],
            summary_text=narrative["summary_text"],
            confidence_label=narrative["confidence_label"],
            strongest_alternative=strongest_alternative,
            primary_scenario_explanation=narrative["primary_scenario_explanation"],
            alternative_scenario_explanation=narrative["alternative_scenario_explanation"],
            risk_notes=narrative["risk_notes"],
            confirmation_checklist=narrative["confirmation_checklist"],
            modules={
                "preprocessing": preprocessing or {},
                "trend": trend_result,
                "higher_timeframe_trend": higher_tf,
                "swings": {key: [item.to_dict() for item in value] for key, value in swings.items()},
                "structure": structure,
                "zones": zones,
                "confirmation": confirmation,
                "patterns": [item.to_dict() for item in patterns],
                "scenarios": [item.to_dict() for item in scenario_bundle.get("ranked", [])],
            },
        )

    def analyze_ticker(self, ticker: str, cache_dir: str | Path, period: str = "2y") -> tuple[pd.DataFrame, ChartInterpretationResult]:
        request = DownloadRequest(ticker=ticker, save_dir=Path(cache_dir), period=period, interval="1d")
        download = self.downloader.download(request)
        frame, analysis = self.analyze_csv(download.file_path)
        analysis.modules.setdefault("download", download.to_dict())
        return frame, analysis

    def export_csv(self, path: str | Path, output_dir: str | Path, title: str | None = None) -> InterpretationArtifacts:
        frame, analysis = self.analyze_csv(path)
        title_label = title or Path(path).stem
        indicator_frame = self.trend_engine.compute_indicator_frame(frame)
        return self.renderer.export(indicator_frame, analysis, output_dir, title_label)

    def export_ticker(self, ticker: str, output_dir: str | Path, cache_dir: str | Path, period: str = "2y") -> InterpretationArtifacts:
        frame, analysis = self.analyze_ticker(ticker, cache_dir=cache_dir, period=period)
        indicator_frame = self.trend_engine.compute_indicator_frame(frame)
        return self.renderer.export(indicator_frame, analysis, output_dir, ticker.upper())
