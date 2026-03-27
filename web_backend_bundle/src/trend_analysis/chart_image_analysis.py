"""Heuristic chart-image analysis and annotation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from PIL import Image, ImageColor, ImageDraw, ImageFont

from .config import EngineConfig
from .engine import TrendAnalysisEngine
from .models import ImageChartAnalysisResult, OverlayShape
from .pattern_overlay import PatternOverlayBuilder
from .utils import clamp


class ChartImageAnalyzer:
    """Approximate chart screenshots into a price series and annotate the image."""

    def __init__(self, config: EngineConfig | None = None) -> None:
        self.config = config or EngineConfig()
        self.engine = TrendAnalysisEngine(self.config)
        self.overlay_builder = PatternOverlayBuilder(self.config)

    def analyze_image(
        self,
        image_path: str | Path,
        annotated_output_path: str | Path | None = None,
        expected_bars: int | None = None,
        chart_style: str = "auto",
    ) -> ImageChartAnalysisResult:
        """Extract a pseudo price series from a chart image and annotate it."""

        image_path = Path(image_path).expanduser().resolve()
        extracted = self._extract_series(image_path, expected_bars=expected_bars, chart_style=chart_style)
        trend_result = self.engine.analyze(extracted["frame"])
        overlay_candidate, shapes, overlay_window = self.overlay_builder.build_shapes(
            extracted["frame"],
            trend_result.pattern_analysis,
        )

        output_path = None
        if annotated_output_path is not None:
            output_path = Path(annotated_output_path).expanduser().resolve()
        else:
            output_path = image_path.with_name(f"{image_path.stem}_annotated.png")
        self._annotate_image(
            image_path=image_path,
            output_path=output_path,
            extracted=extracted,
            overlay_window_length=len(overlay_window),
            shapes=shapes,
        )
        return ImageChartAnalysisResult(
            source_image_path=str(image_path),
            annotated_image_path=str(output_path),
            extracted_bars=int(len(extracted["frame"])),
            extraction_confidence=float(extracted["confidence"]),
            chart_bbox=tuple(int(value) for value in extracted["chart_bbox"]),
            trend_result=trend_result,
            diagnostics={
                "overlay_candidate": overlay_candidate.pattern_name if overlay_candidate is not None else None,
                "overlay_shapes": [shape.to_dict() for shape in shapes],
                "price_region": extracted["price_region"],
                "valid_trace_fraction": extracted["valid_trace_fraction"],
                "requested_chart_style": chart_style,
                "detected_chart_style": extracted["detected_chart_style"],
                "chart_style_confidence": extracted["chart_style_confidence"],
            },
        )

    def _extract_series(
        self,
        image_path: Path,
        expected_bars: int | None = None,
        chart_style: str = "auto",
    ) -> dict[str, Any]:
        image = Image.open(image_path).convert("RGB")
        pixels = np.asarray(image, dtype=np.uint8)
        border_samples = np.concatenate(
            [
                pixels[0, :, :],
                pixels[-1, :, :],
                pixels[:, 0, :],
                pixels[:, -1, :],
            ],
            axis=0,
        )
        background = np.median(border_samples, axis=0)
        distance = np.linalg.norm(pixels.astype(float) - background.astype(float), axis=2)
        mask = distance > 28.0

        row_density = mask.mean(axis=1)
        col_density = mask.mean(axis=0)
        row_indices = np.where(row_density > 0.002)[0]
        col_indices = np.where(col_density > 0.002)[0]
        if len(row_indices) < 10 or len(col_indices) < 30:
            raise ValueError("Could not locate a chart region in the uploaded image.")

        height, width, _ = pixels.shape
        x0 = max(int(col_indices[0]) - 4, 0)
        y0 = max(int(row_indices[0]) - 4, 0)
        x1 = min(int(col_indices[-1]) + 4, width - 1)
        y1 = min(int(row_indices[-1]) + 4, height - 1)

        chart_height = max(y1 - y0, 10)
        price_bottom = min(y0 + int(chart_height * 0.82), y1)
        price_top = y0
        price_mask = mask[price_top : price_bottom + 1, x0 : x1 + 1]
        if int(price_mask.sum()) < 40:
            raise ValueError("The image did not contain enough detectable chart pixels for analysis.")

        price_pixels = pixels[price_top : price_bottom + 1, x0 : x1 + 1]
        inner_margin = 2
        if price_mask.shape[0] > (inner_margin * 2 + 8) and price_mask.shape[1] > (inner_margin * 2 + 8):
            price_mask = price_mask[inner_margin:-inner_margin, inner_margin:-inner_margin]
            price_pixels = price_pixels[inner_margin:-inner_margin, inner_margin:-inner_margin]
            x0 += inner_margin
            price_top += inner_margin
            x1 -= inner_margin
            price_bottom -= inner_margin
        line_candidate = None
        candle_candidate = None
        if chart_style in {"line", "auto"}:
            line_candidate = self._extract_line_series(
                price_mask=price_mask,
                x0=x0,
                price_top=price_top,
                price_bottom=price_bottom,
                expected_bars=expected_bars,
            )
        if chart_style in {"candlestick", "auto"}:
            try:
                candle_candidate = self._extract_candlestick_series(
                    price_pixels=price_pixels,
                    price_mask=price_mask,
                    x0=x0,
                    price_top=price_top,
                    price_bottom=price_bottom,
                    expected_bars=expected_bars,
                )
            except ValueError:
                if chart_style == "candlestick":
                    raise

        extracted = self._select_extraction(
            requested_chart_style=chart_style,
            line_candidate=line_candidate,
            candle_candidate=candle_candidate,
            price_pixels=price_pixels,
            price_mask=price_mask,
        )
        extracted["chart_bbox"] = (x0, y0, x1, y1)
        extracted["price_region"] = (x0, price_top, x1, price_bottom)
        return extracted

    def _extract_line_series(
        self,
        price_mask: np.ndarray,
        x0: int,
        price_top: int,
        price_bottom: int,
        expected_bars: int | None,
    ) -> dict[str, Any]:
        trace = np.full(price_mask.shape[1], np.nan, dtype=float)
        valid_columns = 0
        for column in range(price_mask.shape[1]):
            y_positions = np.where(price_mask[:, column])[0]
            if len(y_positions) == 0:
                continue
            valid_columns += 1
            if len(y_positions) >= 5:
                low_quantile, high_quantile = np.percentile(y_positions, [20, 80])
                trimmed = y_positions[(y_positions >= low_quantile) & (y_positions <= high_quantile)]
                if len(trimmed) > 0:
                    y_positions = trimmed
            trace[column] = float(np.median(y_positions))
        if valid_columns < 40:
            raise ValueError("The image did not contain enough continuous line data for analysis.")

        valid_trace_fraction = valid_columns / max(len(trace), 1)
        valid_mask = ~np.isnan(trace)
        all_columns = np.arange(len(trace), dtype=float)
        interpolated_trace = np.interp(all_columns, all_columns[valid_mask], trace[valid_mask])
        target_bars = self._resolve_target_bars(expected_bars, len(interpolated_trace), style="line")
        bin_edges = np.linspace(0, len(interpolated_trace), num=target_bars + 1, dtype=int)

        records: list[dict[str, float]] = []
        x_pixels: list[float] = []
        for index in range(target_bars):
            left = int(bin_edges[index])
            right = int(bin_edges[index + 1])
            if right <= left:
                right = min(left + 1, len(interpolated_trace))
            segment = interpolated_trace[left:right]
            if len(segment) == 0:
                continue
            x_center = x0 + ((left + right - 1) / 2.0)
            x_pixels.append(x_center)
            open_px = float(segment[0])
            close_px = float(segment[-1])
            high_px = float(np.min(segment))
            low_px = float(np.max(segment))
            records.append(self._record_from_pixels(open_px, close_px, high_px, low_px, price_top, price_bottom))

        frame = self._frame_from_records(records)
        return {
            "frame": frame,
            "x_pixels": x_pixels,
            "confidence": min(100.0, max(0.0, valid_trace_fraction * 100.0)),
            "valid_trace_fraction": valid_trace_fraction,
            "detected_chart_style": "line",
            "chart_style_confidence": valid_trace_fraction,
            "body_fraction": 0.0,
        }

    def _extract_candlestick_series(
        self,
        price_pixels: np.ndarray,
        price_mask: np.ndarray,
        x0: int,
        price_top: int,
        price_bottom: int,
        expected_bars: int | None,
    ) -> dict[str, Any]:
        target_bars = self._resolve_target_bars(expected_bars, price_mask.shape[1], style="candlestick")
        bin_edges = np.linspace(0, price_mask.shape[1], num=target_bars + 1, dtype=int)

        records: list[dict[str, float]] = []
        x_pixels: list[float] = []
        valid_bars = 0
        body_like_bars = 0
        colored_bars = 0

        for index in range(target_bars):
            left = int(bin_edges[index])
            right = int(bin_edges[index + 1])
            if right <= left:
                right = min(left + 1, price_mask.shape[1])
            segment_mask = price_mask[:, left:right]
            x_center = x0 + ((left + right - 1) / 2.0)
            x_pixels.append(x_center)
            if int(segment_mask.sum()) == 0:
                records.append({"open": np.nan, "high": np.nan, "low": np.nan, "close": np.nan, "volume": 1_000_000.0})
                continue

            valid_bars += 1
            y_rows, _ = np.where(segment_mask)
            high_px = float(y_rows.min())
            low_px = float(y_rows.max())

            col_counts = segment_mask.sum(axis=0)
            positive_counts = col_counts[col_counts > 0]
            typical_body_height = float(np.median(positive_counts)) if len(positive_counts) else 0.0
            low_floor = max(2.0, typical_body_height * 0.6)
            high_cap = max(low_floor + 1.0, typical_body_height * 2.2)
            body_cols = np.where((col_counts >= low_floor) & (col_counts <= high_cap))[0]
            if len(body_cols) == 0 and len(positive_counts):
                percentile_cap = float(np.percentile(positive_counts, 80))
                body_cols = np.where((col_counts >= max(1.0, typical_body_height * 0.5)) & (col_counts <= percentile_cap))[0]
            if len(body_cols) >= 2:
                body_like_bars += 1

            if len(body_cols) > 0:
                body_tops: list[int] = []
                body_bottoms: list[int] = []
                for body_col in body_cols:
                    body_rows = np.where(segment_mask[:, body_col])[0]
                    if len(body_rows) == 0:
                        continue
                    body_tops.append(int(body_rows.min()))
                    body_bottoms.append(int(body_rows.max()))
                body_top_px = float(np.median(body_tops)) if body_tops else high_px
                body_bottom_px = float(np.median(body_bottoms)) if body_bottoms else low_px
            else:
                body_top_px = high_px
                body_bottom_px = low_px

            body_region_mask = np.zeros_like(segment_mask, dtype=bool)
            if len(body_cols) > 0:
                body_region_mask[:, body_cols] = segment_mask[:, body_cols]
            body_pixels = price_pixels[:, left:right][body_region_mask] if bool(body_region_mask.any()) else price_pixels[:, left:right][segment_mask]
            direction = self._infer_candle_direction(body_pixels)
            if direction != "neutral":
                colored_bars += 1

            body_mid_px = (body_top_px + body_bottom_px) / 2.0
            if abs(body_bottom_px - body_top_px) <= 1.0:
                open_px = body_mid_px
                close_px = body_mid_px
            elif direction == "bullish":
                open_px = body_bottom_px
                close_px = body_top_px
            elif direction == "bearish":
                open_px = body_top_px
                close_px = body_bottom_px
            else:
                open_px = body_mid_px
                close_px = body_mid_px

            records.append(self._record_from_pixels(open_px, close_px, high_px, low_px, price_top, price_bottom))

        valid_bar_fraction = valid_bars / max(target_bars, 1)
        body_fraction = body_like_bars / max(target_bars, 1)
        color_fraction = colored_bars / max(valid_bars, 1)
        if valid_bars < self.config.data.min_bars or body_fraction < 0.18:
            raise ValueError("Could not reliably detect candlestick bodies in the uploaded image.")

        frame = self._frame_from_records(records)
        chart_style_confidence = clamp((valid_bar_fraction * 0.45) + (body_fraction * 0.40) + (color_fraction * 0.15), 0.0, 1.0)
        return {
            "frame": frame,
            "x_pixels": x_pixels,
            "confidence": chart_style_confidence * 100.0,
            "valid_trace_fraction": valid_bar_fraction,
            "detected_chart_style": "candlestick",
            "chart_style_confidence": chart_style_confidence,
            "body_fraction": body_fraction,
        }

    def _select_extraction(
        self,
        requested_chart_style: str,
        line_candidate: dict[str, Any] | None,
        candle_candidate: dict[str, Any] | None,
        price_pixels: np.ndarray,
        price_mask: np.ndarray,
    ) -> dict[str, Any]:
        if requested_chart_style == "line":
            if line_candidate is None:
                raise ValueError("Could not extract a line chart trace from the uploaded image.")
            return line_candidate
        if requested_chart_style == "candlestick":
            if candle_candidate is None:
                raise ValueError("Could not extract candlesticks from the uploaded image.")
            return candle_candidate

        colorful_ratio = self._colorful_ratio(price_pixels, price_mask)
        candle_hint = colorful_ratio
        if candle_candidate is not None:
            candle_hint = max(candle_hint, candle_candidate.get("body_fraction", 0.0))
        if candle_candidate is not None and candle_hint >= 0.20:
            return candle_candidate
        if line_candidate is not None:
            return line_candidate
        if candle_candidate is not None:
            return candle_candidate
        raise ValueError("Could not extract a usable price series from the uploaded image.")

    def _annotate_image(
        self,
        image_path: Path,
        output_path: Path,
        extracted: dict[str, Any],
        overlay_window_length: int,
        shapes: list[OverlayShape],
    ) -> None:
        image = Image.open(image_path).convert("RGB")
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default()
        x0, price_top, x1, price_bottom = extracted["price_region"]
        x_pixels = extracted["x_pixels"]
        total_bars = len(x_pixels)
        window_offset = max(0, total_bars - overlay_window_length)

        for shape in shapes:
            pixel_points: list[tuple[int, int]] = []
            for x_value, price_value in shape.points:
                bar_index = max(0, min(total_bars - 1, int(round(x_value)) + window_offset))
                x_pixel = int(round(x_pixels[bar_index]))
                y_pixel = int(round(self._price_to_y(price_value, price_top, price_bottom)))
                pixel_points.append((x_pixel, y_pixel))
            if len(pixel_points) < 2:
                continue
            color = ImageColor.getrgb(shape.color)
            self._draw_line(draw, pixel_points, color, shape.width, dashed=shape.style == "dashed")
            text_x, text_y = pixel_points[-1]
            draw.text((text_x + 6, text_y - 12), shape.label, fill=color, font=font)

        outline_color = ImageColor.getrgb("#2563eb")
        draw.rectangle(extracted["chart_bbox"], outline=outline_color, width=2)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(output_path)

    def _resolve_target_bars(self, expected_bars: int | None, trace_length: int, style: str) -> int:
        if expected_bars is not None:
            return int(max(self.config.data.min_bars, min(self.config.data.max_bars, expected_bars)))
        divisor = 6 if style == "candlestick" else 4
        target_bars = int(min(self.config.data.max_bars, max(self.config.data.min_bars, trace_length // divisor)))
        return max(target_bars, self.config.data.min_bars)

    def _record_from_pixels(
        self,
        open_px: float,
        close_px: float,
        high_px: float,
        low_px: float,
        price_top: int,
        price_bottom: int,
    ) -> dict[str, float]:
        open_price = self._y_to_price(open_px, price_top, price_bottom)
        close_price = self._y_to_price(close_px, price_top, price_bottom)
        high_price = self._y_to_price(high_px, price_top, price_bottom)
        low_price = self._y_to_price(low_px, price_top, price_bottom)
        return {
            "open": open_price,
            "high": max(high_price, open_price, close_price),
            "low": min(low_price, open_price, close_price),
            "close": close_price,
            "volume": 1_000_000.0,
        }

    def _frame_from_records(self, records: list[dict[str, float]]) -> pd.DataFrame:
        frame = pd.DataFrame(records)
        frame = frame.interpolate(limit_direction="both")
        frame["volume"] = frame["volume"].fillna(1_000_000.0)
        frame = frame.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
        if len(frame) < self.config.data.min_bars:
            raise ValueError("The extracted chart trace was too short for analysis.")
        frame.index = pd.date_range("2025-01-01", periods=len(frame), freq="B")
        return frame

    @staticmethod
    def _colorful_ratio(price_pixels: np.ndarray, price_mask: np.ndarray) -> float:
        masked_pixels = price_pixels[price_mask]
        if masked_pixels.size == 0:
            return 0.0
        rgb = masked_pixels.reshape(-1, 3).astype(int)
        colorful = (np.abs(rgb[:, 1] - rgb[:, 0]) > 25) | (np.max(rgb, axis=1) - np.min(rgb, axis=1) > 25)
        return float(colorful.mean())

    @staticmethod
    def _infer_candle_direction(body_pixels: np.ndarray) -> str:
        if body_pixels.size == 0:
            return "neutral"
        rgb = body_pixels.reshape(-1, 3).astype(int)
        bullish = int(((rgb[:, 1] - rgb[:, 0]) > 20).sum())
        bearish = int(((rgb[:, 0] - rgb[:, 1]) > 20).sum())
        if bullish >= max(4, int(bearish * 1.15)):
            return "bullish"
        if bearish >= max(4, int(bullish * 1.15)):
            return "bearish"
        return "neutral"

    @staticmethod
    def _draw_line(
        draw: ImageDraw.ImageDraw,
        points: list[tuple[int, int]],
        color: tuple[int, int, int],
        width: float,
        dashed: bool = False,
    ) -> None:
        if not dashed:
            draw.line(points, fill=color, width=max(1, int(round(width))))
            return
        for start, end in zip(points[:-1], points[1:]):
            x0, y0 = start
            x1, y1 = end
            steps = max(abs(x1 - x0), abs(y1 - y0), 1)
            dash = 8
            gap = 5
            for offset in range(0, steps, dash + gap):
                start_ratio = offset / steps
                end_ratio = min(offset + dash, steps) / steps
                sx = int(round(x0 + (x1 - x0) * start_ratio))
                sy = int(round(y0 + (y1 - y0) * start_ratio))
                ex = int(round(x0 + (x1 - x0) * end_ratio))
                ey = int(round(y0 + (y1 - y0) * end_ratio))
                draw.line([(sx, sy), (ex, ey)], fill=color, width=max(1, int(round(width))))

    @staticmethod
    def _y_to_price(y_value: float, price_top: int, price_bottom: int) -> float:
        height = max(price_bottom - price_top, 1)
        normalized = 1.0 - ((y_value - 0.0) / height)
        return 100.0 + (normalized * 100.0)

    @staticmethod
    def _price_to_y(price_value: float, price_top: int, price_bottom: int) -> float:
        height = max(price_bottom - price_top, 1)
        normalized = (price_value - 100.0) / 100.0
        normalized = max(0.0, min(1.0, normalized))
        return price_top + ((1.0 - normalized) * height)
