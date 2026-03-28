import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import {
  HOLDEM_ONLINE_ACTION_PHASES,
  HOLDEM_ONLINE_ACTION_TIMEOUT_MS,
  HOLDEM_ONLINE_DISCONNECT_GRACE_MS,
  HOLDEM_ONLINE_MAX_NAME_LENGTH,
  HOLDEM_ONLINE_MAX_PLAYERS,
  HOLDEM_ONLINE_MIN_READY_PLAYERS,
  HOLDEM_ONLINE_TABLE_IDS,
  HOLDEM_ONLINE_TABLE_LABELS,
} from './constants.js';
import { createOnlineGameState, advanceOnlineState, applyOnlinePlayerAction } from './engine.js';
import {
  getAmountToCall,
  getBigBlindSeatIndex,
  getLegalActions,
  getPlayersAbleToAct,
  getSmallBlindSeatIndex,
} from './shared/holdem-engine.generated.js';

function now() {
  return Date.now();
}

function normalizeDisplayName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, HOLDEM_ONLINE_MAX_NAME_LENGTH);
}

function createTable(tableId) {
  return {
    id: tableId,
    label: HOLDEM_ONLINE_TABLE_LABELS[tableId] || tableId,
    participants: new Map(),
    game: null,
    status: 'waiting',
    actionTimeout: null,
    autoAdvanceTimeout: null,
    disconnectTimers: new Map(),
    lastTournamentResult: null,
  };
}

function createParticipant(session) {
  return {
    playerId: session.playerId,
    displayName: session.displayName,
    joinedAt: now(),
    connected: true,
    disconnectedAt: null,
    ready: false,
    nextTournamentReady: false,
    currentSeatIndex: null,
  };
}

function eventTypeForTransition(previousState, nextState) {
  if (!previousState) {
    return 'table:snapshot';
  }

  if (previousState.hand?.handNumber !== nextState.hand?.handNumber) {
    return 'hand:starting';
  }

  const previousBoardCount = previousState.hand?.communityCards?.length || 0;
  const nextBoardCount = nextState.hand?.communityCards?.length || 0;
  if (nextBoardCount > previousBoardCount) {
    if (nextBoardCount === 3) return 'hand:flop';
    if (nextBoardCount === 4) return 'hand:turn';
    if (nextBoardCount === 5) return 'hand:river';
  }

  if (nextState.phase === 'showdown' && previousState.phase !== 'showdown') {
    return 'showdown:started';
  }

  if (HOLDEM_ONLINE_ACTION_PHASES.has(nextState.phase) && previousState.phase !== nextState.phase) {
    return 'turn:started';
  }

  if (nextState.phase === 'tournament_complete' && previousState.phase !== 'tournament_complete') {
    return 'tournament:ended';
  }

  return 'table:snapshot';
}

function buildTournamentResult(game) {
  const winnerId = game.tournamentWinnerId;
  const entries = [...game.seats]
    .map((seat) => ({
      playerId: seat.playerId,
      playerName: seat.name,
      finalPlace: seat.playerId === winnerId ? 1 : Math.max(2, Number(seat.eliminationOrder || game.seats.length)),
      playerWon: seat.playerId === winnerId,
      levelReached: game.currentLevel.level,
      handNumber: game.hand.handNumber,
      chipCount: seat.stack,
    }))
    .sort((left, right) => left.finalPlace - right.finalPlace || right.chipCount - left.chipCount || left.playerName.localeCompare(right.playerName));

  return {
    id: `result-${game.hand.handNumber}-${Date.now()}`,
    completedAt: new Date().toISOString(),
    handNumber: game.hand.handNumber,
    level: game.currentLevel.level,
    entries,
  };
}

function findActingSeat(game) {
  if (!game) return null;
  return game.seats.find((seat) => seat.seatIndex === game.betting.actingSeatIndex) || null;
}

function selectTotalPot(game) {
  if (!game) return 0;
  return game.seats.reduce((sum, seat) => sum + seat.totalCommitted, 0);
}

