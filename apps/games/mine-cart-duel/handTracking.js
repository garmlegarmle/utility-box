import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-tasks/hand_landmarker/hand_landmarker.task";
const BASE_CROSSHAIR_ALPHA = 0.075;
const FAST_CROSSHAIR_ALPHA = 0.18;
const SNAP_CROSSHAIR_ALPHA = 0.3;
const DEAD_ZONE_PX = 16;
const HOLD_LAST_POSITION_MS = 950;
const RAW_HISTORY_SIZE = 8;
const MEDIAN_HISTORY_SIZE = 5;
const RAW_OUTLIER_JUMP_PX = 120;
const RAW_OUTLIER_IGNORE_PX = 240;
const SMALL_HAND_MOVE_PX = 28;
const OUTLIER_CLAMP_STEP_PX = 42;
const AIM_LOCK_THRESHOLD = 2;
const AIM_CONFIDENCE_MAX = 14;
const AIM_POSE_GRACE_MS = 850;
const THUMB_SHOT_PRIME_TIMEOUT_MS = 1200;
const THUMB_ARM_FRAMES = 2;
const THUMB_CLOSED_FRAMES = 1;
const THUMB_REARM_FRAMES = 1;
const THUMB_OPEN_MIN_SPREAD_RATIO = 0.44;
const THUMB_OPEN_MIN_CLOSURE_RATIO = 1.1;
const THUMB_OPEN_SCORE_MIN = 0.54;
const THUMB_FOLD_SCORE_MIN = 0.5;
const THUMB_STRONG_FOLD_SCORE = 0.72;
const THUMB_FOLD_HOLD_MS = 90;
const CALIBRATION_ARM_FRAMES = 1;
const CALIBRATION_REARM_FRAMES = 1;
const CALIBRATION_FOLD_HOLD_MS = 110;
const CALIBRATION_STRONG_FOLD_SCORE = 0.68;
const CALIBRATION_STRONG_FOLD_METRICS = 2;
const THUMB_FOLD_MAX_SPREAD_RATIO = 0.72;
const THUMB_FOLD_MAX_PALM_RATIO = 1.14;
const THUMB_FOLD_MAX_CLOSURE_RATIO = 1.18;
const THUMB_FOLD_MAX_BASE_RATIO = 1.08;
const THUMB_FOLD_DROP_MIN = 0.05;
const THUMB_CLOSURE_DROP_MIN = 0.16;
const THUMB_PALM_DROP_MIN = 0.07;
const THUMB_BASE_DROP_MIN = 0.15;
const RELOAD_SHOT_SUPPRESS_MS = 450;
const RELOAD_SLIDE_DEPTH_MIN_SCALE = 0.8;
const RELOAD_SLIDE_DEPTH_MAX_SCALE = 1.05;
const RELOAD_SLIDE_WIDTH_SCALE = 0.75;
const RELOAD_BACKWARD_MOVE_SCALE = 0.08;

const LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
}

function length(vector) {
  return Math.hypot(vector.x, vector.y, vector.z ?? 0);
}

function normalize(vector) {
  const magnitude = length(vector) || 1;
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: (vector.z ?? 0) / magnitude,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + (a.z ?? 0) * (b.z ?? 0);
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: (a.z ?? 0) + (b.z ?? 0) };
}

function scale(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: (vector.z ?? 0) * scalar,
  };
}

function normalize2D(vector) {
  const magnitude = Math.hypot(vector.x, vector.y) || 1;
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
  };
}

function dot2D(a, b) {
  return a.x * b.x + a.y * b.y;
}

function cross2D(a, b) {
  return a.x * b.y - a.y * b.x;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

function average(points) {
  const total = points.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x,
      y: accumulator.y + point.y,
      z: accumulator.z + (point.z ?? 0),
    }),
    { x: 0, y: 0, z: 0 },
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
    z: total.z / points.length,
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function toMirroredPoint(landmark) {
  // Mirror the tracking coordinates so they line up with the mirrored webcam preview.
  return { x: 1 - landmark.x, y: landmark.y, z: landmark.z ?? 0 };
}

function countExtendedFingers(fingers) {
  return fingers.reduce(
    (total, finger) => total + (finger.extended ? 1 : 0),
    0,
  );
}

function createAimDirection(landmarks) {
  const wristToTip = normalize(
    subtract(landmarks[LANDMARK.INDEX_TIP], landmarks[LANDMARK.WRIST]),
  );
  const wristToDip = normalize(
    subtract(landmarks[LANDMARK.INDEX_DIP], landmarks[LANDMARK.WRIST]),
  );
  const wristToPip = normalize(
    subtract(landmarks[LANDMARK.INDEX_PIP], landmarks[LANDMARK.WRIST]),
  );
  const fingerAxis = normalize(
    subtract(landmarks[LANDMARK.INDEX_TIP], landmarks[LANDMARK.INDEX_MCP]),
  );
  const midAxis = normalize(
    subtract(landmarks[LANDMARK.INDEX_DIP], landmarks[LANDMARK.INDEX_PIP]),
  );
  const tipReach = distance(
    landmarks[LANDMARK.INDEX_TIP],
    landmarks[LANDMARK.WRIST],
  );
  const dipReach = distance(
    landmarks[LANDMARK.INDEX_DIP],
    landmarks[LANDMARK.WRIST],
  );
  const tipReliable = tipReach > dipReach * 1.1;

  if (!tipReliable) {
    return normalize(
      add(
        add(scale(wristToDip, 0.62), scale(wristToPip, 0.2)),
        add(scale(midAxis, 0.12), scale(fingerAxis, 0.06)),
      ),
    );
  }

  return normalize(
    add(
      add(scale(wristToTip, 0.58), scale(fingerAxis, 0.2)),
      add(scale(wristToDip, 0.14), scale(midAxis, 0.08)),
    ),
  );
}

