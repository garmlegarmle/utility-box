import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { nowIso, slugifyTag } from './validators.js';

const { Pool } = pg;
const GAME_LEADERBOARD_LIMIT = 10;

export function createPool(config) {
  return new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000
  });
}

export async function ensureSchema(pool) {
  const sqlPath = path.resolve(process.cwd(), 'sql/schema.pg.sql');
  const sql = await fs.readFile(sqlPath, 'utf8');
  await pool.query(sql);
}

export async function ensureSeedPages(pool) {
  const pages = [
    ['about', 'About', 'About GA-ML.', '# About\n\nGA-ML provides practical tools and guides.', 'en'],
    ['contact', 'Contact', 'Contact GA-ML.', '# Contact\n\nFor inquiries, use the official contact channel.', 'en'],
    ['privacy-policy', 'Privacy Policy', 'Privacy policy details.', '# Privacy Policy\n\nWe only store data required for operating the service.', 'en'],
    ['about', '소개', 'GA-ML 소개', '# 소개\n\nGA-ML은 실용적인 도구와 가이드를 제공합니다.', 'ko'],
    ['contact', '문의하기', '문의 안내', '# 문의하기\n\n문의는 공식 채널로 보내주세요.', 'ko'],
    ['privacy-policy', '개인정보 처리방침', '개인정보 처리방침 안내', '# 개인정보 처리방침\n\n서비스 운영에 필요한 최소한의 정보만 처리합니다.', 'ko']
  ];

  for (const [slug, title, excerpt, content, lang] of pages) {
    await pool.query(
      `INSERT INTO posts (slug, title, excerpt, content_md, status, published_at, lang, section)
       VALUES ($1, $2, $3, $4, 'published', NOW(), $5, 'pages')
       ON CONFLICT DO NOTHING`,
      [slug, title, excerpt, content, lang]
    );
  }
}

async function getPublishedContentCardCount(pool, lang) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM posts
     WHERE is_deleted = FALSE
       AND status = 'published'
       AND lang = $1
       AND section IN ('blog', 'tools', 'games')`,
    [lang]
  );
  return Number(result.rows[0]?.count || 0);
}

export async function getNextPublishedContentCardRank(pool, lang) {
  return (await getPublishedContentCardCount(pool, lang)) + 1;
}

export async function ensureSeedProgramPosts(pool) {
  const posts = [
    {
      slug: 'trend-analyzer',
      section: 'tools',
      title: 'Trend Analyzer',
      excerpt: 'Upload a local OHLCV CSV and review a 200-session trend analysis with chart overlays.',
      content:
        '# Trend Analyzer\n\nUse the built-in analyzer below to upload a CSV from the data downloader and review the chart, score ranges, and interpretation.',
      cleanupExcerpt:
        'Upload an OHLCV CSV to review a 200-session daily chart with moving averages, Ichimoku, MACD, RSI, and a plain-language trend interpretation.',
      cleanupContent:
        '# Trend Analyzer\n\nUpload a daily OHLCV CSV from the GA-ML data downloader to review the recent 200-session trend, chart overlays, and plain-language interpretation.',
      cleanupBefore: `# Trend Analyzer

This page reviews the recent daily trend of a stock or ETF from your own OHLCV CSV. Upload a file from the GA-ML data downloader, then inspect the 200-session candle chart, overlay indicators, and interpretation in one place.

## How To Use This Page

1. Download a CSV with the GA-ML data downloader.
2. Upload the file in the analyzer below.
3. Review the summary block, chart overlays, RSI, MACD, and detailed explanation.
4. Repeat the same workflow with another ticker when you want to compare names side by side.

## What You Will See

- A recent 200-session daily candle chart
- EMA 20, EMA 50, SMA 200, and Ichimoku overlays
- MACD and RSI panels
- A summary block that describes the current regime
- Range-based scores that show whether momentum, confidence, or transition risk are low, medium, or high`,
      cleanupAfter: `## How To Read The Analysis

### Trend And Moving Averages

When price is above short and medium moving averages, the tape is usually in a healthier short-term state. When EMA 20 is above EMA 50 and price also holds above SMA 200, the market is often acting like a stronger continuation trend rather than a weak bounce.

### RSI And MACD

RSI helps show whether momentum is stretched. A high RSI can signal strong upside pressure, but it can also warn that the move is running hot. MACD helps confirm whether momentum is still improving or fading. A bullish crossover is more useful when it happens with supportive price structure instead of in isolation.

### Ichimoku Interpretation

The Ichimoku overlay helps frame trend context. Price above the cloud usually points to a healthier trend backdrop, price inside the cloud often suggests transition or noise, and price below the cloud can mean the market is still structurally weak. Tenkan and Kijun alignment can also show whether shorter-term momentum agrees with the broader setup.

## Why This Tool Uses CSV Uploads

This page analyzes market data that you provide locally. The downloader prepares a consistent daily OHLCV file, and the web analyzer focuses on calculation and explanation rather than live market-data collection.

## Best Use Cases

- Compare several ETFs or stocks with the same data format
- Review whether a recent breakout still has momentum support
- Check whether a pullback is happening above or below key averages
- Study how multiple indicators agree or conflict before you make your own decision

## Limits And Caution

