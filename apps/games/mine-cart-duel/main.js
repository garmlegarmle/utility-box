import "./style.css";
import { DuelGame } from "./game.js";
import { HandTrackingController } from "./handTracking.js";
import { OnlineMatchController } from "./onlineMatchController.js";
import { SoundEffects } from "./soundEffects.js";

const CPU_DIFFICULTY_STORAGE_KEY = "mine-cart-duel.cpu-difficulty.v1";
const SCREEN_STABILITY_DEAD_ZONE_PX = 7;
const SCREEN_STABILITY_ALPHA = 0.12;
const SCREEN_STABILITY_FAST_ALPHA = 0.24;
const SCREEN_STABILITY_SNAP_ALPHA = 0.34;
const SCREEN_HISTORY_SIZE = 4;
const START_FLOW_VIEW = {
  MODE: "mode",
  CPU_DIFFICULTY: "cpu_difficulty",
  TUTORIAL: "tutorial",
  MATCHING: "matching",
};
const LOBBY_MODE = {
  CPU: "cpu",
  MULTI: "multiplayer",
};
const MULTI_MATCH_FOUND_DELAY_MS = 1800;
const MULTI_MATCH_START_DELAY_MS = 3200;

const canvas = document.querySelector("#game-canvas");
const video = document.querySelector("#webcam-video");
const previewPanel = document.querySelector("#preview-panel");
const previewCaption = document.querySelector("#preview-caption");
const cameraToggleButton = document.querySelector("#camera-toggle-button");
const cameraRestoreButton = document.querySelector("#camera-restore-button");
const previewVisibilityButton = document.querySelector("#preview-visibility-button");
const settingsButton = document.querySelector("#settings-button");
const settingsPanel = document.querySelector("#settings-panel");
const settingsCloseButton = document.querySelector("#settings-close-button");
const startOverlay = document.querySelector("#start-overlay");
const modePanel = document.querySelector("#mode-panel");
const cpuDifficultyPanel = document.querySelector("#cpu-difficulty-panel");
const tutorialPanel = document.querySelector("#tutorial-panel");
const matchingPanel = document.querySelector("#matching-panel");
const modeCpuButton = document.querySelector("#mode-cpu-button");
const modeMultiplayerButton = document.querySelector("#mode-multiplayer-button");
const cpuDifficultyBackButton = document.querySelector("#cpu-difficulty-back-button");
const startDifficultyButtons = [
  ...document.querySelectorAll("[data-start-difficulty]"),
];
const tutorialEyebrow = document.querySelector("#tutorial-eyebrow");
const tutorialTitle = document.querySelector("#tutorial-title");
const tutorialCopy = document.querySelector("#tutorial-copy");
const tutorialStatus = document.querySelector("#tutorial-status");
const tutorialBackButton = document.querySelector("#tutorial-back-button");
const tutorialStartButton = document.querySelector("#tutorial-start-button");
const matchingStatus = document.querySelector("#matching-status");
const matchingCopy = document.querySelector("#matching-copy");
const resetButton = document.querySelector("#reset-button");
const difficultyButtons = [
  ...document.querySelectorAll("[data-difficulty]"),
];
const playerLabel = document.querySelector("#player-label");
const enemyLabel = document.querySelector("#enemy-label");

const statNodes = {
  you: document.querySelector("#player-hits-value"),
  cpu: document.querySelector("#enemy-hits-value"),
  ammo: document.querySelector("#ammo-value"),
  reload: document.querySelector("#reload-value"),
  range: document.querySelector("#range-value"),
  state: document.querySelector("#state-value"),
  webcam: document.querySelector("#webcam-status"),
  hand: document.querySelector("#hand-status"),
  aim: document.querySelector("#aim-status"),
  duel: document.querySelector("#duel-status"),
  event: document.querySelector("#event-status"),
  debug: document.querySelector("#debug-status"),
  difficulty: document.querySelector("#difficulty-status"),
};

let cpuDifficulty = loadCpuDifficulty();
const game = new DuelGame(canvas);
game.setCpuDifficulty(cpuDifficulty);
game.setRangeReady(true);
const tracker = new HandTrackingController(video);
const soundEffects = new SoundEffects();
const onlineMatch = new OnlineMatchController(canvas, soundEffects, {
  onMatched: handleOnlineMatched,
  onMatchEnded: handleOnlineMatchEnded,
});

