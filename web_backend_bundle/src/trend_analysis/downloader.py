"""Yahoo Finance OHLCV download helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pandas as pd


@dataclass(slots=True)
class DownloadRequest:
    """Single-ticker download request for daily OHLCV data."""

    ticker: str
    save_dir: Path
    period: str = "1y"
    start: str | None = None
    end: str | None = None
    interval: str = "1d"

    def normalized_ticker(self) -> str:
        return self.ticker.strip().upper()

    def filename(self) -> str:
        ticker = self.normalized_ticker()
        if self.start and self.end:
            return f"{ticker}_daily_{self.start}_{self.end}.csv"
        if self.start:
            return f"{ticker}_daily_{self.start}_to_latest.csv"
        if self.end:
            return f"{ticker}_daily_until_{self.end}.csv"
        return f"{ticker}_daily_{self.period}.csv"


@dataclass(slots=True)
class DownloadResult:
    """Structured result for a successful download."""

    ticker: str
    rows: int
    file_path: Path
    start_date: str
    end_date: str
    columns: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "rows": self.rows,
            "file_path": str(self.file_path),
            "start_date": self.start_date,
            "end_date": self.end_date,
            "columns": self.columns,
        }


class YahooFinanceDownloader:
    """Download daily OHLCV data from Yahoo Finance via yfinance.

    When a custom end date is provided, it is treated as inclusive and converted
    to Yahoo Finance's exclusive end-date semantics internally.
    """

    REQUIRED_OUTPUT_COLUMNS = ["open", "high", "low", "close", "volume"]

    def download(self, request: DownloadRequest) -> DownloadResult:
        """Download a single ticker and save its daily OHLCV CSV."""

        ticker = request.normalized_ticker()
        if not ticker:
            raise ValueError("Ticker is required.")
        if not request.save_dir:
            raise ValueError("Save directory is required.")
        if request.interval != "1d":
            raise ValueError("This downloader only supports daily interval ('1d').")
        if request.start and request.end and request.start > request.end:
            raise ValueError("Start date must be earlier than or equal to end date.")

        request.save_dir.mkdir(parents=True, exist_ok=True)
        frame = self._fetch_dataframe(request)
        prepared = self._prepare_dataframe(frame)
        output_path = request.save_dir / request.filename()
        prepared.to_csv(output_path, index=True)

        return DownloadResult(
            ticker=ticker,
            rows=len(prepared),
            file_path=output_path,
            start_date=prepared.index.min().strftime("%Y-%m-%d"),
            end_date=prepared.index.max().strftime("%Y-%m-%d"),
            columns=["date", *self.REQUIRED_OUTPUT_COLUMNS],
        )

    def _fetch_dataframe(self, request: DownloadRequest) -> pd.DataFrame:
        try:
            import yfinance as yf
        except ModuleNotFoundError as exc:
            raise RuntimeError("yfinance is not installed. Run `pip install -e .` first.") from exc

        kwargs: dict[str, Any] = {
            "tickers": request.normalized_ticker(),
            "interval": request.interval,
            "auto_adjust": False,
            "progress": False,
            "threads": False,
        }
        if request.start or request.end:
            kwargs["start"] = request.start
            kwargs["end"] = self._exclusive_end_date(request.end)
        else:
            kwargs["period"] = request.period

        frame = yf.download(**kwargs)
        if frame is None or frame.empty:
            raise ValueError(f"No data returned for ticker '{request.normalized_ticker()}'.")
        return frame

    def _prepare_dataframe(self, frame: pd.DataFrame) -> pd.DataFrame:
        prepared = frame.copy()
        if isinstance(prepared.columns, pd.MultiIndex):
            prepared.columns = prepared.columns.get_level_values(0)

        prepared.columns = [str(column).strip().lower().replace(" ", "_") for column in prepared.columns]
        rename_map = {
            "adj_close": "adj_close",
            "adjclose": "adj_close",
        }
        prepared = prepared.rename(columns=rename_map)

        missing = [column for column in self.REQUIRED_OUTPUT_COLUMNS if column not in prepared.columns]
        if missing:
            missing_joined = ", ".join(missing)
            raise ValueError(f"Downloaded data is missing required columns: {missing_joined}")

        prepared = prepared[self.REQUIRED_OUTPUT_COLUMNS].copy()
        prepared.index = pd.to_datetime(prepared.index, errors="coerce")
        prepared = prepared[~prepared.index.isna()]
        prepared = prepared.sort_index()
        prepared = prepared[~prepared.index.duplicated(keep="last")]
        prepared.index.name = "date"
        prepared = prepared.dropna(how="any")

        if prepared.empty:
            raise ValueError("Downloaded data contains no valid OHLCV rows after cleaning.")
        return prepared

    @staticmethod
    def _exclusive_end_date(end: str | None) -> str | None:
        if end is None:
            return None
        parsed = date.fromisoformat(end)
        return (parsed + timedelta(days=1)).isoformat()