- This tool reads daily bars only
- The result depends on the quality of the CSV you upload
- Indicator signals can lag or fail in choppy markets
- The output is for research and education, not personalized investment advice`,
      lang: 'en',
      tags: ['analysis', 'trend']
    },
    {
      slug: 'trend-analyzer',
      section: 'tools',
      title: '추세 분석기',
      excerpt: '로컬 OHLCV CSV를 업로드해 최근 200세션 기준 추세 분석과 차트 오버레이를 확인하세요.',
      content:
        '# 추세 분석기\n\n아래 내장 분석기에 데이터 다운로더가 만든 CSV를 업로드하면 차트, 범위형 점수, 해석 결과를 확인할 수 있습니다.',
      cleanupExcerpt:
        'OHLCV CSV를 업로드해 최근 200세션 일봉 차트와 이평선, 일목균형표, MACD, RSI, 해석형 추세 분석을 함께 확인하세요.',
      cleanupContent:
        '# 추세 분석기\n\nGA-ML 데이터 다운로더가 만든 일봉 OHLCV CSV를 업로드하면 최근 200세션 차트와 추세 해석을 한 번에 확인할 수 있습니다.',
      cleanupBefore: `# 추세 분석기

이 페이지는 사용자가 준비한 OHLCV CSV를 바탕으로 종목의 최근 일봉 흐름을 정리해 보여주는 분석 도구입니다. GA-ML 데이터 다운로더로 만든 파일을 업로드하면 최근 200세션 캔들차트, 보조지표, 해석 결과를 한 화면에서 확인할 수 있습니다.

## 이 페이지 이용 방법

1. GA-ML 데이터 다운로더로 원하는 티커의 CSV를 저장합니다.
2. 아래 분석기에 CSV 파일을 업로드합니다.
3. 핵심 요약, 캔들차트, RSI, MACD, 상세 해석을 순서대로 확인합니다.
4. 다른 종목도 같은 형식의 CSV로 반복 업로드해 비교합니다.

## 이 페이지에서 볼 수 있는 것

- 최근 200세션 기준 일봉 캔들차트
- EMA 20, EMA 50, SMA 200, 일목균형표 오버레이
- MACD와 RSI 패널
- 현재 상태를 요약한 핵심 해석 블록
- 모멘텀, 신뢰도, 전환 위험을 범위형으로 보여주는 점수 카드`,
      cleanupAfter: `## 분석 결과 읽는 법

### 추세와 이동평균선

가격이 단기, 중기 이동평균선 위에서 움직이고 있고 EMA 20이 EMA 50 위에 있다면 단기 흐름이 비교적 건강할 가능성이 큽니다. 여기에 SMA 200 위까지 유지하면 단기 반등이 아니라 더 큰 상위 추세 안에서 움직이는지 확인하는 데 도움이 됩니다.

### RSI와 MACD

RSI는 현재 모멘텀이 얼마나 과열되었는지 또는 약해졌는지 보는 데 유용합니다. RSI가 높다고 해서 바로 하락을 뜻하는 것은 아니지만, 과매수 구간에 가까워질수록 추격 매수 리스크를 더 조심해서 볼 필요가 있습니다. MACD는 모멘텀이 강해지는지 약해지는지, 그리고 시그널선과의 관계가 어떤지를 확인하는 데 적합합니다.

### 일목균형표 해석

일목균형표는 현재 가격이 어느 구조 위에 있는지 보는 데 좋습니다. 가격이 구름 위에 있으면 상대적으로 강한 구조일 수 있고, 구름 안에 있으면 방향성이 흐려졌을 수 있으며, 구름 아래에 있으면 아직 약한 흐름일 가능성이 큽니다. 전환선과 기준선의 위치 관계도 단기 모멘텀과 중기 균형을 함께 보는 데 도움을 줍니다.

## 왜 CSV를 업로드해서 분석하나요

이 페이지는 사용자가 로컬에서 준비한 데이터를 기준으로 계산과 해석에 집중하도록 설계되어 있습니다. 데이터 수집은 다운로더가 맡고, 웹 분석기는 그 CSV를 읽어 일관된 방식으로 차트와 해석을 제공합니다.

## 이런 상황에서 유용합니다

- 여러 ETF나 종목을 같은 기준으로 비교하고 싶을 때
- 최근 돌파가 실제 추세 확장인지 확인하고 싶을 때
- 조정 구간이 핵심 이동평균선 위인지 아래인지 보고 싶을 때
- 여러 보조지표가 같은 방향을 말하는지, 서로 충돌하는지 확인하고 싶을 때

## 한계와 주의사항

- 현재 결과는 일봉 데이터 기준입니다
- 업로드한 CSV 품질에 따라 결과도 달라집니다
- 보조지표는 횡보장이나 급격한 전환 구간에서 늦거나 흔들릴 수 있습니다
- 이 도구는 학습과 리서치용이며, 개인 맞춤형 투자 자문이 아닙니다`,
      lang: 'ko',
      tags: ['분석', '추세']
    },
    {
      slug: 'chart-interpretation',
      section: 'tools',
      title: 'Chart Interpretation',
      excerpt: 'Run one ticker or upload an OHLCV CSV to read a discretionary-style chart report with scenarios, targets, and risk notes.',
      content:
        '# Chart Interpretation\n\nUse the built-in chart interpretation tool below to analyze one ticker or one OHLCV CSV and export the chart, HTML report, and JSON payload.',
      cleanupExcerpt:
        'Analyze one ticker or OHLCV CSV with a structure-first chart report that includes scenarios, invalidation, target zones, and export artifacts.',
      cleanupContent:
        '# Chart Interpretation\n\nUse the built-in chart interpretation tool below to analyze one ticker or one OHLCV CSV and export the chart, HTML report, and JSON payload.',
      cleanupBefore: `# Chart Interpretation