let latestTracking = tracker.getState();
let latestFrame = game.update(0, {
  crosshair: { visible: false, x: 0, y: 0 },
  rangeReady: true,
});
let cameraStarted = false;
let previewVisible = true;
let settingsOpen = false;
let selectedLobbyMode = null;
let pendingMatchTimeouts = [];
let screenCrosshairHistory = [];
let smoothedScreenCrosshair = null;
let lastStableScreenCrosshair = {
  visible: false,
  x: 0,
  y: 0,
};
let queuedDebugShoot = false;
let queuedDebugReload = false;
let lastLoopAt = 0;
let currentOverlayView = START_FLOW_VIEW.MODE;
let activeGameplayMode = LOBBY_MODE.CPU;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function setText(node, value) {
  node.textContent = value;
}

function loadCpuDifficulty() {
  try {
    const stored = window.localStorage.getItem(CPU_DIFFICULTY_STORAGE_KEY);
    return ["easy", "medium", "hard"].includes(stored) ? stored : "medium";
  } catch {
    return "medium";
  }
}

function saveCpuDifficulty(level) {
  window.localStorage.setItem(CPU_DIFFICULTY_STORAGE_KEY, level);
}

function resetScreenCrosshairSmoother() {
  screenCrosshairHistory = [];
  smoothedScreenCrosshair = null;
  lastStableScreenCrosshair = {
    visible: false,
    x: 0,
    y: 0,
  };
}

function stabilizeScreenCrosshair(point) {
  if (!point?.visible) {
    return point ? { ...point } : point;
  }

  screenCrosshairHistory.push(point);
  if (screenCrosshairHistory.length > SCREEN_HISTORY_SIZE) {
    screenCrosshairHistory.shift();
  }

  const averagePoint = screenCrosshairHistory.reduce(
    (accumulator, sample) => ({
      x: accumulator.x + sample.x,
      y: accumulator.y + sample.y,
    }),
    { x: 0, y: 0 },
  );
  averagePoint.x /= screenCrosshairHistory.length;
  averagePoint.y /= screenCrosshairHistory.length;

  const medianPoint = {
    x: median(screenCrosshairHistory.map((sample) => sample.x)),
    y: median(screenCrosshairHistory.map((sample) => sample.y)),
  };
  const targetPoint = {
    x: lerp(averagePoint.x, medianPoint.x, 0.72),
    y: lerp(averagePoint.y, medianPoint.y, 0.72),
  };

  if (!smoothedScreenCrosshair) {
    smoothedScreenCrosshair = { ...targetPoint };
  } else {
    const jump = Math.hypot(
      targetPoint.x - smoothedScreenCrosshair.x,
      targetPoint.y - smoothedScreenCrosshair.y,
    );

    if (jump >= SCREEN_STABILITY_DEAD_ZONE_PX) {
      const alpha =
        jump > 110
          ? SCREEN_STABILITY_SNAP_ALPHA
          : jump > 36
            ? SCREEN_STABILITY_FAST_ALPHA
            : SCREEN_STABILITY_ALPHA;
      smoothedScreenCrosshair = {
        x:
          smoothedScreenCrosshair.x +
          (targetPoint.x - smoothedScreenCrosshair.x) * alpha,
        y:
          smoothedScreenCrosshair.y +
          (targetPoint.y - smoothedScreenCrosshair.y) * alpha,
      };
    }
  }

  lastStableScreenCrosshair = {
    visible: true,
    x: smoothedScreenCrosshair.x,
    y: smoothedScreenCrosshair.y,
  };

  return {
    visible: true,
    x: smoothedScreenCrosshair.x,
    y: smoothedScreenCrosshair.y,
  };
}

function mapTrackingToScreen(tracking) {
  const crosshair = stabilizeScreenCrosshair(tracking.crosshair);
  const shotReference = lastStableScreenCrosshair.visible
    ? lastStableScreenCrosshair
    : tracking.shotCrosshair?.visible
      ? tracking.shotCrosshair
      : crosshair;

  return {
    ...tracking,
    crosshair,
    shotCrosshair: tracking.shootDetected
      ? {
          visible: true,
          x: shotReference?.x ?? 0,
          y: shotReference?.y ?? 0,
        }
      : {
          visible: false,
          x: shotReference?.x ?? 0,
          y: shotReference?.y ?? 0,
        },
  };
}

