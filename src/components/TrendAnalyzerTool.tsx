import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import spyPayloadSource from '../../web_backend_bundle/samples/SPY_web_payload.json';
import type { SiteLang } from '../types';

interface TrendPayload {
  meta: {
    ticker: string;
    as_of_date: string;
    window_bars: number;
    window_start: string;
    window_end: string;
    best_direction_family?: string | null;
  };
  current_state: {
    trend_state_label: string;
    trend_state_label_ko: string;
    trend_strength_score: number;
    trend_conviction_score: number;
    transition_risk_score: number;
    transition_risk_label: string;
    confidence_score: number;
    summary_text: string;
    interpretation_text_ko: string;
    tags?: string[];
  };
  chart_200d: {
    candles: TrendCandle[];
  };
  indicator_snapshot?: Record<string, number>;
}

interface TrendCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trend_strength_score: number;
  transition_risk_score: number;
  confidence_score: number;
}

const SAMPLE_PAYLOADS: Record<string, TrendPayload> = {
  SPY: spyPayloadSource as TrendPayload
};

const TREND_TOOL_SLUG = 'trend-analyzer';

const TOOL_COPY = {
  en: {
    featureEyebrow: 'Built-in Tool',
    featureTitle: 'Trend Analyzer',
    featureDescription: 'Load the bundled preview and inspect the last 200 daily candles, indicator lines, and regime summary.',
    featureCta: 'Open tool',
    eyebrow: 'Tool / Market Trend',
    title: 'Trend Analyzer',
    description:
      'Enter a ticker, then review the most recent 200 daily candles, indicator lines, and the current trend readout. Live market data will be connected later.',
    inputLabel: 'Ticker',
    inputPlaceholder: 'e.g. SPY, QQQ, NVDA',
    submit: 'Load preview',
    sampleNotice: 'Current version uses bundled sample payloads only. The data pipeline will be added later.',
    activeTicker: 'Selected ticker',
    asOf: 'As of',
    window: 'Window',
    chartTitle: 'Daily Candles',
    chartSubtitle: 'Last 200 market sessions based on the latest close',
    indicatorTitle: 'Indicator Lines',
    indicatorSubtitle: 'Trend strength, confidence, and transition risk',
    resultTitle: 'Analysis Result',
    summaryTitle: 'Interpretation',
    snapshotTitle: 'Indicator Snapshot',
    trend: 'Trend',
    strength: 'Trend strength',
    conviction: 'Conviction',
    risk: 'Transition risk',
    confidence: 'Confidence',
    noDataTitle: 'No payload for this ticker yet',
    noDataBody: 'The page layout is ready, but only bundled samples can be rendered right now.',
    availableSamples: 'Available sample tickers',
    trendStrengthLine: 'Trend strength',
    confidenceLine: 'Confidence',
    riskLine: 'Transition risk',
    lastClose: 'Last close',
    family: 'Direction family'
  },
  ko: {
    featureEyebrow: '내장 도구',
    featureTitle: '추세 분석기',
    featureDescription: '번들에 들어 있는 샘플 payload를 바로 열고, 최근 200일 일봉과 보조지표, 추세 판독 결과를 볼 수 있습니다.',
    featureCta: '도구 열기',
    eyebrow: '도구 / 주식 추세',
    title: '추세 분석기',
    description:
      '티커를 입력하면 최근 장 마감일 기준 200일 일봉, 보조지표 라인, 현재 추세 판독 결과를 볼 수 있게 만든 화면입니다. 실데이터 연결은 이후에 붙일 예정입니다.',
    inputLabel: '티커',
    inputPlaceholder: '예: SPY, QQQ, NVDA',
    submit: '미리보기 불러오기',
    sampleNotice: '현재 버전은 번들에 포함된 샘플 payload만 렌더링합니다. 실데이터 파이프라인은 이후 연결 예정입니다.',
    activeTicker: '선택한 티커',
    asOf: '기준일',
    window: '구간',
    chartTitle: '일봉 캔들 차트',
    chartSubtitle: '최근 장 마감일 기준 과거 200개 세션',
    indicatorTitle: '보조지표 그래프',
    indicatorSubtitle: '추세 강도, 신뢰도, 전환 위험',
    resultTitle: '분석 결과',
    summaryTitle: '해석',
    snapshotTitle: '지표 스냅샷',
    trend: '현재 추세',
    strength: '추세 강도',
    conviction: '추세 확신도',
    risk: '전환 위험',
    confidence: '신뢰도',
    noDataTitle: '아직 이 티커용 payload가 없습니다',
    noDataBody: '화면 구조는 준비됐고, 현재는 번들에 들어 있는 샘플 티커만 렌더링할 수 있습니다.',
    availableSamples: '사용 가능한 샘플 티커',
    trendStrengthLine: '추세 강도',
    confidenceLine: '신뢰도',
    riskLine: '전환 위험',
    lastClose: '최근 종가',
    family: '방향 계열'
  }
} as const;

