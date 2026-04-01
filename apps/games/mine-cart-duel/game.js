import { CpuOpponentController } from "./opponentController.js";
import {
  clamp,
  computeEnemyLayout,
  getPlayerImpactPoint,
  pointInEnemyRider,
} from "./sceneMath.js";
import { SketchRenderer } from "./sketchRenderer.js";

const PHASE = {
  BOOT: "boot",
  AIM_RANGE_SETUP: "aim_range_setup",
  COUNTDOWN: "countdown",
  DUEL: "duel",
  ROUND_OVER: "round_over",
};

const MAGAZINE_SIZE = 6;
const WIN_HITS = 5;
const PLAYER_RELOAD_MS = 920;
const ENEMY_RELOAD_MS = 1220;
const PLAYER_SHOT_COOLDOWN_MS = 320;
const ENEMY_SHOT_COOLDOWN_MS = 460;
const COUNTDOWN_MS = 3000;
const PLAYER_MUZZLE_FLASH_MS = 110;
const ENEMY_MUZZLE_FLASH_MS = 110;
const ENEMY_HIT_REACT_MS = 420;
const ENEMY_STUN_MS = 560;
const PLAYER_HIT_FLASH_MS = 280;
const PLAYER_CAMERA_KICK_MS = 180;
const SHOT_TRAIL_MS = 170;
const IMPACT_MARK_MS = 620;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

export class DuelGame {
  constructor(canvasElement) {
    this.renderer = new SketchRenderer(canvasElement);
    this.cpuController = new CpuOpponentController();
    this.width = 0;
    this.height = 0;
    this.phase = PHASE.BOOT;
    this.rangeReady = true;
    this.playerHits = 0;
    this.enemyHits = 0;
    this.playerAmmo = MAGAZINE_SIZE;
    this.enemyAmmo = MAGAZINE_SIZE;
    this.playerReloadDurationMs = PLAYER_RELOAD_MS;
    this.enemyReloadDurationMs = ENEMY_RELOAD_MS;
    this.playerReloadUntil = 0;
    this.enemyReloadUntil = 0;
    this.playerShotCooldownUntil = 0;
    this.enemyShotCooldownUntil = 0;
    this.playerMuzzleFlashUntil = 0;
    this.enemyMuzzleFlashUntil = 0;
    this.enemyHitReactUntil = 0;
    this.enemyStunUntil = 0;
    this.playerHitFlashUntil = 0;
    this.playerCameraKickUntil = 0;
    this.countdownEndAt = 0;
    this.winner = null;
    this.lastMessage = "Start camera to duel";
    this.recentShots = [];
    this.recentImpacts = [];
    this.enemyAimWeight = 0.12;
    this.enemyCartPose = this.buildEnemyPose(0);
    this.pendingAudioEvents = [];
    this.lastFrameState = this.composeFrameState(0, {
      visible: false,
      x: 0,
      y: 0,
    });
  }

  setCpuDifficulty(level) {
    this.cpuController.setDifficulty(level);
  }

  setReloadDurationMs(durationMs) {
    const safeDuration = Math.max(300, Math.round(durationMs || PLAYER_RELOAD_MS));
    this.playerReloadDurationMs = safeDuration;
    this.enemyReloadDurationMs = safeDuration;
  }

  getCpuDifficulty() {
    return this.cpuController.getDifficulty();
  }

  getCpuDifficultyLabel() {
    return this.cpuController.getDifficultyLabel();
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.renderer.resize(width, height);
  }

  beginAimRangeSetup() {
    this.phase = PHASE.AIM_RANGE_SETUP;
    this.lastMessage = "Trace your reachable corners";
  }

  setRangeReady(ready) {
    this.rangeReady = true;
  }

  startCountdown(timestampMs) {
    this.resetRoundState(timestampMs);
    this.phase = PHASE.COUNTDOWN;
    this.countdownEndAt = timestampMs + COUNTDOWN_MS;
    this.lastMessage = "Duel starts in 3";
  }

