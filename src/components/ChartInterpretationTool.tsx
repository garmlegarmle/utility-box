import { useState, type ChangeEvent, type FormEvent } from 'react';
import {
  analyzeChartInterpretationCsv,
  analyzeChartInterpretationTicker
} from '../lib/api';
import type {
  ChartInterpretationAnalysisResponse,
  ChartInterpretationLocalizedPayload,
  ChartInterpretationPayload,
  ChartInterpretationScenario,
  ChartInterpretationZone,
  SiteLang
} from '../types';
import demoAnalysisRaw from '../assets/chart-interpretation-demo/bundle_demo_analysis.json';
import demoChartUrl from '../assets/chart-interpretation-demo/bundle_demo_chart.png';

export const CHART_INTERPRETATION_TOOL_SLUG = 'chart-interpretation';

const TREND_FETCHER_REPO_URL = 'https://github.com/garmlegarmle/ga-ml-trend-fetcher';
const TREND_FETCHER_MAC_URL = `${TREND_FETCHER_REPO_URL}/releases/latest/download/GA-ML-TrendFetcher-macos.zip`;
const TREND_FETCHER_WINDOWS_URL = `${TREND_FETCHER_REPO_URL}/releases/latest/download/GA-ML-TrendFetcher-windows.zip`;
const CHART_INTERPRETATION_REPO_URL = 'https://github.com/garmlegarmle/ga-ml-chart-interpretation-web';

const DEMO_ANALYSIS = demoAnalysisRaw as ChartInterpretationPayload;

