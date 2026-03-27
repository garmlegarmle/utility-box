"""Validate image-based chart analysis by rendering windows from OHLCV CSV data."""

from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import pandas as pd
from PIL import Image, ImageDraw

from .config import EngineConfig
from .engine import TrendAnalysisEngine
from .utils import safe_divide


@dataclass(slots=True)
class ImageValidationArtifacts:
    """Generated files for one image-validation run."""

    output_dir: Path
    analysis_csv: Path
    metrics_json: Path
    summary_md: Path
    sample_images_dir: Path | None = None

    def to_dict(self) -> dict[str, str | None]:
        return {
            "output_dir": str(self.output_dir),
            "analysis_csv": str(self.analysis_csv),
            "metrics_json": str(self.metrics_json),
            "summary_md": str(self.summary_md),
            "sample_images_dir": str(self.sample_images_dir) if self.sample_images_dir else None,
        }


class ImageValidationRunner:
    """Backtest image-based chart analysis from a source OHLCV CSV."""

    def __init__(
        self,
        config: EngineConfig | None = None,
        window_bars: int | None = None,
        step_bars: int = 10,
        forward_horizons: Iterable[int] = (5, 10, 20),
        keep_sample_images: bool = False,
        max_samples: int | None = None,
        chart_style: str = "line",
    ) -> None:
        self.config = config or EngineConfig()
        self.engine = TrendAnalysisEngine(self.config)
        self.window_bars = max(window_bars or self.config.data.max_bars, self.config.data.min_bars)
        self.step_bars = max(step_bars, 1)
        self.forward_horizons = tuple(sorted({int(horizon) for horizon in forward_horizons if int(horizon) > 0}))
        self.keep_sample_images = keep_sample_images
        self.max_samples = max_samples
        self.chart_style = str(chart_style).strip().lower() or "line"

    def build_from_csv(
        self,
        csv_path: str | Path,
        output_dir: str | Path,
        date_column: str = "date",
        ticker: str | None = None,
    ) -> ImageValidationArtifacts:
        """Run windowed validation and save result artifacts."""

        csv_path = Path(csv_path).expanduser().resolve()
        output_dir = Path(output_dir).expanduser().resolve()
        output_dir.mkdir(parents=True, exist_ok=True)

        cleaned = self.engine.data_handler.load_csv(csv_path, date_column=date_column)
        ticker_label = ticker or self._infer_ticker(csv_path)
        sample_images_dir = output_dir / "sample_images" if self.keep_sample_images else None
        if sample_images_dir is not None:
            sample_images_dir.mkdir(parents=True, exist_ok=True)

        artifacts = ImageValidationArtifacts(
            output_dir=output_dir,
            analysis_csv=output_dir / f"{ticker_label}_{self.chart_style}_image_validation.csv",
            metrics_json=output_dir / f"{ticker_label}_{self.chart_style}_image_validation_metrics.json",
            summary_md=output_dir / f"{ticker_label}_{self.chart_style}_image_validation_summary.md",
            sample_images_dir=sample_images_dir,
        )

        analysis_df = self.evaluate_frame(
            cleaned=cleaned,
            ticker=ticker_label,
            sample_images_dir=sample_images_dir if self.keep_sample_images else None,
        )
        metrics = self._build_metrics(analysis_df, ticker_label, csv_path)
        analysis_df.to_csv(artifacts.analysis_csv, index=False)
        artifacts.metrics_json.write_text(json.dumps(metrics, indent=2, default=str), encoding="utf-8")
        artifacts.summary_md.write_text(self._render_summary(metrics, artifacts), encoding="utf-8")
        return artifacts

    def evaluate_frame(
        self,
        cleaned: pd.DataFrame,
        ticker: str,
        sample_images_dir: Path | None = None,
    ) -> pd.DataFrame:
        """Return row-level validation results for an already-cleaned OHLCV frame."""

        max_horizon = max(self.forward_horizons, default=0)
        minimum_required = self.window_bars + max_horizon
        if len(cleaned) < minimum_required:
            raise ValueError(
                f"Image validation needs at least {minimum_required} cleaned rows "
                f"for window={self.window_bars} and max horizon={max_horizon}, but only {len(cleaned)} are available."
            )

        if sample_images_dir is not None:
            sample_images_dir.mkdir(parents=True, exist_ok=True)
            rows = self._run_validation(cleaned, ticker, sample_images_dir=sample_images_dir)
        else:
            with tempfile.TemporaryDirectory() as temp_dir:
                rows = self._run_validation(cleaned, ticker, sample_images_dir=Path(temp_dir))
        return pd.DataFrame(rows)

    def _run_validation(
        self,
        cleaned: pd.DataFrame,
        ticker: str,
        sample_images_dir: Path,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        max_horizon = max(self.forward_horizons, default=0)
        final_stop = len(cleaned) - max_horizon
        starts = range(self.window_bars, final_stop + 1, self.step_bars)

        for sample_index, stop in enumerate(starts, start=1):
            if self.max_samples is not None and len(rows) >= self.max_samples:
                break

            window = cleaned.iloc[stop - self.window_bars : stop].copy()
            as_of_date = pd.Timestamp(window.index[-1])
            direct_result = self.engine.analyze(window)
            direct_pattern = direct_result.pattern_analysis.primary_candidate if direct_result.pattern_analysis else None
            direct_top2 = {
                candidate.pattern_name
                for candidate in (direct_result.pattern_analysis.candidates[:2] if direct_result.pattern_analysis else [])
            }

            base_name = f"{ticker}_{sample_index:04d}_{as_of_date.date().isoformat()}"
            rendered_chart_path = sample_images_dir / f"{base_name}.png"
            annotated_chart_path = sample_images_dir / f"{base_name}_annotated.png"
            self._render_window_image(
                window,
                rendered_chart_path,
                ticker=ticker,
                as_of_date=as_of_date,
                chart_style=self.chart_style,
            )
            image_result = self.engine.analyze_chart_image(
                image_path=rendered_chart_path,
                annotated_output_path=annotated_chart_path,
                expected_bars=len(window),
                chart_style=self.chart_style,
            )
            image_pattern = image_result.trend_result.pattern_analysis.primary_candidate if image_result.trend_result.pattern_analysis else None
            image_top2 = {
                candidate.pattern_name
                for candidate in (image_result.trend_result.pattern_analysis.candidates[:2] if image_result.trend_result.pattern_analysis else [])
            }

            row: dict[str, Any] = {
                "sample_index": sample_index,
                "as_of_date": as_of_date.isoformat(),
                "window_start": pd.Timestamp(window.index[0]).isoformat(),
                "window_end": as_of_date.isoformat(),
                "bars_used": len(window),
                "chart_style": self.chart_style,
                "csv_regime_label": direct_result.regime_label,
                "csv_trend_state_label": direct_result.trend_state_label,
                "csv_transition_risk_label": direct_result.transition_risk_label,
                "csv_primary_pattern": direct_pattern.pattern_name if direct_pattern else None,
                "csv_primary_category": direct_pattern.category if direct_pattern else None,
                "csv_primary_direction": direct_pattern.direction_bias if direct_pattern else None,
                "csv_primary_score": direct_pattern.score if direct_pattern else None,
                "csv_top2_patterns": "|".join(sorted(direct_top2)) if direct_top2 else None,
                "image_regime_label": image_result.trend_result.regime_label,
                "image_trend_state_label": image_result.trend_result.trend_state_label,
                "image_transition_risk_label": image_result.trend_result.transition_risk_label,
                "image_primary_pattern": image_pattern.pattern_name if image_pattern else None,
                "image_primary_category": image_pattern.category if image_pattern else None,
                "image_primary_direction": image_pattern.direction_bias if image_pattern else None,
                "image_primary_score": image_pattern.score if image_pattern else None,
                "image_top2_patterns": "|".join(sorted(image_top2)) if image_top2 else None,
                "trend_state_match": direct_result.trend_state_label == image_result.trend_result.trend_state_label,
                "primary_pattern_match": (direct_pattern.pattern_name if direct_pattern else None)
                == (image_pattern.pattern_name if image_pattern else None),
                "top2_overlap": bool(direct_top2.intersection(image_top2)),
                "image_extraction_confidence": image_result.extraction_confidence,
                "image_extracted_bars": image_result.extracted_bars,
                "image_detected_chart_style": image_result.diagnostics.get("detected_chart_style"),
                "image_chart_style_confidence": image_result.diagnostics.get("chart_style_confidence"),
                "image_chart_style_match": self.chart_style == image_result.diagnostics.get("detected_chart_style"),
                "rendered_chart_path": str(rendered_chart_path) if self.keep_sample_images else None,
                "annotated_chart_path": str(annotated_chart_path) if self.keep_sample_images else None,
            }

            as_of_close = float(cleaned["close"].iloc[stop - 1])
            for horizon in self.forward_horizons:
                future_close = float(cleaned["close"].iloc[stop + horizon - 1])
                forward_return = safe_divide(future_close - as_of_close, as_of_close, default=0.0) * 100.0
                row[f"forward_return_{horizon}"] = forward_return
                row[f"csv_direction_hit_{horizon}"] = self._direction_hit(
                    direct_pattern.direction_bias if direct_pattern else None,
                    forward_return,
                )
                row[f"image_direction_hit_{horizon}"] = self._direction_hit(
                    image_pattern.direction_bias if image_pattern else None,
                    forward_return,
                )
                row[f"csv_signed_forward_return_{horizon}"] = self._signed_forward_return(
                    direct_pattern.direction_bias if direct_pattern else None,
                    forward_return,
                )
                row[f"image_signed_forward_return_{horizon}"] = self._signed_forward_return(
                    image_pattern.direction_bias if image_pattern else None,
                    forward_return,
                )
            rows.append(row)
        return rows

    @staticmethod
    def _direction_hit(direction_bias: str | None, forward_return: float) -> bool | None:
        if direction_bias == "bullish":
            return forward_return > 0.0
        if direction_bias == "bearish":
            return forward_return < 0.0
        return None

    @staticmethod
    def _signed_forward_return(direction_bias: str | None, forward_return: float) -> float | None:
        if direction_bias == "bullish":
            return forward_return
        if direction_bias == "bearish":
            return -forward_return
        return None

    def _build_metrics(
        self,
        analysis_df: pd.DataFrame,
        ticker: str,
        csv_path: Path,
    ) -> dict[str, Any]:
        sample_count = int(len(analysis_df))
        metrics: dict[str, Any] = {
            "ticker": ticker,
            "source_csv": str(csv_path),
            "chart_style": self.chart_style,
            "sample_count": sample_count,
            "window_bars": self.window_bars,
            "step_bars": self.step_bars,
            "forward_horizons": list(self.forward_horizons),
            "trend_state_match_rate": self._mean_bool(analysis_df["trend_state_match"]),
            "primary_pattern_match_rate": self._mean_bool(analysis_df["primary_pattern_match"]),
            "top2_overlap_rate": self._mean_bool(analysis_df["top2_overlap"]),
            "mean_image_extraction_confidence": float(analysis_df["image_extraction_confidence"].mean()) if sample_count else 0.0,
            "mean_image_extracted_bars": float(analysis_df["image_extracted_bars"].mean()) if sample_count else 0.0,
            "chart_style_match_rate": self._mean_bool(analysis_df["image_chart_style_match"]),
        }

        horizon_metrics: dict[str, Any] = {}
        for horizon in self.forward_horizons:
            csv_hits = analysis_df[f"csv_direction_hit_{horizon}"].dropna()
            image_hits = analysis_df[f"image_direction_hit_{horizon}"].dropna()
            bullish_mask_csv = analysis_df["csv_primary_direction"] == "bullish"
            bearish_mask_csv = analysis_df["csv_primary_direction"] == "bearish"
            bullish_mask_image = analysis_df["image_primary_direction"] == "bullish"
            bearish_mask_image = analysis_df["image_primary_direction"] == "bearish"

            horizon_metrics[str(horizon)] = {
                "mean_forward_return": float(analysis_df[f"forward_return_{horizon}"].mean()),
                "csv_directional_accuracy": float(csv_hits.mean()) if not csv_hits.empty else None,
                "image_directional_accuracy": float(image_hits.mean()) if not image_hits.empty else None,
                "csv_bullish_mean_forward_return": float(analysis_df.loc[bullish_mask_csv, f"forward_return_{horizon}"].mean())
                if bool(bullish_mask_csv.any())
                else None,
                "csv_bearish_mean_forward_return": float(analysis_df.loc[bearish_mask_csv, f"forward_return_{horizon}"].mean())
                if bool(bearish_mask_csv.any())
                else None,
                "image_bullish_mean_forward_return": float(analysis_df.loc[bullish_mask_image, f"forward_return_{horizon}"].mean())
                if bool(bullish_mask_image.any())
                else None,
                "image_bearish_mean_forward_return": float(analysis_df.loc[bearish_mask_image, f"forward_return_{horizon}"].mean())
                if bool(bearish_mask_image.any())
                else None,
                "csv_signal_count": int(csv_hits.shape[0]),
                "image_signal_count": int(image_hits.shape[0]),
            }
        metrics["horizons"] = horizon_metrics
        return metrics

    def _render_summary(self, metrics: dict[str, Any], artifacts: ImageValidationArtifacts) -> str:
        lines = [
            f"# {metrics['ticker']} Image Validation Summary",
            "",
            "## Setup",
            f"- Source CSV: {metrics['source_csv']}",
            f"- Chart style: {metrics['chart_style']}",
            f"- Samples: {metrics['sample_count']}",
            f"- Window bars: {metrics['window_bars']}",
            f"- Step bars: {metrics['step_bars']}",
            f"- Mean image extraction confidence: {metrics['mean_image_extraction_confidence']:.2f}",
            f"- Mean extracted bars: {metrics['mean_image_extracted_bars']:.2f}",
            f"- Chart style match rate: {metrics['chart_style_match_rate']:.4f}"
            if metrics["chart_style_match_rate"] is not None
            else "- Chart style match rate: n/a",
            "",
            "## Agreement",
            f"- Trend state match rate: {metrics['trend_state_match_rate']:.4f}",
            f"- Primary pattern match rate: {metrics['primary_pattern_match_rate']:.4f}",
            f"- Top-2 overlap rate: {metrics['top2_overlap_rate']:.4f}",
            "",
            "## Horizons",
        ]
        for horizon, payload in metrics["horizons"].items():
            lines.extend(
                [
                    f"### Forward {horizon} bars",
                    f"- Mean forward return: {payload['mean_forward_return']:.4f}",
                    f"- CSV directional accuracy: {payload['csv_directional_accuracy']:.4f}" if payload["csv_directional_accuracy"] is not None else "- CSV directional accuracy: n/a",
                    f"- Image directional accuracy: {payload['image_directional_accuracy']:.4f}" if payload["image_directional_accuracy"] is not None else "- Image directional accuracy: n/a",
                    f"- CSV signal count: {payload['csv_signal_count']}",
                    f"- Image signal count: {payload['image_signal_count']}",
                    "",
                ]
            )
        lines.extend(
            [
                "## Files",
                f"- Analysis CSV: `{artifacts.analysis_csv.name}`",
                f"- Metrics JSON: `{artifacts.metrics_json.name}`",
                f"- Summary: `{artifacts.summary_md.name}`",
            ]
        )
        if artifacts.sample_images_dir is not None:
            lines.append(f"- Sample images: `{artifacts.sample_images_dir.name}`")
        return "\n".join(lines) + "\n"

    @staticmethod
    def _render_window_image(
        window: pd.DataFrame,
        output_path: Path,
        ticker: str,
        as_of_date: pd.Timestamp,
        chart_style: str = "line",
        width: int = 960,
        height: int = 540,
    ) -> None:
        image = Image.new("RGB", (width, height), color="white")
        draw = ImageDraw.Draw(image)
        chart_left = 70
        chart_top = 50
        chart_right = width - 50
        chart_bottom = height - 90
        draw.rectangle((chart_left, chart_top, chart_right, chart_bottom), outline="#94a3b8", width=2)
        low = window["low"].astype(float)
        high = window["high"].astype(float)
        min_price = float(low.min())
        max_price = float(high.max())
        price_padding = max((max_price - min_price) * 0.05, 1e-6)
        min_price -= price_padding
        max_price += price_padding
        span = max(max_price - min_price, 1e-6)

        def _price_to_y(price_value: float) -> int:
            normalized = (float(price_value) - min_price) / span
            return chart_bottom - int(round(normalized * (chart_bottom - chart_top)))

        if chart_style == "candlestick":
            candle_space = (chart_right - chart_left) / max(len(window), 1)
            body_width = max(3, int(round(candle_space * 0.65)))
            for index, (_, row) in enumerate(window.iterrows()):
                x_center = chart_left + int(round((index + 0.5) * candle_space))
                open_y = _price_to_y(float(row["open"]))
                close_y = _price_to_y(float(row["close"]))
                high_y = _price_to_y(float(row["high"]))
                low_y = _price_to_y(float(row["low"]))
                bullish = float(row["close"]) >= float(row["open"])
                color = "#15803d" if bullish else "#b91c1c"
                draw.line([(x_center, high_y), (x_center, low_y)], fill=color, width=2)
                top_y = min(open_y, close_y)
                bottom_y = max(open_y, close_y)
                if abs(bottom_y - top_y) <= 1:
                    draw.line([(x_center - body_width // 2, top_y), (x_center + body_width // 2, bottom_y)], fill=color, width=3)
                else:
                    draw.rectangle(
                        (x_center - body_width // 2, top_y, x_center + body_width // 2, bottom_y),
                        fill=color,
                        outline=color,
                    )
        else:
            close = window["close"].astype(float)
            points: list[tuple[int, int]] = []
            for index, value in enumerate(close.to_list()):
                x_value = chart_left + int(round(index * (chart_right - chart_left) / max(len(close) - 1, 1)))
                y_value = _price_to_y(float(value))
                points.append((x_value, y_value))
            if len(points) >= 2:
                draw.line(points, fill="black", width=4)

        draw.text(
            (chart_left, height - 30),
            f"{ticker} | {as_of_date.date().isoformat()} | {len(window)} bars | {chart_style}",
            fill="black",
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(output_path)

    @staticmethod
    def _mean_bool(series: pd.Series) -> float:
        if series.empty:
            return 0.0
        return float(series.astype(float).mean())

    @staticmethod
    def _infer_ticker(csv_path: Path) -> str:
        stem = csv_path.stem
        return stem.split("_")[0].upper() if "_" in stem else stem.upper()