This page turns one ticker or one OHLCV CSV into a discretionary-style technical report. It focuses on structure, current location, scenario paths, invalidation, and target zones rather than only dumping indicator values.

## How To Use This Page

1. Start with the built-in demo to understand the output format.
2. Run a ticker directly, or upload a CSV prepared by the GA-ML downloader.
3. Review the rendered chart image, summary, primary scenario, strongest alternative, and target zones.
4. Open the exported HTML or JSON artifact when you want the full output outside the page.

## Why CSV Upload Is Still Included

This page can download a ticker directly, but it also supports the same CSV workflow used in Trend Analyzer. That keeps raw OHLCV preparation available on the user device first when you prefer a local-first process.`,
      cleanupAfter: `## What The Report Tries To Answer

### Structure First

The engine first asks whether price is trending, breaking structure, pressing into resistance, retesting support, or showing signs of failure. That framing matters more than reading one indicator in isolation.

### Scenario Paths

The primary scenario describes the currently favored path. The strongest alternative shows the next path that could take over if the market reacts differently from here. Invalidation and target zones are included so the output stays decision-oriented.

### Exported Artifacts

Each run can produce a chart image, a JSON payload, and an HTML report. That makes it easier to save a snapshot, compare names, or move the interpretation into another workflow.

## Where The CSV Downloader Fits

If you already use the GA-ML CSV downloader from Trend Analyzer, you can use the same workflow here. Prepare a clean daily OHLCV CSV locally, upload it on this page, and let the chart interpretation engine focus on reading the structure and writing the report.`,
      lang: 'en',
      tags: ['analysis', 'chart']
    },
    {
      slug: 'chart-interpretation',
      section: 'tools',
      title: '차트 해석기',
      excerpt: '티커 하나를 바로 실행하거나 OHLCV CSV를 업로드해 시나리오, 목표 구간, 리스크 메모가 포함된 재량형 차트 리포트를 확인할 수 있습니다.',
      content:
        '# 차트 해석기\n\n아래 내장 도구에서 티커 하나 또는 OHLCV CSV 하나를 분석하고, 차트 이미지와 HTML 리포트, JSON payload를 함께 확인할 수 있습니다.',
      cleanupExcerpt:
        '티커 하나 또는 OHLCV CSV 하나를 구조 중심 차트 리포트로 해석하고 시나리오, 무효화 기준, 목표 구간, 산출물을 함께 확인하세요.',
      cleanupContent:
        '# 차트 해석기\n\n아래 내장 도구에서 티커 하나 또는 OHLCV CSV 하나를 분석하고, 차트 이미지와 HTML 리포트, JSON payload를 함께 확인할 수 있습니다.',
      cleanupBefore: `# 차트 해석기

이 페이지는 티커 하나 또는 OHLCV CSV 하나를 재량형 기술적 리포트처럼 읽을 수 있게 정리해주는 도구입니다. 단순히 지표 값만 나열하기보다, 구조, 현재 위치, 시나리오 경로, 무효화 기준, 목표 구간을 함께 보여줍니다.

## 이 페이지 이용 방법

1. 먼저 기본 데모를 보고 출력 형식을 확인합니다.
2. 티커를 바로 실행하거나, GA-ML 다운로더가 만든 CSV를 업로드합니다.
3. 렌더링된 차트 이미지, 요약, 주 시나리오, 가장 강한 대안, 목표 구간을 확인합니다.
4. 페이지 밖에서 결과를 보관하거나 비교하려면 HTML 또는 JSON 산출물을 엽니다.

## 왜 CSV 업로드도 같이 넣었나요

이 페이지는 티커 직접 실행도 가능하지만, 추세 분석기에서 쓰던 같은 CSV 흐름도 지원합니다. 원시 OHLCV 준비를 먼저 사용자 기기에서 처리하고 싶을 때 그대로 이어서 사용할 수 있습니다.`,
      cleanupAfter: `## 이 리포트가 답하려는 것

### 구조를 먼저 봅니다

엔진은 먼저 가격이 추세 안에 있는지, 구조를 돌파했는지, 저항을 밀고 있는지, 지지를 재시험하는지, 실패 신호가 나오는지를 우선 판단합니다. 개별 지표 하나만 보는 것보다 이 맥락이 더 중요합니다.

### 시나리오 경로를 보여줍니다

주 시나리오는 현재 가장 유력한 경로를 말하고, 가장 강한 대안 시나리오는 다른 반응이 나왔을 때 바로 대체될 수 있는 경로를 보여줍니다. 무효화 기준과 목표 구간도 같이 제공해서 해석이 행동 기준으로 이어지게 합니다.

### 산출물을 같이 남깁니다

각 실행은 차트 이미지, JSON payload, HTML 리포트를 만들 수 있습니다. 그래서 여러 종목을 비교하거나, 결과를 따로 저장하거나, 다른 워크플로에 넘기기 쉬워집니다.