const TOOL_COPY = {
  en: {
    eyebrow: 'Tool / Chart Report',
    title: 'Chart Interpretation',
    description:
      'Read one ticker or OHLCV CSV like a discretionary technical report with structure, scenario paths, invalidation, target zones, and an exported chart image.',
    introTitle: 'What This Tool Does',
    introBody:
      'The engine interprets daily price structure first, then layers trend state, market structure, location, confirmation, scenarios, and risk notes into one chart-report style output.',
    usageTitle: 'How To Use It',
    usageSteps: [
      'Start with the built-in demo to see the default report format.',
      'Run a ticker directly, or upload a downloader-generated OHLCV CSV.',
      'Review the chart image, primary scenario, alternative path, and target zones.',
      'Open the full HTML report or JSON export when you want the raw artifact files.'
    ],
    demoTitle: 'Bundle demo snapshot',
    demoBody: 'The page opens with a fixed demo generated from the bundled chart interpretation workspace.',
    demoNote: 'Use the ticker or CSV inputs below when you want a fresh analysis.',
    demoReset: 'Show bundle demo again',
    sourceLabel: 'Source',
    activeLabel: 'Current run',
    demoSourceLabel: 'Bundle demo',
    tickerSourceLabel: 'Ticker request',
    csvSourceLabel: 'CSV upload',
    statusTitle: 'Current read',
    trend: 'Trend',
    structure: 'Structure',
    location: 'Location',
    conviction: 'Conviction',
    chartTitle: 'Rendered chart',
    chartBody: 'The backend exports a fresh PNG chart for each run, together with the JSON payload and HTML report.',
    summaryTitle: 'Summary',
    primaryTitle: 'Primary scenario',
    alternativeTitle: 'Strongest alternative',
    confirmationTitle: 'Confirmation checklist',
    riskTitle: 'Risk notes',
    notesTitle: 'Analyst notes',
    levelsTitle: 'Key levels',
    patternsTitle: 'Active patterns',
    eventsTitle: 'Recent events',
    noAlternative: 'No clear alternative path is standing out yet.',
    noItems: 'Nothing additional is listed yet.',
    noPatterns: 'No active pattern is strong enough to highlight.',
    noEvents: 'No recent event is currently highlighted.',
    invalidation: 'Invalidation',
    target1: '1st target',
    target2: '2nd target',
    score: 'Score',
    confidenceScore: 'Confidence',
    tickerFormTitle: 'Run a ticker directly',
    tickerFormBody: 'The server reads recent daily OHLCV for one ticker from the GA-ML market database and generates the chart report on demand.',
    tickerPlaceholder: 'AAPL, NVDA, BTC-USD',
    tickerSubmit: 'Analyze ticker',
    csvFormTitle: 'Upload your own CSV',
    csvFormBody: 'Upload the OHLCV CSV from the downloader when you want a local-first file workflow.',
    csvRowsNote: 'Use a daily OHLCV CSV with roughly 260 or more valid rows so the engine has enough history to interpret structure.',
    csvTitleLabel: 'CSV title',
    csvTitlePlaceholder: 'Example: NVDA daily',
    fileButton: 'Choose CSV',
    fileEmpty: 'No file selected',
    csvSubmit: 'Analyze CSV',
    processing: 'Analyzing...',
    rawUploadNotice: 'Uploaded CSV files are processed to generate the report, and the raw upload is not retained afterward.',
    artifactJson: 'JSON',
    artifactChart: 'PNG chart',
    artifactReport: 'HTML report',
    downloadTitle: 'CSV Downloader',
    downloadBody: 'The same GA-ML downloader used by Trend Analyzer also works here when you want to prepare OHLCV CSV files locally before uploading them.',
    downloadReason:
      'This keeps raw market-data collection on the user device first, while the web page focuses on interpretation, scenario rendering, and artifact export.',
    downloadNote:
      'macOS may block the first launch because the current app build is unsigned. Use Control-click > Open, or allow it once from Privacy & Security.',
    pythonGuide: 'Python setup guide',
    pythonIntro: 'If the unsigned app is blocked, you can run the downloader directly with Python:',
    pythonCommands: [
      'git clone https://github.com/garmlegarmle/ga-ml-trend-fetcher.git',
      'cd ga-ml-trend-fetcher',
      'python3 -m venv .venv',
      'source .venv/bin/activate',
      'pip install -r requirements.txt',
      'python main.py'
    ],
    macDownload: 'macOS app',
    windowsDownload: 'Windows app',
    downloaderRepo: 'Downloader repo',
    toolRepo: 'Chart tool repo',
    errorTicker: 'Enter a ticker first.',
    errorCsv: 'Choose a CSV file first.',
    errorGeneric: 'Analysis failed.',
    direction: 'Direction'
  },
  ko: {
    eyebrow: '도구 / 차트 리포트',
    title: '차트 해석기',
    description:
      '티커 하나 또는 OHLCV CSV 하나를 넣으면 구조, 시나리오 경로, 무효화 기준, 목표 구간, 차트 이미지까지 포함한 재량형 기술적 리포트로 읽을 수 있습니다.',
    introTitle: '이 도구는 무엇을 하나요',
    introBody:
      '이 엔진은 일봉 구조를 먼저 해석하고, 그 위에 추세 상태, 시장 구조, 현재 위치, 확인 조건, 시나리오, 리스크 메모를 얹어 차트 리포트 형태로 정리합니다.',
    usageTitle: '이용 방법',
    usageSteps: [
      '먼저 번들 데모를 보고 기본 리포트 형식을 확인합니다.',
      '티커를 바로 실행하거나, 다운로더가 만든 OHLCV CSV를 업로드합니다.',
      '차트 이미지, 주 시나리오, 대안 경로, 목표 구간을 순서대로 확인합니다.',
      '원본 산출물이 필요하면 HTML 리포트나 JSON 파일을 열어봅니다.'
    ],
    demoTitle: '번들 데모 스냅샷',
    demoBody: '페이지는 chart interpretation 번들에 포함된 고정 데모 결과로 먼저 열립니다.',
    demoNote: '새 분석이 필요하면 아래 티커 실행 또는 CSV 업로드를 사용하세요.',
    demoReset: '번들 데모 다시 보기',
    sourceLabel: '소스',
    activeLabel: '현재 실행',
    demoSourceLabel: '번들 데모',
    tickerSourceLabel: '티커 요청',
    csvSourceLabel: 'CSV 업로드',
    statusTitle: '현재 해석',
    trend: '추세',
    structure: '구조',
    location: '위치',
    conviction: '확신도',
    chartTitle: '렌더링 차트',
    chartBody: '실행할 때마다 서버가 PNG 차트, JSON payload, HTML 리포트를 함께 생성합니다.',
    summaryTitle: '요약',
    primaryTitle: '주 시나리오',
    alternativeTitle: '가장 강한 대안',
    confirmationTitle: '확인 체크리스트',
    riskTitle: '리스크 메모',
    notesTitle: '애널리스트 메모',
    levelsTitle: '핵심 레벨',
    patternsTitle: '활성 패턴',
    eventsTitle: '최근 이벤트',
    noAlternative: '아직 뚜렷하게 부각되는 대안 경로가 없습니다.',
    noItems: '추가로 표시할 항목이 없습니다.',
    noPatterns: '강하게 강조할 활성 패턴이 아직 없습니다.',
    noEvents: '현재 강조되는 최근 이벤트가 없습니다.',
    invalidation: '무효화 기준',
    target1: '1차 목표',
    target2: '2차 목표',
    score: '점수',
    confidenceScore: '확신도',
    tickerFormTitle: '티커 바로 실행',
    tickerFormBody: '서버가 GA-ML 시세 DB에서 티커 하나의 최근 일봉 OHLCV를 읽어 차트 리포트를 바로 생성합니다.',
    tickerPlaceholder: 'AAPL, NVDA, BTC-USD',
    tickerSubmit: '티커 분석',
    csvFormTitle: '내 CSV 업로드',
    csvFormBody: '로컬 중심 흐름을 원하면 다운로더가 만든 OHLCV CSV를 업로드해 사용하세요.',
    csvRowsNote: '구조 해석이 가능하도록 일봉 기준 유효 행이 대략 260개 이상 있는 CSV를 사용하는 편이 좋습니다.',
    csvTitleLabel: 'CSV 제목',
    csvTitlePlaceholder: '예: NVDA daily',
    fileButton: 'CSV 선택',
    fileEmpty: '선택한 파일 없음',
    csvSubmit: 'CSV 분석',
    processing: '분석 중...',
    rawUploadNotice: '업로드한 CSV는 리포트 생성에만 사용하며, 원본 업로드 파일은 계속 보관하지 않습니다.',
    artifactJson: 'JSON',
    artifactChart: 'PNG 차트',
    artifactReport: 'HTML 리포트',
    downloadTitle: 'CSV 다운로더',
    downloadBody: '추세 분석기에 넣어둔 GA-ML 다운로더를 여기에서도 그대로 사용할 수 있습니다. 로컬에서 OHLCV CSV를 만든 뒤 업로드하세요.',
    downloadReason:
      '이 방식은 원시 시세 수집을 먼저 사용자 기기에서 처리하고, 웹 페이지는 해석과 시나리오 정리, 산출물 생성에 집중하게 해줍니다.',
    downloadNote:
      '현재 macOS 빌드는 서명되지 않아 첫 실행 시 차단될 수 있습니다. Control-클릭 후 열기 또는 개인 정보 보호 및 보안에서 한 번 허용해 주세요.',
    pythonGuide: 'Python 실행 안내',
    pythonIntro: 'unsigned 앱이 막히면 아래처럼 Python으로 직접 실행할 수 있습니다:',
    pythonCommands: [
      'git clone https://github.com/garmlegarmle/ga-ml-trend-fetcher.git',
      'cd ga-ml-trend-fetcher',
      'python3 -m venv .venv',
      'source .venv/bin/activate',
      'pip install -r requirements.txt',
      'python main.py'
    ],
    macDownload: 'macOS 앱',
    windowsDownload: 'Windows 앱',
    downloaderRepo: '다운로더 레포',
    toolRepo: '차트 툴 레포',
    errorTicker: '먼저 티커를 입력하세요.',
    errorCsv: '먼저 CSV 파일을 선택하세요.',
    errorGeneric: '분석에 실패했습니다.',
    direction: '방향'
  }
} as const;

