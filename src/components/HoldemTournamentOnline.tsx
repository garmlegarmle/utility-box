import { useEffect, useMemo, useRef, useState } from 'react';
import { CommunityCards } from 'holdem/components/cards/CommunityCards';
import { SeatView } from 'holdem/components/seat/SeatView';
import bettingStyles from 'holdem/components/betting/BettingControls.module.css';
import tableStyles from 'holdem/components/table/TableScreen.module.css';
import { useIsMobileTableLayout } from 'holdem/hooks/useIsMobileTableLayout';
import type { Seat as HoldemSeat } from 'holdem/types/engine';
import { createHoldemOnlineSession, getHoldemOnlineTables } from '../lib/api';
import type {
  HoldemOnlineLegalAction,
  HoldemOnlineSessionResponse,
  HoldemOnlineTableSnapshot,
  HoldemOnlineTableSummary,
  HoldemTournamentResultSnapshot,
  SiteLang,
} from '../types';

const SESSION_TOKEN_STORAGE_KEY = 'ga_ml_holdem_online_session_token';
const CURRENT_TABLE_STORAGE_KEY = 'ga_ml_holdem_online_current_table';

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

const COPY = {
  en: {
    modeTitle: 'Online tournament',
    modeBody: 'Join one of two live tables, watch ongoing tournaments, and sit only when the current tournament ends.',
    connection: 'Connection',
    waiting: 'Waiting',
    inHand: 'In hand',
    showdown: 'Showdown',
    tournamentComplete: 'Tournament complete',
    connected: 'Connected',
    connecting: 'Connecting…',
    reconnecting: 'Reconnecting…',
    disconnected: 'Disconnected',
    nameTitle: 'Choose your online display name',
    nameHint: 'The same name is used for AI mode and online tables.',
    tableListTitle: 'Available tables',
    join: 'Join table',
    leave: 'Leave table',
    ready: 'Ready',
    cancelReady: 'Cancel ready',
    nextTournamentReady: 'Join next tournament',
    cancelNextTournamentReady: 'Cancel next tournament',
    spectators: 'Participants',
    logs: 'Action log',
    loadingTable: 'Joining table…',
    noTable: 'Choose a table to watch or play.',
    acting: 'to act',
    actionDeadline: 'Time left',
    you: 'You',
    currentTable: 'Current table',
    tablePlayers: 'Connected',
    tableSeated: 'Seated',
    tableReady: 'Ready',
    level: 'Level',
    hand: 'Hand',
    mainPot: 'Main pot',
    sidePot: 'Side pot',
    totalPot: 'Total pot',
    ante: 'Ante',
    bb: 'BB',
    call: (value: number) => `Call ${value.toLocaleString()}`,
    check: 'Check',
    fold: 'Fold',
    allIn: (value: number) => `All-in ${value.toLocaleString()}`,
    bet: (value: number) => `Bet ${value.toLocaleString()}`,
    raise: (value: number) => `Raise ${value.toLocaleString()}`,
    betAmount: 'Bet size',
    raiseAmount: 'Raise size',
    potShortcut: (ratioPercent: number) => `Pot ${ratioPercent}%`,
    noWagerAvailable: 'Betting or raising is not available right now.',
    eliminatedMessage: 'You are not active in the current tournament.',
    spectatingMessage: 'You are spectating this tournament.',
    waitingForTurn: 'Waiting for your turn.',
    resultTitle: 'Latest tournament result',
    closeResult: 'Close result',
    place: 'Place',
    player: 'Player',
    chips: 'Chips',
    resultLevel: 'Level',
    resultHands: 'Hands',
    noLogs: 'No action log yet.',
    errorPrefix: 'Online table error:',
  },
  ko: {
    modeTitle: '온라인 토너먼트',
    modeBody: '두 개의 라이브 테이블 중 하나에 참가하고, 진행 중인 토너먼트는 관전만 하다가 현재 토너먼트가 끝난 뒤에만 착석합니다.',
    connection: '연결 상태',
    waiting: '대기중',
    inHand: '진행중',
    showdown: '쇼다운',
    tournamentComplete: '토너먼트 종료',
    connected: '연결됨',
    connecting: '연결 중…',
    reconnecting: '재연결 중…',
    disconnected: '연결 끊김',
    nameTitle: '온라인 표시 이름',
    nameHint: 'AI 모드와 온라인 테이블에서 같은 이름을 사용합니다.',
    tableListTitle: '테이블 선택',
    join: '테이블 참가',
    leave: '테이블 나가기',
    ready: '준비 완료',
    cancelReady: '준비 취소',
    nextTournamentReady: '다음 토너먼트 참가',
    cancelNextTournamentReady: '다음 토너먼트 취소',
    spectators: '참가자',
    logs: '액션 로그',
    loadingTable: '테이블에 참가하는 중…',
    noTable: '테이블을 선택하면 관전하거나 참가할 수 있습니다.',
    acting: '차례',
    actionDeadline: '남은 시간',
    you: '나',
    currentTable: '현재 테이블',
    tablePlayers: '접속 인원',
    tableSeated: '착석 인원',
    tableReady: '준비 인원',
    level: '레벨',
    hand: '핸드',
    mainPot: '메인 팟',
    sidePot: '사이드 팟',
    totalPot: '총 팟',
    ante: '앤티',
    bb: 'BB',
    call: (value: number) => `콜 ${value.toLocaleString()}`,
    check: '체크',
    fold: '폴드',
    allIn: (value: number) => `올인 ${value.toLocaleString()}`,
    bet: (value: number) => `베팅 ${value.toLocaleString()}`,
    raise: (value: number) => `레이즈 ${value.toLocaleString()}`,
    betAmount: '베팅 금액',
    raiseAmount: '레이즈 금액',
    potShortcut: (ratioPercent: number) => `팟 ${ratioPercent}%`,
    noWagerAvailable: '지금은 베팅이나 레이즈가 불가능합니다.',
    eliminatedMessage: '현재 토너먼트에서는 탈락한 상태입니다.',
    spectatingMessage: '현재 토너먼트를 관전 중입니다.',
    waitingForTurn: '내 차례를 기다리는 중입니다.',
    resultTitle: '방금 끝난 토너먼트 결과',
    closeResult: '결과 닫기',
    place: '순위',
    player: '플레이어',
    chips: '칩',
    resultLevel: '레벨',
    resultHands: '핸드',
    noLogs: '아직 로그가 없습니다.',
    errorPrefix: '온라인 테이블 오류:',
  },
} as const;