  restartRound(timestampMs) {
    this.startCountdown(timestampMs);
  }

  consumeAudioEvents() {
    const events = [...this.pendingAudioEvents];
    this.pendingAudioEvents.length = 0;
    return events;
  }

  getPhase() {
    return this.phase;
  }

  isRoundOver() {
    return this.phase === PHASE.ROUND_OVER;
  }

  update(timestampMs, inputState) {
    const crosshair = inputState.crosshair ?? {
      visible: false,
      x: 0,
      y: 0,
    };
    this.rangeReady = inputState.rangeReady ?? this.rangeReady;
    this.enemyCartPose = this.buildEnemyPose(timestampMs);
    this.updateTimers(timestampMs);

    switch (this.phase) {
      case PHASE.COUNTDOWN:
        if (timestampMs >= this.countdownEndAt) {
          this.phase = PHASE.DUEL;
          this.lastMessage = "Draw";
        }
        break;
      case PHASE.DUEL:
        this.handlePlayerInput(timestampMs, inputState);
        this.handleCpuTurn(timestampMs);
        this.checkRoundEnd();
        break;
      default:
        break;
    }

    this.trimTransientEffects(timestampMs);
    this.lastFrameState = this.composeFrameState(timestampMs, crosshair);
    return this.lastFrameState;
  }

  render(frameState = this.lastFrameState) {
    this.renderer.render(frameState);
  }

  resetRoundState(timestampMs) {
    this.phase = PHASE.COUNTDOWN;
    this.playerHits = 0;
    this.enemyHits = 0;
    this.playerAmmo = MAGAZINE_SIZE;
    this.enemyAmmo = MAGAZINE_SIZE;
    this.playerReloadUntil = 0;
    this.enemyReloadUntil = 0;
    this.playerShotCooldownUntil = timestampMs;
    this.enemyShotCooldownUntil = timestampMs;
    this.playerMuzzleFlashUntil = 0;
    this.enemyMuzzleFlashUntil = 0;
    this.enemyHitReactUntil = 0;
    this.enemyStunUntil = 0;
    this.playerHitFlashUntil = 0;
    this.playerCameraKickUntil = 0;
    this.winner = null;
    this.recentShots = [];
    this.recentImpacts = [];
    this.enemyAimWeight = 0.12;
    this.pendingAudioEvents = [];
    this.cpuController.reset(timestampMs);
  }

  queueAudioEvent(type, payload = {}) {
    this.pendingAudioEvents.push({
      type,
      ...payload,
    });
  }

  updateTimers(timestampMs) {
    if (this.playerReloadUntil > 0 && timestampMs >= this.playerReloadUntil) {
      this.playerReloadUntil = 0;
      this.playerAmmo = MAGAZINE_SIZE;
      this.lastMessage = "장전 완료 / Reloaded";
    }

    if (this.enemyReloadUntil > 0 && timestampMs >= this.enemyReloadUntil) {
      this.enemyReloadUntil = 0;
      this.enemyAmmo = MAGAZINE_SIZE;
      this.lastMessage = "상대 장전 완료 / CPU Reloaded";
    }
  }

  handlePlayerInput(timestampMs, inputState) {
    if (inputState.reloadPressed) {
      this.tryStartPlayerReload(timestampMs);
    }

    if (inputState.shootPressed) {
      this.tryPlayerShot(timestampMs, inputState.shotCrosshair ?? inputState.crosshair);
    }
  }

  handleCpuTurn(timestampMs) {
    const command = this.cpuController.update(timestampMs, {
      phase: this.phase,
      enemyAmmo: this.enemyAmmo,
      enemyReloading: this.isEnemyReloading(timestampMs),
      enemyStunned: this.isEnemyStunned(timestampMs),
      playerReloading: this.isPlayerReloading(timestampMs),
      enemyHits: this.enemyHits,
      playerHits: this.playerHits,
    });
    this.enemyAimWeight = command.aimWeight;

    if (command.wantsReload) {
      this.tryStartEnemyReload(timestampMs);
      return;
    }

    if (command.wantsShoot) {
      this.fireEnemyShot(timestampMs, command.aimWeight);
    }
  }