type ResultMode = 'demo' | 'ticker' | 'csv';

type ToolResult = {
  label: string;
  mode: ResultMode;
  artifacts: ChartInterpretationAnalysisResponse['artifacts'] | null;
  analysis: ChartInterpretationPayload;
  chartUrl: string;
};

function copyFor(lang: SiteLang) {
  return TOOL_COPY[lang];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatNumber(value: number | null | undefined, lang: SiteLang, digits = 2): string {
  if (!isFiniteNumber(value)) return '-';
  return new Intl.NumberFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(value);
}

function formatScore(value: number | null | undefined, lang: SiteLang): string {
  if (!isFiniteNumber(value)) return '-';
  return formatNumber(value, lang, 2);
}

function formatDate(value: string | null | undefined, lang: SiteLang): string {
  if (!value) return '-';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US');
}

function fileNameOrFallback(file: File | null, fallback: string): string {
  if (!file) return fallback;
  return file.name || fallback;
}

function deriveCsvTitle(file: File | null): string {
  const name = String(file?.name || '').trim();
  return name.replace(/\.csv$/i, '').trim();
}

function localizedPayload(analysis: ChartInterpretationPayload, lang: SiteLang): ChartInterpretationLocalizedPayload {
  return analysis.locales?.[lang] || analysis;
}

function strongestAlternative(
  localized: ChartInterpretationLocalizedPayload,
  analysis: ChartInterpretationPayload
): ChartInterpretationScenario | null {
  if (localized.strongest_alternative) return localized.strongest_alternative;
  const candidates = [analysis.bullish_alternative, analysis.bearish_alternative].filter(
    (item): item is ChartInterpretationScenario => Boolean(item)
  );
  if (!candidates.length) return null;
  return [...candidates].sort((left, right) => Number(right.score || 0) - Number(left.score || 0))[0] || null;
}

function directionClass(direction: string): string {
  const normalized = String(direction || '').trim().toLowerCase();
  if (normalized.includes('bull') || normalized.includes('상방')) return 'chart-report-tool__pill chart-report-tool__pill--bull';
  if (normalized.includes('bear') || normalized.includes('하방')) return 'chart-report-tool__pill chart-report-tool__pill--bear';
  return 'chart-report-tool__pill';
}

function zoneText(zone: ChartInterpretationZone | null | undefined, lang: SiteLang): string {
  if (!zone) return '-';
  const joiner = lang === 'ko' ? ' ~ ' : ' to ';
  return `${formatNumber(zone.low, lang, 2)}${joiner}${formatNumber(zone.high, lang, 2)}`;
}

function scenarioMeta(
  scenario: ChartInterpretationScenario | null | undefined,
  copy: (typeof TOOL_COPY)[SiteLang],
  lang: SiteLang
): string {
  if (!scenario) return '-';
  return `${copy.direction} ${scenario.direction} | ${copy.score} ${formatScore(scenario.score, lang)} | ${copy.confidenceScore} ${formatScore(
    scenario.confidence,
    lang
  )}`;
}

function buildDemoResult(): ToolResult {
  return {
    label: 'Bundle demo',
    mode: 'demo',
    artifacts: null,
    analysis: DEMO_ANALYSIS,
    chartUrl: demoChartUrl
  };
}

export function ChartInterpretationToolContent({ lang, embedded = false }: { lang: SiteLang; embedded?: boolean }) {
  const copy = copyFor(lang);
  const [ticker, setTicker] = useState('');
  const [csvTitle, setCsvTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<ToolResult>(buildDemoResult);
  const [busyMode, setBusyMode] = useState<'ticker' | 'csv' | null>(null);
  const [error, setError] = useState('');

  const localized = localizedPayload(result.analysis, lang);
  const primaryScenario = localized.primary_scenario || null;
  const alternativeScenario = strongestAlternative(localized, result.analysis);
  const summaryText = localized.summary_text || '';
  const notes = [localized.primary_scenario_explanation, localized.alternative_scenario_explanation].filter(Boolean) as string[];
  const confirmationItems = localized.confirmation_checklist || primaryScenario?.confirmation_needed || [];
  const riskItems = localized.risk_notes || primaryScenario?.risk_flags || [];
  const patterns = localized.active_patterns || [];
  const events = localized.recent_events || [];
  const sourceLabel =
    result.mode === 'demo' ? copy.demoSourceLabel : result.mode === 'ticker' ? copy.tickerSourceLabel : copy.csvSourceLabel;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null;
    setSelectedFile(nextFile);
    if (nextFile && !csvTitle.trim()) {
      setCsvTitle(deriveCsvTitle(nextFile));
    }
    setError('');
  };

  const resetDemo = () => {
    setResult(buildDemoResult());
    setTicker('');
    setSelectedFile(null);
    setCsvTitle('');
    setError('');
    setBusyMode(null);
  };

  const handleTickerSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = ticker.trim();
    if (!value) {
      setError(copy.errorTicker);
      return;
    }

    setBusyMode('ticker');
    setError('');

    try {
      const response = await analyzeChartInterpretationTicker(value);
      setResult({
        label: response.label,
        mode: 'ticker',
        artifacts: response.artifacts,
        analysis: response.analysis,
        chartUrl: response.artifacts.chart_png
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.errorGeneric);
    } finally {
      setBusyMode(null);
    }
  };

  const handleCsvSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) {
      setError(copy.errorCsv);
      return;
    }

    setBusyMode('csv');
    setError('');

    try {
      const response = await analyzeChartInterpretationCsv(selectedFile, csvTitle.trim() || deriveCsvTitle(selectedFile));
      setResult({
        label: response.label,
        mode: 'csv',
        artifacts: response.artifacts,
        analysis: response.analysis,
        chartUrl: response.artifacts.chart_png
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.errorGeneric);
    } finally {
      setBusyMode(null);
    }
  };

  return (
    <div className={`chart-report-tool${embedded ? ' chart-report-tool--embedded' : ''}`}>
      {!embedded ? (
        <header className="chart-report-tool__hero">
          <p className="chart-report-tool__eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </header>
      ) : null}

      <div className="chart-report-tool__intro-grid">
        <section className="chart-report-tool__panel">
          <div className="chart-report-tool__panel-head">
            <div>
              <h2>{copy.introTitle}</h2>
              <p>{copy.title}</p>
            </div>
          </div>
          <p className="chart-report-tool__body-copy">{copy.introBody}</p>
        </section>

        <section className="chart-report-tool__panel">
          <div className="chart-report-tool__panel-head">
            <div>
              <h2>{copy.usageTitle}</h2>
              <p>{copy.title}</p>
            </div>
          </div>
          <ol className="chart-report-tool__steps">
            {copy.usageSteps.map((item, index) => (
              <li key={`chart-report-usage-${index}`}>{item}</li>
            ))}
          </ol>
        </section>
      </div>

      <section className="chart-report-tool__panel chart-report-tool__panel--demo">
        <div className="chart-report-tool__panel-head">
          <div>
            <h2>{copy.demoTitle}</h2>
            <p>{copy.demoBody}</p>
          </div>
          {result.mode !== 'demo' ? (
            <button type="button" className="chart-report-tool__ghost-button" onClick={resetDemo}>
              {copy.demoReset}
            </button>
          ) : null}
        </div>
        <p className="chart-report-tool__body-copy">{copy.demoNote}</p>
      </section>

      <div className="chart-report-tool__status">
        <span>
          {copy.sourceLabel}: <strong>{sourceLabel}</strong>
        </span>
        <span>
          {copy.activeLabel}: <strong>{result.label}</strong>
        </span>
      </div>

      <div className="chart-report-tool__metric-grid">
        <article className="chart-report-tool__metric-card">
          <span>{copy.trend}</span>
          <strong>{localized.trend_state || '-'}</strong>
        </article>
        <article className="chart-report-tool__metric-card">
          <span>{copy.structure}</span>
          <strong>{localized.market_structure || '-'}</strong>
        </article>
        <article className="chart-report-tool__metric-card">
          <span>{copy.location}</span>
          <strong>{localized.location_state || '-'}</strong>
        </article>
        <article className="chart-report-tool__metric-card">
          <span>{copy.conviction}</span>
          <strong>{localized.confidence_label || formatNumber(result.analysis.confidence, lang, 2)}</strong>
        </article>
      </div>

      <section className="chart-report-tool__panel chart-report-tool__panel--chart">
        <div className="chart-report-tool__panel-head">
          <div>
            <h2>{copy.chartTitle}</h2>
            <p>{copy.chartBody}</p>
          </div>
          {result.artifacts ? (
            <div className="chart-report-tool__links">
              <a href={result.artifacts.report_html} target="_blank" rel="noreferrer">
                {copy.artifactReport}
              </a>
              <a href={result.artifacts.chart_png} target="_blank" rel="noreferrer">
                {copy.artifactChart}
              </a>
              <a href={result.artifacts.analysis_json} target="_blank" rel="noreferrer">
                {copy.artifactJson}
              </a>
            </div>
          ) : (
            <div className="chart-report-tool__links">
              <a href={CHART_INTERPRETATION_REPO_URL} target="_blank" rel="noreferrer">
                {copy.toolRepo}
              </a>
            </div>
          )}
        </div>
        <div className="chart-report-tool__chart-stage">
          <img src={result.chartUrl} alt={`${result.label} chart interpretation`} loading="lazy" decoding="async" />
        </div>
      </section>

      <div className="chart-report-tool__analysis-grid">
        <section className="chart-report-tool__panel">
          <div className="chart-report-tool__panel-head">
            <div>
              <h2>{copy.summaryTitle}</h2>
              <p>{result.label}</p>
            </div>
          </div>
          <p className="chart-report-tool__body-copy">{summaryText || '-'}</p>
        </section>

        <section className="chart-report-tool__panel">
          <div className="chart-report-tool__panel-head">
            <div>
              <h2>{copy.primaryTitle}</h2>
              <p>{primaryScenario?.name || '-'}</p>
            </div>
          </div>
          {primaryScenario ? (
            <div className="chart-report-tool__scenario">
              <p className="chart-report-tool__meta">{scenarioMeta(primaryScenario, copy, lang)}</p>
              <div className="chart-report-tool__pill-row">
                <span className={directionClass(primaryScenario.direction)}>{primaryScenario.direction}</span>
                <span className="chart-report-tool__pill">
                  {copy.invalidation} {formatNumber(primaryScenario.invalidation_level, lang, 2)}
                </span>
              </div>
              <div className="chart-report-tool__list">
                {primaryScenario.explanation.map((item, index) => (
                  <div key={`primary-explanation-${index}`} className="chart-report-tool__list-item">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="chart-report-tool__empty">{copy.noItems}</p>
          )}
        </section>
      </div>

      <div className="chart-report-tool__analysis-grid chart-report-tool__analysis-grid--lower">
        <section className="chart-report-tool__panel">
          <div className="chart-report-tool__panel-head">
            <div>
              <h2>{copy.alternativeTitle}</h2>
              <p>{alternativeScenario?.name || '-'}</p>
            </div>
          </div>
          {alternativeScenario ? (
            <div className="chart-report-tool__scenario">
              <p className="chart-report-tool__meta">{scenarioMeta(alternativeScenario, copy, lang)}</p>
              <div className="chart-report-tool__pill-row">
                <span className={directionClass(alternativeScenario.direction)}>{alternativeScenario.direction}</span>
                <span className="chart-report-tool__pill">
                  {copy.invalidation} {formatNumber(alternativeScenario.invalidation_level, lang, 2)}
                </span>
              </div>
              <div className="chart-report-tool__list">
                {alternativeScenario.explanation.map((item, index) => (
                  <div key={`alternative-explanation-${index}`} className="chart-report-tool__list-item">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="chart-report-tool__empty">{copy.noAlternative}</p>
          )}
        </section>

        <section className="chart-report-tool__panel">
          <div className="chart-report-tool__panel-head">
            <div>
              <h2>{copy.levelsTitle}</h2>
              <p>{primaryScenario?.name || result.label}</p>
            </div>
          </div>
          <dl className="chart-report-tool__levels">
            <div>
              <dt>{copy.invalidation}</dt>
              <dd>{formatNumber(primaryScenario?.invalidation_level, lang, 2)}</dd>
            </div>
            <div>
              <dt>{copy.target1}</dt>
              <dd>{zoneText(primaryScenario?.target_zone_1, lang)}</dd>
            </div>
            <div>
              <dt>{copy.target2}</dt>
              <dd>{zoneText(primaryScenario?.target_zone_2, lang)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="chart-report-tool__analysis-grid chart-report-tool__analysis-grid--lower">
        <section className="chart-report-tool__panel">
          <div className="chart-report-tool__panel-head">
            <div>
              <h2>{copy.confirmationTitle}</h2>
              <p>{primaryScenario?.name || result.label}</p>
            </div>
          </div>
          {confirmationItems.length ? (
            <div className="chart-report-tool__list">
              {confirmationItems.map((item, index) => (
                <div key={`confirmation-${index}`} className="chart-report-tool__list-item">
                  {item}
                </div>
              ))}
            </div>
          ) : (
            <p className="chart-report-tool__empty">{copy.noItems}</p>
          )}
        </section>

        <section className="chart-report-tool__panel">
          <div className="chart-report-tool__panel-head">
            <div>
              <h2>{copy.riskTitle}</h2>
              <p>{primaryScenario?.name || result.label}</p>
            </div>
          </div>
          {riskItems.length ? (
            <div className="chart-report-tool__list">
              {riskItems.map((item, index) => (
                <div key={`risk-${index}`} className="chart-report-tool__list-item">
                  {item}
                </div>
              ))}
            </div>
          ) : (
            <p className="chart-report-tool__empty">{copy.noItems}</p>
          )}
        </section>
      </div>

      <div className="chart-report-tool__analysis-grid chart-report-tool__analysis-grid--lower">
        <section className="chart-report-tool__panel">
          <div className="chart-report-tool__panel-head">
            <div>
              <h2>{copy.notesTitle}</h2>
              <p>{result.label}</p>
            </div>
          </div>
          {notes.length ? (
            <div className="chart-report-tool__list">
              {notes.map((item, index) => (
                <div key={`note-${index}`} className="chart-report-tool__list-item">
                  {item}
                </div>
              ))}
            </div>
          ) : (
            <p className="chart-report-tool__empty">{copy.noItems}</p>
          )}
        </section>

        <section className="chart-report-tool__panel">
          <div className="chart-report-tool__panel-head">
            <div>
              <h2>{copy.patternsTitle}</h2>
              <p>{result.label}</p>
            </div>
          </div>
          {patterns.length ? (
            <div className="chart-report-tool__list">
              {patterns.map((item, index) => (
                <div key={`pattern-${index}`} className="chart-report-tool__list-item">
                  <strong>{item.pattern_name}</strong>
                  <p className="chart-report-tool__meta">
                    {item.direction} | {copy.confidenceScore} {formatScore(item.confidence, lang)}
                  </p>
                  <p>{item.explanation.join(' ')}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="chart-report-tool__empty">{copy.noPatterns}</p>
          )}
        </section>
      </div>

      <section className="chart-report-tool__panel">
        <div className="chart-report-tool__panel-head">
          <div>
            <h2>{copy.eventsTitle}</h2>
            <p>{result.label}</p>
          </div>
        </div>
        {events.length ? (
          <div className="chart-report-tool__list">
            {events.map((item, index) => (
              <div key={`event-${index}`} className="chart-report-tool__list-item">
                <strong>{item.event_type}</strong>
                <p className="chart-report-tool__meta">
                  {formatDate(item.timestamp, lang)} | {copy.score} {formatScore(item.strength, lang)}
                </p>
                <p>{item.details}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="chart-report-tool__empty">{copy.noEvents}</p>
        )}
      </section>

      <div className="chart-report-tool__forms">
        <form className="chart-report-tool__panel chart-report-tool__form" onSubmit={handleTickerSubmit}>
          <div className="chart-report-tool__panel-head">
            <div>
              <h2>{copy.tickerFormTitle}</h2>
              <p>{copy.tickerFormBody}</p>
            </div>
          </div>
          <label className="chart-report-tool__field">
            <span>Ticker</span>
            <input
              type="text"
              value={ticker}
              placeholder={copy.tickerPlaceholder}
              onChange={(event) => setTicker(event.target.value)}
            />
          </label>
          <div className="chart-report-tool__form-footer">
            <button type="submit" disabled={busyMode !== null}>
              {busyMode === 'ticker' ? copy.processing : copy.tickerSubmit}
            </button>
          </div>
        </form>

        <form className="chart-report-tool__panel chart-report-tool__form" onSubmit={handleCsvSubmit}>
          <div className="chart-report-tool__panel-head">
            <div>
              <h2>{copy.csvFormTitle}</h2>
              <p>{copy.csvFormBody}</p>
            </div>
          </div>
          <label className="chart-report-tool__field">
            <span>{copy.csvTitleLabel}</span>
            <input
              type="text"
              value={csvTitle}
              placeholder={copy.csvTitlePlaceholder}
              onChange={(event) => setCsvTitle(event.target.value)}
            />
          </label>
          <label className="chart-report-tool__field">
            <span>CSV</span>
            <div className="chart-report-tool__upload-row">
              <label className="chart-report-tool__file-button">
                <input type="file" accept=".csv,text/csv" onChange={handleFileChange} />
                <span>{copy.fileButton}</span>
              </label>
              <span className="chart-report-tool__file-name">{fileNameOrFallback(selectedFile, copy.fileEmpty)}</span>
            </div>
          </label>
          <p className="chart-report-tool__notice">{copy.csvRowsNote}</p>
          <div className="chart-report-tool__form-footer">
            <button type="submit" disabled={busyMode !== null}>
              {busyMode === 'csv' ? copy.processing : copy.csvSubmit}
            </button>
            <p className="chart-report-tool__notice">{copy.rawUploadNotice}</p>
          </div>
        </form>
      </div>

      {error ? <p className="chart-report-tool__error">{error}</p> : null}

      <section className="chart-report-tool__panel">
        <div className="chart-report-tool__panel-head">
          <div>
            <h2>{copy.downloadTitle}</h2>
            <p>{copy.downloadBody}</p>
          </div>
        </div>
        <div className="chart-report-tool__links chart-report-tool__links--downloads">
          <a href={TREND_FETCHER_MAC_URL} target="_blank" rel="noreferrer">
            {copy.macDownload}
          </a>
          <a href={TREND_FETCHER_WINDOWS_URL} target="_blank" rel="noreferrer">
            {copy.windowsDownload}
          </a>
          <a href={TREND_FETCHER_REPO_URL} target="_blank" rel="noreferrer">
            {copy.downloaderRepo}
          </a>
          <a href={CHART_INTERPRETATION_REPO_URL} target="_blank" rel="noreferrer">
            {copy.toolRepo}
          </a>
        </div>
        <p className="chart-report-tool__body-copy">{copy.downloadReason}</p>
        <p className="chart-report-tool__notice">{copy.downloadNote}</p>
        <details className="chart-report-tool__disclosure">
          <summary>{copy.pythonGuide}</summary>
          <div className="chart-report-tool__python">
            <p>{copy.pythonIntro}</p>
            <pre>
              <code>{copy.pythonCommands.join('\n')}</code>
            </pre>
          </div>
        </details>
      </section>
    </div>
  );
}

export function ChartInterpretationToolScreen({ lang }: { lang: SiteLang }) {
  return (
    <section className="page-section">
      <div className="container">
        <ChartInterpretationToolContent lang={lang} />
      </div>
    </section>
  );
}
