import { SketchRenderer } from "./sketchRenderer.js";
import { clamp } from "./sceneMath.js";

const PHASE = {
  BOOT: "boot",
  COUNTDOWN: "countdown",
  DUEL: "duel",
  ROUND_OVER: "round_over",
};

const WIN_HITS = 5;
const MAGAZINE_SIZE = 6;
const PLAYER_RELOAD_MS = 920;
const PLAYER_SHOT_COOLDOWN_MS = 320;
const PLAYER_MUZZLE_FLASH_MS = 110;
const ENEMY_MUZZLE_FLASH_MS = 110;
const PLAYER_HIT_FLASH_MS = 280;
const PLAYER_CAMERA_KICK_MS = 180;
const SHOT_TRAIL_MS = 170;
const IMPACT_MARK_MS = 620;

function wsUrl() {
  const { protocol, host } = window.location;
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${host}/ws/mine-cart-duel-online`;
}

function normalizeName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

function buildEnemyPose(timestampMs, opponent = {}) {
  const seconds = timestampMs * 0.001;
  const worldPhase = seconds * 1.24;
  const backgroundScroll = seconds * 182;
  const progress = clamp(
    0.48 +
      Math.sin(seconds * 0.78 + 0.34) * 0.22 +
      Math.sin(seconds * 1.94 - 1.16) * 0.1,
    0.14,
    0.9,
  );
  const bob =
    Math.sin(seconds * 3.24 + 0.74) * 0.52 +
    Math.sin(seconds * 5.02 - 0.46) * 0.18;
  const depthScale = Math.sin(seconds * 0.86 + 1.6) * 0.6;
  const enemyTrackLift =
    Math.sin(seconds * 0.82 + 0.3) * 0.58 +
    Math.sin(seconds * 1.28 - 0.2) * 0.14;
  const playerTrackLift =
    Math.sin(seconds * 0.82 + 0.02) * 0.52 +
    Math.sin(seconds * 1.28 - 0.5) * 0.12;

  return {
    trackProgress: progress,
    bob,
    depthScale,
    worldPhase,
    backgroundScroll,
    enemyTrackLift,
    playerTrackLift,
    hitReaction: clamp(
      (Number(opponent.hitReactionUntil || 0) - timestampMs) / 420,
      0,
      1,
    ),
    aimWeight:
      Number(opponent.reloadUntil || 0) > timestampMs
        ? 0.12
        : Number(opponent.lastShotAt || 0) + 180 > timestampMs
          ? 0.82
          : 0.18,
  };
}

function localizeServerTime(serverTimestamp, serverOffsetMs) {
  return serverTimestamp - serverOffsetMs;
}

function trimEvents(items, timestampMs, maxAgeMs) {
  return items.filter((entry) => timestampMs - entry.createdAt <= maxAgeMs);
}

function createGuestName() {
  const stored = window.localStorage.getItem("mine-cart-duel.online-name");
  const normalized = normalizeName(stored);
  if (normalized) {
    return normalized;
  }

  const generated = `Guest ${Math.floor(Math.random() * 9000) + 1000}`;
  window.localStorage.setItem("mine-cart-duel.online-name", generated);
  return generated;
}

export class OnlineMatchController {
  constructor(canvasElement, soundEffects, options = {}) {
    this.renderer = new SketchRenderer(canvasElement);
    this.soundEffects = soundEffects;
    this.onMatched = options.onMatched ?? (() => {});
    this.onMatchEnded = options.onMatchEnded ?? (() => {});
    this.width = 0;
    this.height = 0;
    this.socket = null;
    this.status = "idle";
    this.statusText = "온라인 상대를 기다리는 중...";
    this.playerId = null;
    this.displayName = createGuestName();
    this.snapshot = null;
    this.serverOffsetMs = 0;
    this.processedEvents = new Set();
    this.recentShots = [];
    this.recentImpacts = [];
    this.playerHitFlashUntil = 0;
    this.playerCameraKickUntil = 0;
    this.ignoreClose = false;
    this.error = "";
    this.lastFrameState = this.composeIdleFrame(0, { visible: false, x: 0, y: 0 });
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.renderer.resize(width, height);
  }

  getDisplayName() {
    return this.displayName;
  }

  getStatus() {
    return this.status;
  }

  getStatusText() {
    return this.error || this.statusText;
  }

  getOpponentName() {
    return this.snapshot?.opponent?.displayName || "RIVAL";
  }

  hasLiveMatch() {
    return Boolean(this.snapshot);
  }

  isMatched() {
    return this.status === "matched" && Boolean(this.snapshot);
  }

  async start(displayName = this.displayName) {
    this.stop({ silent: true });
    this.displayName = normalizeName(displayName) || createGuestName();
    window.localStorage.setItem("mine-cart-duel.online-name", this.displayName);
    this.status = "connecting";
    this.statusText = "서버에 연결 중...";
    this.error = "";
    this.ignoreClose = false;

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl());
      this.socket = socket;

      socket.addEventListener("open", () => {
        socket.send(
          JSON.stringify({
            type: "hello",
            displayName: this.displayName,
          }),
        );
        socket.send(JSON.stringify({ type: "queue:join" }));
        resolve();
      });

      socket.addEventListener("message", (event) => {
        this.handleMessage(event);
      });

      socket.addEventListener("close", () => {
        this.socket = null;
        this.snapshot = null;
        if (this.ignoreClose) {
          this.ignoreClose = false;
          return;
        }
        if (this.status === "matched") {
          this.status = "waiting";
          this.statusText = "상대 연결이 끊겼습니다. 다시 대기열로 이동합니다.";
          this.onMatchEnded();
          return;
        }

        if (this.status === "connecting" || this.status === "waiting") {
          this.error = "온라인 매치 서버와 연결이 끊겼습니다.";
          this.status = "error";
        }
      });

      socket.addEventListener("error", () => {
        this.error = "온라인 매치 서버에 연결하지 못했습니다.";
        this.status = "error";
        reject(new Error(this.error));
      });
    });
  }

  stop({ silent = false } = {}) {
    if (this.socket) {
      try {
        this.ignoreClose = true;
        if (!silent) {
          this.socket.send(JSON.stringify({ type: "match:leave" }));
        }
        this.socket.close();
      } catch {
        // noop
      }
    }
    this.socket = null;
    this.snapshot = null;
    this.processedEvents.clear();
    this.recentShots = [];
    this.recentImpacts = [];
    this.status = "idle";
    this.statusText = "온라인 상대를 기다리는 중...";
    this.error = "";
  }

  requestRestart() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "match:restart" }));
    }
  }

  handleMessage(event) {
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === "hello:ok") {
      this.playerId = payload.playerId;
      this.status = "waiting";
      this.statusText = "상대방 기다리는 중...";
      return;
    }

    if (payload.type === "queue:waiting") {
      this.status = "waiting";
      this.statusText = payload.message || "상대방 기다리는 중...";
      return;
    }

    if (payload.type === "match:found" || payload.type === "match:update") {
      this.status = "matched";
      this.error = "";
      this.snapshot = payload.snapshot;
      this.serverOffsetMs = Number(payload.snapshot?.serverTime || Date.now()) - Date.now();
      this.statusText = payload.snapshot?.message || "매칭 완료";
      this.processEvents(payload.events || []);
      if (payload.type === "match:found") {
        this.onMatched();
      }
      return;
    }

    if (payload.type === "match:ended") {
      this.snapshot = null;
      this.status = "waiting";
      this.statusText = payload.message || "상대 연결이 끊겼습니다. 다시 대기 중...";
      this.onMatchEnded();
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "queue:join" }));
      }
      return;
    }

    if (payload.type === "error") {
      this.error = payload.message || "온라인 매치 오류";
      this.status = "error";
    }
  }

  processEvents(events) {
    for (const entry of events) {
      if (!entry?.id || this.processedEvents.has(entry.id)) {
        continue;
      }
      this.processedEvents.add(entry.id);
      const localCreatedAt = localizeServerTime(
        Number(entry.createdAt || Date.now()),
        this.serverOffsetMs,
      );

      if (entry.type === "shot") {
        const team = entry.actorId === this.playerId ? "player" : "enemy";
        const point = {
          x: clamp(Number(entry.target?.x || 0.5), 0, 1) * this.width,
          y: clamp(Number(entry.target?.y || 0.5), 0, 1) * this.height,
        };
        this.recentShots.push({
          team,
          to: point,
          createdAt: localCreatedAt,
          hit: Boolean(entry.hit),
        });
        this.recentImpacts.push({
          x: point.x,
          y: point.y,
          kind:
            team === "player"
              ? entry.hit
                ? "enemy-hit"
                : "miss"
              : entry.hit
                ? "player-hit"
                : "enemy-miss",
          createdAt: localCreatedAt,
        });
        this.soundEffects.playShot(team === "player" ? "player" : "enemy");
        if (entry.hit) {
          this.soundEffects.playHurt(team === "player" ? "enemy" : "player");
          if (team === "enemy") {
            this.playerHitFlashUntil = localCreatedAt + PLAYER_HIT_FLASH_MS;
            this.playerCameraKickUntil = localCreatedAt + PLAYER_CAMERA_KICK_MS;
          }
        }
      }

      if (entry.type === "reload") {
        const actor = entry.actorId === this.playerId ? "player" : "enemy";
        this.soundEffects.playReload(actor);
      }
    }
  }

  sendAction(message) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  update(timestampMs, inputState) {
    const crosshair = inputState.crosshair ?? { visible: false, x: 0, y: 0 };
    if (!this.snapshot) {
      this.lastFrameState = this.composeIdleFrame(timestampMs, crosshair);
      return this.lastFrameState;
    }

    const serverNow = Date.now() + this.serverOffsetMs;
    const you = this.snapshot.you;

    if (this.snapshot.phase === "duel" && you) {
      if (inputState.reloadPressed) {
        this.sendAction({ type: "action:reload" });
      }

      if (inputState.shootPressed) {
        const target = inputState.shotCrosshair ?? crosshair;
        this.sendAction({
          type: "action:shoot",
          x: clamp(target?.x / Math.max(1, this.width), 0, 1),
          y: clamp(target?.y / Math.max(1, this.height), 0, 1),
        });
      }
    }

    this.recentShots = trimEvents(this.recentShots, timestampMs, SHOT_TRAIL_MS);
    this.recentImpacts = trimEvents(this.recentImpacts, timestampMs, IMPACT_MARK_MS);
    this.lastFrameState = this.composeFrameState(timestampMs, crosshair, serverNow);
    return this.lastFrameState;
  }

  render(frameState = this.lastFrameState) {
    this.renderer.render(frameState);
  }

  composeIdleFrame(timestampMs, crosshair) {
    return {
      timestampMs,
      phase: PHASE.BOOT,
      winner: null,
      countdownValue: null,
      crosshair,
      maxHealth: WIN_HITS,
      playerHealth: WIN_HITS,
      enemyHealth: WIN_HITS,
      playerReloading: false,
      enemyReloading: false,
      reloadPromptVisible: false,
      reloadPromptMode: "hidden",
      playerHits: 0,
      enemyHits: 0,
      recentShots: [],
      recentImpacts: [],
      enemyCartPose: buildEnemyPose(timestampMs, {}),
      worldMotion: {
        worldPhase: buildEnemyPose(timestampMs, {}).worldPhase,
        backgroundScroll: buildEnemyPose(timestampMs, {}).backgroundScroll,
        enemyTrackLift: buildEnemyPose(timestampMs, {}).enemyTrackLift,
        playerTrackLift: buildEnemyPose(timestampMs, {}).playerTrackLift,
      },
      enemyMuzzleFlashAlpha: 0,
      playerWeaponFx: {
        muzzleFlashAlpha: 0,
        reloadProgress: 0,
      },
      playerHitFx: {
        flash: 0,
        kick: 0,
      },
      cameraBobY: Math.sin(timestampMs * 0.0051 + 0.8) * 1.4,
      hud: {
        playerHits: `0 / ${WIN_HITS}`,
        enemyHits: `0 / ${WIN_HITS}`,
        ammo: `0 / ${MAGAZINE_SIZE}`,
        reload: "Ready",
        aimRange: "Direct",
        difficulty: "Online",
        state: "Waiting",
        event: this.getStatusText(),
      },
    };
  }

  composeFrameState(timestampMs, crosshair, serverNow) {
    const you = this.snapshot.you || {};
    const opponent = this.snapshot.opponent || {};
    const playerReloading = Number(you.reloadUntil || 0) > serverNow;
    const enemyReloading = Number(opponent.reloadUntil || 0) > serverNow;
    const countdownValue =
      this.snapshot.phase === PHASE.COUNTDOWN
        ? Math.max(1, Math.ceil((Number(this.snapshot.countdownEndAt || serverNow) - serverNow) / 1000))
        : null;
    const playerReloadProgress = playerReloading
      ? clamp(
          1 -
            (Number(you.reloadUntil || 0) - serverNow) /
              Math.max(1, PLAYER_RELOAD_MS),
          0,
          1,
        )
      : 0;
    const enemyPose = buildEnemyPose(serverNow, opponent);

    return {
      timestampMs,
      phase: this.snapshot.phase,
      winner:
        this.snapshot.phase === PHASE.ROUND_OVER
          ? this.snapshot.winnerId === this.playerId
            ? "player"
            : "cpu"
          : null,
      roundOverTitle:
        this.snapshot.phase === PHASE.ROUND_OVER
          ? this.snapshot.winnerId === this.playerId
            ? "YOU WIN"
            : `${(opponent.displayName || "RIVAL").toUpperCase()} WINS`
          : "",
      roundOverSubtitle:
        this.snapshot.phase === PHASE.ROUND_OVER
          ? "Press Enter or Restart Duel"
          : "",
      countdownValue,
      crosshair,
      maxHealth: WIN_HITS,
      playerHealth: Math.max(0, WIN_HITS - Number(opponent.hitsLanded || 0)),
      enemyHealth: Math.max(0, WIN_HITS - Number(you.hitsLanded || 0)),
      playerReloading,
      enemyReloading,
      reloadPromptVisible: this.snapshot.phase === PHASE.DUEL && (playerReloading || Number(you.ammo || 0) === 0),
      reloadPromptMode: playerReloading ? "reloading" : Number(you.ammo || 0) === 0 ? "needed" : "hidden",
      playerHits: Number(you.hitsLanded || 0),
      enemyHits: Number(opponent.hitsLanded || 0),
      recentShots: this.recentShots,
      recentImpacts: this.recentImpacts,
      enemyCartPose: enemyPose,
      worldMotion: {
        worldPhase: enemyPose.worldPhase,
        backgroundScroll: enemyPose.backgroundScroll,
        enemyTrackLift: enemyPose.enemyTrackLift,
        playerTrackLift: enemyPose.playerTrackLift,
      },
      enemyMuzzleFlashAlpha: clamp((Number(opponent.lastShotAt || 0) + ENEMY_MUZZLE_FLASH_MS - serverNow) / ENEMY_MUZZLE_FLASH_MS, 0, 1),
      playerWeaponFx: {
        muzzleFlashAlpha: clamp((Number(you.lastShotAt || 0) + PLAYER_MUZZLE_FLASH_MS - serverNow) / PLAYER_MUZZLE_FLASH_MS, 0, 1),
        reloadProgress: playerReloadProgress,
      },
      playerHitFx: {
        flash: clamp((this.playerHitFlashUntil - timestampMs) / PLAYER_HIT_FLASH_MS, 0, 1),
        kick: clamp((this.playerCameraKickUntil - timestampMs) / PLAYER_CAMERA_KICK_MS, 0, 1),
      },
      cameraBobY: (enemyPose.playerTrackLift ?? 0) * 18 + Math.sin(timestampMs * 0.0051 + 0.8) * 1.4,
      hud: {
        playerHits: `${Number(you.hitsLanded || 0)} / ${WIN_HITS}`,
        enemyHits: `${Number(opponent.hitsLanded || 0)} / ${WIN_HITS}`,
        ammo: `${Number(you.ammo || 0)} / ${MAGAZINE_SIZE}`,
        reload: playerReloading ? "Reloading" : Number(you.ammo || 0) === 0 ? "Needed" : "Ready",
        aimRange: "Direct",
        difficulty: opponent.displayName || "Online",
        state:
          this.snapshot.phase === PHASE.COUNTDOWN
            ? `Countdown ${countdownValue}`
            : this.snapshot.phase === PHASE.DUEL
              ? "Live"
              : this.snapshot.phase === PHASE.ROUND_OVER
                ? "Round Over"
                : "Waiting",
        event: this.snapshot.message || this.getStatusText(),
      },
    };
  }
}