  tryStartPlayerReload(timestampMs) {
    if (this.phase !== PHASE.DUEL) {
      return;
    }

    if (this.isPlayerReloading(timestampMs)) {
      this.lastMessage = "장전중 / Reloading";
      return;
    }

    if (this.playerAmmo === MAGAZINE_SIZE) {
      this.lastMessage = "Cylinder full";
      return;
    }

    this.playerReloadUntil = timestampMs + this.playerReloadDurationMs;
    this.lastMessage = "장전중 / Reloading";
    this.queueAudioEvent("reload", { actor: "player" });
  }

  tryStartEnemyReload(timestampMs) {
    if (this.phase !== PHASE.DUEL || this.isEnemyReloading(timestampMs)) {
      return;
    }

    this.enemyReloadUntil = timestampMs + this.enemyReloadDurationMs;
    this.lastMessage = "상대 장전중 / CPU Reloading";
    this.queueAudioEvent("reload", { actor: "enemy" });
  }

  tryPlayerShot(timestampMs, crosshair) {
    if (this.phase !== PHASE.DUEL) {
      return;
    }

    if (timestampMs < this.playerShotCooldownUntil) {
      return;
    }

    if (this.isPlayerReloading(timestampMs)) {
      this.lastMessage = "Reloading...";
      return;
    }

    if (this.playerAmmo <= 0) {
      this.lastMessage = "Empty. Reload";
      return;
    }

    this.playerAmmo -= 1;
    this.playerShotCooldownUntil = timestampMs + PLAYER_SHOT_COOLDOWN_MS;
    this.playerMuzzleFlashUntil = timestampMs + PLAYER_MUZZLE_FLASH_MS;
    this.queueAudioEvent("shot", { actor: "player" });

    const targetPoint = crosshair?.visible
      ? { x: crosshair.x, y: crosshair.y }
      : { x: this.width * 0.5, y: this.height * 0.5 };
    const enemyLayout = computeEnemyLayout(
      this.width,
      this.height,
      this.enemyCartPose,
    );
    const hit =
      crosshair?.visible &&
      this.pointHitsEnemyRider(targetPoint, enemyLayout);

    this.recentShots.push({
      team: "player",
      to: targetPoint,
      createdAt: timestampMs,
      hit,
    });

    this.recentImpacts.push({
      x: targetPoint.x,
      y: targetPoint.y,
      kind: hit ? "enemy-hit" : "miss",
      createdAt: timestampMs,
    });

    if (hit) {
      this.playerHits += 1;
      this.enemyHitReactUntil = timestampMs + ENEMY_HIT_REACT_MS;
      this.enemyStunUntil = timestampMs + ENEMY_STUN_MS;
      this.cpuController.cancelTelegraph(timestampMs);
      this.lastMessage = "CPU hit";
      this.queueAudioEvent("hurt", { actor: "enemy" });
    } else {
      this.lastMessage = "Missed";
    }

    if (this.playerAmmo === 0 && this.phase === PHASE.DUEL) {
      this.lastMessage = hit ? "CPU hit. Reload now" : "Empty. Reload";
    }
  }