function createFingerMeasure(landmarks, indices, palmCenter, palmSize) {
  const mcp = landmarks[indices.mcp];
  const pip = landmarks[indices.pip];
  const dip = landmarks[indices.dip];
  const tip = landmarks[indices.tip];
  const boneLengthSum =
    distance(mcp, pip) + distance(pip, dip) + distance(dip, tip);
  const coreBoneLength = distance(mcp, pip) + distance(pip, dip);
  const reachRatio =
    boneLengthSum > 0 ? distance(mcp, tip) / boneLengthSum : 0;
  const coreReachRatio =
    coreBoneLength > 0 ? distance(mcp, dip) / coreBoneLength : 0;
  const farFromPalm =
    distance(palmCenter, tip) > distance(palmCenter, pip) + palmSize * 0.15;
  const midFarFromPalm =
    distance(palmCenter, dip) > distance(palmCenter, pip) + palmSize * 0.04;
  const baseDirection = normalize(subtract(pip, mcp));
  const midDirection = normalize(subtract(dip, pip));
  const straightness = dot(baseDirection, midDirection);

  return {
    extended:
      (reachRatio > 0.84 && farFromPalm) ||
      (coreReachRatio > 0.85 && midFarFromPalm && straightness > 0.68),
    reachRatio: Math.max(reachRatio, coreReachRatio),
    straightness,
  };
}

function createThumbMeasure(landmarks, palmCenter, palmSize) {
  const cmc = landmarks[LANDMARK.THUMB_CMC];
  const mcp = landmarks[LANDMARK.THUMB_MCP];
  const ip = landmarks[LANDMARK.THUMB_IP];
  const tip = landmarks[LANDMARK.THUMB_TIP];
  const indexMcp = landmarks[LANDMARK.INDEX_MCP];
  const segmentA = normalize(subtract(mcp, cmc));
  const segmentB = normalize(subtract(ip, mcp));
  const segmentC = normalize(subtract(tip, ip));
  const straightness = (dot(segmentA, segmentB) + dot(segmentB, segmentC)) / 2;
  const spread = distance(tip, indexMcp);
  const spreadRatio = spread / Math.max(palmSize, 0.0001);
  const tipPalmRatio = distance(tip, palmCenter) / Math.max(palmSize, 0.0001);
  const baseSpread = Math.max(distance(mcp, indexMcp), palmSize * 0.18);
  const closureRatio = spread / baseSpread;
  const tipBaseRatio = distance(tip, mcp) / baseSpread;
  const openScore =
    (
      clamp((straightness - 0.42) / 0.38, 0, 1) +
      clamp((spreadRatio - 0.42) / 0.34, 0, 1) +
      clamp((closureRatio - 1.04) / 0.34, 0, 1) +
      clamp((tipPalmRatio - 0.92) / 0.28, 0, 1) +
      clamp((tipBaseRatio - 0.96) / 0.24, 0, 1)
    ) / 5;
  const foldScore =
    (
      clamp((0.84 - spreadRatio) / 0.28, 0, 1) +
      clamp((1.18 - closureRatio) / 0.24, 0, 1) +
      clamp((1.14 - tipPalmRatio) / 0.22, 0, 1) +
      clamp((1.08 - tipBaseRatio) / 0.16, 0, 1)
    ) / 4;

  return {
    extended:
      straightness > 0.74 &&
      spreadRatio > 0.58 &&
      closureRatio > 1.34,
    openLikely:
      openScore > 0.55 ||
      (straightness > 0.52 &&
        spreadRatio > 0.42 &&
        closureRatio > 1.1),
    foldedLikely:
      foldScore > 0.52 ||
      closureRatio < 1.16 ||
      (spreadRatio < 0.74 && tipPalmRatio < 1.15) ||
      tipBaseRatio < 1.1,
    straightness,
    spreadRatio,
    tipPalmRatio,
    closureRatio,
    tipBaseRatio,
    openScore,
    foldScore,
  };
}

function estimateIndexPointerPoint(landmarks, palmSize) {
  const wrist = landmarks[LANDMARK.WRIST];
  const mcp = landmarks[LANDMARK.INDEX_MCP];
  const pip = landmarks[LANDMARK.INDEX_PIP];
  const dip = landmarks[LANDMARK.INDEX_DIP];
  const tip = landmarks[LANDMARK.INDEX_TIP];
  const baseAxis = normalize(subtract(pip, mcp));
  const midAxis = normalize(subtract(dip, pip));
  const fallbackAxis = normalize(
    add(scale(midAxis, 0.75), scale(baseAxis, 0.25)),
  );
  const extensionLength = Math.max(
    distance(tip, dip),
    distance(dip, pip) * 0.82,
    palmSize * 0.18,
  );
  const proxyTip = add(dip, scale(fallbackAxis, extensionLength));
  const tipReach = distance(tip, wrist);
  const dipReach = distance(dip, wrist);
  const tipToDip = distance(tip, dip);
  const tipReliable =
    tipReach > dipReach * 1.07 && tipToDip > palmSize * 0.12;
  const blend = tipReliable ? 0.72 : 0.18;

  return {
    point: {
      x: lerp(proxyTip.x, tip.x, blend),
      y: lerp(proxyTip.y, tip.y, blend),
      z: lerp(proxyTip.z ?? 0, tip.z ?? 0, blend),
    },
    tipReliable,
  };
}