function normalizePlayerName(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

function getStoredValue(key: string): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(key) || '';
}

function setStoredValue(key: string, value: string | null) {
  if (typeof window === 'undefined') return;
  if (value) {
    window.localStorage.setItem(key, value);
  } else {
    window.localStorage.removeItem(key);
  }
}

function getWsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/holdem-online`;
}

function formatPlacement(value: number, lang: SiteLang) {
  if (lang === 'ko') return `${value}위`;
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value}st`;
  if (mod10 === 2 && mod100 !== 12) return `${value}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${value}rd`;
  return `${value}th`;
}

function formatStatus(status: HoldemOnlineTableSummary['status'], lang: SiteLang) {
  const copy = COPY[lang];
  switch (status) {
    case 'waiting':
      return copy.waiting;
    case 'showdown':
      return copy.showdown;
    case 'tournament_complete':
      return copy.tournamentComplete;
    case 'in_hand':
    default:
      return copy.inHand;
  }
}

function buildShortcutOptions(
  wagerAction: (HoldemOnlineLegalAction & { min: number; max: number }) | undefined,
  currentBet: number,
  amountToCall: number,
  potSize: number,
  bigBlind: number,
  lang: SiteLang,
) {
  if (!wagerAction) {
    return [];
  }

  const copy = COPY[lang];
  const options: Array<{ label: string; amount: number }> = [];
  const add = (label: string, rawAmount: number) => {
    const amount = Math.max(wagerAction.min, Math.min(wagerAction.max, Math.round(rawAmount)));
    if (options.some((item) => item.amount === amount)) {
      return;
    }
    options.push({ label, amount });
  };

  [2, 2.5, 3, 4].forEach((multiplier) => add(`${multiplier}BB`, multiplier * bigBlind));
  [0.33, 0.5, 0.75, 1].forEach((ratio) =>
    add(copy.potShortcut(Math.round(ratio * 100)), currentBet + amountToCall + potSize * ratio),
  );

  return options;
}

