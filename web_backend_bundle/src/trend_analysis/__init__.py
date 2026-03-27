"""Public package exports for the trend analysis engine."""

from __future__ import annotations

from .config import EngineConfig
from .models import (
    ComponentScores,
    FeatureSnapshot,
    ImageChartAnalysisResult,
    OverlayShape,
    PatternAnalysisResult,
    PatternCandidate,
    TrendAnalysisResult,
)

__all__ = [
    "ComponentScores",
    "DownloadRequest",
    "DownloadResult",
    "EngineConfig",
    "FeatureSnapshot",
    "HistoricalAnalysisReporter",
    "HistoricalReportArtifacts",
    "HoldoutValidationArtifacts",
    "HoldoutValidationRunner",
    "ImageChartAnalysisResult",
    "ImageValidationArtifacts",
    "ImageValidationRunner",
    "OptimizationArtifacts",
    "OptimizationSettings",
    "OverlayShape",
    "PatternChartRenderer",
    "PatternAnalysisResult",
    "PatternCandidate",
    "ChartImageAnalyzer",
    "BatchImageValidationArtifacts",
    "BatchImageValidationRunner",
    "TrendAnalysisEngine",
    "TrendParameterOptimizer",
    "TrendAnalysisResult",
    "TrendStateBackgroundArtifacts",
    "TrendStateBackgroundChartRenderer",
    "WebAnalysisExporter",
    "WebExportArtifacts",
    "YahooFinanceDownloader",
]


def __getattr__(name: str):
    if name == "TrendAnalysisEngine":
        from .engine import TrendAnalysisEngine

        return TrendAnalysisEngine
    if name in {"DownloadRequest", "DownloadResult", "YahooFinanceDownloader"}:
        from .downloader import DownloadRequest, DownloadResult, YahooFinanceDownloader

        exports = {
            "DownloadRequest": DownloadRequest,
            "DownloadResult": DownloadResult,
            "YahooFinanceDownloader": YahooFinanceDownloader,
        }
        return exports[name]
    if name in {"OptimizationArtifacts", "OptimizationSettings", "TrendParameterOptimizer"}:
        from .optimizer import OptimizationArtifacts, OptimizationSettings, TrendParameterOptimizer

        exports = {
            "OptimizationArtifacts": OptimizationArtifacts,
            "OptimizationSettings": OptimizationSettings,
            "TrendParameterOptimizer": TrendParameterOptimizer,
        }
        return exports[name]
    if name in {"HistoricalAnalysisReporter", "HistoricalReportArtifacts"}:
        from .history_report import HistoricalAnalysisReporter, HistoricalReportArtifacts

        exports = {
            "HistoricalAnalysisReporter": HistoricalAnalysisReporter,
            "HistoricalReportArtifacts": HistoricalReportArtifacts,
        }
        return exports[name]
    if name in {"HoldoutValidationArtifacts", "HoldoutValidationRunner"}:
        from .holdout_validation import HoldoutValidationArtifacts, HoldoutValidationRunner

        exports = {
            "HoldoutValidationArtifacts": HoldoutValidationArtifacts,
            "HoldoutValidationRunner": HoldoutValidationRunner,
        }
        return exports[name]
    if name in {"TrendStateBackgroundArtifacts", "TrendStateBackgroundChartRenderer"}:
        from .state_background_chart import (
            TrendStateBackgroundArtifacts,
            TrendStateBackgroundChartRenderer,
        )

        exports = {
            "TrendStateBackgroundArtifacts": TrendStateBackgroundArtifacts,
            "TrendStateBackgroundChartRenderer": TrendStateBackgroundChartRenderer,
        }
        return exports[name]
    if name in {"ImageValidationArtifacts", "ImageValidationRunner"}:
        from .image_validation import ImageValidationArtifacts, ImageValidationRunner

        exports = {
            "ImageValidationArtifacts": ImageValidationArtifacts,
            "ImageValidationRunner": ImageValidationRunner,
        }
        return exports[name]
    if name in {"BatchImageValidationArtifacts", "BatchImageValidationRunner"}:
        from .batch_image_validation import BatchImageValidationArtifacts, BatchImageValidationRunner

        exports = {
            "BatchImageValidationArtifacts": BatchImageValidationArtifacts,
            "BatchImageValidationRunner": BatchImageValidationRunner,
        }
        return exports[name]
    if name in {"WebAnalysisExporter", "WebExportArtifacts"}:
        from .web_export import WebAnalysisExporter, WebExportArtifacts

        exports = {
            "WebAnalysisExporter": WebAnalysisExporter,
            "WebExportArtifacts": WebExportArtifacts,
        }
        return exports[name]
    if name == "PatternChartRenderer":
        from .pattern_overlay import PatternChartRenderer

        return PatternChartRenderer
    if name == "ChartImageAnalyzer":
        from .chart_image_analysis import ChartImageAnalyzer

        return ChartImageAnalyzer
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