  fireEnemyShot(timestampMs, aimWeight) {
    if (this.phase !== PHASE.DUEL) {
      return;
    }

    if (timestampMs < this.enemyShotCooldownUntil) {
      return;
    }

    if (this.isEnemyReloading(timestampMs) || this.isEnemyStunned(timestampMs)) {
      return;
    }

    if (this.enemyAmmo <= 0) {
      this.tryStartEnemyReload(timestampMs);
      return;
    }

    this.enemyAmmo -= 1;
    this.enemyShotCooldownUntil = timestampMs + ENEMY_SHOT_COOLDOWN_MS;
    this.enemyMuzzleFlashUntil = timestampMs + ENEMY_MUZZLE_FLASH_MS;
    this.queueAudioEvent("shot", { actor: "enemy" });

    const difficultyLevel = this.getCpuDifficulty();
    const difficulty = this.cpuController.getDifficultyProfile();
    const hitChance = clamp(
      difficulty.hitBase +
        aimWeight * difficulty.hitAimScale +
        (this.isPlayerReloading(timestampMs) ? difficulty.hitReloadBonus : 0),
      difficulty.hitMin,
      difficulty.hitMax,
    );
    const hit = Math.random() < hitChance;
    const missSpreadX =
      difficultyLevel === "easy"
        ? [0.26, 0.84]
        : difficultyLevel === "medium"
          ? [0.3, 0.81]
          : [0.32, 0.78];
    const missSpreadY =
      difficultyLevel === "easy"
        ? [0.44, 0.9]
        : difficultyLevel === "medium"
          ? [0.46, 0.87]
          : [0.48, 0.84];
    const impactPoint = hit
      ? getPlayerImpactPoint(
          this.width,
          this.height,
          timestampMs * 0.001,
          this.enemyCartPose,
        )
      : {
          x: this.width * randomBetween(missSpreadX[0], missSpreadX[1]),
          y: this.height * randomBetween(missSpreadY[0], missSpreadY[1]),
        };

    this.recentShots.push({
      team: "enemy",
      to: impactPoint,
      createdAt: timestampMs,
      hit,
    });
    this.recentImpacts.push({
      x: impactPoint.x,
      y: impactPoint.y,
      kind: hit ? "player-hit" : "enemy-miss",
      createdAt: timestampMs,
    });

    if (hit) {
      this.enemyHits += 1;
      this.playerHitFlashUntil = timestampMs + PLAYER_HIT_FLASH_MS;
      this.playerCameraKickUntil = timestampMs + PLAYER_CAMERA_KICK_MS;
      this.lastMessage = "CPU landed a hit";
      this.queueAudioEvent("hurt", { actor: "player" });
    } else {
      this.lastMessage = "CPU missed";
    }
  }

  checkRoundEnd() {
    if (this.playerHits >= WIN_HITS) {
      this.phase = PHASE.ROUND_OVER;
      this.winner = "player";
      this.lastMessage = "You win the duel";
      return;
    }

    if (this.enemyHits >= WIN_HITS) {
      this.phase = PHASE.ROUND_OVER;
      this.winner = "cpu";
      this.lastMessage = "CPU wins the duel";
    }
  }

  trimTransientEffects(timestampMs) {
    this.recentShots = this.recentShots.filter(
      (shot) => timestampMs - shot.createdAt <= SHOT_TRAIL_MS,
    );
    this.recentImpacts = this.recentImpacts.filter(
      (impact) => timestampMs - impact.createdAt <= IMPACT_MARK_MS,
    );
  }

  isPlayerReloading(timestampMs) {
    return this.playerReloadUntil > timestampMs;
  }

  isEnemyReloading(timestampMs) {
    return this.enemyReloadUntil > timestampMs;
  }

  isEnemyStunned(timestampMs) {
    return this.enemyStunUntil > timestampMs;
  }