interface OnlineBettingControlsProps {
  lang: SiteLang;
  legalActions: HoldemOnlineLegalAction[];
  amountToCall: number;
  currentBet: number;
  potSize: number;
  bigBlind: number;
  disabled?: boolean;
  onAction: (type: HoldemOnlineLegalAction['type'], amount?: number) => void;
}

function OnlineBettingControls({
  lang,
  legalActions,
  amountToCall,
  currentBet,
  potSize,
  bigBlind,
  disabled = false,
  onAction,
}: OnlineBettingControlsProps) {
  const copy = COPY[lang];
  const checkAction = legalActions.find((action) => action.type === 'check');
  const callAction = legalActions.find((action) => action.type === 'call');
  const foldAction = legalActions.find((action) => action.type === 'fold');
  const allInAction = legalActions.find((action) => action.type === 'all-in');
  const wagerAction = legalActions.find(
    (action) => typeof action.min === 'number' && typeof action.max === 'number',
  ) as (HoldemOnlineLegalAction & { min: number; max: number }) | undefined;
  const [raiseInput, setRaiseInput] = useState<number>(wagerAction?.min ?? bigBlind * 2);

  useEffect(() => {
    if (!wagerAction) return;
    setRaiseInput((current) => Math.max(wagerAction.min, Math.min(wagerAction.max, current || wagerAction.min)));
  }, [wagerAction?.min, wagerAction?.max]);

  const shortcutOptions = buildShortcutOptions(wagerAction, currentBet, amountToCall, potSize, bigBlind, lang);

  return (
    <div className={bettingStyles.controls}>
      {wagerAction ? (
        <div className={bettingStyles.raisePanel}>
          <label className={bettingStyles.label}>
            {wagerAction.type === 'bet' ? copy.betAmount : copy.raiseAmount}
            {shortcutOptions.length > 0 ? (
              <div className={bettingStyles.shortcutRow}>
                {shortcutOptions.map((option) => (
                  <button
                    key={`${option.label}-${option.amount}`}
                    type="button"
                    className={bettingStyles.shortcutButton}
                    disabled={disabled}
                    onClick={() => setRaiseInput(option.amount)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              type="range"
              min={wagerAction.min}
              max={wagerAction.max}
              step={1}
              value={Math.max(wagerAction.min, Math.min(wagerAction.max, raiseInput))}
              onChange={(event) => setRaiseInput(Number(event.target.value))}
              disabled={disabled}
            />
          </label>
          <input
            className={bettingStyles.numeric}
            type="number"
            min={wagerAction.min}
            max={wagerAction.max}
            value={Math.max(wagerAction.min, Math.min(wagerAction.max, raiseInput))}
            onChange={(event) => setRaiseInput(Number(event.target.value))}
            disabled={disabled}
          />
        </div>
      ) : (
        <div className={bettingStyles.raisePanelPlaceholder}>{copy.noWagerAvailable}</div>
      )}

      <div className={bettingStyles.buttons}>
        {foldAction ? (
          <button className={bettingStyles.secondary} disabled={disabled} onClick={() => onAction('fold')}>
            {copy.fold}
          </button>
        ) : null}
        {checkAction ? (
          <button className={bettingStyles.secondary} disabled={disabled} onClick={() => onAction('check')}>
            {copy.check}
          </button>
        ) : null}
        {callAction ? (
          <button className={bettingStyles.secondary} disabled={disabled} onClick={() => onAction('call')}>
            {copy.call(callAction.amount || 0)}
          </button>
        ) : null}
        {wagerAction ? (
          <button
            className={bettingStyles.primary}
            disabled={disabled}
            onClick={() => onAction(wagerAction.type, raiseInput)}
          >
            {wagerAction.type === 'bet' ? copy.bet(raiseInput) : copy.raise(raiseInput)}
          </button>
        ) : null}
        {allInAction ? (
          <button className={bettingStyles.danger} disabled={disabled} onClick={() => onAction('all-in')}>
            {copy.allIn(allInAction.amount || 0)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function HoldemTournamentOnline({
  lang,
  playerName,
  onPlayerNameChange,
}: {
  lang: SiteLang;
  playerName: string;
  onPlayerNameChange: (value: string) => void;
}) {
  const copy = COPY[lang];
  const isMobileLayout = useIsMobileTableLayout();
  const normalizedPlayerName = normalizePlayerName(playerName);
  const [tables, setTables] = useState<HoldemOnlineTableSummary[]>([]);
  const [sessionToken, setSessionToken] = useState(() => getStoredValue(SESSION_TOKEN_STORAGE_KEY));
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [currentTableId, setCurrentTableId] = useState(() => getStoredValue(CURRENT_TABLE_STORAGE_KEY) || '');
  const [snapshot, setSnapshot] = useState<HoldemOnlineTableSnapshot | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dismissedResultId, setDismissedResultId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const currentTableIdRef = useRef(currentTableId);
  const onPlayerNameChangeRef = useRef(onPlayerNameChange);

  useEffect(() => {
    onPlayerNameChangeRef.current = onPlayerNameChange;
  }, [onPlayerNameChange]);

  useEffect(() => {
    currentTableIdRef.current = currentTableId;
    setStoredValue(CURRENT_TABLE_STORAGE_KEY, currentTableId || null);
  }, [currentTableId]);

  useEffect(() => {
    let cancelled = false;

    getHoldemOnlineTables()
      .then((result) => {
        if (!cancelled) {
          setTables(result.tables);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTables([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!normalizedPlayerName) {
      setPlayerId(null);
      return;
    }

    let cancelled = false;

    createHoldemOnlineSession({
      displayName: normalizedPlayerName,
      sessionToken: sessionToken || undefined,
    })
      .then((result: HoldemOnlineSessionResponse) => {
        if (cancelled) return;
        setSessionToken(result.sessionToken);
        setStoredValue(SESSION_TOKEN_STORAGE_KEY, result.sessionToken);
        setPlayerId(result.playerId);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err instanceof Error ? err.message : err || 'Failed to create session.'));
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedPlayerName, sessionToken]);

  useEffect(() => {
    if (!sessionToken || !normalizedPlayerName || typeof window === 'undefined') {
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      setConnectionStatus((status) => (status === 'idle' ? 'connecting' : 'connecting'));
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        if (cancelled) return;
        setConnectionStatus('connected');
        setError(null);
        ws.send(JSON.stringify({ type: 'session:resume', payload: { sessionToken } }));
        ws.send(JSON.stringify({ type: 'tables:subscribe', payload: {} }));
      });

      ws.addEventListener('message', (event) => {
        let message;
        try {
          message = JSON.parse(String(event.data || ''));
        } catch {
          return;
        }

        const type = String(message?.type || '');
        const payload = message?.payload || {};

        if (type === 'session:ready') {
          if (payload.playerId) {
            setPlayerId(String(payload.playerId));
          }
          if (payload.displayName && normalizePlayerName(payload.displayName) !== normalizedPlayerName) {
            onPlayerNameChangeRef.current(String(payload.displayName));
          }
          const resumedTableId = String(payload.currentTableId || '').trim();
          if (resumedTableId) {
            setCurrentTableId(resumedTableId);
          } else if (currentTableIdRef.current) {
            ws.send(JSON.stringify({ type: 'table:join', payload: { tableId: currentTableIdRef.current } }));
          }
          return;
        }

        if (type === 'tables:snapshot') {
          setTables(Array.isArray(payload.tables) ? payload.tables : []);
          return;
        }

        if (type === 'table:snapshot' || type === 'table:user_joined' || type === 'turn:started' || type === 'action:applied' || type === 'turn:auto_action' || type === 'hand:starting' || type === 'hand:flop' || type === 'hand:turn' || type === 'hand:river' || type === 'showdown:started' || type === 'tournament:result_snapshot' || type === 'game:starting') {
          if (payload.table) {
            setSnapshot(payload.table as HoldemOnlineTableSnapshot);
            setCurrentTableId(String((payload.table as HoldemOnlineTableSnapshot).tableId || ''));
          }
          return;
        }

        if (type === 'error') {
          setError(`${copy.errorPrefix} ${String(payload.message || 'Unknown error')}`);
        }
      });

      ws.addEventListener('close', () => {
        if (cancelled) return;
        setConnectionStatus('error');
        if (reconnectTimerRef.current) {
          window.clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = window.setTimeout(() => {
          connect();
        }, 2000);
      });

      ws.addEventListener('error', () => {
        if (cancelled) return;
        setConnectionStatus('error');
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [sessionToken, normalizedPlayerName, copy.errorPrefix]);

  useEffect(() => {
    if (!snapshot?.actionDeadlineAt) return;

    const timer = window.setInterval(() => {
      setClock(Date.now());
    }, 250);

    return () => window.clearInterval(timer);
  }, [snapshot?.actionDeadlineAt]);

  useEffect(() => {
    if (!snapshot?.lastTournamentResult?.id) return;
    setDismissedResultId((current) => (current === snapshot.lastTournamentResult?.id ? current : null));
  }, [snapshot?.lastTournamentResult?.id]);

  const connectionLabel =
    connectionStatus === 'connected'
      ? copy.connected
      : connectionStatus === 'connecting'
        ? copy.connecting
        : connectionStatus === 'error'
          ? copy.reconnecting
          : copy.disconnected;

  const remainingSeconds = snapshot?.actionDeadlineAt ? Math.max(0, Math.ceil((snapshot.actionDeadlineAt - clock) / 1000)) : null;
  const currentResult: HoldemTournamentResultSnapshot | null =
    snapshot?.lastTournamentResult && snapshot.lastTournamentResult.id !== dismissedResultId ? snapshot.lastTournamentResult : null;

  const sendEvent = (type: string, payload: Record<string, unknown> = {}) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError(`${copy.errorPrefix} ${lang === 'ko' ? '연결이 아직 준비되지 않았습니다.' : 'Connection is not ready yet.'}`);
      return;
    }
    ws.send(JSON.stringify({ type, payload }));
  };

  const activeTable = snapshot?.tableId ? snapshot : currentTableId ? tables.find((table) => table.tableId === currentTableId) || null : null;
  const activeTableLabel = snapshot?.label || activeTable?.label || '';
  const actingSeatName = snapshot?.actingPlayerName || '';

  const currentViewerSeat = useMemo(() => {
    if (!snapshot?.viewer?.seatIndex) {
      return snapshot?.viewer?.seatIndex === 0 ? snapshot.seats.find((seat) => seat.seatIndex === 0) || null : null;
    }
    return snapshot.seats.find((seat) => seat.seatIndex === snapshot.viewer.seatIndex) || null;
  }, [snapshot]);

  function handleJoinTable(tableId: string) {
    setCurrentTableId(tableId);
    setSnapshot(null);
    sendEvent('table:join', { tableId });
  }

  function handleLeaveTable() {
    sendEvent('table:leave', {});
    setCurrentTableId('');
    setSnapshot(null);
    setDismissedResultId(null);
  }

  function handleAction(type: HoldemOnlineLegalAction['type'], amount?: number) {
    const eventType = `action:${type}`;
    sendEvent(eventType, amount !== undefined ? { amount } : {});
  }

  return (
    <div className="holdem-online-shell">
      <section className="holdem-online-head">
        <div>
          <h2>{copy.modeTitle}</h2>
          <p>{copy.modeBody}</p>
        </div>
        <div className="holdem-online-connection">
          <span>{copy.connection}</span>
          <strong>{connectionLabel}</strong>
        </div>
      </section>

      <section className="holdem-online-name-panel">
        <div>
          <h3>{copy.nameTitle}</h3>
          <p>{copy.nameHint}</p>
        </div>
        <input
          type="text"
          value={playerName}
          maxLength={24}
          onChange={(event) => onPlayerNameChange(event.target.value)}
          placeholder={lang === 'ko' ? '표시할 이름 입력' : 'Enter display name'}
        />
      </section>

      {error ? <p className="holdem-online-error">{error}</p> : null}

      {!currentTableId ? (
        <section className="holdem-online-lobby">
          <div className="holdem-online-lobby__head">
            <h3>{copy.tableListTitle}</h3>
          </div>
          <div className="holdem-online-lobby__grid">
            {tables.map((table) => (
              <article key={table.tableId} className="holdem-online-card">
                <div className="holdem-online-card__head">
                  <strong>{table.label}</strong>
                  <span>{formatStatus(table.status, lang)}</span>
                </div>
                <dl className="holdem-online-card__stats">
                  <div>
                    <dt>{copy.tablePlayers}</dt>
                    <dd>{table.connectedCount}</dd>
                  </div>
                  <div>
                    <dt>{copy.tableSeated}</dt>
                    <dd>{table.seatedCount}</dd>
                  </div>
                  <div>
                    <dt>{copy.tableReady}</dt>
                    <dd>{table.readyCount}</dd>
                  </div>
                  <div>
                    <dt>{copy.level}</dt>
                    <dd>{table.level ?? '—'}</dd>
                  </div>
                </dl>
                <button disabled={!normalizedPlayerName || connectionStatus !== 'connected'} onClick={() => handleJoinTable(table.tableId)}>
                  {copy.join}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : snapshot ? (
        <div className="holdem-online-table">
          <section className="holdem-online-tablebar">
            <div>
              <p>{copy.currentTable}</p>
              <h3>{activeTableLabel}</h3>
            </div>
            <div className="holdem-online-tablebar__actions">
              <span>{formatStatus(snapshot.status, lang)}</span>
              <button onClick={handleLeaveTable}>{copy.leave}</button>
            </div>
          </section>

          {currentResult ? (
            <section className="holdem-online-result">
              <div className="holdem-online-result__head">
                <h3>{copy.resultTitle}</h3>
                <button type="button" onClick={() => setDismissedResultId(currentResult.id)}>
                  {copy.closeResult}
                </button>
              </div>
              <div className="holdem-online-result__meta">
                <span>{copy.resultLevel} {currentResult.level}</span>
                <span>{copy.resultHands} {currentResult.handNumber}</span>
              </div>
              <div className="holdem-online-result__table">
                <div className="holdem-online-result__row holdem-online-result__row--head">
                  <span>{copy.place}</span>
                  <span>{copy.player}</span>
                  <span>{copy.chips}</span>
                </div>
                {currentResult.entries.map((entry) => (
                  <div key={entry.playerId} className="holdem-online-result__row">
                    <span>{formatPlacement(entry.finalPlace, lang)}</span>
                    <span>{entry.playerName}</span>
                    <span>{entry.chipCount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div
            className={[
              tableStyles.page,
              tableStyles.embeddedPage,
              isMobileLayout ? tableStyles.mobilePage : '',
            ].join(' ')}
          >
            <main className={tableStyles.mainStage}>
              <section className={tableStyles.tableWrap}>
                <div className={[tableStyles.tableArena, isMobileLayout ? tableStyles.mobileTableArena : ''].join(' ')}>
                  <div className={tableStyles.tableSurface}>
                    <div className={tableStyles.innerGuide} />
                    <div className={tableStyles.boardZone}>
                      <div className={tableStyles.potPanel}>
                        <span className={tableStyles.potLabel}>{copy.mainPot}</span>
                        <strong className={tableStyles.potValue}>{snapshot.mainPot.toLocaleString()}</strong>
                        {snapshot.sidePots.length > 0 ? (
                          <div className={tableStyles.sidePots}>
                            {snapshot.sidePots.map((amount, index) => (
                              <span key={`${amount}-${index}`}>
                                {copy.sidePot} {index + 1}: {amount.toLocaleString()}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className={tableStyles.potMetaStrip}>
                        <span>
                          {copy.ante} {snapshot.currentLevel?.ante ?? 0} · {copy.bb} {snapshot.currentLevel?.bigBlind ?? 0}
                        </span>
                        <span>
                          {copy.hand} {snapshot.handNumber} · {copy.level} {snapshot.currentLevel?.level ?? '—'}
                        </span>
                      </div>
                      <div className={tableStyles.communityBoard}>
                        <CommunityCards cards={snapshot.communityCards as never[]} handNumber={snapshot.handNumber} />
                      </div>
                      <div className={tableStyles.handMessage}>
                        {snapshot.handMessage ||
                          (actingSeatName ? `${actingSeatName} ${copy.acting}` : '')}
                      </div>
                    </div>
                  </div>
                  {snapshot.seats.map((seat) => (
                    <SeatView
                      key={`${snapshot.handNumber}-${seat.playerId}`}
                      seat={seat as unknown as HoldemSeat}
                      handNumber={snapshot.handNumber}
                      isActing={seat.seatIndex === snapshot.actingSeatIndex}
                      isButton={seat.seatIndex === snapshot.buttonSeatIndex}
                      isSmallBlind={seat.seatIndex === snapshot.smallBlindSeatIndex}
                      isBigBlind={seat.seatIndex === snapshot.bigBlindSeatIndex}
                      showCards={seat.playerId === playerId || seat.hasShownCards || snapshot.status === 'tournament_complete'}
                      showHoleCards
                      isMobileLayout={isMobileLayout}
                      lang={lang}
                    />
                  ))}
                </div>
              </section>

              <section className={tableStyles.controlDock}>
                <div className={tableStyles.bottomRail}>
                  <div className={tableStyles.leftDock}>
                    {snapshot.viewer.role === 'player' && snapshot.legalActions.length > 0 ? (
                      <OnlineBettingControls
                        lang={lang}
                        legalActions={snapshot.legalActions}
                        amountToCall={snapshot.amountToCall}
                        currentBet={currentViewerSeat?.currentBet ?? 0}
                        potSize={snapshot.totalPot}
                        bigBlind={snapshot.currentLevel?.bigBlind ?? 0}
                        disabled={snapshot.actingSeatIndex !== snapshot.viewer.seatIndex}
                        onAction={handleAction}
                      />
                    ) : (
                      <div className={bettingStyles.disabled}>
                        {snapshot.viewer.role === 'spectator'
                          ? copy.spectatingMessage
                          : snapshot.viewer.role === 'eliminated'
                            ? copy.eliminatedMessage
                            : copy.waitingForTurn}
                      </div>
                    )}
                  </div>

                  <div className={tableStyles.rightDock}>
                    <div className="holdem-online-sidepanel">
                      <div className="holdem-online-sidepanel__meta">
                        <span>{copy.totalPot}</span>
                        <strong>{snapshot.totalPot.toLocaleString()}</strong>
                      </div>
                      {remainingSeconds !== null ? (
                        <div className="holdem-online-sidepanel__meta">
                          <span>{copy.actionDeadline}</span>
                          <strong>{remainingSeconds}s</strong>
                        </div>
                      ) : null}
                      {snapshot.status === 'waiting' ? (
                        <button
                          type="button"
                          className="holdem-online-ready-button"
                          onClick={() => sendEvent(snapshot.viewer.ready ? 'table:unset_ready' : 'table:set_ready')}
                        >
                          {snapshot.viewer.ready ? copy.cancelReady : copy.ready}
                        </button>
                      ) : snapshot.viewer.role === 'spectator' || snapshot.viewer.role === 'eliminated' ? (
                        <button
                          type="button"
                          className="holdem-online-ready-button"
                          onClick={() =>
                            sendEvent(
                              snapshot.viewer.nextTournamentReady ? 'table:unset_next_tournament_ready' : 'table:set_next_tournament_ready',
                            )
                          }
                        >
                          {snapshot.viewer.nextTournamentReady ? copy.cancelNextTournamentReady : copy.nextTournamentReady}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>
            </main>
          </div>

          <section className="holdem-online-rail">
            <div className="holdem-online-participants">
              <h3>{copy.spectators}</h3>
              <ul>
                {snapshot.participants.map((participant) => (
                  <li key={participant.playerId}>
                    <span>
                      {participant.displayName}
                      {participant.playerId === playerId ? ` (${copy.you})` : ''}
                    </span>
                    <span>
                      {participant.connected ? copy.connected : copy.disconnected}
                      {participant.ready ? ` · ${copy.ready}` : ''}
                      {participant.nextTournamentReady ? ` · ${copy.nextTournamentReady}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="holdem-online-log">
              <h3>{copy.logs}</h3>
              {snapshot.logs.length === 0 ? (
                <p>{copy.noLogs}</p>
              ) : (
                <div className="holdem-online-log__list">
                  {snapshot.logs.slice().reverse().map((entry) => (
                    <div key={entry.id} className="holdem-online-log__entry">
                      <span>{entry.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <section className="holdem-online-lobby">
          <p>{copy.loadingTable}</p>
        </section>
      )}
    </div>
  );
}