function setPreviewVisible(visible) {
  previewVisible = visible;
  const panelVisible = cameraStarted && visible;
  previewPanel.classList.toggle("is-hidden", !panelVisible);
  cameraRestoreButton.classList.toggle("is-hidden", !cameraStarted || visible);
  previewVisibilityButton.textContent = visible ? "Hide Camera" : "Show Camera";
}

function setSettingsOpen(open) {
  settingsOpen = open;
  settingsPanel.classList.toggle("is-hidden", !open);
}

function syncDifficultyButtons() {
  difficultyButtons.forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.difficulty === cpuDifficulty,
    );
  });
}

function setCpuDifficulty(level) {
  const nextDifficulty = ["easy", "medium", "hard"].includes(level)
    ? level
    : "medium";
  cpuDifficulty = nextDifficulty;
  saveCpuDifficulty(cpuDifficulty);
  game.setCpuDifficulty(cpuDifficulty);
  syncDifficultyButtons();
}

function syncLayout() {
  game.resize(window.innerWidth, window.innerHeight);
  onlineMatch.resize(window.innerWidth, window.innerHeight);
}

function updateHud(frameState) {
  playerLabel.textContent = "YOU";
  enemyLabel.textContent =
    activeGameplayMode === LOBBY_MODE.MULTI
      ? onlineMatch.getOpponentName().toUpperCase()
      : "CPU";
  setText(statNodes.you, frameState.hud.playerHits);
  setText(statNodes.cpu, frameState.hud.enemyHits);
  setText(statNodes.ammo, frameState.hud.ammo);
  setText(statNodes.reload, frameState.hud.reload);
  setText(statNodes.range, "Direct");
  setText(statNodes.state, frameState.hud.state);
  setText(statNodes.webcam, latestTracking.error || latestTracking.webcamStatus);
  setText(statNodes.hand, latestTracking.handDetected ? "Yes" : "No");
  setText(statNodes.aim, latestTracking.aimActive ? "Locked" : "Searching");
  setText(statNodes.duel, frameState.hud.state);
  setText(statNodes.event, frameState.hud.event);
  setText(statNodes.difficulty, frameState.hud.difficulty);
  setText(statNodes.debug, "Space shoot / R reload / Enter restart");

  previewCaption.textContent =
    latestTracking.error ||
    `${latestTracking.webcamStatus}. Thumb fold shoots, support-hand rack reloads.`;
}

function clearPendingMatchTimeouts() {
  pendingMatchTimeouts.forEach((timeoutId) => {
    window.clearTimeout(timeoutId);
  });
  pendingMatchTimeouts = [];
}

function setOverlayView(view) {
  currentOverlayView = view;
  modePanel.classList.toggle("is-hidden", view !== START_FLOW_VIEW.MODE);
  cpuDifficultyPanel.classList.toggle(
    "is-hidden",
    view !== START_FLOW_VIEW.CPU_DIFFICULTY,
  );
  tutorialPanel.classList.toggle("is-hidden", view !== START_FLOW_VIEW.TUTORIAL);
  matchingPanel.classList.toggle("is-hidden", view !== START_FLOW_VIEW.MATCHING);
  startOverlay.classList.remove("is-hidden");
}

function stopOnlineMatch() {
  onlineMatch.stop({ silent: true });
}

function openModeSelect() {
  clearPendingMatchTimeouts();
  stopOnlineMatch();
  selectedLobbyMode = null;
  activeGameplayMode = LOBBY_MODE.CPU;
  tutorialStartButton.disabled = false;
  tutorialStartButton.textContent = "Start Game";
  tutorialStatus.textContent =
    "Press Start Game to grant webcam permission and begin the duel.";
  matchingStatus.textContent = "상대를 찾는 중...";
  matchingCopy.textContent =
    "매칭이 완료되면 자동으로 게임 화면으로 전환됩니다.";
  setOverlayView(START_FLOW_VIEW.MODE);
}

