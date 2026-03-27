"""Overlay-shape construction and annotated chart rendering."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

MPLCONFIGDIR = Path(os.environ.get("MPLCONFIGDIR", Path.cwd() / ".matplotlib-cache"))
MPLCONFIGDIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(MPLCONFIGDIR))

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from .config import EngineConfig
from .indicators import IndicatorEngine
from .models import OverlayShape, PatternAnalysisResult, PatternCandidate
from .pattern_analysis import ChartPatternAnalyzer


class PatternOverlayBuilder:
    """Build drawable overlay shapes for the most useful chart-pattern candidate."""

    def __init__(self, config: EngineConfig | None = None) -> None:
        self.config = config or EngineConfig()
        self.indicator_engine = IndicatorEngine(self.config)
        self.pattern_analyzer = ChartPatternAnalyzer(self.config)

    def build_shapes(
        self,
        frame: pd.DataFrame,
        pattern_analysis: PatternAnalysisResult | None,
        indicator_frame: pd.DataFrame | None = None,
    ) -> tuple[PatternCandidate | None, list[OverlayShape], pd.DataFrame]:
        """Return the best drawable candidate and overlay shapes."""

        window = frame.tail(self.config.patterns.analysis_window_bars).copy()
        if window.empty:
            return None, [], window
        indicators = (
            indicator_frame.loc[window.index].copy()
            if indicator_frame is not None and not indicator_frame.empty
            else self.indicator_engine.compute(window)
        )
        ctx = self.pattern_analyzer._build_context(window, indicators, {})
        candidate = self._select_overlay_candidate(pattern_analysis)
        if candidate is None:
            return None, [], window
        shapes = self._build_candidate_shapes(candidate, ctx)
        if not shapes:
            shapes = self._build_generic_shapes(ctx)
        return candidate, shapes, window

    def _select_overlay_candidate(self, pattern_analysis: PatternAnalysisResult | None) -> PatternCandidate | None:
        if pattern_analysis is None or not pattern_analysis.candidates:
            return None
        priorities = {
            "반전": 5,
            "지속": 5,
            "수렴/구조": 4,
            "추세 구조": 4,
            "변동성": 3,
            "캔들": 2,
            "거래량": 1,
        }
        top_score = pattern_analysis.candidates[0].score
        viable = [candidate for candidate in pattern_analysis.candidates if candidate.score >= top_score - 18.0]
        ranked = sorted(
            viable,
            key=lambda candidate: (-priorities.get(candidate.category, 0), -candidate.score, candidate.pattern_name),
        )
        return ranked[0] if ranked else pattern_analysis.primary_candidate

    def _build_candidate_shapes(self, candidate: PatternCandidate, ctx: dict[str, Any]) -> list[OverlayShape]:
        name = candidate.pattern_name
        if name in {"Range", "Consolidation", "Accumulation", "Distribution", "Trend → Range 전환", "Squeeze", "Tight Range", "Volume Dry-up"}:
            return self._range_shapes(ctx)
        if name in {"Ascending Triangle", "Descending Triangle", "Symmetrical Triangle", "Rising Wedge", "Falling Wedge"}:
            return self._triangle_shapes(ctx, name)
        if name in {"Bull Pennant", "Bear Pennant"}:
            return self._triangle_shapes(ctx, name, window=self.config.patterns.flag_window_max)
        if name in {"Bull Flag", "Bear Flag", "Pullback continuation", "Throwback", "Breakout Retest", "Downtrend Continuation"}:
            return self._flag_shapes(ctx, candidate)
        if name in {"Higher High + Higher Low", "Lower High + Lower Low", "Trend Acceleration", "Trend Break", "Higher Low 전환 구조", "Lower High 전환 구조"}:
            return self._structure_shapes(ctx, candidate)
        if name in {"Double Top", "Double Bottom"}:
            return self._double_shapes(candidate)
        if name in {"Head and Shoulders", "Inverse Head and Shoulders"}:
            return self._head_and_shoulders_shapes(candidate)
        if name in {"Rounded Bottom", "Rounded Top", "V-bottom", "Exhaustion Move", "Blow-off Top", "Spike Reversal"}:
            return self._curve_shapes(ctx, candidate)
        if name in {"Breakout Expansion", "Volume Surge Breakout", "Range → Trend 전환"}:
            return self._breakout_shapes(ctx, candidate)
        if candidate.category == "캔들":
            return self._last_candle_shapes(ctx, candidate)
        if candidate.category == "거래량":
            return self._range_shapes(ctx)
        return []

    def _range_shapes(self, ctx: dict[str, Any]) -> list[OverlayShape]:
        window = ctx["window"]
        range_window = min(self.config.patterns.range_window, len(window))
        start = len(window) - range_window
        end = len(window) - 1
        top = float(ctx["high"].tail(range_window).max())
        bottom = float(ctx["low"].tail(range_window).min())
        return [
            OverlayShape("line", "Range Top", [(start, top), (end, top)], color="#2563eb", style="dashed"),
            OverlayShape("line", "Range Bottom", [(start, bottom), (end, bottom)], color="#dc2626", style="dashed"),
        ]

    def _triangle_shapes(self, ctx: dict[str, Any], name: str, window: int | None = None) -> list[OverlayShape]:
        shape_window = min(window or self.config.patterns.triangle_window, len(ctx["window"]))
        start = len(ctx["window"]) - shape_window
        high_segment = ctx["high"].tail(shape_window).reset_index(drop=True)
        low_segment = ctx["low"].tail(shape_window).reset_index(drop=True)
        if name == "Ascending Triangle":
            upper_points = [(start, float(high_segment.nlargest(min(3, len(high_segment))).mean())), (len(ctx["window"]) - 1, float(high_segment.nlargest(min(3, len(high_segment))).mean()))]
            lower_points = self._fit_segment_points(low_segment, start)
        elif name == "Descending Triangle":
            lower_value = float(low_segment.nsmallest(min(3, len(low_segment))).mean())
            upper_points = self._fit_segment_points(high_segment, start)
            lower_points = [(start, lower_value), (len(ctx["window"]) - 1, lower_value)]
        else:
            upper_points = self._fit_segment_points(high_segment, start)
            lower_points = self._fit_segment_points(low_segment, start)
        return [
            OverlayShape("line", "Upper Line", upper_points, color="#2563eb"),
            OverlayShape("line", "Lower Line", lower_points, color="#dc2626"),
        ]

    def _flag_shapes(self, ctx: dict[str, Any], candidate: PatternCandidate) -> list[OverlayShape]:
        window_len = min(self.config.patterns.flag_window_max, len(ctx["window"]))
        start = len(ctx["window"]) - window_len
        high_segment = ctx["high"].tail(window_len).reset_index(drop=True)
        low_segment = ctx["low"].tail(window_len).reset_index(drop=True)
        shapes = [
            OverlayShape("line", "Flag Top", self._fit_segment_points(high_segment, start), color="#2563eb"),
            OverlayShape("line", "Flag Bottom", self._fit_segment_points(low_segment, start), color="#dc2626"),
        ]
        pole_start = max(0, start - self.config.patterns.flag_pole_bars)
        pole_low = float(ctx["close"].iloc[pole_start:start].min()) if start > pole_start else float(ctx["close"].iloc[0])
        pole_high = float(ctx["close"].iloc[pole_start:start].max()) if start > pole_start else float(ctx["close"].iloc[start])
        if candidate.direction_bias == "bullish":
            shapes.append(OverlayShape("line", "Pole", [(pole_start, pole_low), (start, pole_high)], color="#16a34a"))
            if ctx["breakout_level"]:
                shapes.append(
                    OverlayShape(
                        "line",
                        "Breakout Level",
                        [(start, float(ctx["breakout_level"])), (len(ctx["window"]) - 1, float(ctx["breakout_level"]))],
                        color="#7c3aed",
                        style="dashed",
                    )
                )
        else:
            shapes.append(OverlayShape("line", "Pole", [(pole_start, pole_high), (start, pole_low)], color="#ef4444"))
            if ctx["breakdown_level"]:
                shapes.append(
                    OverlayShape(
                        "line",
                        "Breakdown Level",
                        [(start, float(ctx["breakdown_level"])), (len(ctx["window"]) - 1, float(ctx["breakdown_level"]))],
                        color="#7c3aed",
                        style="dashed",
                    )
                )
        return shapes

    def _structure_shapes(self, ctx: dict[str, Any], candidate: PatternCandidate) -> list[OverlayShape]:
        highs = ctx["pivots_high"][-3:]
        lows = ctx["pivots_low"][-3:]
        shapes: list[OverlayShape] = []
        if highs:
            shapes.append(
                OverlayShape(
                    "polyline",
                    "Swing Highs",
                    [(pivot.position, pivot.price) for pivot in highs],
                    color="#2563eb",
                )
            )
        if lows:
            shapes.append(
                OverlayShape(
                    "polyline",
                    "Swing Lows",
                    [(pivot.position, pivot.price) for pivot in lows],
                    color="#dc2626",
                )
            )
        start = max(0, len(ctx["window"]) - 20)
        ema20 = [(start, float(ctx["close"].rolling(window=20, min_periods=1).mean().iloc[start])), (len(ctx["window"]) - 1, float(ctx["ema20"]))]
        shapes.append(OverlayShape("line", "EMA20", ema20, color="#7c3aed", style="dashed"))
        return shapes

    def _double_shapes(self, candidate: PatternCandidate) -> list[OverlayShape]:
        info = candidate.diagnostics
        if not info:
            return []
        resistance = float((info["left_price"] + info["right_price"]) / 2.0)
        left_pos = float(info.get("left_position", 0.0))
        right_pos = float(info.get("right_position", left_pos + 1.0))
        midpoint_pos = float(info.get("midpoint_position", (left_pos + right_pos) / 2.0))
        neckline = float(info["midpoint"])
        return [
            OverlayShape("line", candidate.pattern_name, [(left_pos, resistance), (right_pos, resistance)], color="#2563eb"),
            OverlayShape("line", "Neckline", [(left_pos, neckline), (right_pos, neckline)], color="#dc2626", style="dashed"),
            OverlayShape("polyline", "Swing", [(left_pos, resistance), (midpoint_pos, neckline), (right_pos, resistance)], color="#0f172a"),
        ]

    def _head_and_shoulders_shapes(self, candidate: PatternCandidate) -> list[OverlayShape]:
        info = candidate.diagnostics
        if not info:
            return []
        swing_points = [
            (float(info["left_position"]), float(info["left_shoulder"])),
            (float(info["head_position"]), float(info["head"])),
            (float(info["right_position"]), float(info["right_shoulder"])),
        ]
        neckline_points = [
            (float(info["neckline_left_position"]), float(info["neckline_left_price"])),
            (float(info["neckline_right_position"]), float(info["neckline_right_price"])),
        ]
        return [
            OverlayShape("polyline", candidate.pattern_name, swing_points, color="#2563eb"),
            OverlayShape("line", "Neckline", neckline_points, color="#dc2626", style="dashed"),
        ]

    def _curve_shapes(self, ctx: dict[str, Any], candidate: PatternCandidate) -> list[OverlayShape]:
        if candidate.pattern_name in {"Rounded Bottom", "Rounded Top"}:
            curve_window = min(self.config.patterns.rounded_window, len(ctx["window"]))
        else:
            curve_window = min(24, len(ctx["window"]))
        start = len(ctx["window"]) - curve_window
        close_segment = ctx["close"].tail(curve_window).reset_index(drop=True)
        step = max(1, curve_window // 12)
        points = [(start + idx, float(close_segment.iloc[idx])) for idx in range(0, curve_window, step)]
        if points[-1][0] != len(ctx["window"]) - 1:
            points.append((len(ctx["window"]) - 1, float(close_segment.iloc[-1])))
        return [OverlayShape("polyline", candidate.pattern_name, points, color="#2563eb")]

    def _breakout_shapes(self, ctx: dict[str, Any], candidate: PatternCandidate) -> list[OverlayShape]:
        shapes = self._range_shapes(ctx)
        level = float(ctx["breakout_level"]) if candidate.direction_bias == "bullish" else float(ctx["breakdown_level"])
        shapes.append(
            OverlayShape(
                "line",
                "Trigger",
                [(max(0, len(ctx["window"]) - self.config.patterns.range_window), level), (len(ctx["window"]) - 1, level)],
                color="#7c3aed",
                style="dashed",
            )
        )
        return shapes

    def _last_candle_shapes(self, ctx: dict[str, Any], candidate: PatternCandidate) -> list[OverlayShape]:
        last = len(ctx["window"]) - 1
        prev = max(0, last - 2)
        top = float(ctx["high"].iloc[prev:last + 1].max())
        bottom = float(ctx["low"].iloc[prev:last + 1].min())
        return [
            OverlayShape("line", candidate.pattern_name, [(prev, top), (last, top)], color="#2563eb"),
            OverlayShape("line", "Recent Low", [(prev, bottom), (last, bottom)], color="#dc2626"),
        ]

    def _build_generic_shapes(self, ctx: dict[str, Any]) -> list[OverlayShape]:
        return self._structure_shapes(
            ctx,
            PatternCandidate(
                pattern_name="Trend Structure",
                category="추세 구조",
                direction_bias="neutral",
                score=0.0,
                interpretation_ko="",
                likely_outcome_ko="",
                invalidation_ko="",
            ),
        )

    @staticmethod
    def _fit_segment_points(series: pd.Series, start_index: int) -> list[tuple[float, float]]:
        x_values = np.arange(len(series), dtype=float)
        y_values = series.to_numpy(dtype=float)
        if len(y_values) < 2:
            value = float(y_values[0]) if len(y_values) else 0.0
            return [(start_index, value), (start_index + 1, value)]
        slope, intercept = np.polyfit(x_values, y_values, deg=1)
        y0 = float(intercept)
        y1 = float(intercept + slope * (len(series) - 1))
        return [(start_index, y0), (start_index + len(series) - 1, y1)]


class PatternChartRenderer:
    """Render annotated OHLC close charts with pattern overlays."""

    def __init__(self, config: EngineConfig | None = None) -> None:
        self.config = config or EngineConfig()
        self.overlay_builder = PatternOverlayBuilder(self.config)

    def render_annotated_chart(
        self,
        frame: pd.DataFrame,
        pattern_analysis: PatternAnalysisResult | None,
        output_path: str | Path,
        title: str,
        indicator_frame: pd.DataFrame | None = None,
        axis: plt.Axes | None = None,
    ) -> tuple[PatternCandidate | None, list[OverlayShape]]:
        """Render or apply annotated chart overlays."""

        candidate, shapes, window = self.overlay_builder.build_shapes(frame, pattern_analysis, indicator_frame=indicator_frame)
        own_figure = axis is None
        if own_figure:
            figure, axis = plt.subplots(figsize=(14, 7))
        assert axis is not None
        axis.plot(window.index, window["close"], color="#111827", linewidth=1.25, label="Close")
        self.apply_shapes(axis, window, shapes)
        heading = title
        if candidate is not None:
            heading = f"{title} | Overlay: {candidate.pattern_name}"
        axis.set_title(heading)
        axis.set_ylabel("Price")
        axis.legend(loc="upper left")
        axis.grid(True, alpha=0.18, linewidth=0.6)
        if own_figure:
            figure.savefig(output_path, dpi=180, bbox_inches="tight")
            plt.close(figure)
        return candidate, shapes

    @staticmethod
    def apply_shapes(axis: plt.Axes, window: pd.DataFrame, shapes: list[OverlayShape]) -> None:
        dates = list(window.index)
        for shape in shapes:
            points = []
            for x_value, y_value in shape.points:
                x_index = int(round(x_value))
                x_index = max(0, min(len(dates) - 1, x_index))
                points.append((dates[x_index], y_value))
            if len(points) < 2:
                continue
            x_points = [point[0] for point in points]
            y_points = [point[1] for point in points]
            axis.plot(
                x_points,
                y_points,
                color=shape.color,
                linestyle="--" if shape.style == "dashed" else "-",
                linewidth=shape.width,
                alpha=shape.alpha,
            )
            axis.text(
                x_points[-1],
                y_points[-1],
                f" {shape.label}",
                color=shape.color,
                fontsize=8.5,
                va="bottom",
                ha="left",
                alpha=shape.alpha,
            )
