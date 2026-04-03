"""Input preprocessing for the chart interpretation engine."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .config import ChartInterpretationConfig


@dataclass(slots=True)
class PreparedFrame:
    """Prepared OHLCV frame plus diagnostics."""

    frame: pd.DataFrame
    diagnostics: dict[str, object]


class OHLCVPreprocessor:
    """Clean and normalize OHLCV input for interpretation."""

    def __init__(self, config: ChartInterpretationConfig) -> None:
        self.config = config

    def prepare_csv(self, path: str | Path) -> PreparedFrame:
        frame = pd.read_csv(path)
        return self.prepare_frame(frame)

    def prepare_frame(self, frame: pd.DataFrame) -> PreparedFrame:
        cfg = self.config.preprocess
        if frame.empty:
            raise ValueError("Input dataframe is empty.")

        prepared = frame.copy()
        prepared.columns = [str(column).strip().lower() for column in prepared.columns]

        timestamp_column = next((name for name in cfg.timestamp_aliases if name in prepared.columns), None)
        if timestamp_column is None:
            if not isinstance(prepared.index, pd.DatetimeIndex):
                raise ValueError("Input must contain one of: timestamp, date, datetime, time.")
        else:
            prepared[timestamp_column] = pd.to_datetime(prepared[timestamp_column], errors="coerce")
            prepared = prepared.set_index(timestamp_column)

        if not isinstance(prepared.index, pd.DatetimeIndex):
            prepared.index = pd.to_datetime(prepared.index, errors="coerce")

        prepared = prepared[~prepared.index.isna()]
        original_rows = len(prepared)
        prepared = prepared.sort_index()
        prepared = prepared[~prepared.index.duplicated(keep=cfg.dedupe_keep)]

        missing = [column for column in cfg.required_columns if column not in prepared.columns]
        if missing:
            raise ValueError(f"Missing required columns: {', '.join(missing)}")

        for column in cfg.required_columns:
            prepared[column] = pd.to_numeric(prepared[column], errors="coerce")

        prepared = prepared[list(cfg.required_columns)].dropna(how="any")
        prepared["high"] = prepared[["high", "open", "close"]].max(axis=1)
        prepared["low"] = prepared[["low", "open", "close"]].min(axis=1)
        prepared["volume"] = prepared["volume"].clip(lower=0.0)

        cleaned, outlier_adjustments = self._clip_outliers(prepared)
        if len(cleaned) < cfg.min_rows:
            raise ValueError(f"At least {cfg.min_rows} valid rows are required, but only {len(cleaned)} remain.")

        return PreparedFrame(
            frame=cleaned,
            diagnostics={
                "original_rows": int(len(frame)),
                "parsed_rows": int(original_rows),
                "cleaned_rows": int(len(cleaned)),
                "dropped_rows": int(len(frame) - len(cleaned)),
                "outlier_adjustments": int(outlier_adjustments),
            },
        )

    def _clip_outliers(self, frame: pd.DataFrame) -> tuple[pd.DataFrame, int]:
        cfg = self.config.preprocess
        cleaned = frame.copy()
        median_range = (cleaned["high"] - cleaned["low"]).rolling(cfg.outlier_window, min_periods=5).median().bfill()
        cap_range = median_range * cfg.outlier_range_multiple
        adjustments = 0
        for index, row in cleaned.iterrows():
            current_cap = float(cap_range.loc[index]) if pd.notna(cap_range.loc[index]) else float((row["high"] - row["low"]) * 2.0)
            base_high = max(float(row["open"]), float(row["close"]))
            base_low = min(float(row["open"]), float(row["close"]))
            high_cap = base_high + current_cap
            low_cap = base_low - current_cap
            new_high = min(float(row["high"]), high_cap)
            new_low = max(float(row["low"]), low_cap)
            if new_high != float(row["high"]) or new_low != float(row["low"]):
                adjustments += 1
            cleaned.at[index, "high"] = max(new_high, base_high)
            cleaned.at[index, "low"] = min(new_low, base_low)
        return cleaned, adjustments
