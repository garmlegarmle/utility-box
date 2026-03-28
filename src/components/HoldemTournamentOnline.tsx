import { useEffect, useMemo, useRef, useState } from 'react';
import { CommunityCards } from 'holdem/components/cards/CommunityCards';
import infoPanelStyles from 'holdem/components/panels/InfoPanels.module.css';
import { HeroHud } from 'holdem/components/seat/HeroHud';
import { SeatView } from 'holdem/components/seat/SeatView';
import { TableChips } from 'holdem/components/table/TableChips';
import bettingStyles from 'holdem/components/betting/BettingControls.module.css';
import tableStyles from 'holdem/components/table/TableScreen.module.css';
import appStyles from 'holdem/app/App.module.css';
import { getGameUiText, getStreetLabel } from 'holdem/config/localization';
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
import type { ChipAnimationGameState } from 'holdem/components/table/TableChips';

const SESSION_TOKEN_STORAGE_KEY = 'ga_ml_holdem_online_session_token';
const ONLINE_HANDS_PER_LEVEL = 8;

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
    continueToTables: 'Continue',
    editName: 'Change name',
    tableListTitle: 'Available tables',
    tableListBody: 'Pick a live table. If a tournament is already running, you will watch first and join when the next tournament begins.',
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
    waitingRoomMessage: 'The table is waiting to start. Once at least two connected players are ready, the next tournament begins.',
    waitingRoomMessageReady: 'You are marked ready. The next tournament starts when every connected player is ready.',
    spectatorNextTournament: 'You are watching this tournament. You can join only after it ends.',
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
    continueToTables: '다음',
    editName: '이름 수정',
    tableListTitle: '테이블 선택',
    tableListBody: '라이브 테이블을 선택하세요. 이미 토너먼트가 진행 중이면 우선 관전하고, 다음 토너먼트부터 참가합니다.',
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
    waitingRoomMessage: '테이블이 시작을 기다리는 중입니다. 접속한 플레이어가 2명 이상이고 모두 준비되면 다음 토너먼트가 시작됩니다.',
    waitingRoomMessageReady: '준비 완료 상태입니다. 접속한 플레이어 전원이 준비되면 다음 토너먼트가 시작됩니다.',
    spectatorNextTournament: '현재 토너먼트는 관전만 가능하며, 종료 후 다음 토너먼트부터 참가할 수 있습니다.',
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

function rotateSeatIndex(seatIndex: number | null, heroSeatIndex: number | null) {
  if (seatIndex === null || heroSeatIndex === null) {
    return seatIndex;
  }
  return (seatIndex - heroSeatIndex + 9) % 9;
}

function buildViewerRelativeSnapshot(snapshot: HoldemOnlineTableSnapshot | null) {
  if (!snapshot || snapshot.viewer.seatIndex === null) {
    return snapshot;
  }

  const heroSeatIndex = snapshot.viewer.seatIndex;

  return {
    ...snapshot,
    viewer: {
      ...snapshot.viewer,
      seatIndex: 0,
    },
    actingSeatIndex: rotateSeatIndex(snapshot.actingSeatIndex, heroSeatIndex),
    buttonSeatIndex: rotateSeatIndex(snapshot.buttonSeatIndex, heroSeatIndex),
    smallBlindSeatIndex: rotateSeatIndex(snapshot.smallBlindSeatIndex, heroSeatIndex),
    bigBlindSeatIndex: rotateSeatIndex(snapshot.bigBlindSeatIndex, heroSeatIndex),
    seats: snapshot.seats
      .map((seat) => ({
        ...seat,
        seatIndex: rotateSeatIndex(seat.seatIndex, heroSeatIndex) ?? seat.seatIndex,
      }))
      .sort((left, right) => left.seatIndex - right.seatIndex),
    participants: snapshot.participants.map((participant) => ({
      ...participant,
      seatIndex: rotateSeatIndex(participant.seatIndex, heroSeatIndex),
    })),
  };
}