## CSV 다운로더는 어디에 쓰이나요

추세 분석기에서 사용하던 GA-ML CSV 다운로더를 여기에서도 그대로 쓸 수 있습니다. 로컬에서 일봉 OHLCV CSV를 만든 뒤 이 페이지에 업로드하면, 차트 해석 엔진은 구조 읽기와 리포트 작성에 집중합니다.`,
      lang: 'ko',
      tags: ['분석', '차트']
    },
    {
      slug: 'texas-holdem-tournament',
      section: 'games',
      title: "Texas Hold'em Tournament",
      excerpt: 'Play a browser-based single-table tournament against eight local AI opponents.',
      content:
        "# Texas Hold'em Tournament\n\nPlay a built-in single-table Texas Hold'em tournament against local AI opponents directly in the page below.",
      cleanupExcerpt:
        "Play a browser-based single-table Texas Hold'em tournament against eight AI opponents and compare your result with the top 10 leaderboard.",
      cleanupContent:
        "# Texas Hold'em Tournament\n\nPlay a built-in single-table Texas Hold'em tournament against eight local AI opponents directly in the page below.",
      cleanupBefore: `# Texas Hold'em Tournament

This page is a browser-based single-table tournament. You play against eight AI opponents, climb through blind levels, and try to finish first without installing anything extra.

## How To Use This Page

1. Enter the name you want to display at the table.
2. Review the opponent profile summary.
3. Start the tournament and play each hand directly in the browser.
4. When a run ends, compare your finish with the public top 10 leaderboard.

## Tournament Setup

- 9 players at one table
- 10,000 starting chips per player
- Blind levels increase every 8 hands
- Total plays count every started run
- The leaderboard keeps the best 10 completed results`,
      cleanupAfter: `## Strategy Guide

### Early Levels

In the early phase, chip preservation matters. You have room to fold marginal hands and wait for stronger spots. Strong position, selective aggression, and avoiding low-quality all-ins usually matter more than forcing action every hand.

### Middle Levels

As blinds rise, stack pressure becomes more important. Pay attention to how often you are posting blinds, whether your stack still gives you postflop flexibility, and whether open-raising or reshove spots are becoming more urgent.

### Short-Stack And Late Stage

When stacks get shallow, preflop discipline becomes critical. Hand value shifts, fold equity matters more, and one mistimed call can end the run. If you are near the endgame, survival and pressure both matter because a first-place finish is worth far more than simply staying alive with no plan.

## How The Ranking Works

Completed runs are ranked by whether you won the tournament, your final finishing place, the blind level you reached, and the hand count recorded for that run. Only the top 10 results are kept on the public leaderboard.

## About Play Count And Saved Results

The total play count is a lightweight public counter of started runs. The leaderboard stores only the strongest completed finishes so the page stays focused on best results rather than every session ever played.

## Why This Game Works Well In The Browser

The tournament flow, betting logic, eliminations, and showdown resolution all run directly in the page. That makes it fast to restart, easy to practice repeatedly, and convenient to play on demand without a separate install.`,
      lang: 'en',
      tags: ['holdem', 'poker']
    },
    {
      slug: 'texas-holdem-tournament',
      section: 'games',
      title: '텍사스 홀덤 토너먼트',
      excerpt: '로컬 AI 8명을 상대로 브라우저 안에서 싱글 테이블 토너먼트를 플레이할 수 있습니다.',
      content:
        '# 텍사스 홀덤 토너먼트\n\n아래 내장 게임에서 로컬 AI 8명을 상대로 싱글 테이블 텍사스 홀덤 토너먼트를 바로 플레이할 수 있습니다.',
      cleanupExcerpt:
        '브라우저에서 로컬 AI 8명을 상대로 싱글 테이블 텍사스 홀덤 토너먼트를 플레이하고 상위 10위 랭킹과 비교해보세요.',
      cleanupContent:
        '# 텍사스 홀덤 토너먼트\n\n아래 내장 게임에서 로컬 AI 8명을 상대로 싱글 테이블 텍사스 홀덤 토너먼트를 바로 플레이할 수 있습니다.',
      cleanupBefore: `# 텍사스 홀덤 토너먼트

이 페이지는 브라우저에서 바로 플레이할 수 있는 싱글 테이블 텍사스 홀덤 토너먼트 게임입니다. 별도 설치 없이 로컬 AI 8명과 맞붙어 블라인드가 올라가는 환경에서 1위를 노릴 수 있습니다.

## 이 페이지 이용 방법

1. 테이블에서 표시할 이름을 입력합니다.
2. 상대 프로필 요약을 확인합니다.
3. 게임을 시작하고 브라우저 안에서 직접 액션을 진행합니다.
4. 한 판이 끝나면 상위 10위 랭킹과 자신의 결과를 비교합니다.

## 토너먼트 기본 설정

- 한 테이블 9인 토너먼트
- 모든 플레이어 시작 칩 10,000
- 8핸드마다 블라인드 상승
- 총 플레이 수는 시작된 판 기준으로 누적
- 랭킹은 완료된 결과 중 상위 10개만 유지`,
      cleanupAfter: `## 플레이 전략 가이드

### 초반 레벨

초반에는 무리하게 큰 팟을 만들기보다 스택을 지키는 판단이 중요합니다. 포지션이 좋을 때 더 넓게 열고, 좋지 않은 자리에서는 약한 핸드로 불필요한 충돌을 줄이는 편이 안정적입니다.