  buildEnemyPose(timestampMs) {
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
        (this.enemyHitReactUntil - timestampMs) / ENEMY_HIT_REACT_MS,
        0,
        1,
      ),
      aimWeight: this.enemyAimWeight,
    };
  }

  pointHitsEnemyRider(point, enemyLayout) {
    return pointInEnemyRider(point, enemyLayout);
  }

  composeFrameState(timestampMs, crosshair) {
    const countdownValue =
      this.phase === PHASE.COUNTDOWN
        ? Math.max(1, Math.ceil((this.countdownEndAt - timestampMs) / 1000))
        : null;
    const playerReloading = this.isPlayerReloading(timestampMs);
    const enemyReloading = this.isEnemyReloading(timestampMs);
    const playerReloadProgress = playerReloading
      ? clamp(
          1 - (this.playerReloadUntil - timestampMs) / this.playerReloadDurationMs,
          0,
          1,
        )
      : 0;
    const playerFlash = clamp(
      (this.playerHitFlashUntil - timestampMs) / PLAYER_HIT_FLASH_MS,
      0,
      1,
    );
    const playerKick = clamp(
      (this.playerCameraKickUntil - timestampMs) / PLAYER_CAMERA_KICK_MS,
      0,
      1,
    );

    return {
      timestampMs,
      phase: this.phase,
      winner: this.winner,
      countdownValue,
      crosshair,
      maxHealth: WIN_HITS,
      playerHealth: Math.max(0, WIN_HITS - this.enemyHits),
      enemyHealth: Math.max(0, WIN_HITS - this.playerHits),
      playerReloading,
      enemyReloading,
      reloadPromptVisible: this.phase === PHASE.DUEL && (playerReloading || this.playerAmmo === 0),
      reloadPromptMode: playerReloading ? "reloading" : this.playerAmmo === 0 ? "needed" : "hidden",
      playerHits: this.playerHits,
      enemyHits: this.enemyHits,
      recentShots: this.recentShots,
      recentImpacts: this.recentImpacts,
      enemyCartPose: this.enemyCartPose,
      worldMotion: {
        worldPhase: this.enemyCartPose.worldPhase,
        backgroundScroll: this.enemyCartPose.backgroundScroll,
        enemyTrackLift: this.enemyCartPose.enemyTrackLift,
        playerTrackLift: this.enemyCartPose.playerTrackLift,
      },
      enemyMuzzleFlashAlpha: clamp(
        (this.enemyMuzzleFlashUntil - timestampMs) / ENEMY_MUZZLE_FLASH_MS,
        0,
        1,
      ),
      playerWeaponFx: {
        muzzleFlashAlpha: clamp(
          (this.playerMuzzleFlashUntil - timestampMs) / PLAYER_MUZZLE_FLASH_MS,
          0,
          1,
        ),
        reloadProgress: playerReloadProgress,
      },
      playerHitFx: {
        flash: playerFlash,
        kick: playerKick,
      },
      cameraBobY:
        (this.enemyCartPose.playerTrackLift ?? 0) * 18 +
        Math.sin(timestampMs * 0.0051 + 0.8) * 1.4,
      hud: {
        playerHits: `${this.playerHits} / ${WIN_HITS}`,
        enemyHits: `${this.enemyHits} / ${WIN_HITS}`,
        ammo: `${this.playerAmmo} / ${MAGAZINE_SIZE}`,
        reload: playerReloading
          ? "Reloading"
          : this.playerAmmo === 0
            ? "Needed"
            : "Ready",
        aimRange: "Direct",
        difficulty: this.getCpuDifficultyLabel(),
        state: this.getRoundStateLabel(timestampMs),
        event: this.getEventMessage(timestampMs),
      },
    };
  }

  getEventMessage(timestampMs) {
    if (this.isPlayerReloading(timestampMs)) {
      return "장전중 / Reloading";
    }

    if (this.isEnemyReloading(timestampMs)) {
      return "상대 장전중 / CPU Reloading";
    }

    return this.lastMessage;
  }

  getRoundStateLabel(timestampMs) {
    switch (this.phase) {
      case PHASE.BOOT:
        return "Start Camera";
      case PHASE.AIM_RANGE_SETUP:
        return "Aim Range Setup";
      case PHASE.COUNTDOWN:
        return `Countdown ${Math.max(
          1,
          Math.ceil((this.countdownEndAt - timestampMs) / 1000),
        )}`;
      case PHASE.DUEL:
        if (this.isPlayerReloading(timestampMs)) {
          return "Reloading";
        }
        if (this.isEnemyReloading(timestampMs)) {
          return "CPU Reloading";
        }
        return "Live";
      case PHASE.ROUND_OVER:
        return this.winner === "player" ? "You Win" : "CPU Wins";
      default:
        return "Idle";
    }
  }
}