function buildOnlineChipState(snapshot: HoldemOnlineTableSnapshot | null): ChipAnimationGameState | null {
  if (!snapshot) {
    return null;
  }

  return {
    hand: {
      handNumber: snapshot.handNumber,
      completed:
        snapshot.status === 'showdown' ||
        snapshot.status === 'tournament_complete' ||
        snapshot.seats.some((seat) => seat.winningsThisHand > 0),
    },
    seats: snapshot.seats.map((seat) => ({
      playerId: seat.playerId,
      seatIndex: seat.seatIndex,
      currentBet: seat.currentBet,
      winningsThisHand: seat.winningsThisHand,
    })),
  };
}

function inferStreetLabel(snapshot: HoldemOnlineTableSnapshot, lang: SiteLang) {
  if (snapshot.status === 'showdown' || snapshot.status === 'tournament_complete') {
    return getStreetLabel('showdown', lang);
  }

  switch (snapshot.communityCards.length) {
    case 0:
      return getStreetLabel('preflop', lang);
    case 3:
      return getStreetLabel('flop', lang);
    case 4:
      return getStreetLabel('turn', lang);
    case 5:
      return getStreetLabel('river', lang);
    default:
      return getStreetLabel('preflop', lang);
  }
}

function getHandsUntilLevelUp(handNumber: number) {
  if (!Number.isFinite(handNumber) || handNumber <= 0) {
    return ONLINE_HANDS_PER_LEVEL;
  }

  const completedHandsThisLevel = (handNumber - 1) % ONLINE_HANDS_PER_LEVEL;
  return Math.max(0, ONLINE_HANDS_PER_LEVEL - completedHandsThisLevel);
}