### 중반 레벨

블라인드가 올라가기 시작하면 한 번의 폴드와 한 번의 블라인드 납부가 스택에 미치는 영향이 커집니다. 자신의 유효 스택이 얼마나 남았는지, 오픈 레이즈와 올인 압박 중 어느 쪽이 더 적합한지 더 자주 판단해야 합니다.

### 후반과 숏스택 구간

후반으로 갈수록 프리플랍 선택의 무게가 커집니다. 핸드 강도, 폴드 이퀴티, 남은 상대 수를 함께 봐야 하고, 애매한 콜 한 번이 바로 탈락으로 이어질 수 있습니다. 상위권 진입 직전에는 생존과 압박을 함께 고려하는 운영이 중요합니다.

## 랭킹은 어떻게 정해지나요

완료된 기록은 우승 여부, 최종 순위, 도달 레벨, 해당 런의 핸드 수 순서로 비교해 정렬합니다. 공개 랭킹에는 상위 10개 결과만 남습니다.

## 총 플레이 수와 결과 저장

총 플레이 수는 시작된 판의 누적 횟수를 보여주는 가벼운 공용 카운터입니다. 랭킹은 모든 결과를 다 저장하는 방식이 아니라, 좋은 완료 기록만 남겨 페이지를 간결하게 유지합니다.

## 이 게임이 웹에서 잘 맞는 이유

토너먼트 진행, 베팅 로직, 탈락 처리, 쇼다운 계산이 모두 페이지 안에서 바로 돌아갑니다. 그래서 재시작이 빠르고, 여러 번 반복 플레이하며 연습하기에 적합합니다.`,
      lang: 'ko',
      tags: ['홀덤', '포커']
    },
    {
      slug: 'mine-cart-duel',
      section: 'games',
      title: 'Mine Cart Duel',
      excerpt: 'Use webcam hand tracking to duel a CPU opponent in a fast mine-cart shooter embedded directly in the page.',
      content:
        '# Mine Cart Duel\n\nPlay a hand-tracking duel game directly in the page below. Allow camera access inside the game when you press Start Game.',
      cleanupExcerpt:
        'Use webcam hand tracking to duel a CPU opponent in a fast mine-cart shooter embedded directly in the page.',
      cleanupContent:
        '# Mine Cart Duel\n\nPlay a hand-tracking duel game directly in the page below. Allow camera access inside the game when you press Start Game.',
      cleanupBefore: '',
      cleanupAfter: '',
      lang: 'en',
      tags: ['duel', 'shooter']
    },
    {
      slug: 'mine-cart-duel',
      section: 'games',
      title: '마인 카트 듀얼',
      excerpt: '웹캠 손 추적으로 CPU 상대와 빠른 광차 슈팅 듀얼을 플레이할 수 있는 내장 게임입니다.',
      content:
        '# 마인 카트 듀얼\n\n아래 내장 게임에서 손 추적 광차 듀얼을 바로 플레이할 수 있습니다. 게임 안에서 Start Game을 눌러 카메라 권한을 허용하세요.',
      cleanupExcerpt:
        '웹캠 손 추적으로 CPU 상대와 빠른 광차 슈팅 듀얼을 플레이할 수 있는 내장 게임입니다.',
      cleanupContent:
        '# 마인 카트 듀얼\n\n아래 내장 게임에서 손 추적 광차 듀얼을 바로 플레이할 수 있습니다. 게임 안에서 Start Game을 눌러 카메라 권한을 허용하세요.',
      cleanupBefore: '',
      cleanupAfter: '',
      lang: 'ko',
      tags: ['듀얼', '슈터']
    }
  ];

  for (const item of posts) {
    const nextRank = await getNextPublishedContentCardRank(pool, item.lang);
    const inserted = await pool.query(
      `INSERT INTO posts (
         slug, title, excerpt, content_md, status, published_at, lang, section,
         card_title, card_category, card_rank, schema_type
       )
       VALUES ($1, $2, $3, $4, 'published', NOW(), $5, $6, $2, $6, $7, 'Service')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [item.slug, item.title, item.excerpt, item.content, item.lang, item.section, nextRank]
    );

    const postId = inserted.rows[0]?.id ? Number(inserted.rows[0].id) : 0;
    if (postId > 0 && item.tags.length > 0) {
      await replacePostTags(pool, postId, item.tags);
      continue;
    }

    const existing = await pool.query(
      `SELECT id, card_rank, excerpt, content_md, content_before_md, content_after_md
       FROM posts
       WHERE slug = $1 AND lang = $2 AND section = $3 AND is_deleted = FALSE
       LIMIT 1`,
      [item.slug, item.lang, item.section]
    );
    const existingPost = existing.rows[0];
    const hasInjectedSeoContent =
      existingPost?.id &&
      String(existingPost.excerpt || '').trim() === String(item.cleanupExcerpt || '').trim() &&
      String(existingPost.content_md || '').trim() === String(item.cleanupContent || '').trim() &&
      String(existingPost.content_before_md || '').trim() === String(item.cleanupBefore || '').trim() &&
      String(existingPost.content_after_md || '').trim() === String(item.cleanupAfter || '').trim();

    if (hasInjectedSeoContent) {
      await pool.query(
        `UPDATE posts
         SET excerpt = $1,
             content_md = $2,
             content_before_md = NULL,
             content_after_md = NULL,
             updated_at = NOW()
         WHERE id = $3`,
        [item.excerpt, item.content, Number(existingPost.id)]
      );
    }

    if (existingPost?.id && Number(existingPost.card_rank || 0) === 1) {
      const total = await getPublishedContentCardCount(pool, item.lang);
      if (total > 1) {
        await pool.query('UPDATE posts SET card_rank = $1, updated_at = NOW() WHERE id = $2', [total, Number(existingPost.id)]);
      }
    }
  }
}

