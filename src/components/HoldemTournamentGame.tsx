import { useEffect, useRef, useState } from 'react';
import { HoldemTournamentEmbed } from 'holdem/embed';
import { getHoldemStats, recordHoldemCompletion, recordHoldemPlayStart } from '../lib/api';
import { HoldemTournamentOnline } from './HoldemTournamentOnline';
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
    nameTitle: 'Choose your display name',
    nameBody: 'Set the name shown in both AI mode and online tables.',
    nameLabel: 'Display name',
    namePlaceholder: 'Enter your display name',
    continue: 'Continue',
    chooseModeTitle: 'Choose your table mode',
    chooseModeBody: 'Start a solo tournament against AI or jump into one of the two live multiplayer tables.',
    editName: 'Edit name',
    changeMode: 'Change mode',
    modeAi: 'AI mode',
    modeOnline: 'Multiplayer mode',
    modeAiBody: 'Single-table local tournament against eight AI opponents.',
    modeOnlineBody: 'Two fixed live tables. Watch current tournaments and join the next one when the table resets.',
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
    nameTitle: '플레이어 이름',
    nameBody: 'AI 모드와 멀티플레이 모드에서 공통으로 쓸 이름을 먼저 정합니다.',
    nameLabel: '표시 이름',
    namePlaceholder: '표시할 이름을 입력하세요',
    continue: '다음',
    chooseModeTitle: '게임 모드 선택',
    chooseModeBody: 'AI와 싱글 테이블 토너먼트를 하거나, 두 개의 라이브 멀티플레이 테이블 중 하나에 참가할 수 있습니다.',
    editName: '이름 수정',
    changeMode: '모드 변경',
    modeAi: 'AI 모드',
    modeOnline: '멀티플레이 모드',
    modeAiBody: 'AI 8명과 싱글 테이블 토너먼트를 바로 플레이합니다.',
    modeOnlineBody: '고정된 2개 라이브 테이블을 관전하고, 현재 토너먼트가 끝나면 다음 토너먼트에 참가합니다.',
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
  const [mode, setMode] = useState<'ai' | 'online' | null>(null);
  const [playerName, setPlayerName] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    return normalizePlayerName(window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || '');
  });
  const [selectionStep, setSelectionStep] = useState<'name' | 'mode'>(() =>
    normalizePlayerName(typeof window === 'undefined' ? '' : window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || '')
      ? 'mode'
      : 'name',
  );
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

  useEffect(() => {
    if (!playerName) {
      setSelectionStep('name');
      setMode(null);
    }
  }, [playerName]);

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

  function handleContinueFromName() {
    if (!playerName) return;
    setSelectionStep('mode');
  }

  function handleChooseMode(nextMode: 'ai' | 'online') {
    if (!playerName) {
      setSelectionStep('name');
      return;
    }

    setMode(nextMode);
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

      {mode === 'ai' ? (
        <>
          <section className="holdem-game-summary" aria-label={copy.totalPlays}>
            <article className="holdem-game-summary__card holdem-game-summary__card--single">
              <span className="holdem-game-summary__label">{copy.totalPlays}</span>
              <strong className="holdem-game-summary__value">{summary.totalPlays.toLocaleString()}</strong>
            </article>
          </section>

          {syncMessage ? <p className="holdem-game-sync-note">{syncMessage}</p> : null}

          <div className="holdem-game-stage holdem-game-stage--selectable">
            <button type="button" className="holdem-game-stage__mode-button" onClick={() => setMode(null)}>
              {copy.changeMode}
            </button>
            <HoldemTournamentEmbed
              initialSeed={seedRef.current}
              lang={lang}
              playerName={playerName}
              skipNamePrompt
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
        </>
      ) : mode === 'online' ? (
        <div className="holdem-game-stage holdem-game-stage--selectable">
          <button type="button" className="holdem-game-stage__mode-button" onClick={() => setMode(null)}>
            {copy.changeMode}
          </button>
          <HoldemTournamentOnline
            lang={lang}
            playerName={playerName}
            onPlayerNameChange={handlePlayerNameChange}
            initialSetupStep="table"
          />
        </div>
      ) : (
        <div className="holdem-game-stage">
          <div className="holdem-app-theme holdem-mode-stage">
            <div className="holdem-mode-stage__overlay">
              <div className="holdem-mode-stage__card">
                {selectionStep === 'name' ? (
                  <>
                    <span className="holdem-mode-stage__eyebrow">{copy.eyebrow}</span>
                    <h2 className="holdem-mode-stage__title">{copy.nameTitle}</h2>
                    <p className="holdem-mode-stage__copy">{copy.nameBody}</p>
                    <label className="holdem-mode-stage__field">
                      <span className="holdem-mode-stage__label">{copy.nameLabel}</span>
                      <input
                        className="holdem-mode-stage__input"
                        type="text"
                        value={playerName}
                        maxLength={24}
                        placeholder={copy.namePlaceholder}
                        onChange={(event) => handlePlayerNameChange(event.target.value)}
                      />
                    </label>
                    <div className="holdem-mode-stage__actions">
                      <button
                        type="button"
                        className="holdem-mode-stage__button"
                        disabled={!playerName}
                        onClick={handleContinueFromName}
                      >
                        {copy.continue}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="holdem-mode-stage__eyebrow">{copy.eyebrow}</span>
                    <h2 className="holdem-mode-stage__title">{copy.chooseModeTitle}</h2>
                    <p className="holdem-mode-stage__copy">{copy.chooseModeBody}</p>
                    <div className="holdem-mode-chooser">
                      <button type="button" className="holdem-mode-choice" onClick={() => handleChooseMode('ai')}>
                        <span className="holdem-mode-choice__icon holdem-mode-choice__icon--solo" aria-hidden="true">
                          <span />
                        </span>
                        <strong>{copy.modeAi}</strong>
                        <span>{copy.modeAiBody}</span>
                      </button>
                      <button type="button" className="holdem-mode-choice" onClick={() => handleChooseMode('online')}>
                        <span className="holdem-mode-choice__icon holdem-mode-choice__icon--multi" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                        <strong>{copy.modeOnline}</strong>
                        <span>{copy.modeOnlineBody}</span>
                      </button>
                    </div>
                    <div className="holdem-mode-stage__actions">
                      <button type="button" className="holdem-mode-stage__secondary" onClick={() => setSelectionStep('name')}>
                        {copy.editName}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
