function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

export const CPU_DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const DIFFICULTY_PRESETS = {
  easy: {
    label: "Easy",
    telegraphMinMs: 520,
    telegraphMaxMs: 920,
    shotGapMinMs: 1120,
    shotGapMaxMs: 1760,
    aimBase: 0.4,
    aimJitter: 0.14,
    aimMin: 0.28,
    aimMax: 0.68,
    pressureBonusScale: 0.01,
    setbackPenaltyScale: 0.008,
    reloadBonus: 0.03,
    idleAimWeight: 0.1,
    warmupAimWeight: 0.24,
    telegraphFloor: 0.18,
    reloadAimWeight: 0.16,
    hitBase: 0.12,
    hitAimScale: 0.12,
    hitReloadBonus: 0.03,
    hitMin: 0.1,
    hitMax: 0.32,
  },
  medium: {
    label: "Medium",
    telegraphMinMs: 420,
    telegraphMaxMs: 760,
    shotGapMinMs: 920,
    shotGapMaxMs: 1520,
    aimBase: 0.48,
    aimJitter: 0.2,
    aimMin: 0.34,
    aimMax: 0.82,
    pressureBonusScale: 0.012,
    setbackPenaltyScale: 0.009,
    reloadBonus: 0.045,
    idleAimWeight: 0.11,
    warmupAimWeight: 0.26,
    telegraphFloor: 0.2,
    reloadAimWeight: 0.17,
    hitBase: 0.16,
    hitAimScale: 0.15,
    hitReloadBonus: 0.04,
    hitMin: 0.13,
    hitMax: 0.42,
  },
  hard: {
    label: "Hard",
    telegraphMinMs: 360,
    telegraphMaxMs: 620,
    shotGapMinMs: 760,
    shotGapMaxMs: 1320,
    aimBase: 0.56,
    aimJitter: 0.24,
    aimMin: 0.42,
    aimMax: 0.96,
    pressureBonusScale: 0.015,
    setbackPenaltyScale: 0.01,
    reloadBonus: 0.06,
    idleAimWeight: 0.12,
    warmupAimWeight: 0.28,
    telegraphFloor: 0.22,
    reloadAimWeight: 0.18,
    hitBase: 0.23,
    hitAimScale: 0.22,
    hitReloadBonus: 0.06,
    hitMin: 0.2,
    hitMax: 0.58,
  },
};

function getPreset(level) {
  return DIFFICULTY_PRESETS[level] ?? DIFFICULTY_PRESETS.hard;
}

export class CpuOpponentController {
  constructor(difficulty = "hard") {
    this.setDifficulty(difficulty);
    this.reset(0);
  }

  setDifficulty(level) {
    this.difficulty = DIFFICULTY_PRESETS[level] ? level : "hard";
    this.preset = getPreset(this.difficulty);
  }

  getDifficulty() {
    return this.difficulty;
  }

  getDifficultyLabel() {
    return this.preset.label;
  }

  getDifficultyProfile() {
    return this.preset;
  }

  reset(timestampMs = 0) {
    this.telegraphStartedAt = 0;
    this.telegraphUntil = 0;
    this.cooldownUntil = timestampMs + 900;
    this.shotQueued = false;
    this.currentAimWeight = this.preset.idleAimWeight;
  }

  cancelTelegraph(timestampMs) {
    this.telegraphStartedAt = 0;
    this.telegraphUntil = 0;
    this.shotQueued = false;
    this.currentAimWeight = this.preset.idleAimWeight;
    this.cooldownUntil = Math.max(this.cooldownUntil, timestampMs + 220);
  }

  beginTelegraph(timestampMs, duelState) {
    const duration = randomBetween(
      this.preset.telegraphMinMs,
      this.preset.telegraphMaxMs,
    );
    const pressureBonus =
      duelState.enemyHits * this.preset.pressureBonusScale;
    const setbackPenalty =
      duelState.playerHits * this.preset.setbackPenaltyScale;
    const reloadBonus = duelState.playerReloading
      ? this.preset.reloadBonus
      : 0;

    this.currentAimWeight = clamp(
      this.preset.aimBase +
        Math.random() * this.preset.aimJitter +
        pressureBonus -
        setbackPenalty +
        reloadBonus,
      this.preset.aimMin,
      this.preset.aimMax,
    );
    this.telegraphStartedAt = timestampMs;
    this.telegraphUntil = timestampMs + duration;
    this.shotQueued = false;
  }

  update(timestampMs, duelState) {
    if (duelState.phase !== "duel") {
      this.currentAimWeight = this.preset.idleAimWeight;
      return {
        wantsShoot: false,
        wantsReload: false,
        aimWeight: this.preset.idleAimWeight,
      };
    }

    if (duelState.enemyReloading || duelState.enemyStunned) {
      this.cancelTelegraph(timestampMs);
      return {
        wantsShoot: false,
        wantsReload: false,
        aimWeight: this.preset.reloadAimWeight,
      };
    }

    if (duelState.enemyAmmo <= 0) {
      this.cancelTelegraph(timestampMs);
      return {
        wantsShoot: false,
        wantsReload: true,
        aimWeight: this.preset.reloadAimWeight,
      };
    }

    if (this.telegraphUntil > 0 && timestampMs < this.telegraphUntil) {
      const progress = clamp(
        (timestampMs - this.telegraphStartedAt) /
          Math.max(1, this.telegraphUntil - this.telegraphStartedAt),
        0,
        1,
      );
      return {
        wantsShoot: false,
        wantsReload: false,
        aimWeight: clamp(
          this.preset.telegraphFloor + this.currentAimWeight * progress,
          this.preset.telegraphFloor,
          1,
        ),
      };
    }

    if (this.telegraphUntil > 0 && !this.shotQueued) {
      this.shotQueued = true;
      const aimWeight = this.currentAimWeight;
      this.telegraphStartedAt = 0;
      this.telegraphUntil = 0;
      this.cooldownUntil =
        timestampMs +
        randomBetween(this.preset.shotGapMinMs, this.preset.shotGapMaxMs);

      return {
        wantsShoot: true,
        wantsReload: false,
        aimWeight,
      };
    }

    if (timestampMs >= this.cooldownUntil) {
      this.beginTelegraph(timestampMs, duelState);
      return {
        wantsShoot: false,
        wantsReload: false,
        aimWeight: this.preset.warmupAimWeight,
      };
    }

    return {
      wantsShoot: false,
      wantsReload: false,
      aimWeight: this.preset.idleAimWeight + 0.02,
    };
  }
}