export async function normalizeDerivedPostCardFields(pool) {
  await pool.query(
    `WITH tag_lists AS (
      SELECT p.id AS post_id, NULLIF(string_agg(t.name, ', ' ORDER BY LOWER(t.name)), '') AS card_tag
      FROM posts p
      LEFT JOIN post_tags pt ON pt.post_id = p.id
      LEFT JOIN tags t ON t.id = pt.tag_id
      WHERE p.is_deleted = FALSE
      GROUP BY p.id
    )
    UPDATE posts p
    SET
      card_title = p.title,
      card_tag = tag_lists.card_tag,
      updated_at = CASE
        WHEN p.card_title IS DISTINCT FROM p.title OR p.card_tag IS DISTINCT FROM tag_lists.card_tag THEN NOW()
        ELSE p.updated_at
      END
    FROM tag_lists
    WHERE p.id = tag_lists.post_id
      AND (p.card_title IS DISTINCT FROM p.title OR p.card_tag IS DISTINCT FROM tag_lists.card_tag)`
  );
}

export async function getAppSetting(pool, key) {
  const result = await pool.query('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', [key]);
  return result.rows[0]?.value || null;
}

export async function setAppSetting(pool, key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

export async function upsertTags(pool, tags) {
  const out = [];
  for (const tag of tags) {
    const name = String(tag || '').trim();
    if (!name) continue;
    const slug = slugifyTag(name);
    if (!slug) continue;
    await pool.query(
      `INSERT INTO tags (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
      [name, slug]
    );
    const found = await pool.query('SELECT id FROM tags WHERE slug = $1 LIMIT 1', [slug]);
    if (found.rows[0]?.id) out.push(Number(found.rows[0].id));
  }
  return out;
}

export async function replacePostTags(pool, postId, tags) {
  const tagIds = await upsertTags(pool, tags);
  await pool.query('DELETE FROM post_tags WHERE post_id = $1', [postId]);
  for (const tagId of tagIds) {
    await pool.query(
      'INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [postId, tagId]
    );
  }
}

export async function getPostTags(pool, postId) {
  const rows = await pool.query(
    `SELECT t.name
     FROM tags t
     INNER JOIN post_tags pt ON pt.tag_id = t.id
     WHERE pt.post_id = $1
     ORDER BY LOWER(t.name) ASC`,
    [postId]
  );
  return rows.rows.map((row) => row.name);
}

export async function getPostTagsMap(pool, postIds) {
  const ids = postIds.filter((id) => Number.isFinite(id) && id > 0);
  const out = new Map();
  if (!ids.length) return out;
  const rows = await pool.query(
    `SELECT pt.post_id AS post_id, t.name AS name
     FROM post_tags pt
     INNER JOIN tags t ON t.id = pt.tag_id
     WHERE pt.post_id = ANY($1::bigint[])
     ORDER BY LOWER(t.name) ASC`,
    [ids]
  );
  for (const row of rows.rows) {
    const key = Number(row.post_id);
    const list = out.get(key) || [];
    list.push(String(row.name || '').trim());
    out.set(key, list);
  }
  return out;
}

export async function listDistinctTags(pool, { lang, publishedOnly = false }) {
  const binds = [];
  const where = ['p.is_deleted = FALSE'];
  if (lang) {
    binds.push(lang);
    where.push(`p.lang = $${binds.length}`);
  }
  if (publishedOnly) {
    where.push(`p.status = 'published'`);
  }
  const rows = await pool.query(
    `SELECT name
     FROM (
       SELECT DISTINCT t.name AS name
       FROM tags t
       INNER JOIN post_tags pt ON pt.tag_id = t.id
       INNER JOIN posts p ON p.id = pt.post_id
       WHERE ${where.join(' AND ')}
     ) tag_names
     ORDER BY LOWER(name) ASC`,
    binds
  );
  return rows.rows.map((row) => String(row.name || '').trim()).filter(Boolean);
}

export async function listTagCountsBySection(pool, { lang, section, publishedOnly = false }) {
  const binds = [lang, section];
  const where = ['p.is_deleted = FALSE', 'p.lang = $1', 'p.section = $2'];
  if (publishedOnly) where.push(`p.status = 'published'`);
  const rows = await pool.query(
    `SELECT t.name AS name, COUNT(*)::int AS count
     FROM tags t
     INNER JOIN post_tags pt ON pt.tag_id = t.id
     INNER JOIN posts p ON p.id = pt.post_id
     WHERE ${where.join(' AND ')}
     GROUP BY t.id, t.name
     ORDER BY LOWER(t.name) ASC`,
    binds
  );
  return rows.rows.map((row) => ({ name: row.name, count: Number(row.count || 0) }));
}

export async function getMediaById(pool, mediaId) {
  const rows = await pool.query('SELECT * FROM media WHERE id = $1 LIMIT 1', [mediaId]);
  return rows.rows[0] || null;
}

export async function getMediaVariants(pool, mediaId) {
  const rows = await pool.query('SELECT * FROM media_variants WHERE media_id = $1 ORDER BY id ASC', [mediaId]);
  return rows.rows;
}

function requestOrigin(request, publicOrigin = '') {
  if (publicOrigin) {
    return { origin: publicOrigin };
  }
  const forwardedProto = String(request.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = String(request.get('x-forwarded-host') || '').split(',')[0].trim();
  const protocol = forwardedProto || request.protocol;
  const host = forwardedHost || request.get('host');
  return { origin: `${protocol}://${host}` };
}

export function mapPostRow(row, tags, request, publicOrigin = '') {
  const { origin } = requestOrigin(request, publicOrigin);
  const coverUrl = row.cover_image_id ? `${origin}/api/media/${row.cover_image_id}/file` : null;
  const cardImageUrl = row.card_image_id ? `${origin}/api/media/${row.card_image_id}/file` : null;
  const rankValue = row.card_rank ? `#${row.card_rank}` : null;
  const resolvedOgImageUrl = row.og_image_url || cardImageUrl || coverUrl || null;
  const joinedTags = tags.map((tag) => String(tag || '').trim()).filter(Boolean).join(', ');
  const storedCardTag = String(row.card_tag || '').trim();
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content_md: row.content_md,
    content_before_md: row.content_before_md || null,
    content_after_md: row.content_after_md || null,
    status: row.status,
    published_at: row.published_at ? new Date(row.published_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    lang: row.lang,
    section: row.section,
    pair_slug: row.pair_slug,
    view_count: Number(row.view_count || 0),
    tags,
    meta: {
      title: row.meta_title || null,
      description: row.meta_description || null
    },
    og: {
      title: row.og_title || row.meta_title || row.title || null,
      description: row.og_description || row.meta_description || row.excerpt || null,
      imageUrl: resolvedOgImageUrl
    },
    schemaType: row.schema_type || null,
    cover: row.cover_image_id ? { id: Number(row.cover_image_id), url: coverUrl } : null,
    card: {
      title: row.card_title || row.title,
      category: row.card_category || row.section,
      tag: storedCardTag && storedCardTag.toLowerCase() !== 'tag' ? storedCardTag : joinedTags || 'Tag',
      rank: rankValue,
      rankNumber: row.card_rank ? Number(row.card_rank) : null,
      imageId: row.card_image_id ? Number(row.card_image_id) : null,
      imageUrl: cardImageUrl,
      titleSize: row.card_title_size || 'auto'
    }
  };
}

export async function touchViewCount(pool, postId) {
  await pool.query('UPDATE posts SET view_count = view_count + 1 WHERE id = $1', [postId]);
}

export async function softDeletePost(pool, postId) {
  return pool.query(
    'UPDATE posts SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND is_deleted = FALSE',
    [postId]
  );
}

export async function cleanupUnusedTag(pool, tagId) {
  const remains = await pool.query('SELECT COUNT(*)::int AS count FROM post_tags WHERE tag_id = $1', [tagId]);
  if (!Number(remains.rows[0]?.count || 0)) {
    await pool.query('DELETE FROM tags WHERE id = $1', [tagId]);
  }
}

export async function incrementGamePlayCount(pool, { gameSlug, playerName }) {
  const result = await pool.query(
    `INSERT INTO game_play_counts (game_slug, player_name, play_count, created_at, updated_at)
     VALUES ($1, $2, 1, NOW(), NOW())
     ON CONFLICT (game_slug, player_name)
     DO UPDATE SET play_count = game_play_counts.play_count + 1, updated_at = NOW()
     RETURNING play_count`,
    [gameSlug, playerName]
  );

  return Number(result.rows[0]?.play_count || 0);
}

export async function registerGamePlay(pool, { gameSlug, playerName, runToken, ttlSeconds }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `DELETE FROM game_run_sessions
       WHERE game_slug = $1
         AND (expires_at <= NOW() OR consumed_at IS NOT NULL)`,
      [gameSlug]
    );

    const playResult = await client.query(
      `INSERT INTO game_play_counts (game_slug, player_name, play_count, created_at, updated_at)
       VALUES ($1, $2, 1, NOW(), NOW())
       ON CONFLICT (game_slug, player_name)
       DO UPDATE SET play_count = game_play_counts.play_count + 1, updated_at = NOW()
       RETURNING play_count`,
      [gameSlug, playerName]
    );

    await client.query(
      `INSERT INTO game_run_sessions (
         run_token, game_slug, player_name, created_at, expires_at
       ) VALUES ($1, $2, $3, NOW(), NOW() + make_interval(secs => $4))`,
      [runToken, gameSlug, playerName, ttlSeconds]
    );

    await client.query('COMMIT');
    return Number(playResult.rows[0]?.play_count || 0);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getGamePlaySummary(pool, { gameSlug, playerName = null }) {
  const totalResult = await pool.query(
    `SELECT COALESCE(SUM(play_count), 0)::int AS total_plays
     FROM game_play_counts
     WHERE game_slug = $1`,
    [gameSlug]
  );

  let playerPlays = 0;
  if (playerName) {
    const playerResult = await pool.query(
      `SELECT play_count
       FROM game_play_counts
       WHERE game_slug = $1 AND player_name = $2
       LIMIT 1`,
      [gameSlug, playerName]
    );
    playerPlays = Number(playerResult.rows[0]?.play_count || 0);
  }

  return {
    totalPlays: Number(totalResult.rows[0]?.total_plays || 0),
    playerPlays
  };
}

export async function listGameLeaderboard(pool, { gameSlug, limit = GAME_LEADERBOARD_LIMIT }) {
  const result = await pool.query(
    `SELECT
       id,
       player_name,
       final_place,
       level_reached,
       hand_number,
       player_won,
       created_at,
       ROW_NUMBER() OVER (
         ORDER BY
           CASE WHEN player_won THEN 1 ELSE 0 END DESC,
           final_place ASC,
           level_reached DESC,
           hand_number DESC,
           created_at ASC,
           id ASC
       )::int AS leaderboard_rank
     FROM game_leaderboard_entries
     WHERE game_slug = $1
     ORDER BY
       CASE WHEN player_won THEN 1 ELSE 0 END DESC,
       final_place ASC,
       level_reached DESC,
       hand_number DESC,
       created_at ASC,
       id ASC
     LIMIT $2`,
    [gameSlug, limit]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    rank: Number(row.leaderboard_rank || 0),
    playerName: String(row.player_name || '').trim(),
    finalPlace: Number(row.final_place || 0),
    levelReached: Number(row.level_reached || 0),
    handNumber: Number(row.hand_number || 0),
    playerWon: Boolean(row.player_won),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  }));
}

export async function recordGameLeaderboardEntry(
  pool,
  { gameSlug, playerName, finalPlace, levelReached, handNumber, playerWon }
) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const insert = await client.query(
      `INSERT INTO game_leaderboard_entries (
         game_slug, player_name, final_place, level_reached, hand_number, player_won, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id`,
      [gameSlug, playerName, finalPlace, levelReached, handNumber, playerWon]
    );

    const entryId = Number(insert.rows[0]?.id || 0);

    await client.query(
      `WITH ranked AS (
         SELECT
           id,
           ROW_NUMBER() OVER (
             ORDER BY
               CASE WHEN player_won THEN 1 ELSE 0 END DESC,
               final_place ASC,
               level_reached DESC,
               hand_number DESC,
               created_at ASC,
               id ASC
           ) AS leaderboard_rank
         FROM game_leaderboard_entries
         WHERE game_slug = $1
       )
       DELETE FROM game_leaderboard_entries entry
       USING ranked
       WHERE entry.id = ranked.id
         AND ranked.leaderboard_rank > $2`,
      [gameSlug, GAME_LEADERBOARD_LIMIT]
    );

    const kept = await client.query(
      `SELECT 1
       FROM game_leaderboard_entries
       WHERE id = $1
       LIMIT 1`,
      [entryId]
    );

    await client.query('COMMIT');
    return {
      entryId,
      madeLeaderboard: Boolean(kept.rows[0])
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function recordGameLeaderboardEntryForRun(
  pool,
  { gameSlug, playerName, runToken, finalPlace, levelReached, handNumber, playerWon }
) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const sessionResult = await client.query(
      `UPDATE game_run_sessions
       SET consumed_at = NOW()
       WHERE run_token = $1
         AND game_slug = $2
         AND player_name = $3
         AND consumed_at IS NULL
         AND expires_at > NOW()
       RETURNING run_token`,
      [runToken, gameSlug, playerName]
    );

    if (!sessionResult.rows[0]) {
      await client.query('ROLLBACK');
      return {
        entryId: 0,
        madeLeaderboard: false,
        accepted: false
      };
    }

    const insert = await client.query(
      `INSERT INTO game_leaderboard_entries (
         game_slug, player_name, final_place, level_reached, hand_number, player_won, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id`,
      [gameSlug, playerName, finalPlace, levelReached, handNumber, playerWon]
    );

    const entryId = Number(insert.rows[0]?.id || 0);

    await client.query(
      `WITH ranked AS (
         SELECT
           id,
           ROW_NUMBER() OVER (
             ORDER BY
               CASE WHEN player_won THEN 1 ELSE 0 END DESC,
               final_place ASC,
               level_reached DESC,
               hand_number DESC,
               created_at ASC,
               id ASC
           ) AS leaderboard_rank
         FROM game_leaderboard_entries
         WHERE game_slug = $1
       )
       DELETE FROM game_leaderboard_entries entry
       USING ranked
       WHERE entry.id = ranked.id
         AND ranked.leaderboard_rank > $2`,
      [gameSlug, GAME_LEADERBOARD_LIMIT]
    );

    const kept = await client.query(
      `SELECT 1
       FROM game_leaderboard_entries
       WHERE id = $1
       LIMIT 1`,
      [entryId]
    );

    await client.query(
      `DELETE FROM game_run_sessions
       WHERE game_slug = $1
         AND (expires_at <= NOW() OR consumed_at IS NOT NULL)`,
      [gameSlug]
    );

    await client.query('COMMIT');
    return {
      entryId,
      madeLeaderboard: Boolean(kept.rows[0]),
      accepted: true
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function nowDb() {
  return nowIso();
}