function normalizeTicker(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-_]/g, '');
}

function formatDate(value: string, lang: SiteLang): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US');
}

function formatNumber(value: number, lang: SiteLang, digits = 2): string {
  return new Intl.NumberFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(Number(value || 0));
}

function formatScore(value: number, lang: SiteLang): string {
  return `${formatNumber(value, lang, 1)}`;
}

function titleCase(value: string): string {
  return String(value || '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function scoreTone(value: number): 'low' | 'mid' | 'high' {
  if (value >= 66) return 'high';
  if (value >= 33) return 'mid';
  return 'low';
}

function buildLinePath(values: number[], width: number, height: number, padding: number): string {
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const safeValues = values.length > 0 ? values : [0];
  const min = Math.min(...safeValues, 0);
  const max = Math.max(...safeValues, 100);
  const span = max - min || 1;

  return safeValues
    .map((value, index) => {
      const x = padding + (innerWidth * index) / Math.max(safeValues.length - 1, 1);
      const y = padding + innerHeight - ((value - min) / span) * innerHeight;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function buildChartTicks(candles: TrendCandle[]) {
  const midpoint = Math.floor(candles.length / 2);
  return [
    candles[0]?.date || '',
    candles[midpoint]?.date || '',
    candles[candles.length - 1]?.date || ''
  ];
}

function CandlestickChart({ candles, lang }: { candles: TrendCandle[]; lang: SiteLang }) {
  const width = 1040;
  const height = 420;
  const padding = { top: 20, right: 20, bottom: 30, left: 54 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const highs = candles.map((item) => item.high);
  const lows = candles.map((item) => item.low);
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const priceSpan = Math.max(maxPrice - minPrice, 1);
  const stepX = plotWidth / Math.max(candles.length, 1);
  const bodyWidth = Math.max(2, Math.min(5, stepX * 0.56));
  const ticks = buildChartTicks(candles);

  const scaleY = (price: number) => padding.top + ((maxPrice - price) / priceSpan) * plotHeight;

  return (
    <div className="trend-tool-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={lang === 'ko' ? '최근 200일 캔들 차트' : 'Last 200-session candlestick chart'}>
        <rect x="0" y="0" width={width} height={height} rx="20" fill="#fffdf6" />
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + plotHeight * ratio;
          const value = maxPrice - priceSpan * ratio;
          return (
            <g key={`price-grid-${ratio}`}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#d9d2bf" strokeDasharray="4 6" />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#5a5342">
                {formatNumber(value, lang, 1)}
              </text>
            </g>
          );
        })}

        {candles.map((candle, index) => {
          const centerX = padding.left + stepX * index + stepX / 2;
          const openY = scaleY(candle.open);
          const closeY = scaleY(candle.close);
          const highY = scaleY(candle.high);
          const lowY = scaleY(candle.low);
          const rising = candle.close >= candle.open;
          const bodyY = Math.min(openY, closeY);
          const bodyHeight = Math.max(Math.abs(closeY - openY), 1.5);
          const bodyColor = rising ? '#174f43' : '#9d2f36';

          return (
            <g key={`candle-${candle.date}`}>
              <line x1={centerX} y1={highY} x2={centerX} y2={lowY} stroke={bodyColor} strokeWidth="1.2" />
              <rect
                x={centerX - bodyWidth / 2}
                y={bodyY}
                width={bodyWidth}
                height={bodyHeight}
                rx="1"
                fill={rising ? '#d6ede5' : '#f6d7d7'}
                stroke={bodyColor}
                strokeWidth="1"
              />
            </g>
          );
        })}

        {ticks.map((tick, index) => (
          <text
            key={`date-tick-${tick}-${index}`}
            x={index === 0 ? padding.left : index === 1 ? width / 2 : width - padding.right}
            y={height - 8}
            textAnchor={index === 0 ? 'start' : index === 1 ? 'middle' : 'end'}
            fontSize="11"
            fill="#5a5342"
          >
            {formatDate(tick, lang)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function IndicatorChart({ candles, lang }: { candles: TrendCandle[]; lang: SiteLang }) {
  const width = 1040;
  const height = 240;
  const padding = 26;
  const trendValues = candles.map((item) => item.trend_strength_score);
  const confidenceValues = candles.map((item) => item.confidence_score);
  const riskValues = candles.map((item) => item.transition_risk_score);
  const ticks = buildChartTicks(candles);

  return (
    <div className="trend-tool-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={lang === 'ko' ? '보조지표 라인 차트' : 'Indicator line chart'}>
        <rect x="0" y="0" width={width} height={height} rx="20" fill="#f8f8f8" />
        {[0, 25, 50, 75, 100].map((value) => {
          const y = padding + ((100 - value) / 100) * (height - padding * 2);
          return (
            <g key={`indicator-grid-${value}`}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#d7d7d7" strokeDasharray="4 6" />
              <text x={padding - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#575757">
                {value}
              </text>
            </g>
          );
        })}

        <path d={buildLinePath(trendValues, width, height, padding)} fill="none" stroke="#0f766e" strokeWidth="2.5" />
        <path d={buildLinePath(confidenceValues, width, height, padding)} fill="none" stroke="#1d4ed8" strokeWidth="2.5" />
        <path d={buildLinePath(riskValues, width, height, padding)} fill="none" stroke="#d97706" strokeWidth="2.5" />

        {ticks.map((tick, index) => (
          <text
            key={`indicator-tick-${tick}-${index}`}
            x={index === 0 ? padding : index === 1 ? width / 2 : width - padding}
            y={height - 8}
            textAnchor={index === 0 ? 'start' : index === 1 ? 'middle' : 'end'}
            fontSize="11"
            fill="#575757"
          >
            {formatDate(tick, lang)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function TrendAnalyzerFeatureCard({ lang }: { lang: SiteLang }) {
  const copy = TOOL_COPY[lang];

  return (
    <section className="tool-feature-card" aria-label={copy.featureTitle}>
      <div className="tool-feature-card__body">
        <p className="tool-feature-card__eyebrow">{copy.featureEyebrow}</p>
        <h2>{copy.featureTitle}</h2>
        <p>{copy.featureDescription}</p>
      </div>
      <Link className="tool-feature-card__link" to={`/${lang}/tools/${TREND_TOOL_SLUG}/`}>
        {copy.featureCta}
      </Link>
    </section>
  );
}

export function TrendAnalyzerToolScreen({ lang }: { lang: SiteLang }) {
  const copy = TOOL_COPY[lang];
  const [tickerInput, setTickerInput] = useState('SPY');
  const [selectedTicker, setSelectedTicker] = useState('SPY');
  const normalizedTicker = normalizeTicker(selectedTicker);

  const payload = useMemo(() => SAMPLE_PAYLOADS[normalizedTicker] || null, [normalizedTicker]);
  const candles = payload?.chart_200d?.candles || [];
  const availableTickers = Object.keys(SAMPLE_PAYLOADS);
  const indicatorSnapshot = payload?.indicator_snapshot || {};

  const overviewItems = payload
    ? [
        { label: copy.trend, value: lang === 'ko' ? payload.current_state.trend_state_label_ko : titleCase(payload.current_state.trend_state_label) },
        { label: copy.strength, value: formatScore(payload.current_state.trend_strength_score, lang), tone: scoreTone(payload.current_state.trend_strength_score) },
        { label: copy.conviction, value: formatScore(payload.current_state.trend_conviction_score, lang), tone: scoreTone(payload.current_state.trend_conviction_score) },
        { label: copy.risk, value: formatScore(payload.current_state.transition_risk_score, lang), tone: scoreTone(100 - payload.current_state.transition_risk_score) },
        { label: copy.confidence, value: formatScore(payload.current_state.confidence_score, lang), tone: scoreTone(payload.current_state.confidence_score) }
      ]
    : [];

  const snapshotItems = [
    { label: copy.lastClose, value: indicatorSnapshot.close },
    { label: 'EMA 20', value: indicatorSnapshot.ema20 },
    { label: 'EMA 50', value: indicatorSnapshot.ema50 },
    { label: 'SMA 200', value: indicatorSnapshot.sma200 },
    { label: 'RSI', value: indicatorSnapshot.rsi },
    { label: 'MACD Hist', value: indicatorSnapshot.macd_hist },
    { label: 'ATR %', value: indicatorSnapshot.atr_pct },
    { label: 'ADX', value: indicatorSnapshot.adx }
  ].filter((item) => Number.isFinite(item.value));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSelectedTicker(normalizeTicker(tickerInput));
  };

  return (
    <section className="page-section trend-tool-page">
      <div className="container">
        <div className="trend-tool-shell">
          <header className="trend-tool-head">
            <p className="trend-tool-head__eyebrow">{copy.eyebrow}</p>
            <h1>{copy.title}</h1>
            <p>{copy.description}</p>
          </header>

          <form className="trend-tool-form" onSubmit={handleSubmit}>
            <label className="trend-tool-form__field">
              <span>{copy.inputLabel}</span>
              <div className="trend-tool-form__controls">
                <input
                  value={tickerInput}
                  onChange={(event) => setTickerInput(event.target.value)}
                  placeholder={copy.inputPlaceholder}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
                <button type="submit">{copy.submit}</button>
              </div>
            </label>
            <p className="trend-tool-form__note">{copy.sampleNotice}</p>
          </form>

          <div className="trend-tool-status">
            <span>
              {copy.activeTicker}: <strong>{normalizedTicker || '-'}</strong>
            </span>
            {payload ? (
              <>
                <span>
                  {copy.asOf}: <strong>{formatDate(payload.meta.as_of_date, lang)}</strong>
                </span>
                <span>
                  {copy.window}: <strong>{payload.meta.window_bars} bars</strong>
                </span>
                {payload.meta.best_direction_family ? (
                  <span>
                    {copy.family}: <strong>{titleCase(payload.meta.best_direction_family)}</strong>
                  </span>
                ) : null}
              </>
            ) : null}
          </div>

          {payload ? (
            <>
              <div className="trend-tool-panel-grid">
                <section className="trend-tool-panel">
                  <div className="trend-tool-panel__head">
                    <div>
                      <h2>{copy.chartTitle}</h2>
                      <p>{copy.chartSubtitle}</p>
                    </div>
                  </div>
                  <CandlestickChart candles={candles} lang={lang} />
                </section>

                <section className="trend-tool-panel">
                  <div className="trend-tool-panel__head">
                    <div>
                      <h2>{copy.indicatorTitle}</h2>
                      <p>{copy.indicatorSubtitle}</p>
                    </div>
                    <div className="trend-tool-legend">
                      <span className="trend-tool-legend__item trend-tool-legend__item--teal">{copy.trendStrengthLine}</span>
                      <span className="trend-tool-legend__item trend-tool-legend__item--blue">{copy.confidenceLine}</span>
                      <span className="trend-tool-legend__item trend-tool-legend__item--amber">{copy.riskLine}</span>
                    </div>
                  </div>
                  <IndicatorChart candles={candles} lang={lang} />
                </section>
              </div>

              <section className="trend-tool-result">
                <div className="trend-tool-result__head">
                  <h2>{copy.resultTitle}</h2>
                </div>

                <div className="trend-tool-score-grid">
                  {overviewItems.map((item) => (
                    <article
                      key={`overview-${item.label}`}
                      className={`trend-tool-score-card${item.tone ? ` trend-tool-score-card--${item.tone}` : ''}`}
                    >
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </article>
                  ))}
                </div>

                <div className="trend-tool-analysis-grid">
                  <article className="trend-tool-panel">
                    <div className="trend-tool-panel__head">
                      <div>
                        <h2>{copy.summaryTitle}</h2>
                        <p>{payload.current_state.summary_text}</p>
                      </div>
                    </div>
                    <p className="trend-tool-summary">
                      {lang === 'ko'
                        ? payload.current_state.interpretation_text_ko
                        : payload.current_state.summary_text}
                    </p>
                  </article>

                  <article className="trend-tool-panel">
                    <div className="trend-tool-panel__head">
                      <div>
                        <h2>{copy.snapshotTitle}</h2>
                        <p>{payload.meta.ticker}</p>
                      </div>
                    </div>
                    <dl className="trend-tool-metric-list">
                      {snapshotItems.map((item) => (
                        <div key={`snapshot-${item.label}`}>
                          <dt>{item.label}</dt>
                          <dd>{formatNumber(Number(item.value), lang, 2)}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                </div>
              </section>
            </>
          ) : (
            <section className="trend-tool-panel trend-tool-panel--empty">
              <h2>{copy.noDataTitle}</h2>
              <p>{copy.noDataBody}</p>
              <p>
                {copy.availableSamples}: <strong>{availableTickers.join(', ')}</strong>
              </p>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}

