import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { buildEnemyPose, clamp, computeEnemyLayout, pointInEnemyRider } from './math.js';

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const WIN_HITS = 5;
const MAGAZINE_SIZE = 6;
const RELOAD_MS = 920;
const SHOT_COOLDOWN_MS = 320;
const COUNTDOWN_MS = 3000;
const MAX_NAME_LENGTH = 24;

function now() {
  return Date.now();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeDisplayName(value) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return normalized || `Guest ${Math.floor(Math.random() * 9000) + 1000}`;
}

function send(ws, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function createPlayerSession(ws, displayName) {
  return {
    playerId: createId('cart_player'),
    displayName: normalizeDisplayName(displayName),
    ws,
    matchId: null,
  };
}

function createRoundPlayerState(session) {
  return {
    playerId: session.playerId,
    displayName: session.displayName,
    hitsLanded: 0,
    ammo: MAGAZINE_SIZE,
    reloadStartedAt: 0,
    reloadUntil: 0,
    shotCooldownUntil: 0,
    lastShotAt: 0,
    hitReactionUntil: 0,
  };
}

function createMatch(left, right) {
  const timestamp = now();
  return {
    id: createId('cart_match'),
    phase: 'countdown',
    message: 'Opponent found. Duel starts soon.',
    countdownEndAt: timestamp + COUNTDOWN_MS,
    winnerId: null,
    players: new Map([
      [left.playerId, createRoundPlayerState(left)],
      [right.playerId, createRoundPlayerState(right)],
    ]),
    sockets: new Map([
      [left.playerId, left.ws],
      [right.playerId, right.ws],
    ]),
    eventSequence: 0,
    countdownTimer: null,
  };
}

function buildViewerSnapshot(match, viewerId) {
  const viewer = match.players.get(viewerId);
  const opponent = [...match.players.values()].find((entry) => entry.playerId !== viewerId) || null;

  return {
    matchId: match.id,
    phase: match.phase,
    serverTime: now(),
    countdownEndAt: match.countdownEndAt,
    winnerId: match.winnerId,
    message: match.message,
    viewerPlayerId: viewer?.playerId || null,
    you: viewer,
    opponent,
  };
}

function makeEvent(match, type, payload) {
  match.eventSequence += 1;
  return {
    id: `${match.id}:${match.eventSequence}`,
    type,
    createdAt: now(),
    ...payload,
  };
}

function buildShotTarget(target) {
  return {
    x: clamp(Number(target?.x || 0.5), 0, 1),
    y: clamp(Number(target?.y || 0.5), 0, 1),
  };
}

function transitionToDuel(match) {
  if (!match || match.phase !== 'countdown') return;
  match.phase = 'duel';
  match.message = 'Draw';
}

function resetMatchForRematch(match) {
  const sessions = [...match.players.values()].map((entry) => ({
    playerId: entry.playerId,
    displayName: entry.displayName,
  }));
  const timestamp = now();
  match.phase = 'countdown';
  match.message = 'Rematch found. Duel starts soon.';
  match.countdownEndAt = timestamp + COUNTDOWN_MS;
  match.winnerId = null;
  match.eventSequence = 0;
  match.players = new Map(
    sessions.map((entry) => [
      entry.playerId,
      {
        playerId: entry.playerId,
        displayName: entry.displayName,
        hitsLanded: 0,
        ammo: MAGAZINE_SIZE,
        reloadStartedAt: 0,
        reloadUntil: 0,
        shotCooldownUntil: 0,
        lastShotAt: 0,
        hitReactionUntil: 0,
      },
    ]),
  );
}

export function createMineCartDuelOnlineManager() {
  const wss = new WebSocketServer({ noServer: true });
  const sessions = new Map();
  const matches = new Map();
  let waitingPlayerId = null;

  function clearCountdownTimer(match) {
    if (match?.countdownTimer) {
      clearTimeout(match.countdownTimer);
      match.countdownTimer = null;
    }
  }

  function broadcastSnapshot(match, type = 'match:update', events = []) {
    for (const [playerId, ws] of match.sockets.entries()) {
      send(ws, {
        type,
        snapshot: buildViewerSnapshot(match, playerId),
        events,
      });
    }
  }

  function cleanupMatch(matchId) {
    const match = matches.get(matchId);
    if (!match) return;
    clearCountdownTimer(match);
    matches.delete(matchId);
    for (const playerId of match.sockets.keys()) {
      const session = sessions.get(playerId);
      if (session) {
        session.matchId = null;
      }
    }
  }

  function beginMatch(leftSession, rightSession) {
    const match = createMatch(leftSession, rightSession);
    leftSession.matchId = match.id;
    rightSession.matchId = match.id;
    matches.set(match.id, match);
    match.countdownTimer = setTimeout(() => {
      transitionToDuel(match);
      broadcastSnapshot(match, 'match:update');
    }, COUNTDOWN_MS);
    broadcastSnapshot(match, 'match:found');
  }

  function handleQueueJoin(session) {
    if (session.matchId) return;
    if (waitingPlayerId && waitingPlayerId !== session.playerId) {
      const waiting = sessions.get(waitingPlayerId);
      waitingPlayerId = null;
      if (waiting && waiting.ws.readyState === waiting.ws.OPEN) {
        beginMatch(waiting, session);
        return;
      }
    }

    waitingPlayerId = session.playerId;
    send(session.ws, {
      type: 'queue:waiting',
      message: 'Waiting for another online player...',
    });
  }

  function handleDisconnect(session) {
    if (waitingPlayerId === session.playerId) {
      waitingPlayerId = null;
    }

    if (!session.matchId) {
      sessions.delete(session.playerId);
      return;
    }

    const match = matches.get(session.matchId);
    if (!match) {
      sessions.delete(session.playerId);
      return;
    }

    const opponentId = [...match.sockets.keys()].find((playerId) => playerId !== session.playerId) || null;
    const opponentWs = opponentId ? match.sockets.get(opponentId) : null;
    cleanupMatch(match.id);
    sessions.delete(session.playerId);

    if (opponentId) {
      const opponentSession = sessions.get(opponentId);
      if (opponentSession) {
        opponentSession.matchId = null;
      }
      if (opponentWs) {
        send(opponentWs, {
          type: 'match:ended',
          reason: 'opponent_left',
          message: 'Your opponent left. Rejoining matchmaking...',
        });
        if (opponentSession) {
          handleQueueJoin(opponentSession);
        }
      }
    }
  }

  function finishMatch(match, winnerId, message, extraEvents = []) {
    clearCountdownTimer(match);
    match.phase = 'round_over';
    match.winnerId = winnerId;
    match.message = message;
    broadcastSnapshot(match, 'match:update', extraEvents);
  }

  function handleShoot(match, session, payload) {
    if (match.phase !== 'duel') return;
    const timestamp = now();
    const actor = match.players.get(session.playerId);
    const targetPlayer = [...match.players.values()].find((entry) => entry.playerId !== session.playerId);
    if (!actor || !targetPlayer) return;
    if (timestamp < actor.shotCooldownUntil || timestamp < actor.reloadUntil || actor.ammo <= 0) {
      return;
    }

    const normalizedTarget = buildShotTarget(payload);
    actor.ammo -= 1;
    actor.lastShotAt = timestamp;
    actor.shotCooldownUntil = timestamp + SHOT_COOLDOWN_MS;

    const enemyPose = buildEnemyPose(timestamp, targetPlayer);
    const enemyLayout = computeEnemyLayout(CANVAS_WIDTH, CANVAS_HEIGHT, enemyPose);
    const hit = pointInEnemyRider(
      {
        x: normalizedTarget.x * CANVAS_WIDTH,
        y: normalizedTarget.y * CANVAS_HEIGHT,
      },
      enemyLayout,
    );

    if (hit) {
      actor.hitsLanded += 1;
      targetPlayer.hitReactionUntil = timestamp + 420;
      match.message = `${actor.displayName} landed a hit`;
    } else {
      match.message = `${actor.displayName} missed`;
    }

    const events = [
      makeEvent(match, 'shot', {
        actorId: actor.playerId,
        target: normalizedTarget,
        hit,
      }),
    ];

    if (actor.hitsLanded >= WIN_HITS) {
      finishMatch(match, actor.playerId, `${actor.displayName} wins the duel`, events);
      return;
    }

    broadcastSnapshot(match, 'match:update', events);
  }

  function handleReload(match, session) {
    if (match.phase !== 'duel') return;
    const timestamp = now();
    const actor = match.players.get(session.playerId);
    if (!actor) return;
    if (timestamp < actor.reloadUntil || actor.ammo === MAGAZINE_SIZE) {
      return;
    }

    actor.reloadStartedAt = timestamp;
    actor.reloadUntil = timestamp + RELOAD_MS;
    actor.ammo = MAGAZINE_SIZE;
    match.message = `${actor.displayName} is reloading`;

    const events = [
      makeEvent(match, 'reload', {
        actorId: actor.playerId,
      }),
    ];

    broadcastSnapshot(match, 'match:update', events);
  }

  function handleRestart(match) {
    resetMatchForRematch(match);
    clearCountdownTimer(match);
    match.countdownTimer = setTimeout(() => {
      transitionToDuel(match);
      broadcastSnapshot(match, 'match:update');
    }, COUNTDOWN_MS);
    broadcastSnapshot(match, 'match:update');
  }

  wss.on('connection', (ws) => {
    let session = null;

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw || '{}'));
      } catch {
        send(ws, { type: 'error', message: 'Invalid message payload' });
        return;
      }

      if (message.type === 'hello') {
        session = createPlayerSession(ws, message.displayName);
        sessions.set(session.playerId, session);
        send(ws, {
          type: 'hello:ok',
          playerId: session.playerId,
          displayName: session.displayName,
        });
        return;
      }

      if (!session) {
        send(ws, { type: 'error', message: 'Session not initialized' });
        return;
      }

      if (message.type === 'queue:join') {
        handleQueueJoin(session);
        return;
      }

      if (message.type === 'match:leave') {
        handleDisconnect(session);
        return;
      }

      const match = session.matchId ? matches.get(session.matchId) : null;
      if (!match) {
        return;
      }

      if (message.type === 'action:shoot') {
        handleShoot(match, session, message);
        return;
      }

      if (message.type === 'action:reload') {
        handleReload(match, session);
        return;
      }

      if (message.type === 'match:restart') {
        handleRestart(match);
      }
    });

    ws.on('close', () => {
      if (!session) return;
      handleDisconnect(session);
    });
  });

  return {
    handleUpgrade(request, socket, head) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    },
  };
}
