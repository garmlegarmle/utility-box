import { useEffect, useRef, useState } from 'react';
import { HoldemTournamentEmbed } from 'holdem/embed';
import { getHoldemStats, recordHoldemCompletion, recordHoldemPlayStart } from '../lib/api';
import type {
  HoldemCompleteResponse,
  HoldemLeaderboardEntry,
  HoldemStatsSummary,
  SiteLang,
} from '../types';

export const TEXAS_HOLDEM_TOURNAMENT_SLUG = 'texas-holdem-tournament';
const PLAYER_NAME_STORAGE_KEY = 'ga_ml_holdem_player_name';

const COPY = {
  en: {
    eyebrow: 'Game / Texas Holdem',
    title: "Texas Hold'em Tournament",
    description:
      'Play a single-table tournament against local AI opponents. The embedded game runs directly in the page and keeps tournament flow, blinds, eliminations, and showdown logic in the browser.',
    totalPlays: 'Total plays',
    leaderboardTitle: 'Top 10 leaderboard',
    leaderboardEmpty: 'No ranked runs have been recorded yet.',
    leaderboardOutcome: 'Finish',
    leaderboardLevel: 'Level',
    leaderboardHands: 'Hands',
    leaderboardRecorded: 'Recorded',
    syncSaved: 'Run synced to the leaderboard service.',
    syncSavedTop10: 'Top 10 result saved.',
    syncPlayError: 'The tournament started, but play count sync failed.',
    syncResultError: 'The tournament finished, but result sync failed.',
    loading: 'Loading stats...',
  },
  ko: {
    eyebrow: '게임 / 텍사스 홀덤',
    title: '텍사스 홀덤 토너먼트',
    description:
      '로컬 AI 8명을 상대로 싱글 테이블 토너먼트를 진행하는 브라우저 게임입니다. 블라인드 상승, 탈락, 쇼다운까지 페이지 안에서 바로 플레이할 수 있습니다.',
    totalPlays: '총 플레이 수',
    leaderboardTitle: '상위 10위 랭킹',
    leaderboardEmpty: '아직 저장된 랭킹이 없습니다.',
    leaderboardOutcome: '최종 순위',
    leaderboardLevel: '도달 레벨',
    leaderboardHands: '핸드 수',
    leaderboardRecorded: '기록 시각',
    syncSaved: '플레이 결과가 저장되었습니다.',
    syncSavedTop10: '상위 10위 기록이 저장되었습니다.',
    syncPlayError: '게임은 시작됐지만 플레이 수 저장에는 실패했습니다.',
    syncResultError: '게임은 종료됐지만 결과 저장에는 실패했습니다.',
    loading: '통계를 불러오는 중입니다.',
  }
} as const;