function openCpuDifficulty() {
  clearPendingMatchTimeouts();
  stopOnlineMatch();
  selectedLobbyMode = LOBBY_MODE.CPU;
  activeGameplayMode = LOBBY_MODE.CPU;
  setOverlayView(START_FLOW_VIEW.CPU_DIFFICULTY);
}

function openTutorial(mode) {
  clearPendingMatchTimeouts();
  selectedLobbyMode = mode;
  tutorialStartButton.disabled = false;
  tutorialStartButton.textContent = "Start Game";

  if (mode === LOBBY_MODE.CPU) {
    tutorialEyebrow.textContent = "CPU Duel";
    tutorialTitle.textContent = "튜토리얼";
    tutorialCopy.textContent =
      `선택 난이도는 ${game.getCpuDifficultyLabel()}다. Start Game을 누르면 카메라 권한 요청 후 바로 결투 카운트다운이 시작된다.`;
    tutorialStatus.textContent =
      "Start Game을 누르면 카메라 권한을 요청하고 바로 결투를 시작한다.";
  } else {
    tutorialEyebrow.textContent = "Online Match";
    tutorialTitle.textContent = "멀티플레이 튜토리얼";
    tutorialCopy.textContent =
      "조작은 CPU 대전과 같다. Start Game을 누르면 카메라 권한 요청 후 실제 온라인 매칭 화면으로 이동하고, 다른 플레이어가 들어오면 바로 1대1 결투에 연결된다.";
    tutorialStatus.textContent =
      "Start Game을 누르면 카메라 권한을 요청하고 매칭을 시작한다.";
  }

  setOverlayView(START_FLOW_VIEW.TUTORIAL);
}

async function ensureMediaReady() {
  await soundEffects.unlock();

  if (!cameraStarted) {
    await tracker.start();
    cameraStarted = true;
    resetScreenCrosshairSmoother();
  }

  await soundEffects.ready();
  game.setReloadDurationMs(soundEffects.getReloadDurationMs());
  setPreviewVisible(previewVisible);
}

function startGameplayFromOverlay() {
  clearPendingMatchTimeouts();
  stopOnlineMatch();
  activeGameplayMode = LOBBY_MODE.CPU;
  startOverlay.classList.add("is-hidden");
  game.startCountdown(performance.now());
}

async function startOnlineMatchmaking() {
  clearPendingMatchTimeouts();
  setOverlayView(START_FLOW_VIEW.MATCHING);
  startOverlay.classList.remove("is-hidden");
  activeGameplayMode = LOBBY_MODE.MULTI;
  matchingStatus.textContent = "상대를 찾는 중...";
  matchingCopy.textContent =
    "다른 플레이어가 접속하면 바로 같은 광차 결투에 매칭됩니다.";

  try {
    await onlineMatch.start();
    matchingStatus.textContent = onlineMatch.getStatusText();
  } catch (error) {
    activeGameplayMode = LOBBY_MODE.CPU;
    setOverlayView(START_FLOW_VIEW.TUTORIAL);
    tutorialStatus.textContent =
      error instanceof Error
        ? error.message
        : "온라인 매치 서버에 연결하지 못했습니다.";
    tutorialStartButton.disabled = false;
    tutorialStartButton.textContent = "Retry Start Game";
  }
}

function handleOnlineMatched() {
  clearPendingMatchTimeouts();
  activeGameplayMode = LOBBY_MODE.MULTI;
  startOverlay.classList.add("is-hidden");
}

function handleOnlineMatchEnded() {
  if (selectedLobbyMode !== LOBBY_MODE.MULTI) {
    return;
  }

  activeGameplayMode = LOBBY_MODE.MULTI;
  setOverlayView(START_FLOW_VIEW.MATCHING);
  startOverlay.classList.remove("is-hidden");
  matchingStatus.textContent = onlineMatch.getStatusText();
  matchingCopy.textContent =
    "다른 플레이어가 접속하면 바로 같은 광차 결투에 다시 매칭됩니다.";
}

