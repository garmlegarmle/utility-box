export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point, segmentStart, segmentEnd) {
  const segmentVector = {
    x: segmentEnd.x - segmentStart.x,
    y: segmentEnd.y - segmentStart.y,
  };
  const lengthSquared =
    segmentVector.x * segmentVector.x + segmentVector.y * segmentVector.y;

  if (lengthSquared <= 0.0001) {
    return distance(point, segmentStart);
  }

  const projection = clamp(
    ((point.x - segmentStart.x) * segmentVector.x +
      (point.y - segmentStart.y) * segmentVector.y) /
      lengthSquared,
    0,
    1,
  );

  return distance(point, {
    x: segmentStart.x + segmentVector.x * projection,
    y: segmentStart.y + segmentVector.y * projection,
  });
}

export function computeTrackY(baseY, x, phase, amplitude) {
  return (
    baseY +
    Math.sin(phase + x * 0.0072) * amplitude +
    Math.sin(phase * 0.58 + x * 0.0145 - 1.24) * amplitude * 0.52
  );
}

export function getSceneGeometry(width, height, motion = {}) {
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
  const railY = computeTrackY(
    geometry.enemyTrack.baseY,
    x,
    geometry.worldPhase + 0.4,
    geometry.enemyTrack.amplitude,
  );
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
  const shoulder = {
    x: torsoTop.x + 10 * scale,
    y: torsoTop.y + 12 * scale,
  };
  const gunHand = {
    x: shoulder.x + 28 * scale + aimWeight * 8 * scale,
    y: shoulder.y + 14 * scale,
  };
  const muzzle = {
    x: gunHand.x + 20 * scale,
    y: gunHand.y + 2 * scale,
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
    shoulder,
    gunHand,
    muzzle,
    frontWheel: {
      x: cartRect.x + cartRect.width * 0.26,
      y: wheelY,
    },
    rearWheel: {
      x: cartRect.x + cartRect.width * 0.78,
      y: wheelY,
    },
  };
}

export function pointInEnemyRider(point, layout) {
  const insideHead = distance(point, layout.headCenter) <= layout.headRadius;
  if (insideHead) {
    return true;
  }

  return (
    distanceToSegment(point, layout.torsoCapsule.a, layout.torsoCapsule.b) <=
    layout.torsoCapsule.radius
  );
}

export function getPlayerWeaponAnchor(width, height, motion = {}) {
  const geometry = getSceneGeometry(width, height, motion);
  const gripX = width * 0.72;
  const railY = computeTrackY(
    geometry.playerTrack.baseY,
    gripX,
    geometry.worldPhase + 0.86,
    geometry.playerTrack.amplitude,
  );

  return {
    railY,
    grip: { x: width * 0.77, y: railY - 48 },
    muzzle: { x: width * 0.665, y: railY - 228 },
  };
}

export function getPlayerCartLip(width, height, motion = {}) {
  const geometry = getSceneGeometry(width, height, motion);
  const leftX = width * 0.08;
  const rightX = width * 0.92;
  const leftY = computeTrackY(
    geometry.playerTrack.baseY,
    leftX,
    geometry.worldPhase + 0.86,
    geometry.playerTrack.amplitude,
  );
  const rightY = computeTrackY(
    geometry.playerTrack.baseY,
    rightX,
    geometry.worldPhase + 0.86,
    geometry.playerTrack.amplitude,
  );
  const lipTopLeft = {
    x: width * 0.18,
    y: leftY - 34,
  };
  const lipTopRight = {
    x: width * 0.86,
    y: rightY - 38,
  };

  return [
    lipTopLeft,
    lipTopRight,
    { x: width * 0.93, y: rightY + 10 },
    { x: width * 0.12, y: leftY + 16 },
  ];
}

export function getPlayerImpactPoint(width, height, seed = 0, motion = {}) {
  const anchor = getPlayerWeaponAnchor(width, height, motion);
  const wobbleX = Math.sin(seed * 1.73) * width * 0.03;
  const wobbleY = Math.cos(seed * 1.11) * height * 0.028;
  return {
    x: width * 0.54 + wobbleX,
    y: anchor.railY - height * 0.16 + wobbleY,
  };
}
