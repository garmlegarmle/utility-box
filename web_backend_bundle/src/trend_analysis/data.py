"""Data loading and preparation helpers for daily OHLCV analysis."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .config import EngineConfig


@dataclass(slots=True)
class PreparedData:
    """Bundle of cleaned data and preparation diagnostics."""

    cleaned: pd.DataFrame
    current_window: pd.DataFrame
    original_rows: int
    cleaned_rows: int
    dropped_rows: int


class MarketDataHandler:
    """Load, validate, clean, and slice daily OHLCV data."""

    def __init__(self, config: EngineConfig) -> None:
        self.config = config

    def load_csv(self, path: str | Path, date_column: str = "date") -> pd.DataFrame:
        """Read a CSV file into a dataframe without mutating the engine state."""

        frame = pd.read_csv(path)
        return self.prepare(frame, date_column=date_column)

    def prepare(self, frame: pd.DataFrame, date_column: str | None = None) -> pd.DataFrame:
        """Validate schema, normalize types, and sort by date."""

        if frame.empty:
            raise ValueError("Input dataframe is empty.")

        prepared = frame.copy()
        prepared.columns = [str(column).strip().lower() for column in prepared.columns]

        if date_column:
            normalized_date_column = date_column.strip().lower()
            if normalized_date_column in prepared.columns:
                prepared[normalized_date_column] = pd.to_datetime(
                    prepared[normalized_date_column],
                    errors="coerce",
                )
                prepared = prepared.set_index(normalized_date_column)
        if not isinstance(prepared.index, pd.DatetimeIndex):
            prepared.index = pd.to_datetime(prepared.index, errors="coerce")

        prepared = prepared[~prepared.index.isna()]
        prepared = prepared.sort_index()
        prepared = prepared[~prepared.index.duplicated(keep=self.config.data.dedupe_keep)]

        required = list(self.config.data.required_columns)
        missing_columns = [column for column in required if column not in prepared.columns]
        if missing_columns:
            joined = ", ".join(missing_columns)
            raise ValueError(f"Missing required OHLCV columns: {joined}")

        for column in required:
            prepared[column] = pd.to_numeric(prepared[column], errors="coerce")

        cleaned = prepared[required].dropna(how="any")
        if len(cleaned) < self.config.data.min_bars:
            raise ValueError(
                f"At least {self.config.data.min_bars} valid rows are required, "
                f"but only {len(cleaned)} remain after cleaning."
            )
        return cleaned

    def prepare_bundle(self, frame: pd.DataFrame, date_column: str | None = None) -> PreparedData:
        """Return cleaned data together with preparation diagnostics."""

        original_rows = len(frame)
        cleaned = self.prepare(frame, date_column=date_column)
        current_window = cleaned.tail(self.config.data.max_bars).copy()
        return PreparedData(
            cleaned=cleaned,
            current_window=current_window,
            original_rows=original_rows,
            cleaned_rows=len(cleaned),
            dropped_rows=original_rows - len(cleaned),
        )

    def rolling_windows(self, cleaned: pd.DataFrame) -> list[pd.DataFrame]:
        """Create rolling windows for historical analysis.

        TODO: Optimize by reusing vectorized indicator state if historical runs
        become a performance bottleneck.
        """

        windows: list[pd.DataFrame] = []
        start_index = self.config.data.min_bars
        for stop in range(start_index, len(cleaned) + 1):
            windows.append(cleaned.iloc[max(0, stop - self.config.data.max_bars) : stop].copy())
        return windows