function OnlineCompactStatus({
  snapshot,
  lang,
}: {
  snapshot: HoldemOnlineTableSnapshot;
  lang: SiteLang;
}) {
  const uiCopy = getGameUiText(lang);
  const handsUntilLevelUp = getHandsUntilLevelUp(snapshot.handNumber);
  const streetLabel = inferStreetLabel(snapshot, lang);
  const actingLabel = snapshot.actingPlayerName || uiCopy.waiting;

  return (
    <section className={infoPanelStyles.cornerStatus}>
      <div className={infoPanelStyles.cornerTitle}>
        {uiCopy.tournament} · {snapshot.label}
      </div>
      <div className={infoPanelStyles.cornerLine}>
        <span>
          {uiCopy.level} {snapshot.currentLevel?.level ?? 1}
        </span>
        <span>
          {snapshot.currentLevel?.smallBlind ?? 0}/{snapshot.currentLevel?.bigBlind ?? 0}
        </span>
        <span>
          {uiCopy.ante} {snapshot.currentLevel?.ante ?? 0}
        </span>
      </div>
      <div className={infoPanelStyles.cornerLine}>
        <span>
          {uiCopy.hand} #{snapshot.handNumber}
        </span>
        <span>
          {uiCopy.pot} {snapshot.totalPot.toLocaleString()}
        </span>
        <span>{uiCopy.nextLevelInHands(handsUntilLevelUp)}</span>
      </div>
      <div className={infoPanelStyles.cornerLine}>
        <span>{streetLabel}</span>
        <span>{actingLabel}</span>
      </div>
    </section>
  );
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
  const [currentTableId, setCurrentTableId] = useState('');
  const [snapshot, setSnapshot] = useState<HoldemOnlineTableSnapshot | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dismissedResultId, setDismissedResultId] = useState<string | null>(null);
  const [setupStep, setSetupStep] = useState<'name' | 'table'>('name');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const onPlayerNameChangeRef = useRef(onPlayerNameChange);

  useEffect(() => {
    onPlayerNameChangeRef.current = onPlayerNameChange;
  }, [onPlayerNameChange]);

  useEffect(() => {
    if (!normalizedPlayerName) {
      setSetupStep('name');
    }
  }, [normalizedPlayerName]);

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
            setSetupStep('table');
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

  const currentResult: HoldemTournamentResultSnapshot | null =
    snapshot?.lastTournamentResult && snapshot.lastTournamentResult.id !== dismissedResultId ? snapshot.lastTournamentResult : null;
  const displaySnapshot = useMemo(() => buildViewerRelativeSnapshot(snapshot), [snapshot]);
  const chipAnimationState = useMemo(() => buildOnlineChipState(displaySnapshot), [displaySnapshot]);
  const isWaitingRoom = displaySnapshot?.status === 'waiting';
  const showLobbyOverlay = !displaySnapshot;

  const sendEvent = (type: string, payload: Record<string, unknown> = {}) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError(`${copy.errorPrefix} ${lang === 'ko' ? '연결이 아직 준비되지 않았습니다.' : 'Connection is not ready yet.'}`);
      return;
    }
    ws.send(JSON.stringify({ type, payload }));
  };

  const currentViewerSeat = useMemo(() => {
    if (!displaySnapshot?.viewer?.seatIndex) {
      return displaySnapshot?.viewer?.seatIndex === 0
        ? displaySnapshot.seats.find((seat) => seat.seatIndex === 0) || null
        : null;
    }
    return displaySnapshot.seats.find((seat) => seat.seatIndex === displaySnapshot.viewer.seatIndex) || null;
  }, [displaySnapshot]);

  function handleJoinTable(tableId: string) {
    setCurrentTableId(tableId);
    setSnapshot(null);
    setSetupStep('table');
    sendEvent('table:join', { tableId });
  }

  function handleLeaveTable() {
    sendEvent('table:leave', {});
    setCurrentTableId('');
    setSnapshot(null);
    setDismissedResultId(null);
    setSetupStep('table');
  }

  function handleAction(type: HoldemOnlineLegalAction['type'], amount?: number) {
    const eventType = `action:${type}`;
    sendEvent(eventType, amount !== undefined ? { amount } : {});
  }

  function handleContinueToTables() {
    if (!normalizedPlayerName) {
      return;
    }

    setSetupStep('table');
    setError(null);
  }

  return (
    <div className={['holdem-app-theme', appStyles.shell, appStyles.embedded, 'holdem-online-shell'].join(' ')}>
      {error ? <p className="holdem-online-error">{error}</p> : null}
      <div
        className={[
          tableStyles.page,
          tableStyles.embeddedPage,
          'holdem-online-page',
          isMobileLayout ? tableStyles.mobilePage : '',
        ].join(' ')}
      >
        {!showLobbyOverlay && displaySnapshot ? (
          <div className={tableStyles.headerBar}>
            <OnlineCompactStatus snapshot={displaySnapshot} lang={lang} />
            <div className={tableStyles.headerButtons}>
              <button className={tableStyles.headerButton} onClick={handleLeaveTable}>
                {copy.leave}
              </button>
            </div>
          </div>
        ) : null}

        <main className={tableStyles.mainStage}>
          <section className={tableStyles.tableWrap}>
            <div className={[tableStyles.tableArena, isMobileLayout ? tableStyles.mobileTableArena : ''].join(' ')}>
              <div className={tableStyles.tableSurface}>
                <div className={tableStyles.innerGuide} />
                <div className={tableStyles.boardZone}>
                  {displaySnapshot ? (
                    <>
                      <div className={tableStyles.potPanel}>
                        <span className={tableStyles.potLabel}>{copy.mainPot}</span>
                        <strong className={tableStyles.potValue}>{displaySnapshot.mainPot.toLocaleString()}</strong>
                        {displaySnapshot.sidePots.length > 0 ? (
                          <div className={tableStyles.sidePots}>
                            {displaySnapshot.sidePots.map((amount, index) => (
                              <span key={`${amount}-${index}`}>
                                {copy.sidePot} {index + 1}: {amount.toLocaleString()}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className={tableStyles.potMetaStrip}>
                        <span>
                          {copy.ante} {displaySnapshot.currentLevel?.ante ?? 0} · {copy.bb} {displaySnapshot.currentLevel?.bigBlind ?? 0}
                        </span>
                        <span>
                          {copy.hand} {displaySnapshot.handNumber} · {copy.level} {displaySnapshot.currentLevel?.level ?? '—'}
                        </span>
                      </div>
                      <div className={tableStyles.communityBoard}>
                        <CommunityCards cards={displaySnapshot.communityCards as never[]} handNumber={displaySnapshot.handNumber} />
                      </div>
                      <div className={tableStyles.handMessage}>
                        {displaySnapshot.handMessage ||
                          (displaySnapshot.actingPlayerName ? `${displaySnapshot.actingPlayerName} ${copy.acting}` : '')}
                      </div>
                    </>
                  ) : (
                    <div className="holdem-online-standby">
                      <span className="holdem-online-standby__eyebrow">{copy.modeTitle}</span>
                      <strong className="holdem-online-standby__title">{copy.modeBody}</strong>
                    </div>
                  )}
                </div>
              </div>

              {displaySnapshot?.seats.map((seat) => (
                <SeatView
                  key={`${displaySnapshot.handNumber}-${seat.playerId}`}
                  seat={seat as unknown as HoldemSeat}
                  handNumber={displaySnapshot.handNumber}
                  isActing={seat.seatIndex === displaySnapshot.actingSeatIndex}
                  isButton={seat.seatIndex === displaySnapshot.buttonSeatIndex}
                  isSmallBlind={seat.seatIndex === displaySnapshot.smallBlindSeatIndex}
                  isBigBlind={seat.seatIndex === displaySnapshot.bigBlindSeatIndex}
                  showCards={seat.playerId !== playerId && (seat.hasShownCards || displaySnapshot.status === 'tournament_complete')}
                  showHoleCards={seat.playerId !== playerId}
                  isMobileLayout={isMobileLayout}
                  lang={lang}
                />
              ))}

              {displaySnapshot && chipAnimationState ? (
                <TableChips game={chipAnimationState} totalPot={displaySnapshot.totalPot} isMobileLayout={isMobileLayout} />
              ) : null}

              {showLobbyOverlay ? (
                <div className={tableStyles.startOverlay}>
                  <div className={`${tableStyles.startCard} holdem-online-overlay-card`}>
                    {setupStep === 'name' ? (
                      <>
                        <span className={tableStyles.startEyebrow}>{copy.modeTitle}</span>
                        <h2 className={tableStyles.startTitle}>{copy.nameTitle}</h2>
                        <div className="holdem-online-overlay-status">
                          <span>{copy.connection}</span>
                          <strong>{connectionLabel}</strong>
                        </div>
                        <label className={tableStyles.startField}>
                          <span className={tableStyles.startFieldLabel}>{copy.nameTitle}</span>
                          <input
                            className={tableStyles.startInput}
                            type="text"
                            value={playerName}
                            maxLength={24}
                            onChange={(event) => onPlayerNameChange(event.target.value)}
                            placeholder={lang === 'ko' ? '표시할 이름 입력' : 'Enter display name'}
                          />
                        </label>
                        <div className="holdem-online-overlay-actions">
                          <button
                            type="button"
                            className={tableStyles.startButton}
                            disabled={!normalizedPlayerName}
                            onClick={handleContinueToTables}
                          >
                            {copy.continueToTables}
                          </button>
                        </div>
                      </>
                    ) : currentTableId ? (
                      <>
                        <span className={tableStyles.startEyebrow}>{copy.modeTitle}</span>
                        <h2 className={tableStyles.startTitle}>{copy.tableListTitle}</h2>
                        <p className={tableStyles.startCopy}>{copy.loadingTable}</p>
                        <div className="holdem-online-overlay-status">
                          <span>{copy.connection}</span>
                          <strong>{connectionLabel}</strong>
                        </div>
                        <p className="holdem-online-loading">{copy.loadingTable}</p>
                      </>
                    ) : (
                      <>
                        <span className={tableStyles.startEyebrow}>{copy.modeTitle}</span>
                        <h2 className={tableStyles.startTitle}>{copy.tableListTitle}</h2>
                        <p className={tableStyles.startCopy}>{copy.tableListBody}</p>
                        <div className="holdem-online-overlay-status">
                          <span>{copy.connection}</span>
                          <strong>{connectionLabel}</strong>
                        </div>
                        <div className="holdem-online-overlay-actions">
                          <button
                            type="button"
                            className="holdem-online-overlay-secondary"
                            onClick={() => setSetupStep('name')}
                          >
                            {copy.editName}
                          </button>
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
                              <button
                                disabled={!normalizedPlayerName || connectionStatus !== 'connected'}
                                onClick={() => handleJoinTable(table.tableId)}
                              >
                                {copy.join}
                              </button>
                            </article>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : null}

              {currentResult ? (
                <div className={tableStyles.startOverlay}>
                  <div className={`${tableStyles.startCard} holdem-online-result-card`}>
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
                  </div>
                </div>
              ) : null}

              {displaySnapshot && isWaitingRoom ? (
                <div className={tableStyles.startOverlay}>
                  <div className={`${tableStyles.startCard} holdem-online-waiting-card`}>
                    <span className={tableStyles.startEyebrow}>{copy.modeTitle}</span>
                    <h2 className={tableStyles.startTitle}>{displaySnapshot.label}</h2>
                    <p className={tableStyles.startCopy}>
                      {displaySnapshot.viewer.ready ? copy.waitingRoomMessageReady : copy.waitingRoomMessage}
                    </p>
                    <div className="holdem-online-overlay-actions holdem-online-overlay-actions--center">
                      <button
                        type="button"
                        className={tableStyles.startButton}
                        onClick={() => sendEvent(displaySnapshot.viewer.ready ? 'table:unset_ready' : 'table:set_ready')}
                      >
                        {displaySnapshot.viewer.ready ? copy.cancelReady : copy.ready}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {displaySnapshot ? (
            <section className={tableStyles.controlDock}>
              <div className={tableStyles.bottomRail}>
                <div className={tableStyles.leftDock}>
                  {isWaitingRoom ? null : displaySnapshot.viewer.role === 'player' && displaySnapshot.legalActions.length > 0 ? (
                    <OnlineBettingControls
                      lang={lang}
                      legalActions={displaySnapshot.legalActions}
                      amountToCall={displaySnapshot.amountToCall}
                      currentBet={currentViewerSeat?.currentBet ?? 0}
                      potSize={displaySnapshot.totalPot}
                      bigBlind={displaySnapshot.currentLevel?.bigBlind ?? 0}
                      disabled={displaySnapshot.actingSeatIndex !== displaySnapshot.viewer.seatIndex}
                      onAction={handleAction}
                    />
                  ) : displaySnapshot.viewer.role === 'spectator' ? (
                    <div className={tableStyles.nextHandCard}>
                      <div className={tableStyles.nextHandText}>
                        {displaySnapshot.viewer.eliminated ? copy.eliminatedMessage : copy.spectatorNextTournament}
                      </div>
                      <button
                        type="button"
                        className={tableStyles.nextHandButton}
                        onClick={() =>
                          sendEvent(
                            displaySnapshot.viewer.nextTournamentReady ? 'table:unset_next_tournament_ready' : 'table:set_next_tournament_ready',
                          )
                        }
                      >
                        {displaySnapshot.viewer.nextTournamentReady ? copy.cancelNextTournamentReady : copy.nextTournamentReady}
                      </button>
                    </div>
                  ) : (
                    <div className={bettingStyles.disabled}>
                      {copy.waitingForTurn}
                    </div>
                  )}
                </div>

                <div className={tableStyles.rightDock}>
                  {currentViewerSeat ? (
                    <HeroHud
                      seat={currentViewerSeat as unknown as HoldemSeat}
                      handNumber={displaySnapshot.handNumber}
                      isButton={currentViewerSeat.seatIndex === displaySnapshot.buttonSeatIndex}
                      isSmallBlind={currentViewerSeat.seatIndex === displaySnapshot.smallBlindSeatIndex}
                      isBigBlind={currentViewerSeat.seatIndex === displaySnapshot.bigBlindSeatIndex}
                      lang={lang}
                    />
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