function defaultState(webcamStatus = "Idle", error = "") {
  return {
    webcamStatus,
    handDetected: false,
    aimActive: false,
    shootDetected: false,
    calibrationCaptureDetected: false,
    reloadDetected: false,
    debugModeActive: true,
    crosshair: {
      visible: false,
      x: 0,
      y: 0,
    },
    shotCrosshair: {
      visible: false,
      x: 0,
      y: 0,
    },
    error,
  };
}

export class HandTrackingController {
  constructor(videoElement) {
    this.videoElement = videoElement;
    this.handLandmarker = null;
    this.stream = null;
    this.lastVideoTime = -1;
    this.state = defaultState();
    this.smoothedCrosshair = null;
    this.lastProjectedCrosshair = null;
    this.rawCrosshairHistory = [];
    this.lastGoodCrosshairAt = 0;
    this.aimFrameCount = 0;
    this.aimHandKey = null;
    this.lastAimCenter = null;
    this.thumbClosedFrames = 0;
    this.thumbOpenFrames = 0;
    this.thumbTriggerState = "idle";
    this.thumbShotPrimedAt = 0;
    this.thumbBaselineSpreadRatio = 0;
    this.thumbBaselineClosureRatio = 0;
    this.thumbBaselinePalmRatio = 0;
    this.thumbBaselineBaseRatio = 0;
    this.thumbClosedSince = 0;
    this.calibrationOpenFrames = 0;
    this.calibrationFoldSince = 0;
    this.calibrationCaptureLock = false;
    this.reloadLock = false;
    this.reloadGestureActive = false;
    this.shootSuppressedUntil = 0;
    this.handMotion = new Map();
  }

  resetShotTrigger() {
    this.thumbClosedFrames = 0;
    this.thumbOpenFrames = 0;
    this.thumbTriggerState = "idle";
    this.thumbShotPrimedAt = 0;
    this.thumbBaselineSpreadRatio = 0;
    this.thumbBaselineClosureRatio = 0;
    this.thumbBaselinePalmRatio = 0;
    this.thumbBaselineBaseRatio = 0;
    this.thumbClosedSince = 0;
  }

  resetCalibrationTrigger() {
    this.calibrationOpenFrames = 0;
    this.calibrationFoldSince = 0;
    this.calibrationCaptureLock = false;
  }

  clearAimState() {
    this.aimFrameCount = 0;
    this.aimHandKey = null;
    this.lastAimCenter = null;
    this.lastProjectedCrosshair = null;
    this.rawCrosshairHistory = [];
    this.reloadGestureActive = false;
    this.resetShotTrigger();
    this.resetCalibrationTrigger();
  }

