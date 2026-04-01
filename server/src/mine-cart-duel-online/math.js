export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point, segmentStart, segmentEnd) {
  const segmentVector = {
    x: segmentEnd.x - segmentStart.x,
    y: segmentEnd.y - segmentStart.y,
  };
  const lengthSquared = segmentVector.x * segmentVector.x + segmentVector.y * segmentVector.y;

  if (lengthSquared <= 0.0001) {
    return distance(point, segmentStart);
  }

  const projection = clamp(
    ((point.x - segmentStart.x) * segmentVector.x + (point.y - segmentStart.y) * segmentVector.y) / lengthSquared,
    0,
    1,
  );

  return distance(point, {
    x: segmentStart.x + segmentVector.x * projection,
    y: segmentStart.y + segmentVector.y * projection,
  });
}

function computeTrackY(baseY, x, phase, amplitude) {
  return (
    baseY +
    Math.sin(phase + x * 0.0072) * amplitude +
    Math.sin(phase * 0.58 + x * 0.0145 - 1.24) * amplitude * 0.52
  );
}

function getSceneGeometry(width, height, motion = {}) {
  const worldPhase = motion.worldPhase ?? 0;
  const backgroundScroll = motion.backgroundScroll ?? 0;
  const enemyTrack = {
    baseY: height * 0.645 + (motion.enemyTrackLift ?? 0) * height * 0.006,
    amplitude: height * 0.003,
    railGap: Math.max(8, height * 0.012),
    sleeperHeight: Math.max(14, height * 0.024),
  };
  const playerTrack = {
    baseY: height * 0.9 + (motion.playerTrackLift ?? 0) * height * 0.004,
    amplitude: height * 0.002,
    railGap: Math.max(8, height * 0.012),
    sleeperHeight: Math.max(16, height * 0.026),
  };

  return {
    horizonY: height * 0.28,
    worldPhase,
    backgroundScroll,
    enemyTrack,
    playerTrack,
  };
}

export function computeEnemyLayout(width, height, pose) {
  const geometry = getSceneGeometry(width, height, pose);
  const trackProgress = clamp(pose.trackProgress ?? 0.5, 0.12, 0.9);
  const x = lerp(width * 0.18, width * 0.7, trackProgress);
  const railY = computeTrackY(geometry.enemyTrack.baseY, x, geometry.worldPhase + 0.4, geometry.enemyTrack.amplitude);
  const scale = 0.9 + (pose.depthScale ?? 0) * 0.08;
  const bobOffset = (pose.bob ?? 0) * height * 0.012;
  const hitSlide = (pose.hitReaction ?? 0) * width * 0.022;
  const center = {
    x: x - hitSlide,
    y: railY + bobOffset - 4 * scale,
  };

  const cartWidth = 214 * scale;
  const cartHeight = 104 * scale;
  const cartRect = {
    x: center.x - cartWidth * 0.54,
    y: center.y - cartHeight,
    width: cartWidth,
    height: cartHeight,
  };
  const wheelRadius = 18 * scale;
  const wheelY = railY + wheelRadius * 0.08;
  const aimWeight = pose.aimWeight ?? 0;
  const torsoBottom = {
    x: center.x - 3 * scale - hitSlide * 0.08,
    y: cartRect.y + 16 * scale,
  };
  const torsoTop = {
    x: torsoBottom.x - aimWeight * 6 * scale - (pose.hitReaction ?? 0) * 14 * scale,
    y: cartRect.y - 78 * scale - (pose.hitReaction ?? 0) * 15 * scale,
  };
  const headCenter = {
    x: torsoTop.x + 2 * scale,
    y: torsoTop.y - 25 * scale,
  };

  const torsoCapsule = {
    a: torsoBottom,
    b: {
      x: torsoTop.x,
      y: torsoTop.y + 16 * scale,
    },
    radius: 24 * scale,
  };

  return {
    geometry,
    scale,
    center,
    railY,
    cartRect,
    wheelRadius,
    wheelY,
    headCenter,
    headRadius: 22 * scale,
    torsoBottom,
    torsoTop,
    torsoCapsule,
  };
}

export function pointInEnemyRider(point, layout) {
  if (distance(point, layout.headCenter) <= layout.headRadius) {
    return true;
  }

  return distanceToSegment(point, layout.torsoCapsule.a, layout.torsoCapsule.b) <= layout.torsoCapsule.radius;
}

export function buildEnemyPose(timestampMs, targetState = {}) {
  const seconds = timestampMs * 0.001;
  const worldPhase = seconds * 1.24;
  const backgroundScroll = seconds * 182;
  const progress = clamp(
    0.48 + Math.sin(seconds * 0.78 + 0.34) * 0.22 + Math.sin(seconds * 1.94 - 1.16) * 0.1,
    0.14,
    0.9,
  );
  const bob = Math.sin(seconds * 3.24 + 0.74) * 0.52 + Math.sin(seconds * 5.02 - 0.46) * 0.18;
  const depthScale = Math.sin(seconds * 0.86 + 1.6) * 0.6;
  const enemyTrackLift = Math.sin(seconds * 0.82 + 0.3) * 0.58 + Math.sin(seconds * 1.28 - 0.2) * 0.14;
  const playerTrackLift = Math.sin(seconds * 0.82 + 0.02) * 0.52 + Math.sin(seconds * 1.28 - 0.5) * 0.12;

  return {
    trackProgress: progress,
    bob,
    depthScale,
    worldPhase,
    backgroundScroll,
    enemyTrackLift,
    playerTrackLift,
    hitReaction: clamp((Number(targetState.hitReactionUntil || 0) - timestampMs) / 420, 0, 1),
    aimWeight:
      Number(targetState.reloadUntil || 0) > timestampMs
        ? 0.12
        : Number(targetState.lastShotAt || 0) + 180 > timestampMs
          ? 0.82
          : 0.18,
  };
}