function selectMainPot(game) {
  if (!game) return 0;
  if (game.hand.pots.length > 0) {
    return game.hand.pots.filter((pot) => pot.isMain).reduce((sum, pot) => sum + pot.amount, 0);
  }

  return selectTotalPot(game);
}

function selectSidePots(game) {
  if (!game) return [];
  return game.hand.pots.filter((pot) => !pot.isMain && pot.eligiblePlayerIds.length >= 2).map((pot) => pot.amount);
}

function collectWinningPlayerIds(game) {
  if (!game) {
    return new Set();
  }

  if (Array.isArray(game.hand?.payouts) && game.hand.payouts.length > 0) {
    return new Set(game.hand.payouts.map((payout) => payout.playerId));
  }

  if (Array.isArray(game.hand?.showdown) && game.hand.showdown.length > 0) {
    return new Set(
      game.hand.showdown.flatMap((result) => (Array.isArray(result.winners) ? result.winners : [])),
    );
  }

  return new Set();
}

function seatVisibleCards(seat, viewerPlayerId, revealAll = false) {
  if (revealAll || seat.playerId === viewerPlayerId || seat.hasShownCards) {
    return seat.holeCards;
  }

  return [];
}

function buildSeatSnapshot(seat, viewerPlayerId, revealAll = false, winningPlayerIds = new Set()) {
  return {
    seatIndex: seat.seatIndex,
    playerId: seat.playerId,
    name: seat.name,
    isHuman: seat.playerId === viewerPlayerId,
    stack: seat.stack,
    status: seat.status,
    eliminationOrder: seat.eliminationOrder,
    holeCards: seatVisibleCards(seat, viewerPlayerId, revealAll),
    hasFolded: seat.hasFolded,
    isAllIn: seat.isAllIn,
    hasShownCards: seat.hasShownCards,
    currentBet: seat.currentBet,
    totalCommitted: seat.totalCommitted,
    actedThisStreet: seat.actedThisStreet,
    lastFullRaiseSeen: seat.lastFullRaiseSeen,
    lastAction: seat.lastAction,
    lastActionAmount: seat.lastActionAmount,
    winningsThisHand: seat.winningsThisHand,
    position: seat.position,
    isWinner: winningPlayerIds.has(seat.playerId),
  };
}

function buildTableSummary(table) {
  const connectedParticipants = [...table.participants.values()].filter((participant) => participant.connected);
  const readyCount = table.status === 'waiting'
    ? connectedParticipants.filter((participant) => participant.ready).length
    : connectedParticipants.filter((participant) => participant.nextTournamentReady).length;

  return {
    tableId: table.id,
    label: table.label,
    status: table.status,
    connectedCount: connectedParticipants.length,
    seatedCount: table.game ? table.game.seats.filter((seat) => seat.status === 'active').length : 0,
    readyCount,
    handNumber: table.game?.hand.handNumber ?? 0,
    level: table.game?.currentLevel.level ?? null,
    smallBlind: table.game?.currentLevel.smallBlind ?? null,
    bigBlind: table.game?.currentLevel.bigBlind ?? null,
  };
}

function hasActiveSeat(table, playerId) {
  if (!table.game) return false;
  return table.game.seats.some((seat) => seat.playerId === playerId && seat.status === 'active');
}

function syncParticipantSeatState(table) {
  if (!table.game) {
    for (const participant of table.participants.values()) {
      participant.currentSeatIndex = null;
    }
    return;
  }

  for (const participant of table.participants.values()) {
    const activeSeat = table.game.seats.find(
      (seat) => seat.playerId === participant.playerId && seat.status === 'active',
    );
    participant.currentSeatIndex = activeSeat?.seatIndex ?? null;
  }
}

function hasConnectedSeatedPlayers(table) {
  return [...table.participants.values()].some(
    (participant) => participant.connected && participant.currentSeatIndex !== null,
  );
}

