"""Shared PostgreSQL helpers for daily OHLCV storage and retrieval."""

from __future__ import annotations

import os
import re
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterator, Literal

import pandas as pd
import psycopg
from psycopg.rows import dict_row


MarketCode = Literal["us", "kr"]
MARKET_TABLES: dict[MarketCode, str] = {
    "us": "us_equity_daily",
    "kr": "kr_equity_daily",
}
KR_SUFFIX_RE = re.compile(r"\.(KS|KQ)$", re.IGNORECASE)
TIMESTAMP_COLUMNS = ("trade_date", "date", "timestamp", "datetime", "time")
REQUIRED_COLUMNS = ("open", "high", "low", "close", "volume")


def resolve_database_url(database_url: str | None = None) -> str:
    resolved = (
        str(database_url or "").strip()
        or str(os.getenv("MARKET_DATA_DATABASE_URL") or "").strip()
        or str(os.getenv("DATABASE_URL") or "").strip()
    )
    if not resolved:
        raise ValueError("Set MARKET_DATA_DATABASE_URL or DATABASE_URL before using the market-data store.")
    return resolved


def infer_market_from_ticker(ticker: str) -> MarketCode:
    normalized = StringNormalizer.normalize(ticker)
    if KR_SUFFIX_RE.search(normalized):
        return "kr"
    if re.fullmatch(r"\d{6}", normalized):
        return "kr"
    return "us"


def normalize_ticker(ticker: str, market: MarketCode | Literal["auto"] = "auto") -> tuple[str, MarketCode]:
    normalized = StringNormalizer.normalize(ticker)
    resolved_market: MarketCode = infer_market_from_ticker(normalized) if market == "auto" else market

    if resolved_market == "kr":
        normalized = KR_SUFFIX_RE.sub("", normalized)
        if not re.fullmatch(r"\d{6}", normalized):
            raise ValueError("Korean tickers must be six digits, optionally with .KS or .KQ suffix.")
        return normalized, "kr"

    normalized = normalized.replace(" ", "")
    if not normalized:
        raise ValueError("Ticker is required.")
    return normalized, "us"


@dataclass(slots=True)
class MarketDataFetchResult:
    ticker: str
    market: MarketCode
    frame: pd.DataFrame
    start_date: date
    end_date: date


class StringNormalizer:
    @staticmethod
    def normalize(value: str) -> str:
        return str(value or "").strip().upper()