  async start() {
    await this.startCamera();
    await this.initLandmarker();
    this.state.webcamStatus = "Live";
    this.state.error = "";
    return this.state;
  }

  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.state = defaultState("Unsupported", "getUserMedia is not available.");
      throw new Error("This browser does not support webcam access.");
    }

    if (this.stream) {
      return;
    }

    this.state.webcamStatus = "Requesting permission";

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch (error) {
      const message =
        error?.name === "NotAllowedError"
          ? "Webcam permission denied."
          : error?.name === "NotFoundError"
            ? "No webcam was found."
            : "Unable to open the webcam.";
      this.state = defaultState("Camera error", message);
      throw new Error(message);
    }

    this.videoElement.srcObject = this.stream;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;

    await new Promise((resolve, reject) => {
      if (this.videoElement.readyState >= 1) {
        resolve();
        return;
      }

      const cleanup = () => {
        this.videoElement.removeEventListener("loadedmetadata", onLoaded);
        this.videoElement.removeEventListener("error", onError);
      };

      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Webcam stream could not be attached to the video element."));
      };

      this.videoElement.addEventListener("loadedmetadata", onLoaded, {
        once: true,
      });
      this.videoElement.addEventListener("error", onError, { once: true });
    });

    await this.videoElement.play();
    this.state.webcamStatus = "Camera live";
  }

  async initLandmarker() {
    if (this.handLandmarker) {
      return;
    }

    this.state.webcamStatus = "Loading tracker";

    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_ASSET_PATH,
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.35,
        minHandPresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      });
    } catch (error) {
      this.state = defaultState(
        "Tracking error",
        "MediaPipe failed to load. Check your network and try again.",
      );
      throw new Error(this.state.error);
    }
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }

  getState() {
    return this.state;
  }

  update(timestampMs, viewport) {
    if (!this.handLandmarker || !this.stream || this.videoElement.readyState < 2) {
      this.state = {
        ...defaultState(this.state.webcamStatus, this.state.error),
        debugModeActive: true,
      };
      return this.state;
    }

    if (this.videoElement.currentTime === this.lastVideoTime) {
      this.state = {
        ...this.state,
        crosshair: this.resolveHeldCrosshair(
          timestampMs,
          this.state.handDetected,
          this.state.aimActive,
          false,
        ),
        shotCrosshair: {
          visible: false,
          x: this.state.crosshair.x,
          y: this.state.crosshair.y,
        },
        shootDetected: false,
        calibrationCaptureDetected: false,
        reloadDetected: false,
      };
      return this.state;
    }

    this.lastVideoTime = this.videoElement.currentTime;

    try {
      const result = this.handLandmarker.detectForVideo(
        this.videoElement,
        timestampMs,
      );
      const hands = (result.landmarks ?? []).map((landmarks, index) =>
        this.buildHandState(
          landmarks,
          result.handedness?.[index]?.[0]?.categoryName ?? `hand-${index}`,
          timestampMs,
        ),
      );

      if (hands.length === 0) {
        const canHoldAim =
          this.smoothedCrosshair &&
          timestampMs - this.lastGoodCrosshairAt <= HOLD_LAST_POSITION_MS;

        this.reloadGestureActive = false;
        this.reloadLock = false;
        this.resetShotTrigger();
        this.resetCalibrationTrigger();

        if (!canHoldAim) {
          this.clearAimState();
        } else {
          this.aimFrameCount = Math.max(
            AIM_LOCK_THRESHOLD,
            this.aimFrameCount - 1,
          );
        }

        this.state = {
          webcamStatus: "Live",
          handDetected: false,
          aimActive: canHoldAim,
          shootDetected: false,
          calibrationCaptureDetected: false,
          reloadDetected: false,
          debugModeActive: true,
          crosshair: this.resolveHeldCrosshair(
            timestampMs,
            false,
            canHoldAim,
            false,
          ),
          shotCrosshair: {
            visible: false,
            x: this.smoothedCrosshair?.x ?? 0,
            y: this.smoothedCrosshair?.y ?? 0,
          },
          error: "",
        };
        return this.state;
      }

      const aimHand = this.selectAimHand(hands);
      if (!aimHand) {
        const canHoldAim =
          this.smoothedCrosshair &&
          timestampMs - this.lastGoodCrosshairAt <= AIM_POSE_GRACE_MS &&
          this.aimHandKey;

        this.reloadGestureActive = false;
        this.reloadLock = false;
        this.resetShotTrigger();
        this.resetCalibrationTrigger();

        if (canHoldAim) {
          this.aimFrameCount = Math.max(
            AIM_LOCK_THRESHOLD,
            this.aimFrameCount - 1,
          );
        } else {
          this.aimFrameCount = Math.max(0, this.aimFrameCount - 2);
          if (this.aimFrameCount === 0) {
            this.aimHandKey = null;
            this.lastAimCenter = null;
            this.lastProjectedCrosshair = null;
            this.rawCrosshairHistory = [];
          }
        }
      } else if (aimHand.key !== this.aimHandKey) {
        this.aimHandKey = aimHand.key;
        this.lastAimCenter = aimHand.center;
        this.aimFrameCount = aimHand.gunPose ? AIM_LOCK_THRESHOLD : 1;
        this.resetShotTrigger();
        this.resetCalibrationTrigger();
        this.lastProjectedCrosshair = null;
        this.rawCrosshairHistory = [];
      } else if (aimHand.gunPose) {
        this.lastAimCenter = aimHand.center;
        this.aimFrameCount = Math.min(
          AIM_CONFIDENCE_MAX,
          this.aimFrameCount + 2,
        );
      } else if (aimHand.aimRelaxedPose) {
        this.lastAimCenter = aimHand.center;
        this.aimFrameCount = Math.min(
          AIM_CONFIDENCE_MAX,
          this.aimFrameCount + 1,
        );
      } else {
        this.aimFrameCount = Math.max(0, this.aimFrameCount - 2);
        if (this.aimFrameCount === 0) {
          this.aimHandKey = null;
          this.lastAimCenter = null;
          this.lastProjectedCrosshair = null;
          this.rawCrosshairHistory = [];
        }
      }

      const aimActive = this.aimFrameCount >= AIM_LOCK_THRESHOLD;

      let crosshair = this.resolveHeldCrosshair(
        timestampMs,
        hands.length > 0,
        aimActive,
        false,
      );
      let shotCrosshair = {
        visible: false,
        x: this.smoothedCrosshair?.x ?? crosshair.x,
        y: this.smoothedCrosshair?.y ?? crosshair.y,
      };
      if (aimActive && aimHand) {
        const rawCrosshair = this.deriveCrosshair(aimHand, viewport);
        const preRecoilCrosshair = this.smoothedCrosshair
          ? {
              visible: true,
              x: this.smoothedCrosshair.x,
              y: this.smoothedCrosshair.y,
            }
          : {
              visible: true,
              x: rawCrosshair.x,
              y: rawCrosshair.y,
            };

        const handMotionPx = Math.hypot(
          aimHand.moveVector.x * viewport.width,
          aimHand.moveVector.y * viewport.height,
        );
        crosshair = this.smoothCrosshair(rawCrosshair, handMotionPx);
        this.lastGoodCrosshairAt = timestampMs;
        shotCrosshair = preRecoilCrosshair;
      }

      const reloadDetected = this.detectReload(hands, aimHand, timestampMs);
      const calibrationCaptureDetected = this.detectCalibrationCapture(
        aimHand,
        aimActive,
        timestampMs,
      );
      const shootDetected = this.detectThumbShot(
        aimHand,
        aimActive,
        timestampMs,
      );

      this.state = {
        webcamStatus: "Live",
        handDetected: hands.length > 0,
        aimActive,
        shootDetected,
        calibrationCaptureDetected,
        reloadDetected,
        debugModeActive: true,
        crosshair,
        shotCrosshair: shootDetected
          ? {
              visible: true,
              x: shotCrosshair.x,
              y: shotCrosshair.y,
            }
          : {
              visible: false,
              x: shotCrosshair.x,
              y: shotCrosshair.y,
            },
        error: "",
      };
      return this.state;
    } catch (error) {
      this.state = defaultState(
        "Tracking error",
        "Hand tracking failed for the current frame.",
      );
      return this.state;
    }
  }

  detectThumbShot(aimHand, aimActive, timestampMs) {
    const canContinueTrigger =
      aimHand && (aimActive || this.thumbTriggerState !== "idle");
    if (
      !canContinueTrigger ||
      this.reloadGestureActive ||
      timestampMs < this.shootSuppressedUntil
    ) {
      this.resetShotTrigger();
      return false;
    }

    const openScore = aimHand.thumb.openScore ?? 0;
    const foldScore = aimHand.thumb.foldScore ?? 0;
    const openStable =
      aimHand.indexLikelyExtended &&
      aimHand.supportExtendedLikelyCount <= 1 &&
      (
        aimHand.gunPose ||
        aimHand.thumb.openLikely ||
        (
          openScore >= THUMB_OPEN_SCORE_MIN &&
          aimHand.thumb.spreadRatio >= THUMB_OPEN_MIN_SPREAD_RATIO &&
          aimHand.thumb.closureRatio >= THUMB_OPEN_MIN_CLOSURE_RATIO
        )
      );
    const closedMetricCount = [
      aimHand.thumb.spreadRatio <= THUMB_FOLD_MAX_SPREAD_RATIO,
      aimHand.thumb.tipPalmRatio <= THUMB_FOLD_MAX_PALM_RATIO,
      aimHand.thumb.closureRatio <= THUMB_FOLD_MAX_CLOSURE_RATIO,
      aimHand.thumb.tipBaseRatio <= THUMB_FOLD_MAX_BASE_RATIO,
    ].filter(Boolean).length;
    const closedStable =
      aimHand.indexLikelyExtended &&
      aimHand.supportExtendedLikelyCount <= 1 &&
      (
        aimHand.thumbFoldPose ||
        aimHand.thumb.foldedLikely ||
        foldScore >= THUMB_FOLD_SCORE_MIN ||
        closedMetricCount >= 2
      );

    if (closedStable) {
      this.thumbClosedFrames += 1;
      this.thumbOpenFrames = 0;
      if (!this.thumbClosedSince) {
        this.thumbClosedSince = timestampMs;
      }
    } else if (openStable) {
      this.thumbOpenFrames += 1;
      this.thumbClosedFrames = 0;
      this.thumbClosedSince = 0;
      this.thumbBaselineSpreadRatio = Math.max(
        this.thumbBaselineSpreadRatio,
        aimHand.thumb.spreadRatio,
      );
      this.thumbBaselineClosureRatio = Math.max(
        this.thumbBaselineClosureRatio,
        aimHand.thumb.closureRatio,
      );
      this.thumbBaselinePalmRatio = Math.max(
        this.thumbBaselinePalmRatio,
        aimHand.thumb.tipPalmRatio,
      );
      this.thumbBaselineBaseRatio = Math.max(
        this.thumbBaselineBaseRatio,
        aimHand.thumb.tipBaseRatio,
      );
    } else {
      this.thumbClosedFrames = Math.max(0, this.thumbClosedFrames - 1);
      this.thumbOpenFrames = Math.max(0, this.thumbOpenFrames - 1);
      this.thumbClosedSince = 0;
    }

    if (
      this.thumbTriggerState !== "idle" &&
      timestampMs - this.thumbShotPrimedAt > THUMB_SHOT_PRIME_TIMEOUT_MS
    ) {
      this.resetShotTrigger();
    }

    if (this.thumbTriggerState === "idle") {
      if (this.thumbOpenFrames < THUMB_ARM_FRAMES) {
        return false;
      }

      this.thumbTriggerState = "armed";
      this.thumbShotPrimedAt = timestampMs;
      return false;
    }

    if (this.thumbTriggerState === "fired") {
      if (
        openStable &&
        (
          this.thumbOpenFrames >= THUMB_REARM_FRAMES ||
          openScore >= THUMB_OPEN_SCORE_MIN + 0.08
        )
      ) {
        this.resetShotTrigger();
      }
      return false;
    }

    if (openStable) {
      this.thumbShotPrimedAt = timestampMs;
    }

    const spreadDrop =
      this.thumbBaselineSpreadRatio - aimHand.thumb.spreadRatio;
    const closureDrop =
      this.thumbBaselineClosureRatio - aimHand.thumb.closureRatio;
    const palmDrop =
      this.thumbBaselinePalmRatio - aimHand.thumb.tipPalmRatio;
    const baseDrop =
      this.thumbBaselineBaseRatio - aimHand.thumb.tipBaseRatio;
    const foldHoldMs = this.thumbClosedSince
      ? timestampMs - this.thumbClosedSince
      : 0;
    const foldConfirmed =
      closedStable &&
      this.thumbClosedFrames >= THUMB_CLOSED_FRAMES &&
      (
        foldScore >= THUMB_STRONG_FOLD_SCORE ||
        foldHoldMs >= THUMB_FOLD_HOLD_MS ||
        spreadDrop >= THUMB_FOLD_DROP_MIN ||
        closureDrop >= THUMB_CLOSURE_DROP_MIN ||
        palmDrop >= THUMB_PALM_DROP_MIN ||
        baseDrop >= THUMB_BASE_DROP_MIN
      );
    if (
      this.thumbTriggerState === "armed" &&
      foldConfirmed
    ) {
      this.thumbTriggerState = "fired";
      this.thumbClosedFrames = 0;
      this.thumbOpenFrames = 0;
      this.thumbClosedSince = 0;
      this.thumbShotPrimedAt = timestampMs;
      return true;
    }

    return false;
  }

  detectCalibrationCapture(aimHand, aimActive, timestampMs) {
    if (
      !aimHand ||
      !aimActive ||
      this.reloadGestureActive ||
      timestampMs < this.shootSuppressedUntil
    ) {
      this.resetCalibrationTrigger();
      return false;
    }

    const openScore = aimHand.thumb.openScore ?? 0;
    const foldScore = aimHand.thumb.foldScore ?? 0;
    const openStable =
      aimHand.indexLikelyExtended &&
      aimHand.supportExtendedLikelyCount <= 1 &&
      (
        aimHand.gunPose ||
        aimHand.thumb.openLikely ||
        openScore >= THUMB_OPEN_SCORE_MIN
      );
    const closedMetricCount = [
      aimHand.thumb.spreadRatio <= THUMB_FOLD_MAX_SPREAD_RATIO,
      aimHand.thumb.tipPalmRatio <= THUMB_FOLD_MAX_PALM_RATIO,
      aimHand.thumb.closureRatio <= THUMB_FOLD_MAX_CLOSURE_RATIO,
      aimHand.thumb.tipBaseRatio <= THUMB_FOLD_MAX_BASE_RATIO,
    ].filter(Boolean).length;
    const strongFold =
      aimHand.indexLikelyExtended &&
      aimHand.supportExtendedLikelyCount <= 1 &&
      (
        aimHand.thumbFoldPose ||
        aimHand.thumb.foldedLikely ||
        foldScore >= CALIBRATION_STRONG_FOLD_SCORE ||
        closedMetricCount >= CALIBRATION_STRONG_FOLD_METRICS
      );

    if (this.calibrationCaptureLock) {
      if (openStable) {
        this.calibrationOpenFrames += 1;
        if (this.calibrationOpenFrames >= CALIBRATION_REARM_FRAMES) {
          this.calibrationCaptureLock = false;
          this.calibrationFoldSince = 0;
        }
      } else {
        this.calibrationOpenFrames = 0;
      }
      return false;
    }

    if (openStable) {
      this.calibrationOpenFrames += 1;
    } else {
      this.calibrationOpenFrames = Math.max(0, this.calibrationOpenFrames - 1);
      this.calibrationFoldSince = 0;
    }

    if (this.calibrationOpenFrames < CALIBRATION_ARM_FRAMES || !strongFold) {
      return false;
    }

    if (!this.calibrationFoldSince) {
      this.calibrationFoldSince = timestampMs;
      return false;
    }

    if (timestampMs - this.calibrationFoldSince < CALIBRATION_FOLD_HOLD_MS) {
      return false;
    }

    this.calibrationCaptureLock = true;
    this.calibrationOpenFrames = 0;
    this.calibrationFoldSince = 0;
    return true;
  }

  buildHandState(landmarks, key, timestampMs) {
    const mirrored = landmarks.map(toMirroredPoint);
    const palmCenter = average([
      mirrored[LANDMARK.WRIST],
      mirrored[LANDMARK.INDEX_MCP],
      mirrored[LANDMARK.MIDDLE_MCP],
      mirrored[LANDMARK.RING_MCP],
      mirrored[LANDMARK.PINKY_MCP],
    ]);
    const palmSize = Math.max(
      distance(mirrored[LANDMARK.INDEX_MCP], mirrored[LANDMARK.PINKY_MCP]),
      0.0001,
    );
    const thumb = createThumbMeasure(mirrored, palmCenter, palmSize);
    const index = createFingerMeasure(
      mirrored,
      {
        mcp: LANDMARK.INDEX_MCP,
        pip: LANDMARK.INDEX_PIP,
        dip: LANDMARK.INDEX_DIP,
        tip: LANDMARK.INDEX_TIP,
      },
      palmCenter,
      palmSize,
    );
    const middle = createFingerMeasure(
      mirrored,
      {
        mcp: LANDMARK.MIDDLE_MCP,
        pip: LANDMARK.MIDDLE_PIP,
        dip: LANDMARK.MIDDLE_DIP,
        tip: LANDMARK.MIDDLE_TIP,
      },
      palmCenter,
      palmSize,
    );
    const ring = createFingerMeasure(
      mirrored,
      {
        mcp: LANDMARK.RING_MCP,
        pip: LANDMARK.RING_PIP,
        dip: LANDMARK.RING_DIP,
        tip: LANDMARK.RING_TIP,
      },
      palmCenter,
      palmSize,
    );
    const pinky = createFingerMeasure(
      mirrored,
      {
        mcp: LANDMARK.PINKY_MCP,
        pip: LANDMARK.PINKY_PIP,
        dip: LANDMARK.PINKY_DIP,
        tip: LANDMARK.PINKY_TIP,
      },
      palmCenter,
      palmSize,
    );
    const indexLikelyExtended =
      index.extended || (index.reachRatio > 0.79 && index.straightness > 0.6);
    const middleLikelyExtended =
      middle.extended || (middle.reachRatio > 0.81 && middle.straightness > 0.66);
    const ringLikelyExtended =
      ring.extended || (ring.reachRatio > 0.81 && ring.straightness > 0.66);
    const pinkyLikelyExtended =
      pinky.extended || (pinky.reachRatio > 0.8 && pinky.straightness > 0.64);
    const supportExtendedLikelyCount = [
      middleLikelyExtended,
      ringLikelyExtended,
      pinkyLikelyExtended,
    ].filter(Boolean).length;
    const extendedCount = countExtendedFingers([thumb, index, middle, ring, pinky]);
    const gunPose =
      indexLikelyExtended &&
      thumb.openLikely &&
      supportExtendedLikelyCount === 0;
    const thumbFoldPose =
      indexLikelyExtended &&
      thumb.foldedLikely &&
      supportExtendedLikelyCount === 0;
    const aimRelaxedPose =
      gunPose ||
      thumbFoldPose ||
      (indexLikelyExtended &&
        supportExtendedLikelyCount <= 1 &&
        (thumb.openLikely || thumb.foldedLikely || thumb.straightness > 0.42));
    const pointerTipEstimate = estimateIndexPointerPoint(mirrored, palmSize);
    const gripOrigin = add(
      scale(mirrored[LANDMARK.WRIST], 0.76),
      add(
        scale(mirrored[LANDMARK.INDEX_MCP], 0.18),
        scale(mirrored[LANDMARK.INDEX_PIP], 0.06),
      ),
    );
    const center = average([
      mirrored[LANDMARK.WRIST],
      mirrored[LANDMARK.INDEX_MCP],
      mirrored[LANDMARK.MIDDLE_MCP],
      mirrored[LANDMARK.RING_MCP],
      mirrored[LANDMARK.PINKY_MCP],
    ]);
    const motion = this.handMotion.get(key);
    const history = motion?.history ?? [];
    const previous = history[history.length - 1];
    const nextHistory = [...history.slice(-(RAW_HISTORY_SIZE - 1)), {
      gripOrigin,
      center,
      timestampMs,
    }];
    const oldest = nextHistory[0];
    const deltaY = previous ? previous.gripOrigin.y - gripOrigin.y : 0;
    const moveUpBurst = oldest ? oldest.gripOrigin.y - gripOrigin.y : deltaY;
    const sideBurst = oldest ? Math.abs(oldest.gripOrigin.x - gripOrigin.x) : 0;
    this.handMotion.set(key, { history: nextHistory, center, timestampMs });
    const moveVector = previous
      ? {
          x: center.x - previous.center.x,
          y: center.y - previous.center.y,
        }
      : { x: 0, y: 0 };

    return {
      key,
      mirrored,
      palmCenter,
      palmSize,
      gripOrigin,
      center,
      wrist: mirrored[LANDMARK.WRIST],
      pointerTip: pointerTipEstimate.point,
      pointerTipReliable: pointerTipEstimate.tipReliable,
      thumbTip: mirrored[LANDMARK.THUMB_TIP],
      thumbMcp: mirrored[LANDMARK.THUMB_MCP],
      indexMcp: mirrored[LANDMARK.INDEX_MCP],
      thumb,
      index,
      middle,
      ring,
      pinky,
      extendedCount,
      indexLikelyExtended,
      supportExtendedLikelyCount,
      gunPose,
      thumbFoldPose,
      aimRelaxedPose,
      aimDirection: createAimDirection(mirrored),
      moveUpDelta: deltaY,
      moveUpBurst,
      sideBurst,
      motionFrames: nextHistory.length,
      moveVector,
    };
  }

  selectAimHand(hands) {
    const currentTracked = hands.find(
      (hand) => hand.key === this.aimHandKey && hand.aimRelaxedPose,
    );
    if (currentTracked) {
      return currentTracked;
    }

    if (this.lastAimCenter) {
      const nearPreviousAim = hands
        .filter((hand) => hand.aimRelaxedPose)
        .map((hand) => ({
          hand,
          distanceFromLastAim: distance(hand.center, this.lastAimCenter),
        }))
        .sort((left, right) => left.distanceFromLastAim - right.distanceFromLastAim);

      if (
        nearPreviousAim.length > 0 &&
        nearPreviousAim[0].distanceFromLastAim <=
          Math.max(0.18, nearPreviousAim[0].hand.palmSize * 2.4)
      ) {
        return nearPreviousAim[0].hand;
      }
    }

    const candidateHands = hands.filter((hand) => hand.aimRelaxedPose);
    if (candidateHands.length === 0) {
      return null;
    }

    return candidateHands.sort((left, right) => {
      const leftScore =
        (left.gunPose ? 3 : 0) +
        (left.thumb.openLikely ? 1.3 : 0) +
        left.index.reachRatio -
        left.supportExtendedLikelyCount * 0.35;
      const rightScore =
        (right.gunPose ? 3 : 0) +
        (right.thumb.openLikely ? 1.3 : 0) +
        right.index.reachRatio -
        right.supportExtendedLikelyCount * 0.35;
      return rightScore - leftScore;
    })[0];
  }

  detectReload(hands, aimHand, timestampMs) {
    if (!aimHand) {
      this.reloadLock = false;
      this.reloadGestureActive = false;
      return false;
    }

    const supportHands = hands.filter((hand) => hand.key !== aimHand.key);
    if (supportHands.length === 0) {
      this.reloadLock = false;
      this.reloadGestureActive = false;
      return false;
    }

    const aimAxis = normalize2D({
      x: aimHand.aimDirection.x,
      y: aimHand.aimDirection.y,
    });
    const backwardAxis = {
      x: -aimAxis.x,
      y: -aimAxis.y,
    };
    const slideAnchor = average([
      aimHand.thumbTip,
      aimHand.thumbMcp,
      aimHand.indexMcp,
    ]);
    const depthMin = -aimHand.palmSize * RELOAD_SLIDE_DEPTH_MIN_SCALE;
    const depthMax = aimHand.palmSize * RELOAD_SLIDE_DEPTH_MAX_SCALE;
    const widthMax = aimHand.palmSize * RELOAD_SLIDE_WIDTH_SCALE;
    const backwardMoveThreshold = Math.max(
      0.012,
      aimHand.palmSize * RELOAD_BACKWARD_MOVE_SCALE,
    );

    const slideCandidates = supportHands.map((hand) => {
      const relative = {
        x: hand.center.x - slideAnchor.x,
        y: hand.center.y - slideAnchor.y,
      };
      const alongAxis = dot2D(relative, aimAxis);
      const perpendicularDistance = Math.abs(cross2D(relative, aimAxis));
      const backwardMove = dot2D(hand.moveVector, backwardAxis);
      const overThumbBand =
        hand.center.y <= aimHand.gripOrigin.y + aimHand.palmSize * 0.55;
      const inSlideZone =
        alongAxis >= depthMin &&
        alongAxis <= depthMax &&
        perpendicularDistance <= widthMax &&
        overThumbBand;

      return {
        inSlideZone,
        slideRack: inSlideZone && backwardMove > backwardMoveThreshold,
      };
    });

    const inSlideZone = slideCandidates.some((candidate) => candidate.inSlideZone);
    const slideRack = slideCandidates.some((candidate) => candidate.slideRack);
    this.reloadGestureActive = inSlideZone;

    if (slideRack && !this.reloadLock) {
      this.reloadLock = true;
      this.resetShotTrigger();
      this.shootSuppressedUntil = timestampMs + RELOAD_SHOT_SUPPRESS_MS;
      return true;
    }

    if (!inSlideZone) {
      this.reloadLock = false;
      this.reloadGestureActive = false;
    }

    return false;
  }

  deriveCrosshair(hand, viewport) {
    // Keep fingertip aiming, but replace shaky/occluded tip frames with a joint-based fingertip proxy.
    const tip = hand.pointerTip ?? hand.mirrored[LANDMARK.INDEX_TIP];

    return {
      visible: true,
      x: clamp(tip.x, 0.01, 0.99) * viewport.width,
      y: clamp(tip.y, 0.01, 0.99) * viewport.height,
    };
  }

  smoothCrosshair(nextPoint, handMotionPx = 0) {
    let stabilizedPoint = nextPoint;
    if (this.lastProjectedCrosshair) {
      const rawJump = Math.hypot(
        nextPoint.x - this.lastProjectedCrosshair.x,
        nextPoint.y - this.lastProjectedCrosshair.y,
      );

      if (
        rawJump >= RAW_OUTLIER_IGNORE_PX &&
        handMotionPx <= SMALL_HAND_MOVE_PX * 0.8
      ) {
        stabilizedPoint = { ...this.lastProjectedCrosshair };
      } else if (
        rawJump >= RAW_OUTLIER_JUMP_PX &&
        handMotionPx <= SMALL_HAND_MOVE_PX
      ) {
        const ratio = Math.min(
          1,
          OUTLIER_CLAMP_STEP_PX / Math.max(rawJump, 1),
        );
        stabilizedPoint = {
          x:
            this.lastProjectedCrosshair.x +
            (nextPoint.x - this.lastProjectedCrosshair.x) * ratio,
          y:
            this.lastProjectedCrosshair.y +
            (nextPoint.y - this.lastProjectedCrosshair.y) * ratio,
        };
      }
    }

    this.lastProjectedCrosshair = { ...stabilizedPoint };
    this.rawCrosshairHistory.push(stabilizedPoint);
    if (this.rawCrosshairHistory.length > RAW_HISTORY_SIZE) {
      this.rawCrosshairHistory.shift();
    }

    const weightedPoint = this.rawCrosshairHistory.reduce(
      (accumulator, point, index) => {
        const weight = index + 1;
        return {
          x: accumulator.x + point.x * weight,
          y: accumulator.y + point.y * weight,
          totalWeight: accumulator.totalWeight + weight,
        };
      },
      { x: 0, y: 0, totalWeight: 0 },
    );
    const averagedPoint = {
      x: weightedPoint.x / weightedPoint.totalWeight,
      y: weightedPoint.y / weightedPoint.totalWeight,
    };
    const medianWindow = this.rawCrosshairHistory.slice(-MEDIAN_HISTORY_SIZE);
    const medianPoint = {
      x: median(medianWindow.map((point) => point.x)),
      y: median(medianWindow.map((point) => point.y)),
    };
    const targetPoint = {
      x: lerp(averagedPoint.x, medianPoint.x, 0.62),
      y: lerp(averagedPoint.y, medianPoint.y, 0.62),
    };

    if (!this.smoothedCrosshair) {
      this.smoothedCrosshair = { x: targetPoint.x, y: targetPoint.y };
    } else {
      const jump = Math.hypot(
        targetPoint.x - this.smoothedCrosshair.x,
        targetPoint.y - this.smoothedCrosshair.y,
      );

      if (jump >= DEAD_ZONE_PX) {
        const alpha =
          handMotionPx > 85 || jump > 180
            ? SNAP_CROSSHAIR_ALPHA
            : handMotionPx > 42 || jump > 90
              ? FAST_CROSSHAIR_ALPHA
              : BASE_CROSSHAIR_ALPHA;
        // Weighted averaging plus adaptive smoothing removes hand jitter without making large aim corrections feel stuck.
        this.smoothedCrosshair = {
          x:
            this.smoothedCrosshair.x +
            (targetPoint.x - this.smoothedCrosshair.x) * alpha,
          y:
            this.smoothedCrosshair.y +
            (targetPoint.y - this.smoothedCrosshair.y) * alpha,
        };
      }
    }

    return {
      visible: true,
      x: this.smoothedCrosshair.x,
      y: this.smoothedCrosshair.y,
    };
  }

  resolveHeldCrosshair(timestampMs, handDetected, aimActive, shootPose) {
    const canHold =
      this.smoothedCrosshair &&
      timestampMs - this.lastGoodCrosshairAt <= HOLD_LAST_POSITION_MS;

    if ((aimActive || !handDetected || shootPose) && canHold) {
      return {
        visible: true,
        x: this.smoothedCrosshair.x,
        y: this.smoothedCrosshair.y,
      };
    }

    return {
      visible: false,
      x: this.smoothedCrosshair?.x ?? 0,
      y: this.smoothedCrosshair?.y ?? 0,
    };
  }
}