function buildTableSnapshot(table, viewerPlayerId) {
  const participant = table.participants.get(viewerPlayerId) || null;
  const game = table.game;
  const actingSeat = findActingSeat(game);
  const viewerSeat = game?.seats.find((seat) => seat.playerId === viewerPlayerId) || null;
  const viewerEliminated = Boolean(viewerSeat && viewerSeat.status === 'busted');
  const revealAll = game?.phase === 'tournament_complete';
  const winningPlayerIds = collectWinningPlayerIds(game);
  const legalActions = viewerSeat ? getLegalActions(game, viewerPlayerId) : [];
  const amountToCall = viewerSeat ? getAmountToCall(game, viewerSeat) : 0;

  return {
    ...buildTableSummary(table),
    viewer: {
      playerId: viewerPlayerId,
      displayName: participant?.displayName || '',
      connected: Boolean(participant?.connected),
      role: viewerSeat && viewerSeat.status === 'active' ? 'player' : 'spectator',
      eliminated: viewerEliminated,
      ready: Boolean(participant?.ready),
      nextTournamentReady: Boolean(participant?.nextTournamentReady),
      seatIndex: viewerSeat && viewerSeat.status === 'active' ? viewerSeat.seatIndex : null,
    },
    actionDeadlineAt: table.actionTimeout?.deadlineAt ?? null,
    actingSeatIndex: actingSeat?.seatIndex ?? null,
    actingPlayerName: actingSeat?.name ?? null,
    totalPot: selectTotalPot(game),
    mainPot: selectMainPot(game),
    sidePots: selectSidePots(game),
    communityCards: game?.hand.communityCards ?? [],
    handNumber: game?.hand.handNumber ?? 0,
    currentLevel: game?.currentLevel ?? null,
    buttonSeatIndex: game?.buttonSeatIndex ?? null,
    smallBlindSeatIndex: game ? getSmallBlindSeatIndex(game.seats, game.buttonSeatIndex) : null,
    bigBlindSeatIndex: game ? getBigBlindSeatIndex(game.seats, game.buttonSeatIndex) : null,
    handMessage: game?.hand.winnerMessage || null,
    logs: (game?.log ?? []).slice(-60),
    seats: game
      ? game.seats.map((seat) => buildSeatSnapshot(seat, viewerPlayerId, revealAll, winningPlayerIds))
      : [],
    participants: [...table.participants.values()]
      .map((entry) => ({
        playerId: entry.playerId,
        displayName: entry.displayName,
        connected: entry.connected,
        ready: entry.ready,
        nextTournamentReady: entry.nextTournamentReady,
        seated: hasActiveSeat(table, entry.playerId),
        seatIndex: entry.currentSeatIndex,
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName)),
    legalActions,
    amountToCall,
    lastTournamentResult: table.lastTournamentResult,
  };
}

function isReadyToStart(table) {
  if (table.game || table.status !== 'waiting') {
    return false;
  }

  const connectedParticipants = [...table.participants.values()].filter((participant) => participant.connected);
  if (connectedParticipants.length < HOLDEM_ONLINE_MIN_READY_PLAYERS) {
    return false;
  }

  return connectedParticipants.every((participant) => participant.ready);
}

export function createHoldemOnlineManager() {
  const sessions = new Map();
  const playerTable = new Map();
  const connections = new Map();
  const playerSockets = new Map();
  const tables = new Map(HOLDEM_ONLINE_TABLE_IDS.map((tableId) => [tableId, createTable(tableId)]));
  const wss = new WebSocketServer({ noServer: true });

  function send(ws, type, payload = {}) {
    if (ws.readyState !== 1) {
      return;
    }

    ws.send(JSON.stringify({ type, payload }));
  }

  function getPlayerSocketSet(playerId) {
    let set = playerSockets.get(playerId);
    if (!set) {
      set = new Set();
      playerSockets.set(playerId, set);
    }
    return set;
  }

  function tablesSnapshot() {
    return [...tables.values()].map(buildTableSummary);
  }

  function broadcastTables() {
    const payload = { tables: tablesSnapshot() };
    for (const [ws, connection] of connections.entries()) {
      if (!connection.playerId) continue;
      send(ws, 'tables:snapshot', payload);
    }
  }

  function broadcastTable(table, type = 'table:snapshot', extraPayloadByPlayer = null) {
    for (const [ws, connection] of connections.entries()) {
      if (!connection.playerId || connection.tableId !== table.id) continue;
      const payload = {
        table: buildTableSnapshot(table, connection.playerId),
        ...(typeof extraPayloadByPlayer === 'function' ? extraPayloadByPlayer(connection.playerId) : extraPayloadByPlayer || {}),
      };
      send(ws, type, payload);
    }
  }

  function clearActionTimeout(table) {
    if (table.actionTimeout?.timer) {
      clearTimeout(table.actionTimeout.timer);
    }
    table.actionTimeout = null;
  }

  function clearAutoAdvanceTimeout(table) {
    if (table.autoAdvanceTimeout?.timer) {
      clearTimeout(table.autoAdvanceTimeout.timer);
    }
    table.autoAdvanceTimeout = null;
  }

  function clearDisconnectTimeout(table, playerId) {
    const timer = table.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      table.disconnectTimers.delete(playerId);
    }
  }

  function removeParticipant(table, playerId) {
    clearDisconnectTimeout(table, playerId);
    const participant = table.participants.get(playerId);
    if (!participant) return;
    if (participant.currentSeatIndex !== null && table.game) {
      participant.connected = false;
      participant.ready = false;
      participant.nextTournamentReady = false;
      participant.disconnectedAt = now();
      if (!hasConnectedSeatedPlayers(table)) {
        terminateAbandonedTournament(table);
      }
      return;
    }

    table.participants.delete(playerId);
    playerTable.delete(playerId);
  }

  function scheduleDisconnectCleanup(table, playerId) {
    clearDisconnectTimeout(table, playerId);
    const timer = setTimeout(() => {
      const participant = table.participants.get(playerId);
      if (!participant || participant.connected) {
        return;
      }

      if (participant.currentSeatIndex !== null && table.game) {
        return;
      }

      table.participants.delete(playerId);
      playerTable.delete(playerId);
      table.disconnectTimers.delete(playerId);
      broadcastTable(table);
      broadcastTables();
    }, HOLDEM_ONLINE_DISCONNECT_GRACE_MS);
    table.disconnectTimers.set(playerId, timer);
  }

  function finalizeTournament(table) {
    clearActionTimeout(table);
    clearAutoAdvanceTimeout(table);
    if (!table.game) return;

    table.lastTournamentResult = buildTournamentResult(table.game);
    table.status = 'waiting';

    for (const participant of table.participants.values()) {
      participant.ready = false;
      participant.nextTournamentReady = false;
      participant.currentSeatIndex = null;
    }

    table.game = null;
    broadcastTable(table, 'tournament:result_snapshot');
    broadcastTables();
  }

  function terminateAbandonedTournament(table) {
    clearActionTimeout(table);
    clearAutoAdvanceTimeout(table);
    table.game = null;
    table.status = 'waiting';
    table.lastTournamentResult = null;

    for (const [playerId, participant] of [...table.participants.entries()]) {
      participant.currentSeatIndex = null;
      participant.ready = false;
      participant.nextTournamentReady = false;

      if (!participant.connected) {
        table.participants.delete(playerId);
        playerTable.delete(playerId);
        clearDisconnectTimeout(table, playerId);
      }
    }

    broadcastTable(table);
    broadcastTables();
  }

  function scheduleActionTimeout(table) {
    clearActionTimeout(table);
    if (!table.game) return;

    const actingSeat = findActingSeat(table.game);
    if (!actingSeat) return;

    const deadlineAt = now() + HOLDEM_ONLINE_ACTION_TIMEOUT_MS;
    const handNumber = table.game.hand.handNumber;
    const phase = table.game.phase;
    const timer = setTimeout(() => {
      if (!table.game) return;
      const currentActingSeat = findActingSeat(table.game);
      if (!currentActingSeat || currentActingSeat.playerId !== actingSeat.playerId || table.game.hand.handNumber !== handNumber || table.game.phase !== phase) {
        return;
      }

      const legalActions = getLegalActions(table.game, actingSeat.playerId);
      const autoAction = legalActions.some((action) => action.type === 'check') ? { type: 'check' } : { type: 'fold' };
      table.game = applyOnlinePlayerAction(table.game, {
        playerId: actingSeat.playerId,
        type: autoAction.type,
      });
      broadcastTable(table, 'turn:auto_action', () => ({
        autoAction: {
          playerId: actingSeat.playerId,
          type: autoAction.type,
        },
      }));
      driveTable(table);
    }, HOLDEM_ONLINE_ACTION_TIMEOUT_MS);

    table.actionTimeout = {
      playerId: actingSeat.playerId,
      deadlineAt,
      handNumber,
      phase,
      timer,
    };
  }

  function getAutoAdvanceDelay(previousState, nextState, eventType) {
    const allInRunout = getPlayersAbleToAct(nextState.seats).length < 2;

    if (nextState.phase === 'tournament_complete') {
      return 2200;
    }

    switch (eventType) {
      case 'hand:starting':
        return 680;
      case 'hand:flop':
        return allInRunout ? 1700 : 1400;
      case 'hand:turn':
      case 'hand:river':
        return allInRunout ? 1950 : 1600;
      case 'showdown:started':
        return 1500;
      default:
        break;
    }

    switch (nextState.phase) {
      case 'hand_setup':
        return 280;
      case 'post_antes':
        return 360;
      case 'post_blinds':
        return 520;
      case 'deal_hole_cards':
        return 760;
      case 'deal_flop':
        return 820;
      case 'deal_turn':
      case 'deal_river':
        return allInRunout ? 1350 : 980;
      case 'showdown':
        return 1380;
      case 'award_pots':
        return 1650;
      case 'eliminate_players':
        return 1180;
      case 'move_button':
        return 640;
      case 'level_up_check':
        return 780;
      case 'next_hand':
        return 1480;
      default:
        return 480;
    }
  }

  function scheduleAutoAdvance(table, delayMs) {
    clearAutoAdvanceTimeout(table);
    const timer = setTimeout(() => {
      table.autoAdvanceTimeout = null;
      driveTable(table);
    }, delayMs);
    table.autoAdvanceTimeout = { timer, delayMs };
  }

  function driveTable(table) {
    clearActionTimeout(table);
    clearAutoAdvanceTimeout(table);
    if (!table.game) {
      return;
    }

    syncParticipantSeatState(table);

    if (table.game.phase === 'tournament_complete') {
      if (table.status === 'tournament_complete') {
        finalizeTournament(table);
        return;
      }

      table.status = 'tournament_complete';
      scheduleAutoAdvance(table, 2200);
      return;
    }

    if (HOLDEM_ONLINE_ACTION_PHASES.has(table.game.phase)) {
      table.status = 'in_hand';
      scheduleActionTimeout(table);
      broadcastTable(table, 'turn:started');
      broadcastTables();
      return;
    }

    if (table.game.phase === 'showdown' || table.game.phase === 'award_pots' || table.game.phase === 'eliminate_players') {
      table.status = 'showdown';
    } else {
      table.status = 'in_hand';
    }

    const previousState = table.game;
    const nextState = advanceOnlineState(table.game);
    table.game = nextState;
    syncParticipantSeatState(table);

    if (nextState.phase === 'showdown' || nextState.phase === 'award_pots' || nextState.phase === 'eliminate_players') {
      table.status = 'showdown';
    } else if (nextState.phase === 'tournament_complete') {
      table.status = 'tournament_complete';
    } else {
      table.status = 'in_hand';
    }

    const eventType = eventTypeForTransition(previousState, nextState);
    broadcastTable(table, eventType);
    broadcastTables();

    if (nextState.phase === 'tournament_complete') {
      scheduleAutoAdvance(table, getAutoAdvanceDelay(previousState, nextState, eventType));
      return;
    }

    if (HOLDEM_ONLINE_ACTION_PHASES.has(nextState.phase)) {
      table.status = 'in_hand';
      scheduleActionTimeout(table);
      broadcastTable(table, 'turn:started');
      broadcastTables();
      return;
    }

    scheduleAutoAdvance(table, getAutoAdvanceDelay(previousState, nextState, eventType));
  }

  function startTournament(table) {
    const connectedParticipants = [...table.participants.values()]
      .filter((participant) => participant.connected)
      .sort((left, right) => left.joinedAt - right.joinedAt);
    const readyParticipants = connectedParticipants.slice(0, HOLDEM_ONLINE_MAX_PLAYERS);

    if (readyParticipants.length < HOLDEM_ONLINE_MIN_READY_PLAYERS) {
      return;
    }

    table.lastTournamentResult = null;
    for (const participant of table.participants.values()) {
      participant.currentSeatIndex = null;
      participant.ready = false;
      participant.nextTournamentReady = false;
    }

    const game = createOnlineGameState(
      readyParticipants.map((participant) => ({
        playerId: participant.playerId,
        displayName: participant.displayName,
      })),
      Date.now() >>> 0,
      'en',
    );

    for (const seat of game.seats) {
      const participant = table.participants.get(seat.playerId);
      if (participant) {
        participant.currentSeatIndex = seat.seatIndex;
        participant.ready = false;
      }
    }

    table.game = game;
    table.status = 'in_hand';
    broadcastTable(table, 'game:starting');
    broadcastTables();
    driveTable(table);
  }

  function maybeStartTournament(table) {
    if (isReadyToStart(table)) {
      startTournament(table);
      return true;
    }
    return false;
  }

  function playerCurrentTable(playerId) {
    const tableId = playerTable.get(playerId);
    return tableId ? tables.get(tableId) || null : null;
  }

  function applyParticipantUpdate(table, playerId, updater) {
    const participant = table.participants.get(playerId);
    if (!participant) return false;
    updater(participant);
    broadcastTable(table);
    broadcastTables();
    return true;
  }

  function ensureParticipantInTable(table, session) {
    let participant = table.participants.get(session.playerId);
    if (!participant) {
      participant = createParticipant(session);
      table.participants.set(session.playerId, participant);
    } else {
      participant.displayName = session.displayName;
      participant.connected = true;
      participant.disconnectedAt = null;
    }

    clearDisconnectTimeout(table, session.playerId);
    playerTable.set(session.playerId, table.id);
    return participant;
  }

  function joinTable(playerId, tableId) {
    const session = [...sessions.values()].find((entry) => entry.playerId === playerId);
    const table = tables.get(tableId);
    if (!session || !table) {
      return { ok: false, error: 'Invalid table or session.' };
    }

    const currentTable = playerCurrentTable(playerId);
    if (currentTable && currentTable.id !== table.id) {
      const currentParticipant = currentTable.participants.get(playerId);
      if (currentParticipant?.currentSeatIndex !== null && currentTable.game) {
        return { ok: false, error: 'You cannot switch tables during a live tournament.' };
      }
      removeParticipant(currentTable, playerId);
      broadcastTable(currentTable);
      broadcastTables();
    }

    ensureParticipantInTable(table, session);
    return { ok: true, table };
  }

  function leaveTable(playerId) {
    const table = playerCurrentTable(playerId);
    if (!table) return;
    const participant = table.participants.get(playerId);
    if (!participant) return;

    if (participant.currentSeatIndex !== null && table.game) {
      participant.connected = false;
      participant.disconnectedAt = now();
      participant.ready = false;
      participant.nextTournamentReady = false;
      if (!hasConnectedSeatedPlayers(table)) {
        terminateAbandonedTournament(table);
      } else {
        scheduleDisconnectCleanup(table, playerId);
      }
    } else {
      table.participants.delete(playerId);
      playerTable.delete(playerId);
    }

    broadcastTable(table);
    broadcastTables();
  }

  function handleSocketClose(ws) {
    const connection = connections.get(ws);
    if (!connection?.playerId) {
      connections.delete(ws);
      return;
    }

    const socketSet = playerSockets.get(connection.playerId);
    socketSet?.delete(ws);
    if (socketSet && socketSet.size === 0) {
      playerSockets.delete(connection.playerId);
    }

    const table = playerCurrentTable(connection.playerId);
    if (table) {
      const participant = table.participants.get(connection.playerId);
      if (participant) {
        const stillConnected = [...connections.entries()].some(
          ([otherWs, otherConnection]) =>
            otherWs !== ws &&
            otherConnection.playerId === connection.playerId &&
            otherConnection.tableId === table.id,
        );
        if (!stillConnected) {
          participant.connected = false;
          participant.disconnectedAt = now();
          participant.ready = false;
          participant.nextTournamentReady = false;
          if (!hasConnectedSeatedPlayers(table)) {
            terminateAbandonedTournament(table);
          } else {
            scheduleDisconnectCleanup(table, connection.playerId);
          }
          broadcastTable(table);
          broadcastTables();
        }
      }
    }

    connections.delete(ws);
  }

  function handleActionMessage(ws, connection, type, payload) {
    const table = connection.tableId ? tables.get(connection.tableId) : null;
    if (!table || !table.game || !connection.playerId) {
      send(ws, 'error', { message: 'No active table is selected.' });
      return;
    }

    const participant = table.participants.get(connection.playerId);
    if (!participant || participant.currentSeatIndex === null) {
      send(ws, 'error', { message: 'Only seated players can act.' });
      return;
    }

    const actionType = type.replace('action:', '');
    const action = {
      playerId: connection.playerId,
      type: actionType,
      amount: Number.isFinite(Number(payload?.amount)) ? Math.round(Number(payload.amount)) : undefined,
    };

    const nextState = applyOnlinePlayerAction(table.game, action);
    if (nextState === table.game) {
      send(ws, 'error', { message: 'That action is not legal right now.' });
      return;
    }

    table.game = nextState;
    syncParticipantSeatState(table);
    broadcastTable(table, 'action:applied', () => ({
      action: {
        playerId: connection.playerId,
        type: action.type,
        amount: action.amount ?? null,
      },
    }));
    broadcastTables();
    driveTable(table);
  }

  function issueSession({ displayName, sessionToken } = {}) {
    const normalizedName = normalizeDisplayName(displayName);
    if (!normalizedName) {
      return { ok: false, error: 'displayName is required' };
    }

    if (sessionToken && sessions.has(sessionToken)) {
      const existing = sessions.get(sessionToken);
      existing.displayName = normalizedName;
      existing.updatedAt = now();

      const table = playerCurrentTable(existing.playerId);
      if (table) {
        const participant = table.participants.get(existing.playerId);
        if (participant) {
          participant.displayName = normalizedName;
        }
      }

      return { ok: true, session: existing };
    }

    const token = crypto.randomBytes(24).toString('base64url');
    const session = {
      sessionToken: token,
      playerId: crypto.randomUUID(),
      displayName: normalizedName,
      createdAt: now(),
      updatedAt: now(),
    };
    sessions.set(token, session);
    return { ok: true, session };
  }

  function getTablesResponse() {
    return {
      ok: true,
      tables: tablesSnapshot(),
    };
  }

  function markPlayerConnected(playerId) {
    const table = playerCurrentTable(playerId);
    if (!table) return null;
    const participant = table.participants.get(playerId);
    if (!participant) return null;
    participant.connected = true;
    participant.disconnectedAt = null;
    clearDisconnectTimeout(table, playerId);
    return table;
  }

  function handleMessage(ws, raw) {
    let parsed;
    try {
      parsed = JSON.parse(String(raw || ''));
    } catch {
      send(ws, 'error', { message: 'Invalid websocket payload.' });
      return;
    }

    const type = String(parsed?.type || '').trim();
    const payload = parsed?.payload || {};
    const connection = connections.get(ws);

    if (type === 'session:resume') {
      const token = String(payload?.sessionToken || '').trim();
      const session = sessions.get(token);
      if (!session) {
        send(ws, 'error', { message: 'Session not found or expired.' });
        return;
      }

      connection.playerId = session.playerId;
      connection.sessionToken = token;
      getPlayerSocketSet(session.playerId).add(ws);
      const table = markPlayerConnected(session.playerId);
      if (table) {
        connection.tableId = table.id;
      }
      send(ws, 'session:ready', {
        playerId: session.playerId,
        displayName: session.displayName,
        currentTableId: connection.tableId,
      });
      send(ws, 'tables:snapshot', { tables: tablesSnapshot() });
      if (table) {
        broadcastTable(table);
      }
      return;
    }

    if (!connection.playerId) {
      send(ws, 'error', { message: 'Authenticate first with session:resume.' });
      return;
    }

    if (type === 'tables:subscribe') {
      send(ws, 'tables:snapshot', { tables: tablesSnapshot() });
      return;
    }

    if (type === 'table:join') {
      const tableId = String(payload?.tableId || '').trim();
      const result = joinTable(connection.playerId, tableId);
      if (!result.ok) {
        send(ws, 'error', { message: result.error });
        return;
      }

      connection.tableId = tableId;
      broadcastTable(result.table, 'table:user_joined');
      broadcastTables();
      maybeStartTournament(result.table);
      return;
    }

    if (type === 'table:leave') {
      if (!connection.tableId) return;
      const table = tables.get(connection.tableId);
      leaveTable(connection.playerId);
      connection.tableId = null;
      if (table) {
        send(ws, 'tables:snapshot', { tables: tablesSnapshot() });
      }
      return;
    }

    if (type === 'table:set_ready' || type === 'table:unset_ready') {
      const table = connection.tableId ? tables.get(connection.tableId) : null;
      if (!table || table.status !== 'waiting') {
        send(ws, 'error', { message: 'Ready is only available while the table is waiting.' });
        return;
      }
      applyParticipantUpdate(table, connection.playerId, (participant) => {
        participant.ready = type === 'table:set_ready';
      });
      maybeStartTournament(table);
      return;
    }

    if (type === 'table:set_next_tournament_ready' || type === 'table:unset_next_tournament_ready') {
      const table = connection.tableId ? tables.get(connection.tableId) : null;
      if (!table || !table.game) {
        send(ws, 'error', { message: 'This toggle is only available during a live tournament.' });
        return;
      }
      const participant = table.participants.get(connection.playerId);
      const seatedSeat = participant?.currentSeatIndex !== null
        ? table.game.seats.find((seat) => seat.seatIndex === participant.currentSeatIndex) || null
        : null;
      if (seatedSeat && seatedSeat.status === 'active') {
        send(ws, 'error', { message: 'Active players cannot queue the next tournament yet.' });
        return;
      }
      applyParticipantUpdate(table, connection.playerId, (participant) => {
        participant.nextTournamentReady = type === 'table:set_next_tournament_ready';
      });
      return;
    }

    if (type === 'ping') {
      send(ws, 'pong', { now: Date.now() });
      return;
    }

    if (type.startsWith('action:')) {
      handleActionMessage(ws, connection, type, payload);
      return;
    }

    send(ws, 'error', { message: `Unknown websocket event: ${type}` });
  }

  wss.on('connection', (ws) => {
    connections.set(ws, {
      playerId: null,
      sessionToken: null,
      tableId: null,
    });

    ws.on('message', (raw) => handleMessage(ws, raw));
    ws.on('close', () => handleSocketClose(ws));
  });

  return {
    issueSession,
    getTablesResponse,
    handleUpgrade(request, socket, head) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    },
  };
}