class PostgresDailyPriceStore:
    """Read and write daily OHLCV rows stored in PostgreSQL."""

    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = resolve_database_url(database_url)

    @contextmanager
    def connect(self) -> Iterator[psycopg.Connection]:
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

    def apply_schema(self, sql_path: str | Path, *, connection: psycopg.Connection | None = None) -> None:
        sql = Path(sql_path).expanduser().resolve().read_text(encoding="utf-8")
        if connection is not None:
            connection.execute(sql)
            return

        with self.connect() as conn:
            conn.execute(sql)
            conn.commit()

    def latest_trade_date(
        self,
        market: MarketCode | Literal["auto"],
        ticker: str,
        *,
        connection: psycopg.Connection | None = None,
    ) -> date | None:
        normalized_ticker, resolved_market = normalize_ticker(ticker, market)
        table = MARKET_TABLES[resolved_market]
        query = f"SELECT MAX(trade_date) AS max_date FROM {table} WHERE ticker = %s"

        if connection is not None:
            row = connection.execute(query, (normalized_ticker,)).fetchone()
            return row["max_date"] if row else None

        with self.connect() as conn:
            row = conn.execute(query, (normalized_ticker,)).fetchone()
            return row["max_date"] if row else None

    def upsert_frame(
        self,
        market: MarketCode | Literal["auto"],
        ticker: str,
        frame: pd.DataFrame,
        *,
        connection: psycopg.Connection | None = None,
    ) -> int:
        normalized_ticker, resolved_market = normalize_ticker(ticker, market)
        table = MARKET_TABLES[resolved_market]
        prepared = self.prepare_frame(frame)
        rows = [
            (
                normalized_ticker,
                pd.Timestamp(index).date(),
                float(row["open"]),
                float(row["high"]),
                float(row["low"]),
                float(row["close"]),
                int(float(row["volume"])),
            )
            for index, row in prepared.iterrows()
        ]
        if not rows:
            return 0

        sql = f"""
            INSERT INTO {table} (ticker, trade_date, open, high, low, close, volume)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (ticker, trade_date) DO UPDATE SET
              open = EXCLUDED.open,
              high = EXCLUDED.high,
              low = EXCLUDED.low,
              close = EXCLUDED.close,
              volume = EXCLUDED.volume,
              updated_at = NOW()
        """

        if connection is not None:
            with connection.cursor() as cursor:
                cursor.executemany(sql, rows)
            return len(rows)

        with self.connect() as conn:
            with conn.cursor() as cursor:
                cursor.executemany(sql, rows)
            conn.commit()
        return len(rows)

    def fetch_recent_frame(
        self,
        ticker: str,
        *,
        market: MarketCode | Literal["auto"] = "auto",
        limit: int = 260,
        min_rows: int = 260,
        connection: psycopg.Connection | None = None,
    ) -> MarketDataFetchResult:
        if limit <= 0:
            raise ValueError("limit must be greater than 0.")

        normalized_ticker, resolved_market = normalize_ticker(ticker, market)
        table = MARKET_TABLES[resolved_market]
        sql = f"""
            SELECT trade_date, open, high, low, close, volume
            FROM (
              SELECT trade_date, open, high, low, close, volume
              FROM {table}
              WHERE ticker = %s
              ORDER BY trade_date DESC
              LIMIT %s
            ) recent
            ORDER BY trade_date ASC
        """

        if connection is not None:
            rows = connection.execute(sql, (normalized_ticker, limit)).fetchall()
        else:
            with self.connect() as conn:
                rows = conn.execute(sql, (normalized_ticker, limit)).fetchall()

        frame = pd.DataFrame(rows, columns=["trade_date", "open", "high", "low", "close", "volume"])
        if frame.empty or len(frame) < min_rows:
            raise ValueError(
                f"{normalized_ticker} has only {len(frame)} stored rows in {table}; at least {min_rows} rows are required."
            )

        frame["trade_date"] = pd.to_datetime(frame["trade_date"], errors="coerce")
        frame = frame.rename(columns={"trade_date": "date"})
        frame = frame.dropna(subset=["date"]).reset_index(drop=True)
        start_date = pd.Timestamp(frame.iloc[0]["date"]).date()
        end_date = pd.Timestamp(frame.iloc[-1]["date"]).date()
        return MarketDataFetchResult(
            ticker=normalized_ticker,
            market=resolved_market,
            frame=frame,
            start_date=start_date,
            end_date=end_date,
        )

    def prepare_frame(self, frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty:
            raise ValueError("Input dataframe is empty.")

        prepared = frame.copy()
        prepared.columns = [str(column).strip().lower() for column in prepared.columns]

        timestamp_column = next((column for column in TIMESTAMP_COLUMNS if column in prepared.columns), None)
        if timestamp_column is not None:
            prepared[timestamp_column] = pd.to_datetime(prepared[timestamp_column], errors="coerce")
            prepared = prepared.set_index(timestamp_column)

        if not isinstance(prepared.index, pd.DatetimeIndex):
            prepared.index = pd.to_datetime(prepared.index, errors="coerce")

        prepared = prepared[~prepared.index.isna()]
        prepared = prepared.sort_index()
        prepared = prepared[~prepared.index.duplicated(keep="last")]

        missing = [column for column in REQUIRED_COLUMNS if column not in prepared.columns]
        if missing:
            raise ValueError(f"Missing required OHLCV columns: {', '.join(missing)}")

        for column in REQUIRED_COLUMNS:
            prepared[column] = pd.to_numeric(prepared[column], errors="coerce")

        cleaned = prepared[list(REQUIRED_COLUMNS)].dropna(how="any")
        if cleaned.empty:
            raise ValueError("Input dataframe contains no valid OHLCV rows after cleaning.")
        return cleaned
