"""Download unseen samples and evaluate the current trend model on them."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from .config import EngineConfig
from .downloader import DownloadRequest, YahooFinanceDownloader
from .history_report import HistoricalAnalysisReporter
from .state_background_chart import TrendStateBackgroundChartRenderer

DEFAULT_HOLDOUT_ETFS: tuple[dict[str, str], ...] = (
    {"symbol": "DIA", "sample_type": "ETF", "theme": "Dow 30 large caps"},
    {"symbol": "IWM", "sample_type": "ETF", "theme": "Russell 2000 small caps"},
    {"symbol": "VTI", "sample_type": "ETF", "theme": "U.S. total market"},
    {"symbol": "VGT", "sample_type": "ETF", "theme": "Broad technology"},
    {"symbol": "XBI", "sample_type": "ETF", "theme": "Biotechnology"},
)

DEFAULT_HOLDOUT_STOCKS: tuple[dict[str, str], ...] = (
    {
        "symbol": "NVDA",
        "sample_type": "STOCK",
        "theme": "Technology leader",
        "selection_basis": "XLK top holding as of March 2026",
    },
    {
        "symbol": "AMZN",
        "sample_type": "STOCK",
        "theme": "Consumer discretionary leader",
        "selection_basis": "XLY top holding as of March 2026",
    },
    {
        "symbol": "BRK-B",
        "sample_type": "STOCK",
        "theme": "Financials leader",
        "selection_basis": "XLF top holding as of March 2026",
    },
    {
        "symbol": "LLY",
        "sample_type": "STOCK",
        "theme": "Healthcare leader",
        "selection_basis": "XLV top holding as of March 2026",
    },
    {
        "symbol": "GE",
        "sample_type": "STOCK",
        "theme": "Industrials leader",
        "selection_basis": "XLI top holding as of March 2026",
    },
)


@dataclass(slots=True)
class HoldoutValidationArtifacts:
    """Generated files for holdout validation."""

    output_dir: Path
    downloads_dir: Path
    manifest_csv: Path
    summary_csv: Path
    summary_md: Path
    history_reports_dir: Path
    state_background_dir: Path

    def to_dict(self) -> dict[str, str]:
        return {
            "output_dir": str(self.output_dir),
            "downloads_dir": str(self.downloads_dir),
            "manifest_csv": str(self.manifest_csv),
            "summary_csv": str(self.summary_csv),
            "summary_md": str(self.summary_md),
            "history_reports_dir": str(self.history_reports_dir),
            "state_background_dir": str(self.state_background_dir),
        }


class HoldoutValidationRunner:
    """Download unseen symbols and evaluate the current model on them."""

    def __init__(
        self,
        best_params_csv: str | Path,
        period: str = "10y",
        base_config: EngineConfig | None = None,
    ) -> None:
        self.best_params_csv = Path(best_params_csv).expanduser().resolve()
        self.period = period
        self.base_config = base_config
        self.downloader = YahooFinanceDownloader()
        self.history_reporter = HistoricalAnalysisReporter.from_best_params_csv(
            best_params_csv=self.best_params_csv,
            base_config=base_config,
        )
        self.background_renderer = TrendStateBackgroundChartRenderer.from_best_params_csv(
            best_params_csv=self.best_params_csv,
            base_config=base_config,
        )

    @property
    def sample_definitions(self) -> list[dict[str, str]]:
        return [*DEFAULT_HOLDOUT_ETFS, *DEFAULT_HOLDOUT_STOCKS]

    def run(self, output_dir: str | Path) -> HoldoutValidationArtifacts:
        output_dir = Path(output_dir).expanduser().resolve()
        downloads_dir = output_dir / "downloads"
        history_reports_dir = output_dir / "history_reports"
        state_background_dir = output_dir / "state_background_charts"

        output_dir.mkdir(parents=True, exist_ok=True)
        downloads_dir.mkdir(parents=True, exist_ok=True)
        history_reports_dir.mkdir(parents=True, exist_ok=True)
        state_background_dir.mkdir(parents=True, exist_ok=True)

        manifest_records = self._download_all(downloads_dir)
        manifest_df = pd.DataFrame(manifest_records)
        summary_df = self._evaluate_manifest(manifest_df, history_reports_dir, state_background_dir)

        artifacts = HoldoutValidationArtifacts(
            output_dir=output_dir,
            downloads_dir=downloads_dir,
            manifest_csv=output_dir / "holdout_download_manifest.csv",
            summary_csv=output_dir / "holdout_validation_summary.csv",
            summary_md=output_dir / "holdout_validation_summary.md",
            history_reports_dir=history_reports_dir,
            state_background_dir=state_background_dir,
        )

        manifest_df.to_csv(artifacts.manifest_csv, index=False)
        summary_df.to_csv(artifacts.summary_csv, index=False)
        artifacts.summary_md.write_text(self._render_summary(summary_df), encoding="utf-8")
        return artifacts

    def _download_all(self, downloads_dir: Path) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        for sample in self.sample_definitions:
            request = DownloadRequest(
                ticker=sample["symbol"],
                save_dir=downloads_dir,
                period=self.period,
            )
            result = self.downloader.download(request)
            records.append(
                {
                    "symbol": sample["symbol"],
                    "sample_type": sample["sample_type"],
                    "theme": sample["theme"],
                    "selection_basis": sample.get("selection_basis", ""),
                    "file_path": str(result.file_path),
                    "rows": result.rows,
                    "start_date": result.start_date,
                    "end_date": result.end_date,
                }
            )
        return records

    def _evaluate_manifest(
        self,
        manifest_df: pd.DataFrame,
        history_reports_dir: Path,
        state_background_dir: Path,
    ) -> pd.DataFrame:
        rows: list[dict[str, Any]] = []
        for record in manifest_df.to_dict("records"):
            symbol = str(record["symbol"])
            csv_path = Path(str(record["file_path"]))
            symbol_history_dir = history_reports_dir / symbol.replace("-", "_")

            history_artifacts = self.history_reporter.build_from_csv(
                csv_path=csv_path,
                output_dir=symbol_history_dir,
                ticker=symbol,
            )
            background_chart = self.background_renderer.build_from_csv(
                csv_path=csv_path,
                output_dir=state_background_dir,
                ticker=symbol,
            )

            metrics = json.loads(history_artifacts.metrics_json.read_text(encoding="utf-8"))
            analysis_df = pd.read_csv(history_artifacts.analysis_csv)
            latest = analysis_df.iloc[-1].to_dict()

            rows.append(
                {
                    "symbol": symbol,
                    "sample_type": record["sample_type"],
                    "theme": record["theme"],
                    "selection_basis": record.get("selection_basis", ""),
                    "rows": record["rows"],
                    "start_date": record["start_date"],
                    "end_date": record["end_date"],
                    "direction_3state_accuracy": metrics["direction"]["direction_sign_accuracy"],
                    "direction_5state_accuracy": metrics["direction"]["direction_accuracy"],
                    "breakdown_auc": metrics["transition"]["transition_auc"],
                    "state_transition_auc": metrics["state_transition"]["state_transition_auc"],
                    "confidence_accuracy": metrics["confidence"]["confidence_accuracy"],
                    "current_trend_state": latest["trend_state_label"],
                    "current_regime_label": latest["regime_label"],
                    "current_trend_strength_score": latest["trend_strength_score"],
                    "current_transition_risk_score": latest["transition_risk_score"],
                    "history_chart_png": str(history_artifacts.chart_png),
                    "background_chart_png": str(background_chart),
                }
            )

        return pd.DataFrame(rows).sort_values(["sample_type", "symbol"]).reset_index(drop=True)

    def _render_summary(self, summary_df: pd.DataFrame) -> str:
        lines = [
            "# Holdout Validation Summary",
            "",
            "## Sample Set",
            "- ETFs: DIA, IWM, VTI, VGT, XBI",
            "- Stocks: NVDA, AMZN, BRK-B, LLY, GE",
            "",
            "## Aggregate Means",
        ]

        for sample_type, sample_df in summary_df.groupby("sample_type", dropna=False):
            lines.extend(
                [
                    f"### {sample_type}",
                    f"- Direction 3-state accuracy: {sample_df['direction_3state_accuracy'].mean():.4f}",
                    f"- Breakdown AUC: {sample_df['breakdown_auc'].mean():.4f}",
                    f"- 10d state-transition AUC: {sample_df['state_transition_auc'].mean():.4f}",
                    f"- Confidence accuracy: {sample_df['confidence_accuracy'].mean():.4f}",
                    "",
                ]
            )

        lines.extend(
            [
                "## Current State Snapshot",
            ]
        )
        for row in summary_df.to_dict("records"):
            lines.append(
                f"- {row['symbol']} ({row['sample_type']}): {row['current_trend_state']} | "
                f"strength {float(row['current_trend_strength_score']):.1f} | "
                f"transition {float(row['current_transition_risk_score']):.1f}"
            )
        lines.append("")
        return "\n".join(lines)
