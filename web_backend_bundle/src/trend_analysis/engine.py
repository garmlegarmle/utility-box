"""High-level analysis pipeline for the trend analysis engine."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pandas as pd

from .classifier import RegimeClassifier
from .config import EngineConfig
from .data import MarketDataHandler, PreparedData
from .features import FeatureEngine
from .indicators import IndicatorEngine
from .models import TrendAnalysisResult
from .pattern_analysis import ChartPatternAnalyzer
from .scoring import ScoringEngine
from .utils import to_builtin


class TrendAnalysisEngine:
    """Analyze the current daily market state from OHLCV data."""

    def __init__(self, config: EngineConfig | None = None) -> None:
        self.config = config or EngineConfig()
        self.data_handler = MarketDataHandler(self.config)
        self.indicator_engine = IndicatorEngine(self.config)
        self.feature_engine = FeatureEngine(self.config)
        self.scoring_engine = ScoringEngine(self.config)
        self.classifier = RegimeClassifier(self.config)
        self.pattern_analyzer = ChartPatternAnalyzer(self.config)

    def analyze(self, frame: pd.DataFrame) -> TrendAnalysisResult:
        """Run the full analysis pipeline on a dataframe."""

        prepared = self.data_handler.prepare_bundle(frame)
        return self._analyze_prepared_bundle(prepared)

    def analyze_csv(self, path: str | Path, date_column: str = "date") -> TrendAnalysisResult:
        """Run the full analysis pipeline on a CSV file."""

        raw_frame = pd.read_csv(path)
        prepared = self.data_handler.prepare_bundle(raw_frame, date_column=date_column)
        return self._analyze_prepared_bundle(prepared)

    def analyze_patterns(self, frame: pd.DataFrame):
        """Run only the chart-pattern analyzer on a dataframe."""

        prepared = self.data_handler.prepare_bundle(frame)
        indicator_frame = self.indicator_engine.compute(prepared.current_window)
        return self.pattern_analyzer.analyze(prepared.current_window, indicator_frame=indicator_frame)

    def analyze_csv_patterns(self, path: str | Path, date_column: str = "date"):
        """Run only the chart-pattern analyzer on a CSV file."""

        raw_frame = pd.read_csv(path)
        prepared = self.data_handler.prepare_bundle(raw_frame, date_column=date_column)
        indicator_frame = self.indicator_engine.compute(prepared.current_window)
        return self.pattern_analyzer.analyze(prepared.current_window, indicator_frame=indicator_frame)

    def analyze_chart_image(
        self,
        image_path: str | Path,
        annotated_output_path: str | Path | None = None,
        expected_bars: int | None = None,
        chart_style: str = "auto",
    ):
        """Run the heuristic chart-image analyzer on an uploaded screenshot."""

        from .chart_image_analysis import ChartImageAnalyzer

        analyzer = ChartImageAnalyzer(self.config)
        return analyzer.analyze_image(
            image_path=image_path,
            annotated_output_path=annotated_output_path,
            expected_bars=expected_bars,
            chart_style=chart_style,
        )

    def analyze_history(
        self,
        frame: pd.DataFrame,
        date_column: str | None = None,
    ) -> list[TrendAnalysisResult]:
        """Run rolling historical analysis with the same current-state engine.

        TODO: Future walk-forward optimization can reuse this method by iterating
        over parameter sets and comparing rolling outputs without changing the
        analysis core.
        """

        cleaned = self.data_handler.prepare(frame, date_column=date_column)
        windows = self.data_handler.rolling_windows(cleaned)
        results: list[TrendAnalysisResult] = []
        for window in windows:
            prepared = PreparedData(
                cleaned=window,
                current_window=window,
                original_rows=len(window),
                cleaned_rows=len(window),
                dropped_rows=0,
            )
            results.append(self._analyze_prepared_bundle(prepared))
        return results

    def build_history_frame(
        self,
        frame: pd.DataFrame,
        date_column: str | None = None,
    ) -> pd.DataFrame:
        """Return a per-bar historical analysis frame for the full series.

        Unlike :meth:`analyze_history`, this computes indicators once over the
        full cleaned dataset and then classifies each available bar. This is the
        preferred path for web payloads and historical visualizations.
        """

        cleaned = self.data_handler.prepare(frame, date_column=date_column)
        indicator_frame = self.indicator_engine.compute(cleaned)
        feature_frame = self.feature_engine.compute_frame(indicator_frame)
        coverage_ratio = feature_frame.notna().mean(axis=1)

        rows: list[dict[str, object]] = []
        for as_of_date, row in feature_frame.iterrows():
            indicator_row = indicator_frame.loc[as_of_date]
            feature_values = {
                key: (None if pd.isna(value) else float(value))
                for key, value in row.items()
            }
            component_scores = self.scoring_engine.score_values(feature_values)
            classification = self.classifier.classify_values(
                features=feature_values,
                component_scores=component_scores,
                coverage_ratio=float(coverage_ratio.loc[as_of_date]),
            )
            rows.append(
                {
                    "as_of_date": self._as_of_datetime(pd.Timestamp(as_of_date)),
                    "open": float(cleaned.loc[as_of_date, "open"]),
                    "high": float(cleaned.loc[as_of_date, "high"]),
                    "low": float(cleaned.loc[as_of_date, "low"]),
                    "close": float(cleaned.loc[as_of_date, "close"]),
                    "volume": float(cleaned.loc[as_of_date, "volume"]),
                    "regime_label": classification["regime_label"],
                    "trend_state_label": classification["trend_state_label"],
                    "confidence_score": classification["confidence_score"],
                    "transition_risk_label": classification["transition_risk_label"],
                    "trend_direction_score": component_scores.trend_direction.score,
                    "trend_strength_score": component_scores.trend_strength.score,
                    "momentum_score": component_scores.momentum.score,
                    "volatility_regime_score": component_scores.volatility_regime.score,
                    "volume_confirmation_score": component_scores.volume_confirmation.score,
                    "transition_risk_score": component_scores.transition_risk.score,
                    "composite_trend_score": component_scores.composite_trend_score,
                    "ema20": None if pd.isna(indicator_row["ema20"]) else float(indicator_row["ema20"]),
                    "ema50": None if pd.isna(indicator_row["ema50"]) else float(indicator_row["ema50"]),
                    "sma200": None if pd.isna(indicator_row["sma200"]) else float(indicator_row["sma200"]),
                    "ichimoku_tenkan": None
                    if pd.isna(indicator_row["ichimoku_tenkan"])
                    else float(indicator_row["ichimoku_tenkan"]),
                    "ichimoku_kijun": None
                    if pd.isna(indicator_row["ichimoku_kijun"])
                    else float(indicator_row["ichimoku_kijun"]),
                    "ichimoku_cloud_a": None
                    if pd.isna(indicator_row["ichimoku_cloud_a"])
                    else float(indicator_row["ichimoku_cloud_a"]),
                    "ichimoku_cloud_b": None
                    if pd.isna(indicator_row["ichimoku_cloud_b"])
                    else float(indicator_row["ichimoku_cloud_b"]),
                    "macd_line": None if pd.isna(indicator_row["macd_line"]) else float(indicator_row["macd_line"]),
                    "macd_signal": None if pd.isna(indicator_row["macd_signal"]) else float(indicator_row["macd_signal"]),
                    "macd_hist": None if pd.isna(indicator_row["macd_hist"]) else float(indicator_row["macd_hist"]),
                    "rsi": None if pd.isna(indicator_row["rsi"]) else float(indicator_row["rsi"]),
                }
            )
        return pd.DataFrame(rows)

    def _analyze_prepared_bundle(self, prepared: PreparedData) -> TrendAnalysisResult:
        indicator_frame = self.indicator_engine.compute(prepared.current_window)
        feature_snapshot = self.feature_engine.compute(indicator_frame)
        component_scores = self.scoring_engine.score(feature_snapshot)
        classification = self.classifier.classify(feature_snapshot, component_scores)
        pattern_analysis = self.pattern_analyzer.analyze(
            prepared.current_window,
            indicator_frame=indicator_frame,
            trend_context={
                "regime_label": classification["regime_label"],
                "trend_state_label": classification["trend_state_label"],
                "trend_direction_score": component_scores.trend_direction.score,
                "trend_strength_score": component_scores.trend_strength.score,
                "momentum_score": component_scores.momentum.score,
                "transition_risk_score": component_scores.transition_risk.score,
            },
        )

        latest_row = indicator_frame.iloc[-1]
        as_of_date = self._as_of_datetime(indicator_frame.index[-1])
        indicator_snapshot = {
            "close": latest_row["close"],
            "ema20": latest_row["ema20"],
            "ema50": latest_row["ema50"],
            "sma200": latest_row["sma200"],
            "ichimoku_tenkan": latest_row["ichimoku_tenkan"],
            "ichimoku_kijun": latest_row["ichimoku_kijun"],
            "ichimoku_cloud_a": latest_row["ichimoku_cloud_a"],
            "ichimoku_cloud_b": latest_row["ichimoku_cloud_b"],
            "adx": latest_row["adx"],
            "plus_di": latest_row["plus_di"],
            "minus_di": latest_row["minus_di"],
            "rsi": latest_row["rsi"],
            "roc10": latest_row["roc10"],
            "macd_line": latest_row["macd_line"],
            "macd_signal": latest_row["macd_signal"],
            "macd_hist": latest_row["macd_hist"],
            "atr": latest_row["atr"],
            "atr_pct": latest_row["atr_pct"],
            "bb_width": latest_row["bb_width"],
            "donchian_high": latest_row["donchian_high"],
            "donchian_low": latest_row["donchian_low"],
            "volume_avg_20": latest_row["volume_avg_20"],
            "obv": latest_row["obv"],
        }

        diagnostics = {
            "data": {
                "original_rows": prepared.original_rows,
                "cleaned_rows": prepared.cleaned_rows,
                "dropped_rows": prepared.dropped_rows,
                "current_window_rows": len(prepared.current_window),
                "max_bars_used": self.config.data.max_bars,
            },
            "scores": component_scores.to_dict(),
            "classification": classification["diagnostics"],
            "config": {
                "max_bars": self.config.data.max_bars,
                "min_bars": self.config.data.min_bars,
            },
            # TODO: Feed this result bundle directly into a future backtester that
            # records one analysis object per bar.
        }

        return TrendAnalysisResult(
            as_of_date=as_of_date,
            regime_label=classification["regime_label"],
            trend_state_label=classification["trend_state_label"],
            bullish_score=classification["bullish_score"],
            bearish_score=classification["bearish_score"],
            confidence_score=classification["confidence_score"],
            transition_risk_score=component_scores.transition_risk.score,
            transition_risk_label=classification["transition_risk_label"],
            trend_direction_score=component_scores.trend_direction.score,
            trend_strength_score=component_scores.trend_strength.score,
            momentum_score=component_scores.momentum.score,
            volatility_regime_score=component_scores.volatility_regime.score,
            volume_confirmation_score=component_scores.volume_confirmation.score,
            tags=classification["tags"],
            summary_text=classification["summary_text"],
            raw_feature_snapshot=to_builtin(feature_snapshot.values),
            indicator_snapshot=to_builtin(indicator_snapshot),
            diagnostics=to_builtin(diagnostics),
            component_scores=component_scores,
            pattern_analysis=pattern_analysis,
        )

    @staticmethod
    def _as_of_datetime(timestamp: pd.Timestamp) -> datetime:
        return timestamp.to_pydatetime() if isinstance(timestamp, pd.Timestamp) else pd.Timestamp(timestamp).to_pydatetime()