function normalizePlayerName(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

function createEmptySummary(): HoldemStatsSummary {
  return {
    totalPlays: 0,
    playerPlays: 0,
  };
}

function formatPlacement(value: number, lang: SiteLang) {
  if (lang === 'ko') {
    return `${value}위`;
  }

  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value}st`;
  if (mod10 === 2 && mod100 !== 12) return `${value}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${value}rd`;
  return `${value}th`;
}

function formatDate(value: string | null, lang: SiteLang) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function HoldemTournamentGameContent({ lang, embedded = false }: { lang: SiteLang; embedded?: boolean }) {
  const copy = COPY[lang];
  const seedRef = useRef(Math.floor(Date.now() % 2147483647) || 1);
  const [playerName, setPlayerName] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    return normalizePlayerName(window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || '');
  });
  const [summary, setSummary] = useState<HoldemStatsSummary>(createEmptySummary);
  const [leaderboard, setLeaderboard] = useState<HoldemLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [runToken, setRunToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await getHoldemStats();
        if (cancelled) return;
        setSummary(result.summary);
        setLeaderboard(result.leaderboard);
      } catch {
        if (cancelled) return;
        setSummary(createEmptySummary());
        setLeaderboard([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  function applyStats(payload: HoldemCompleteResponse | { summary: HoldemStatsSummary; leaderboard: HoldemLeaderboardEntry[] }) {
    setSummary(payload.summary);
    setLeaderboard(payload.leaderboard);
  }

  function handlePlayerNameChange(nextValue: string) {
    const normalized = normalizePlayerName(nextValue);
    setPlayerName(normalized);

    if (typeof window !== 'undefined') {
      if (normalized) {
        window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(PLAYER_NAME_STORAGE_KEY);
      }
    }
  }

  async function handleTournamentStart(nextPlayerName: string) {
    const normalized = normalizePlayerName(nextPlayerName);
    if (!normalized) return;

    handlePlayerNameChange(normalized);
    setRunToken(null);

    try {
      const result = await recordHoldemPlayStart(normalized);
      applyStats(result);
      setRunToken(result.runToken);
      setSyncMessage(null);
    } catch {
      setRunToken(null);
      setSyncMessage(copy.syncPlayError);
    }
  }

  async function handleTournamentComplete(payload: {
    playerWon: boolean;
    finalPlace: number;
    handNumber: number;
    level: number;
  }) {
    const normalized = normalizePlayerName(playerName);
    if (!normalized || !runToken) {
      setSyncMessage(copy.syncResultError);
      return;
    }

    try {
      const result = await recordHoldemCompletion({
        playerName: normalized,
        runToken,
        playerWon: payload.playerWon,
        finalPlace: payload.finalPlace,
        handNumber: payload.handNumber,
        levelReached: payload.level,
      });
      applyStats(result);
      setRunToken(null);
      setSyncMessage(result.madeLeaderboard ? copy.syncSavedTop10 : copy.syncSaved);
    } catch {
      setRunToken(null);
      setSyncMessage(copy.syncResultError);
    }
  }

  return (
    <div className={`holdem-game-shell${embedded ? ' holdem-game-shell--embedded' : ''}`}>
      {!embedded ? (
        <header className="holdem-game-head">
          <p className="holdem-game-head__eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </header>
      ) : null}

      <section className="holdem-game-summary" aria-label={copy.totalPlays}>
        <article className="holdem-game-summary__card holdem-game-summary__card--single">
          <span className="holdem-game-summary__label">{copy.totalPlays}</span>
          <strong className="holdem-game-summary__value">{summary.totalPlays.toLocaleString()}</strong>
        </article>
      </section>

      {syncMessage ? <p className="holdem-game-sync-note">{syncMessage}</p> : null}

      <div className="holdem-game-stage">
        <HoldemTournamentEmbed
          initialSeed={seedRef.current}
          lang={lang}
          playerName={playerName}
          onPlayerNameChange={handlePlayerNameChange}
          onTournamentStart={handleTournamentStart}
          onTournamentComplete={handleTournamentComplete}
        />
      </div>

      <section className="holdem-game-leaderboard">
        <div className="holdem-game-leaderboard__head">
          <h2>{copy.leaderboardTitle}</h2>
          {loading ? <span>{copy.loading}</span> : null}
        </div>
        {leaderboard.length === 0 ? (
          <p className="holdem-game-leaderboard__empty">{copy.leaderboardEmpty}</p>
        ) : (
          <div className="holdem-game-leaderboard__table" role="table" aria-label={copy.leaderboardTitle}>
            <div className="holdem-game-leaderboard__row holdem-game-leaderboard__row--head" role="row">
              <span role="columnheader">#</span>
              <span role="columnheader">{lang === 'ko' ? '이름' : 'Name'}</span>
              <span role="columnheader">{copy.leaderboardOutcome}</span>
              <span role="columnheader">{copy.leaderboardLevel}</span>
              <span role="columnheader">{copy.leaderboardHands}</span>
              <span role="columnheader">{copy.leaderboardRecorded}</span>
            </div>
            {leaderboard.map((entry) => (
              <div key={entry.id} className="holdem-game-leaderboard__row" role="row">
                <span role="cell">#{entry.rank}</span>
                <span role="cell">{entry.playerName}</span>
                <span role="cell">{formatPlacement(entry.finalPlace, lang)}</span>
                <span role="cell">{entry.levelReached}</span>
                <span role="cell">{entry.handNumber}</span>
                <span role="cell">{formatDate(entry.createdAt, lang)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
