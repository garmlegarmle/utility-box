"""Batch validation for image-based pattern recognition across OHLCV CSV files."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from .config import EngineConfig
from .image_validation import ImageValidationRunner


@dataclass(slots=True)
class BatchImageValidationArtifacts:
    """Generated files for a folder-level image validation run."""

    output_dir: Path
    all_samples_csv: Path
    file_summary_csv: Path
    csv_pattern_performance_csv: Path
    image_pattern_performance_csv: Path
    pattern_recognition_csv: Path
    pattern_confusion_csv: Path
    metrics_json: Path
    summary_md: Path
    sample_images_dir: Path | None = None

    def to_dict(self) -> dict[str, str | None]:
        return {
            "output_dir": str(self.output_dir),
            "all_samples_csv": str(self.all_samples_csv),
            "file_summary_csv": str(self.file_summary_csv),
            "csv_pattern_performance_csv": str(self.csv_pattern_performance_csv),
            "image_pattern_performance_csv": str(self.image_pattern_performance_csv),
            "pattern_recognition_csv": str(self.pattern_recognition_csv),
            "pattern_confusion_csv": str(self.pattern_confusion_csv),
            "metrics_json": str(self.metrics_json),
            "summary_md": str(self.summary_md),
            "sample_images_dir": str(self.sample_images_dir) if self.sample_images_dir else None,
        }


class BatchImageValidationRunner:
    """Run image-vs-CSV validation across a directory of OHLCV CSV files."""

    def __init__(
        self,
        config: EngineConfig | None = None,
        window_bars: int | None = None,
        step_bars: int = 20,
        forward_horizons: Iterable[int] = (5, 10, 20),
        keep_sample_images: bool = False,
        max_samples_per_file: int | None = None,
        chart_styles: Iterable[str] = ("line", "candlestick"),
    ) -> None:
        self.config = config or EngineConfig()
        minimum_pattern_window = max(self.config.data.min_bars, self.config.patterns.analysis_window_bars)
        self.window_bars = max(window_bars or minimum_pattern_window, self.config.data.min_bars)
        self.step_bars = max(step_bars, 1)
        self.forward_horizons = tuple(sorted({int(horizon) for horizon in forward_horizons if int(horizon) > 0}))
        self.keep_sample_images = keep_sample_images
        self.max_samples_per_file = max_samples_per_file
        self.chart_styles = tuple(dict.fromkeys(str(style).strip().lower() for style in chart_styles if str(style).strip()))
        self.image_runner = ImageValidationRunner(
            config=self.config,
            window_bars=self.window_bars,
            step_bars=self.step_bars,
            forward_horizons=self.forward_horizons,
            keep_sample_images=keep_sample_images,
            max_samples=max_samples_per_file,
            chart_style=self.chart_styles[0] if self.chart_styles else "line",
        )

    def _build_style_runner(self, chart_style: str) -> ImageValidationRunner:
        return ImageValidationRunner(
            config=self.config,
            window_bars=self.window_bars,
            step_bars=self.step_bars,
            forward_horizons=self.forward_horizons,
            keep_sample_images=self.keep_sample_images,
            max_samples=self.max_samples_per_file,
            chart_style=chart_style,
        )

    def build_from_directory(
        self,
        csv_dir: str | Path,
        output_dir: str | Path,
        date_column: str = "date",
        glob: str = "*.csv",
    ) -> BatchImageValidationArtifacts:
        """Run batch validation over every matching CSV in a directory."""

        csv_dir = Path(csv_dir).expanduser().resolve()
        output_dir = Path(output_dir).expanduser().resolve()
        output_dir.mkdir(parents=True, exist_ok=True)

        csv_paths = sorted(path for path in csv_dir.glob(glob) if path.is_file())
        if not csv_paths:
            raise ValueError(f"No CSV files matched {glob!r} under {csv_dir}.")

        artifacts = BatchImageValidationArtifacts(
            output_dir=output_dir,
            all_samples_csv=output_dir / "batch_image_validation_samples.csv",
            file_summary_csv=output_dir / "batch_image_validation_file_summary.csv",
            csv_pattern_performance_csv=output_dir / "batch_image_validation_csv_pattern_performance.csv",
            image_pattern_performance_csv=output_dir / "batch_image_validation_image_pattern_performance.csv",
            pattern_recognition_csv=output_dir / "batch_image_validation_pattern_recognition.csv",
            pattern_confusion_csv=output_dir / "batch_image_validation_pattern_confusion.csv",
            metrics_json=output_dir / "batch_image_validation_metrics.json",
            summary_md=output_dir / "batch_image_validation_summary.md",
            sample_images_dir=output_dir / "sample_images" if self.keep_sample_images else None,
        )
        if artifacts.sample_images_dir is not None:
            artifacts.sample_images_dir.mkdir(parents=True, exist_ok=True)

        sample_frames: list[pd.DataFrame] = []
        skipped_files: list[dict[str, str]] = []
        for csv_path in csv_paths:
            ticker = self.image_runner._infer_ticker(csv_path)
            try:
                cleaned = self.image_runner.engine.data_handler.load_csv(csv_path, date_column=date_column)
            except Exception as exc:  # pragma: no cover - defensive batch bookkeeping
                skipped_files.append(
                    {
                        "ticker": ticker,
                        "source_csv": str(csv_path),
                        "reason": str(exc),
                    }
                )
                continue

            for chart_style in self.chart_styles:
                runner = self._build_style_runner(chart_style)
                try:
                    sample_dir = (
                        artifacts.sample_images_dir / chart_style / ticker
                        if artifacts.sample_images_dir is not None
                        else None
                    )
                    frame = runner.evaluate_frame(cleaned=cleaned, ticker=ticker, sample_images_dir=sample_dir)
                except Exception as exc:  # pragma: no cover - defensive batch bookkeeping
                    skipped_files.append(
                        {
                            "ticker": ticker,
                            "chart_style": chart_style,
                            "source_csv": str(csv_path),
                            "reason": str(exc),
                        }
                    )
                    continue

                if frame.empty:
                    skipped_files.append(
                        {
                            "ticker": ticker,
                            "chart_style": chart_style,
                            "source_csv": str(csv_path),
                            "reason": "no validation samples were produced",
                        }
                    )
                    continue

                frame.insert(0, "source_csv", str(csv_path))
                frame.insert(0, "ticker", ticker)
                sample_frames.append(frame)

        if not sample_frames:
            reasons = "; ".join(item["reason"] for item in skipped_files) if skipped_files else "unknown"
            raise ValueError(f"Batch image validation produced no samples. Reasons: {reasons}")

        all_samples_df = pd.concat(sample_frames, ignore_index=True)
        all_samples_df = all_samples_df.sort_values(["chart_style", "ticker", "as_of_date"]).reset_index(drop=True)

        file_summary_df = self._build_file_summary(all_samples_df)
        csv_pattern_df = self._build_pattern_performance(all_samples_df, prefix="csv")
        image_pattern_df = self._build_pattern_performance(all_samples_df, prefix="image")
        pattern_recognition_df = self._build_pattern_recognition(all_samples_df)
        pattern_confusion_df = self._build_pattern_confusion(all_samples_df)
        metrics = self._build_metrics(
            all_samples_df=all_samples_df,
            file_summary_df=file_summary_df,
            csv_paths=csv_paths,
            skipped_files=skipped_files,
        )

        all_samples_df.to_csv(artifacts.all_samples_csv, index=False)
        file_summary_df.to_csv(artifacts.file_summary_csv, index=False)
        csv_pattern_df.to_csv(artifacts.csv_pattern_performance_csv, index=False)
        image_pattern_df.to_csv(artifacts.image_pattern_performance_csv, index=False)
        pattern_recognition_df.to_csv(artifacts.pattern_recognition_csv, index=False)
        pattern_confusion_df.to_csv(artifacts.pattern_confusion_csv, index=False)
        artifacts.metrics_json.write_text(json.dumps(metrics, indent=2, default=str), encoding="utf-8")
        artifacts.summary_md.write_text(
            self._render_summary(
                metrics=metrics,
                artifacts=artifacts,
                image_pattern_df=image_pattern_df,
                pattern_recognition_df=pattern_recognition_df,
            ),
            encoding="utf-8",
        )
        return artifacts

    def _build_file_summary(self, samples_df: pd.DataFrame) -> pd.DataFrame:
        rows: list[dict[str, Any]] = []
        for (chart_style, ticker), frame in samples_df.groupby(["chart_style", "ticker"], sort=True):
            dominant_csv_pattern, dominant_csv_pattern_share = self._dominant_value(frame["csv_primary_pattern"])
            dominant_image_pattern, dominant_image_pattern_share = self._dominant_value(frame["image_primary_pattern"])
            row: dict[str, Any] = {
                "chart_style": chart_style,
                "ticker": ticker,
                "source_csv": str(frame["source_csv"].iloc[0]),
                "sample_count": int(len(frame)),
                "trend_state_match_rate": self._mean_bool(frame["trend_state_match"]),
                "primary_pattern_match_rate": self._mean_bool(frame["primary_pattern_match"]),
                "top2_overlap_rate": self._mean_bool(frame["top2_overlap"]),
                "chart_style_match_rate": self._mean_bool(frame["image_chart_style_match"]),
                "primary_direction_match_rate": self._mean_match_rate(
                    frame["csv_primary_direction"],
                    frame["image_primary_direction"],
                ),
                "mean_image_extraction_confidence": self._mean_numeric(frame["image_extraction_confidence"]),
                "mean_image_extracted_bars": self._mean_numeric(frame["image_extracted_bars"]),
                "csv_unique_primary_patterns": int(frame["csv_primary_pattern"].dropna().nunique()),
                "image_unique_primary_patterns": int(frame["image_primary_pattern"].dropna().nunique()),
                "dominant_csv_pattern": dominant_csv_pattern,
                "dominant_csv_pattern_share": dominant_csv_pattern_share,
                "dominant_image_pattern": dominant_image_pattern,
                "dominant_image_pattern_share": dominant_image_pattern_share,
            }
            for horizon in self.forward_horizons:
                row[f"baseline_up_rate_{horizon}"] = float((frame[f"forward_return_{horizon}"] > 0.0).mean())
                row[f"csv_directional_accuracy_{horizon}"] = self._mean_bool(frame[f"csv_direction_hit_{horizon}"])
                row[f"image_directional_accuracy_{horizon}"] = self._mean_bool(frame[f"image_direction_hit_{horizon}"])
                row[f"csv_mean_signed_forward_return_{horizon}"] = self._mean_numeric(frame[f"csv_signed_forward_return_{horizon}"])
                row[f"image_mean_signed_forward_return_{horizon}"] = self._mean_numeric(frame[f"image_signed_forward_return_{horizon}"])
            rows.append(row)
        return pd.DataFrame(rows).sort_values(["chart_style", "ticker"]).reset_index(drop=True)

    def _build_pattern_performance(self, samples_df: pd.DataFrame, prefix: str) -> pd.DataFrame:
        pattern_col = f"{prefix}_primary_pattern"
        category_col = f"{prefix}_primary_category"
        direction_col = f"{prefix}_primary_direction"
        score_col = f"{prefix}_primary_score"
        rows: list[dict[str, Any]] = []

        for chart_style, style_frame in samples_df.groupby("chart_style", sort=True):
            style_count = max(len(style_frame), 1)
            grouped = style_frame.dropna(subset=[pattern_col]).groupby(pattern_col, sort=True)
            for pattern_name, frame in grouped:
                row: dict[str, Any] = {
                    "chart_style": chart_style,
                    "pattern_name": pattern_name,
                    "sample_count": int(len(frame)),
                    "sample_share": float(len(frame) / style_count),
                    "category_mode": self._mode(frame[category_col]),
                    "direction_mode": self._mode(frame[direction_col]),
                    "mean_score": self._mean_numeric(frame[score_col]),
                    "top1_match_rate": self._mean_bool(frame["primary_pattern_match"]),
                }
                if prefix == "csv":
                    row["image_top2_capture_rate"] = self._mean_bool(self._top2_contains(frame["image_top2_patterns"], pattern_name))
                else:
                    row["csv_top2_capture_rate"] = self._mean_bool(self._top2_contains(frame["csv_top2_patterns"], pattern_name))
                    row["mean_image_extraction_confidence"] = self._mean_numeric(frame["image_extraction_confidence"])
                    row["chart_style_match_rate"] = self._mean_bool(frame["image_chart_style_match"])

                for horizon in self.forward_horizons:
                    row[f"directional_accuracy_{horizon}"] = self._mean_bool(frame[f"{prefix}_direction_hit_{horizon}"])
                    row[f"signal_count_{horizon}"] = int(frame[f"{prefix}_direction_hit_{horizon}"].dropna().shape[0])
                    row[f"mean_forward_return_{horizon}"] = self._mean_numeric(frame[f"forward_return_{horizon}"])
                    row[f"mean_signed_forward_return_{horizon}"] = self._mean_numeric(frame[f"{prefix}_signed_forward_return_{horizon}"])
                rows.append(row)

        if not rows:
            return pd.DataFrame(columns=["pattern_name", "sample_count"])
        return pd.DataFrame(rows).sort_values(["chart_style", "sample_count", "pattern_name"], ascending=[True, False, True]).reset_index(drop=True)

    def _build_pattern_recognition(self, samples_df: pd.DataFrame) -> pd.DataFrame:
        rows: list[dict[str, Any]] = []

        for chart_style, style_frame in samples_df.groupby("chart_style", sort=True):
            patterns = sorted(
                set(style_frame["csv_primary_pattern"].dropna().astype(str))
                | set(style_frame["image_primary_pattern"].dropna().astype(str))
            )
            for pattern_name in patterns:
                csv_mask = style_frame["csv_primary_pattern"] == pattern_name
                image_mask = style_frame["image_primary_pattern"] == pattern_name
                image_top2_mask = self._top2_contains(style_frame["image_top2_patterns"], pattern_name)
                top1_true_positive = int((csv_mask & image_mask).sum())
                csv_occurrences = int(csv_mask.sum())
                image_occurrences = int(image_mask.sum())
                precision = self._ratio(top1_true_positive, image_occurrences)
                recall = self._ratio(top1_true_positive, csv_occurrences)
                rows.append(
                    {
                        "chart_style": chart_style,
                        "pattern_name": pattern_name,
                        "csv_occurrences": csv_occurrences,
                        "image_occurrences": image_occurrences,
                        "top1_true_positive": top1_true_positive,
                        "top1_precision": precision,
                        "top1_recall": recall,
                        "top1_f1": self._f1(precision, recall),
                        "image_top2_recall": self._ratio(int((csv_mask & image_top2_mask).sum()), csv_occurrences),
                        "csv_mean_score": self._mean_numeric(style_frame.loc[csv_mask, "csv_primary_score"]),
                        "image_mean_score": self._mean_numeric(style_frame.loc[image_mask, "image_primary_score"]),
                        "mean_image_extraction_confidence": self._mean_numeric(
                            style_frame.loc[image_mask, "image_extraction_confidence"]
                        ),
                    }
                )

        if not rows:
            return pd.DataFrame(columns=["pattern_name", "csv_occurrences", "image_occurrences"])
        return pd.DataFrame(rows).sort_values(["chart_style", "csv_occurrences", "pattern_name"], ascending=[True, False, True]).reset_index(drop=True)

    @staticmethod
    def _build_pattern_confusion(samples_df: pd.DataFrame) -> pd.DataFrame:
        rows: list[dict[str, Any]] = []
        grouped = samples_df.groupby(
            ["chart_style", "csv_primary_pattern", "image_primary_pattern"],
            dropna=False,
            sort=True,
        ).size()
        for (chart_style, csv_pattern, image_pattern), count in grouped.items():
            rows.append(
                {
                    "chart_style": chart_style,
                    "csv_primary_pattern": csv_pattern if pd.notna(csv_pattern) else "NONE",
                    "image_primary_pattern": image_pattern if pd.notna(image_pattern) else "NONE",
                    "count": int(count),
                }
            )
        return pd.DataFrame(rows).sort_values(["chart_style", "count"], ascending=[True, False]).reset_index(drop=True)

    def _build_metrics(
        self,
        all_samples_df: pd.DataFrame,
        file_summary_df: pd.DataFrame,
        csv_paths: list[Path],
        skipped_files: list[dict[str, str]],
    ) -> dict[str, Any]:
        dominant_csv_pattern, dominant_csv_pattern_share = self._dominant_value(all_samples_df["csv_primary_pattern"])
        dominant_image_pattern, dominant_image_pattern_share = self._dominant_value(all_samples_df["image_primary_pattern"])
        metrics: dict[str, Any] = {
            "source_directory": str(csv_paths[0].parent) if csv_paths else None,
            "files_matched": len(csv_paths),
            "files_processed": int(file_summary_df["ticker"].nunique()),
            "files_skipped": len(skipped_files),
            "skipped_files": skipped_files,
            "sample_count": int(len(all_samples_df)),
            "style_runs": int(file_summary_df.shape[0]),
            "chart_styles": list(self.chart_styles),
            "tickers": sorted(file_summary_df["ticker"].drop_duplicates().tolist()),
            "window_bars": self.window_bars,
            "step_bars": self.step_bars,
            "pattern_analysis_window_bars": int(self.config.patterns.analysis_window_bars),
            "forward_horizons": list(self.forward_horizons),
            "trend_state_match_rate": self._mean_bool(all_samples_df["trend_state_match"]),
            "primary_pattern_match_rate": self._mean_bool(all_samples_df["primary_pattern_match"]),
            "top2_overlap_rate": self._mean_bool(all_samples_df["top2_overlap"]),
            "chart_style_match_rate": self._mean_bool(all_samples_df["image_chart_style_match"]),
            "primary_direction_match_rate": self._mean_match_rate(
                all_samples_df["csv_primary_direction"],
                all_samples_df["image_primary_direction"],
            ),
            "csv_bullish_share": self._share(all_samples_df["csv_primary_direction"], "bullish"),
            "csv_bearish_share": self._share(all_samples_df["csv_primary_direction"], "bearish"),
            "image_bullish_share": self._share(all_samples_df["image_primary_direction"], "bullish"),
            "image_bearish_share": self._share(all_samples_df["image_primary_direction"], "bearish"),
            "dominant_csv_pattern": dominant_csv_pattern,
            "dominant_csv_pattern_share": dominant_csv_pattern_share,
            "dominant_image_pattern": dominant_image_pattern,
            "dominant_image_pattern_share": dominant_image_pattern_share,
            "mean_image_extraction_confidence": self._mean_numeric(all_samples_df["image_extraction_confidence"]),
            "mean_image_extracted_bars": self._mean_numeric(all_samples_df["image_extracted_bars"]),
        }

        horizons: dict[str, Any] = {}
        for horizon in self.forward_horizons:
            forward_col = f"forward_return_{horizon}"
            csv_hits = all_samples_df[f"csv_direction_hit_{horizon}"]
            image_hits = all_samples_df[f"image_direction_hit_{horizon}"]
            csv_signal_mask = csv_hits.notna()
            image_signal_mask = image_hits.notna()
            csv_signal_forward = all_samples_df.loc[csv_signal_mask, forward_col]
            image_signal_forward = all_samples_df.loc[image_signal_mask, forward_col]
            csv_directional_accuracy = self._mean_bool(csv_hits)
            image_directional_accuracy = self._mean_bool(image_hits)
            csv_signal_always_bull_accuracy = float((csv_signal_forward > 0.0).mean()) if not csv_signal_forward.empty else None
            image_signal_always_bull_accuracy = float((image_signal_forward > 0.0).mean()) if not image_signal_forward.empty else None
            csv_signal_always_bear_accuracy = float((csv_signal_forward < 0.0).mean()) if not csv_signal_forward.empty else None
            image_signal_always_bear_accuracy = float((image_signal_forward < 0.0).mean()) if not image_signal_forward.empty else None
            csv_mean_signed = self._mean_numeric(all_samples_df[f"csv_signed_forward_return_{horizon}"])
            image_mean_signed = self._mean_numeric(all_samples_df[f"image_signed_forward_return_{horizon}"])
            csv_always_bull_signed = self._mean_numeric(csv_signal_forward)
            image_always_bull_signed = self._mean_numeric(image_signal_forward)
            csv_always_bear_signed = self._mean_numeric(-csv_signal_forward)
            image_always_bear_signed = self._mean_numeric(-image_signal_forward)
            horizons[str(horizon)] = {
                "baseline_up_rate": float((all_samples_df[forward_col] > 0.0).mean()),
                "baseline_down_rate": float((all_samples_df[forward_col] < 0.0).mean()),
                "mean_forward_return": self._mean_numeric(all_samples_df[forward_col]),
                "csv_directional_accuracy": csv_directional_accuracy,
                "image_directional_accuracy": image_directional_accuracy,
                "csv_signal_count": int(csv_hits.dropna().shape[0]),
                "image_signal_count": int(image_hits.dropna().shape[0]),
                "csv_signal_always_bull_accuracy": csv_signal_always_bull_accuracy,
                "image_signal_always_bull_accuracy": image_signal_always_bull_accuracy,
                "csv_signal_always_bear_accuracy": csv_signal_always_bear_accuracy,
                "image_signal_always_bear_accuracy": image_signal_always_bear_accuracy,
                "csv_accuracy_lift_vs_always_bull": self._subtract(csv_directional_accuracy, csv_signal_always_bull_accuracy),
                "image_accuracy_lift_vs_always_bull": self._subtract(image_directional_accuracy, image_signal_always_bull_accuracy),
                "csv_accuracy_lift_vs_always_bear": self._subtract(csv_directional_accuracy, csv_signal_always_bear_accuracy),
                "image_accuracy_lift_vs_always_bear": self._subtract(image_directional_accuracy, image_signal_always_bear_accuracy),
                "csv_mean_signed_forward_return": csv_mean_signed,
                "image_mean_signed_forward_return": image_mean_signed,
                "csv_always_bull_mean_signed_return": csv_always_bull_signed,
                "image_always_bull_mean_signed_return": image_always_bull_signed,
                "csv_always_bear_mean_signed_return": csv_always_bear_signed,
                "image_always_bear_mean_signed_return": image_always_bear_signed,
                "csv_signed_return_lift_vs_always_bull": self._subtract(csv_mean_signed, csv_always_bull_signed),
                "image_signed_return_lift_vs_always_bull": self._subtract(image_mean_signed, image_always_bull_signed),
                "csv_signed_return_lift_vs_always_bear": self._subtract(csv_mean_signed, csv_always_bear_signed),
                "image_signed_return_lift_vs_always_bear": self._subtract(image_mean_signed, image_always_bear_signed),
            }
        metrics["horizons"] = horizons
        metrics["by_chart_style"] = {
            chart_style: self._build_style_metrics(all_samples_df[all_samples_df["chart_style"] == chart_style])
            for chart_style in self.chart_styles
            if bool((all_samples_df["chart_style"] == chart_style).any())
        }
        return metrics

    def _build_style_metrics(self, samples_df: pd.DataFrame) -> dict[str, Any]:
        dominant_csv_pattern, dominant_csv_pattern_share = self._dominant_value(samples_df["csv_primary_pattern"])
        dominant_image_pattern, dominant_image_pattern_share = self._dominant_value(samples_df["image_primary_pattern"])
        payload: dict[str, Any] = {
            "sample_count": int(len(samples_df)),
            "trend_state_match_rate": self._mean_bool(samples_df["trend_state_match"]),
            "primary_pattern_match_rate": self._mean_bool(samples_df["primary_pattern_match"]),
            "top2_overlap_rate": self._mean_bool(samples_df["top2_overlap"]),
            "chart_style_match_rate": self._mean_bool(samples_df["image_chart_style_match"]),
            "primary_direction_match_rate": self._mean_match_rate(
                samples_df["csv_primary_direction"],
                samples_df["image_primary_direction"],
            ),
            "dominant_csv_pattern": dominant_csv_pattern,
            "dominant_csv_pattern_share": dominant_csv_pattern_share,
            "dominant_image_pattern": dominant_image_pattern,
            "dominant_image_pattern_share": dominant_image_pattern_share,
            "mean_image_extraction_confidence": self._mean_numeric(samples_df["image_extraction_confidence"]),
        }
        horizons: dict[str, Any] = {}
        for horizon in self.forward_horizons:
            forward_col = f"forward_return_{horizon}"
            image_hits = samples_df[f"image_direction_hit_{horizon}"]
            image_signal_mask = image_hits.notna()
            image_signal_forward = samples_df.loc[image_signal_mask, forward_col]
            image_directional_accuracy = self._mean_bool(image_hits)
            always_bull_accuracy = float((image_signal_forward > 0.0).mean()) if not image_signal_forward.empty else None
            mean_signed = self._mean_numeric(samples_df[f"image_signed_forward_return_{horizon}"])
            always_bull_signed = self._mean_numeric(image_signal_forward)
            horizons[str(horizon)] = {
                "baseline_up_rate": float((samples_df[forward_col] > 0.0).mean()),
                "image_directional_accuracy": image_directional_accuracy,
                "image_accuracy_lift_vs_always_bull": self._subtract(image_directional_accuracy, always_bull_accuracy),
                "image_mean_signed_forward_return": mean_signed,
                "image_signed_return_lift_vs_always_bull": self._subtract(mean_signed, always_bull_signed),
            }
        payload["horizons"] = horizons
        return payload

    def _render_summary(
        self,
        metrics: dict[str, Any],
        artifacts: BatchImageValidationArtifacts,
        image_pattern_df: pd.DataFrame,
        pattern_recognition_df: pd.DataFrame,
    ) -> str:
        lines = [
            "# Batch Image Validation Summary",
            "",
            "## Setup",
            f"- Source directory: {metrics['source_directory']}",
            f"- Files matched: {metrics['files_matched']}",
            f"- Files processed: {metrics['files_processed']}",
            f"- Files skipped: {metrics['files_skipped']}",
            f"- Chart styles: {', '.join(metrics['chart_styles'])}",
            f"- Samples: {metrics['sample_count']}",
            f"- Window bars: {metrics['window_bars']}",
            f"- Pattern analysis window bars: {metrics['pattern_analysis_window_bars']}",
            f"- Step bars: {metrics['step_bars']}",
            f"- Mean image extraction confidence: {metrics['mean_image_extraction_confidence']:.4f}",
            f"- Mean extracted bars: {metrics['mean_image_extracted_bars']:.2f}",
            "",
            "## Recognition",
            f"- Trend state match rate: {metrics['trend_state_match_rate']:.4f}",
            f"- Primary pattern match rate: {metrics['primary_pattern_match_rate']:.4f}",
            f"- Top-2 overlap rate: {metrics['top2_overlap_rate']:.4f}",
            f"- Chart style match rate: {metrics['chart_style_match_rate']:.4f}",
            f"- Primary direction match rate: {metrics['primary_direction_match_rate']:.4f}",
            f"- Dominant CSV primary pattern: {metrics['dominant_csv_pattern']} ({metrics['dominant_csv_pattern_share']:.4f})",
            f"- Dominant image primary pattern: {metrics['dominant_image_pattern']} ({metrics['dominant_image_pattern_share']:.4f})",
            f"- CSV bullish share: {metrics['csv_bullish_share']:.4f}",
            f"- Image bullish share: {metrics['image_bullish_share']:.4f}",
            "",
            "## Directional Validation",
        ]
        for horizon, payload in metrics["horizons"].items():
            lines.extend(
                [
                    f"### Forward {horizon} bars",
                    f"- Baseline up rate: {payload['baseline_up_rate']:.4f}",
                    f"- CSV directional accuracy: {payload['csv_directional_accuracy']:.4f}"
                    if payload["csv_directional_accuracy"] is not None
                    else "- CSV directional accuracy: n/a",
                    f"- Image directional accuracy: {payload['image_directional_accuracy']:.4f}"
                    if payload["image_directional_accuracy"] is not None
                    else "- Image directional accuracy: n/a",
                    f"- CSV accuracy lift vs always-bull: {payload['csv_accuracy_lift_vs_always_bull']:.4f}"
                    if payload["csv_accuracy_lift_vs_always_bull"] is not None
                    else "- CSV accuracy lift vs always-bull: n/a",
                    f"- Image accuracy lift vs always-bull: {payload['image_accuracy_lift_vs_always_bull']:.4f}"
                    if payload["image_accuracy_lift_vs_always_bull"] is not None
                    else "- Image accuracy lift vs always-bull: n/a",
                    f"- CSV mean signed forward return: {payload['csv_mean_signed_forward_return']:.4f}"
                    if payload["csv_mean_signed_forward_return"] is not None
                    else "- CSV mean signed forward return: n/a",
                    f"- Image mean signed forward return: {payload['image_mean_signed_forward_return']:.4f}"
                    if payload["image_mean_signed_forward_return"] is not None
                    else "- Image mean signed forward return: n/a",
                    f"- CSV signed return lift vs always-bull: {payload['csv_signed_return_lift_vs_always_bull']:.4f}"
                    if payload["csv_signed_return_lift_vs_always_bull"] is not None
                    else "- CSV signed return lift vs always-bull: n/a",
                    f"- Image signed return lift vs always-bull: {payload['image_signed_return_lift_vs_always_bull']:.4f}"
                    if payload["image_signed_return_lift_vs_always_bull"] is not None
                    else "- Image signed return lift vs always-bull: n/a",
                    "",
                ]
            )

        spotlight_horizon = str(self._summary_horizon())
        lines.append("## Style Breakdown")
        for chart_style, style_metrics in metrics.get("by_chart_style", {}).items():
            lines.extend(
                [
                    f"### {chart_style}",
                    f"- Samples: {style_metrics['sample_count']}",
                    f"- Trend state match rate: {self._format_metric(style_metrics.get('trend_state_match_rate'))}",
                    f"- Primary pattern match rate: {self._format_metric(style_metrics.get('primary_pattern_match_rate'))}",
                    f"- Top-2 overlap rate: {self._format_metric(style_metrics.get('top2_overlap_rate'))}",
                    f"- Chart style match rate: {self._format_metric(style_metrics.get('chart_style_match_rate'))}",
                    f"- Dominant image primary pattern: {style_metrics.get('dominant_image_pattern')} "
                    f"({self._format_metric(style_metrics.get('dominant_image_pattern_share'))})",
                ]
            )
            horizon_payload = style_metrics.get("horizons", {}).get(spotlight_horizon, {})
            lines.extend(
                [
                    f"- {spotlight_horizon} bars image accuracy: {self._format_metric(horizon_payload.get('image_directional_accuracy'))}",
                    f"- {spotlight_horizon} bars accuracy lift vs always-bull: "
                    f"{self._format_metric(horizon_payload.get('image_accuracy_lift_vs_always_bull'))}",
                    f"- {spotlight_horizon} bars signed return lift vs always-bull: "
                    f"{self._format_metric(horizon_payload.get('image_signed_return_lift_vs_always_bull'))}",
                ]
            )

            strongest = self._select_strongest_patterns(
                image_pattern_df[image_pattern_df["chart_style"] == chart_style],
                horizon=int(spotlight_horizon),
            )
            weakest = self._select_weakest_recognition(
                pattern_recognition_df[pattern_recognition_df["chart_style"] == chart_style]
            )

            if strongest:
                lines.append(f"- Strong image patterns ({chart_style}):")
                for row in strongest:
                    lines.append(
                        f"  - {row['pattern_name']}: samples={row['sample_count']}, "
                        f"accuracy={self._format_metric(row.get(f'directional_accuracy_{spotlight_horizon}'))}, "
                        f"signed_return={self._format_metric(row.get(f'mean_signed_forward_return_{spotlight_horizon}'))}, "
                        f"top1_match={self._format_metric(row.get('top1_match_rate'))}"
                    )
            if weakest:
                lines.append(f"- Weak recognition spots ({chart_style}):")
                for row in weakest:
                    lines.append(
                        f"  - {row['pattern_name']}: csv_occurrences={row['csv_occurrences']}, "
                        f"top1_recall={self._format_metric(row.get('top1_recall'))}, "
                        f"image_top2_recall={self._format_metric(row.get('image_top2_recall'))}"
                    )
            lines.append("")

        lines.extend(
            [
                "## Files",
                f"- All samples CSV: `{artifacts.all_samples_csv.name}`",
                f"- File summary CSV: `{artifacts.file_summary_csv.name}`",
                f"- CSV pattern performance CSV: `{artifacts.csv_pattern_performance_csv.name}`",
                f"- Image pattern performance CSV: `{artifacts.image_pattern_performance_csv.name}`",
                f"- Pattern recognition CSV: `{artifacts.pattern_recognition_csv.name}`",
                f"- Pattern confusion CSV: `{artifacts.pattern_confusion_csv.name}`",
                f"- Metrics JSON: `{artifacts.metrics_json.name}`",
                f"- Summary: `{artifacts.summary_md.name}`",
            ]
        )
        if artifacts.sample_images_dir is not None:
            lines.append(f"- Sample images: `{artifacts.sample_images_dir.name}`")
        return "\n".join(lines) + "\n"

    def _summary_horizon(self) -> int:
        if 10 in self.forward_horizons:
            return 10
        return self.forward_horizons[0]

    def _select_strongest_patterns(self, image_pattern_df: pd.DataFrame, horizon: int) -> list[dict[str, Any]]:
        accuracy_col = f"directional_accuracy_{horizon}"
        signed_col = f"mean_signed_forward_return_{horizon}"
        if image_pattern_df.empty or accuracy_col not in image_pattern_df.columns or signed_col not in image_pattern_df.columns:
            return []
        filtered = image_pattern_df[image_pattern_df["sample_count"] >= 10].copy()
        if filtered.empty:
            return []
        filtered = filtered.sort_values([signed_col, accuracy_col, "sample_count"], ascending=[False, False, False])
        return filtered.head(5).to_dict(orient="records")

    @staticmethod
    def _select_weakest_recognition(pattern_recognition_df: pd.DataFrame) -> list[dict[str, Any]]:
        if pattern_recognition_df.empty:
            return []
        filtered = pattern_recognition_df[pattern_recognition_df["csv_occurrences"] >= 10].copy()
        if filtered.empty:
            return []
        filtered = filtered.sort_values(["top1_recall", "image_top2_recall", "csv_occurrences"], ascending=[True, True, False])
        return filtered.head(5).to_dict(orient="records")

    @staticmethod
    def _top2_contains(series: pd.Series, pattern_name: str) -> pd.Series:
        if series.empty:
            return pd.Series(dtype=bool)
        return series.fillna("").astype(str).apply(
            lambda value: pattern_name in [item for item in value.split("|") if item]
        )

    @staticmethod
    def _mode(series: pd.Series) -> str | None:
        cleaned = series.dropna()
        if cleaned.empty:
            return None
        modes = cleaned.mode()
        if modes.empty:
            return None
        return str(modes.iloc[0])

    @staticmethod
    def _mean_bool(series: pd.Series) -> float | None:
        cleaned = series.dropna()
        if cleaned.empty:
            return None
        return float(cleaned.astype(float).mean())

    @staticmethod
    def _mean_numeric(series: pd.Series) -> float | None:
        cleaned = pd.to_numeric(series, errors="coerce").dropna()
        if cleaned.empty:
            return None
        return float(cleaned.mean())

    @staticmethod
    def _mean_match_rate(left: pd.Series, right: pd.Series) -> float | None:
        valid = left.notna() & right.notna()
        if not bool(valid.any()):
            return None
        return float((left[valid] == right[valid]).astype(float).mean())

    @staticmethod
    def _ratio(numerator: int, denominator: int) -> float | None:
        if denominator <= 0:
            return None
        return float(numerator / denominator)

    @staticmethod
    def _share(series: pd.Series, target: str) -> float | None:
        cleaned = series.dropna()
        if cleaned.empty:
            return None
        return float((cleaned == target).mean())

    @staticmethod
    def _dominant_value(series: pd.Series) -> tuple[str | None, float | None]:
        cleaned = series.dropna().astype(str)
        if cleaned.empty:
            return (None, None)
        counts = cleaned.value_counts(normalize=True)
        return str(counts.index[0]), float(counts.iloc[0])

    @staticmethod
    def _subtract(left: float | None, right: float | None) -> float | None:
        if left is None or right is None:
            return None
        return float(left - right)

    @staticmethod
    def _f1(precision: float | None, recall: float | None) -> float | None:
        if precision is None or recall is None or (precision + recall) == 0.0:
            return None
        return float((2.0 * precision * recall) / (precision + recall))

    @staticmethod
    def _format_metric(value: Any) -> str:
        if value is None or pd.isna(value):
            return "n/a"
        return f"{float(value):.4f}"
