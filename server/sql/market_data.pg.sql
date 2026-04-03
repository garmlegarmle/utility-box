CREATE TABLE IF NOT EXISTS us_equity_daily (
  ticker TEXT NOT NULL,
  trade_date DATE NOT NULL,
  open NUMERIC(20, 6) NOT NULL,
  high NUMERIC(20, 6) NOT NULL,
  low NUMERIC(20, 6) NOT NULL,
  close NUMERIC(20, 6) NOT NULL,
  volume BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, trade_date),
  CHECK (volume >= 0)
);

CREATE TABLE IF NOT EXISTS kr_equity_daily (
  ticker TEXT NOT NULL,
  trade_date DATE NOT NULL,
  open NUMERIC(20, 6) NOT NULL,
  high NUMERIC(20, 6) NOT NULL,
  low NUMERIC(20, 6) NOT NULL,
  close NUMERIC(20, 6) NOT NULL,
  volume BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, trade_date),
  CHECK (volume >= 0)
);

CREATE INDEX IF NOT EXISTS idx_us_equity_daily_trade_date
  ON us_equity_daily(trade_date DESC);

CREATE INDEX IF NOT EXISTS idx_kr_equity_daily_trade_date
  ON kr_equity_daily(trade_date DESC);