async function handleTutorialStart() {
  tutorialStartButton.disabled = true;
  tutorialStatus.textContent = "Requesting webcam permission...";

  try {
    await ensureMediaReady();

    if (selectedLobbyMode === LOBBY_MODE.MULTI) {
      await startOnlineMatchmaking();
      return;
    }

    startGameplayFromOverlay();
  } catch (error) {
    tutorialStatus.textContent = error.message;
    tutorialStartButton.disabled = false;
    tutorialStartButton.textContent = "Retry Start Game";
  }
}

function handleRestartDuel() {
  if (!cameraStarted) {
    openModeSelect();
    return;
  }

  if (activeGameplayMode === LOBBY_MODE.MULTI) {
    onlineMatch.requestRestart();
    return;
  }

  game.restartRound(performance.now());
}

function loop(timestampMs) {
  syncLayout();

  const rawTracking = tracker.update(timestampMs, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  latestTracking = mapTrackingToScreen(rawTracking);

  const dt = lastLoopAt ? Math.min(0.05, (timestampMs - lastLoopAt) / 1000) : 0.016;
  lastLoopAt = timestampMs;

  const commonInput = {
    dt,
    crosshair: latestTracking.crosshair,
    shotCrosshair: latestTracking.shotCrosshair,
    shootPressed: latestTracking.shootDetected || queuedDebugShoot,
    reloadPressed: latestTracking.reloadDetected || queuedDebugReload,
    rangeReady: true,
    handDetected: latestTracking.handDetected,
    aimActive: latestTracking.aimActive,
  };

  if (activeGameplayMode === LOBBY_MODE.MULTI) {
    latestFrame = onlineMatch.update(timestampMs, commonInput);
    onlineMatch.render(latestFrame);
    if (currentOverlayView === START_FLOW_VIEW.MATCHING) {
      matchingStatus.textContent = onlineMatch.getStatusText();
    }
  } else {
    latestFrame = game.update(timestampMs, commonInput);
    soundEffects.playEvents(game.consumeAudioEvents());
    game.render(latestFrame);
  }

  queuedDebugShoot = false;
  queuedDebugReload = false;
  updateHud(latestFrame);
  window.requestAnimationFrame(loop);
}

modeCpuButton.addEventListener("click", openCpuDifficulty);
modeMultiplayerButton.addEventListener("click", () => {
  openTutorial(LOBBY_MODE.MULTI);
});
cpuDifficultyBackButton.addEventListener("click", openModeSelect);
startDifficultyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setCpuDifficulty(button.dataset.startDifficulty);
    openTutorial(LOBBY_MODE.CPU);
  });
});
tutorialBackButton.addEventListener("click", () => {
  if (selectedLobbyMode === LOBBY_MODE.CPU) {
    openCpuDifficulty();
    return;
  }

  openModeSelect();
});
tutorialStartButton.addEventListener("click", handleTutorialStart);
settingsButton.addEventListener("click", () => {
  setSettingsOpen(!settingsOpen);
});
settingsCloseButton.addEventListener("click", () => {
  setSettingsOpen(false);
});
cameraToggleButton.addEventListener("click", () => {
  setPreviewVisible(false);
});
cameraRestoreButton.addEventListener("click", () => {
  setPreviewVisible(true);
});
previewVisibilityButton.addEventListener("click", () => {
  setPreviewVisible(!previewVisible);
});
difficultyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setCpuDifficulty(button.dataset.difficulty);
  });
});
resetButton.addEventListener("click", handleRestartDuel);

window.addEventListener("keydown", (event) => {
  if (event.repeat) {
    return;
  }

  if (!startOverlay.classList.contains("is-hidden")) {
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    void soundEffects.unlock();
    queuedDebugShoot = true;
    return;
  }

  if (event.code === "KeyR") {
    void soundEffects.unlock();
    queuedDebugReload = true;
    return;
  }

  if (event.code === "Enter") {
    void soundEffects.unlock();
    handleRestartDuel();
  }
});

window.addEventListener("resize", syncLayout);
window.addEventListener("beforeunload", () => {
  stopOnlineMatch();
  tracker.stop();
});

setPreviewVisible(false);
setSettingsOpen(false);
syncDifficultyButtons();
syncLayout();
updateHud(latestFrame);
openModeSelect();
window.requestAnimationFrame(loop);
