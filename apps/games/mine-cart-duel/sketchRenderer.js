import {
  clamp,
  computeEnemyLayout,
  computeTrackY,
  getPlayerCartLip,
  getPlayerWeaponAnchor,
  getSceneGeometry,
  lerp,
} from "./sceneMath.js";
import { assetUrl } from "./assetPaths.js";

const ART_BACKGROUND_SRC = assetUrl("art/background.png");
const ART_PLAYER_SRC = assetUrl("art/player-layer.png");
const ART_ENEMY_SRC = assetUrl("art/enemy-layer.png");

const ENEMY_ART_METRICS = {
  cartWidth: 1110,
  wheelCenterY: 888,
  scaleBoost: 1.04,
};

const PLAYER_ART_METRICS = {
  muzzleX: 996,
  muzzleY: 340,
  scaleMultiplier: 0.92,
};

function noiseAt(x, y) {
  const seed = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return seed - Math.floor(seed);
}

function roughLine(context, from, to, options = {}) {
  const passes = options.passes ?? 2;
  const wobble = options.wobble ?? 1.6;
  const lineWidth = options.lineWidth ?? 1.4;
  const strokeStyle = options.strokeStyle ?? "rgba(36, 35, 33, 0.7)";

  context.save();
  context.strokeStyle = strokeStyle;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (let pass = 0; pass < passes; pass += 1) {
    const offsetX = (noiseAt(from.x + pass, to.x) - 0.5) * wobble;
    const offsetY = (noiseAt(from.y, to.y + pass) - 0.5) * wobble;
    context.lineWidth = lineWidth * (1 - pass * 0.1);
    context.beginPath();
    context.moveTo(from.x + offsetX, from.y + offsetY);
    context.lineTo(to.x - offsetX * 0.55, to.y - offsetY * 0.55);
    context.stroke();
  }

  context.restore();
}

function roughPolyline(context, points, options = {}) {
  for (let index = 0; index < points.length - 1; index += 1) {
    roughLine(context, points[index], points[index + 1], options);
  }
}

function roughCircle(context, center, radius, options = {}) {
  const steps = 18;
  const points = [];

  for (let index = 0; index <= steps; index += 1) {
    const angle = (Math.PI * 2 * index) / steps;
    const drift = 1 + (noiseAt(center.x + index, center.y) - 0.5) * 0.12;
    points.push({
      x: center.x + Math.cos(angle) * radius * drift,
      y: center.y + Math.sin(angle) * radius * drift,
    });
  }

  roughPolyline(context, points, options);
}

function roughRect(context, x, y, width, height, options = {}) {
  const corners = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
    { x, y },
  ];
  roughPolyline(context, corners, options);
}

function fillPolygon(context, points, fillStyle) {
  context.save();
  context.fillStyle = fillStyle;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
  context.fill();
  context.restore();
}

function hatchRect(context, x, y, width, height, options = {}) {
  const spacing = options.spacing ?? 12;
  const inset = options.inset ?? 4;
  const slope = options.slope ?? 0.34;
  const strokeStyle = options.strokeStyle ?? "rgba(52, 47, 41, 0.16)";
  const lineWidth = options.lineWidth ?? 1;

  context.save();
  context.beginPath();
  context.rect(x + inset, y + inset, width - inset * 2, height - inset * 2);
  context.clip();

  for (let offset = -height; offset <= width + height; offset += spacing) {
    roughLine(
      context,
      {
        x: x + inset + offset,
        y: y + height - inset,
      },
      {
        x: x + inset + offset + height * slope,
        y: y + inset,
      },
      {
        strokeStyle,
        lineWidth,
        wobble: 1.1,
      },
    );
  }

  context.restore();
}

function sampleTrackPolyline(width, track, phase, step = 28) {
  const points = [];
  for (let x = -step; x <= width + step; x += step) {
    points.push({
      x,
      y: computeTrackY(track.baseY, x, phase, track.amplitude),
    });
  }
  return points;
}

export class SketchRenderer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.context = canvasElement.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.paperLayer = document.createElement("canvas");
    this.artLayers = {
      background: this.createArtLayer(ART_BACKGROUND_SRC),
      player: this.createArtLayer(ART_PLAYER_SRC),
      enemy: this.createArtLayer(ART_ENEMY_SRC),
    };
  }

  createArtLayer(src) {
    const image = new Image();
    image.decoding = "async";

    const layer = {
      src,
      image,
      loaded: false,
      failed: false,
    };

    image.addEventListener("load", () => {
      layer.loaded = true;
    });
    image.addEventListener("error", () => {
      layer.failed = true;
    });
    image.src = src;
    return layer;
  }

  hasLayerArt() {
    return (
      this.artLayers.background.loaded &&
      this.artLayers.player.loaded &&
      this.artLayers.enemy.loaded
    );
  }

  resize(width, height) {
    this.width = width;
    this.height = height;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.paperLayer.width = Math.max(1, Math.round(width));
    this.paperLayer.height = Math.max(1, Math.round(height));
    this.buildPaperLayer();
  }

  buildPaperLayer() {
    const context = this.paperLayer.getContext("2d");
    context.clearRect(0, 0, this.paperLayer.width, this.paperLayer.height);
    context.fillStyle = "#f6f1e7";
    context.fillRect(0, 0, this.paperLayer.width, this.paperLayer.height);

    for (let y = 0; y < this.paperLayer.height; y += 8) {
      const alpha = 0.022 + noiseAt(y, this.paperLayer.width) * 0.018;
      context.strokeStyle = `rgba(92, 84, 71, ${alpha})`;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, y + (noiseAt(y, 2) - 0.5) * 2);
      context.lineTo(
        this.paperLayer.width,
        y + (noiseAt(y, 9) - 0.5) * 3,
      );
      context.stroke();
    }

    for (let index = 0; index < 300; index += 1) {
      const x = noiseAt(index, 13) * this.paperLayer.width;
      const y = noiseAt(index, 29) * this.paperLayer.height;
      const alpha = 0.02 + noiseAt(index, 41) * 0.025;
      context.fillStyle = `rgba(70, 62, 54, ${alpha})`;
      context.fillRect(x, y, 1, 1);
    }

    for (let index = 0; index < 12; index += 1) {
      const x = noiseAt(index, 83) * this.paperLayer.width;
      const y = noiseAt(index, 97) * this.paperLayer.height;
      const radius = 44 + noiseAt(index, 113) * 90;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "rgba(82, 74, 63, 0.025)");
      gradient.addColorStop(1, "rgba(82, 74, 63, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
  }

  render(frameState) {
    if (!this.width || !this.height) {
      return;
    }

    const context = this.context;
    const worldMotion = frameState.worldMotion ?? frameState.enemyCartPose ?? {};
    const geometry = getSceneGeometry(this.width, this.height, worldMotion);
    const cameraOffsetY =
      frameState.cameraBobY -
      frameState.playerHitFx.kick * this.height * 0.024;

    context.clearRect(0, 0, this.width, this.height);
    if (this.hasLayerArt()) {
      this.drawLayerBackground(worldMotion);
      context.save();
      context.translate(0, cameraOffsetY);
      this.drawLayerEnemy(frameState);
      this.drawEnemyHealthBar(frameState);
      this.drawShotTraces(frameState, worldMotion);
      this.drawImpacts(frameState);
      this.drawLayerPlayer(frameState, worldMotion);
      context.restore();
    } else {
      context.drawImage(this.paperLayer, 0, 0, this.width, this.height);
      context.save();
      context.translate(0, cameraOffsetY);
      this.drawScenery(geometry, worldMotion);
      this.drawTracks(geometry);
      this.drawEnemy(frameState);
      this.drawEnemyHealthBar(frameState);
      this.drawPlayerCart(geometry, worldMotion);
      this.drawShotTraces(frameState, worldMotion);
      this.drawImpacts(frameState);
      this.drawPlayerWeapon(frameState, worldMotion);
      context.restore();
    }

    if (frameState.crosshair?.visible) {
      this.drawCrosshair(frameState.crosshair);
    }

    this.drawPlayerHealthBar(frameState);
    this.drawReloadPrompt(frameState);
    this.drawPlayerHitFx(frameState);
    this.drawOverlay(frameState);
  }

  drawLayerBackground(worldMotion) {
    const image = this.artLayers.background.image;
    const context = this.context;
    const baseScale =
      Math.max(this.width / image.width, this.height / image.height) * 1.06;
    const drawWidth = image.width * baseScale;
    const drawHeight = image.height * baseScale;
    const overflowX = Math.max(0, drawWidth - this.width);
    const overflowY = Math.max(0, drawHeight - this.height);
    const panX =
      overflowX > 0
        ? Math.sin((worldMotion.backgroundScroll ?? 0) * 0.0034) *
          overflowX *
          0.42
        : 0;
    const bobY =
      overflowY > 0
        ? Math.sin((worldMotion.worldPhase ?? 0) * 0.48) * overflowY * 0.06
        : 0;
    const drawX = -overflowX * 0.5 + panX;
    const drawY = -overflowY * 0.42 + bobY;

    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

    context.save();
    context.globalCompositeOperation = "multiply";
    context.globalAlpha = 0.18;
    context.drawImage(this.paperLayer, 0, 0, this.width, this.height);
    context.restore();
  }

  drawLayerEnemy(frameState) {
    const image = this.artLayers.enemy.image;
    const layout = computeEnemyLayout(
      this.width,
      this.height,
      frameState.enemyCartPose,
    );
    const scale =
      (layout.cartRect.width / ENEMY_ART_METRICS.cartWidth) *
      ENEMY_ART_METRICS.scaleBoost;
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = layout.center.x - drawWidth * 0.5;
    const drawY = layout.wheelY - ENEMY_ART_METRICS.wheelCenterY * scale;

    this.drawCartShadow(layout.cartRect, layout.scale * 1.2);

    this.context.save();
    this.context.globalAlpha = 1;
    this.context.drawImage(
      image,
      drawX + drawWidth,
      drawY,
      -drawWidth,
      drawHeight,
    );
    this.context.restore();

    this.drawDustCloud(
      {
        x: layout.rearWheel.x - 38 * layout.scale,
        y: layout.wheelY + 16 * layout.scale,
      },
      20 * layout.scale,
      0.15,
    );

    if (frameState.enemyMuzzleFlashAlpha > 0.01) {
      this.drawMuzzleFlash(
        layout.muzzle,
        24 * layout.scale,
        frameState.enemyMuzzleFlashAlpha,
      );
    }
  }

  drawLayerPlayer(frameState, worldMotion) {
    const image = this.artLayers.player.image;
    const anchor = getPlayerWeaponAnchor(this.width, this.height, worldMotion);
    const reloadLift = frameState.playerWeaponFx.reloadProgress * 22;
    const scale =
      Math.max(this.width / image.width, this.height / image.height) *
      PLAYER_ART_METRICS.scaleMultiplier;
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = anchor.muzzle.x - PLAYER_ART_METRICS.muzzleX * scale;
    const drawY =
      anchor.muzzle.y -
      PLAYER_ART_METRICS.muzzleY * scale +
      reloadLift;

    this.context.save();
    this.context.globalAlpha = 1;
    this.context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    this.context.restore();

    if (frameState.playerWeaponFx.muzzleFlashAlpha > 0.01) {
      this.drawMuzzleFlash(
        anchor.muzzle,
        28,
        frameState.playerWeaponFx.muzzleFlashAlpha,
      );
    }
  }

  drawScenery(geometry, worldMotion) {
    const context = this.context;
    const horizonY = geometry.horizonY;
    const skyGradient = context.createLinearGradient(0, 0, 0, horizonY * 1.3);
    skyGradient.addColorStop(0, "rgba(255,255,255,0.72)");
    skyGradient.addColorStop(1, "rgba(246,241,231,0.38)");
    context.save();
    context.fillStyle = skyGradient;
    context.fillRect(0, 0, this.width, horizonY + this.height * 0.1);
    context.restore();

    const mountainScroll = (worldMotion.backgroundScroll ?? 0) * 0.16;
    const mountainOffset = ((mountainScroll % (this.width * 0.5)) + this.width * 0.5) % (this.width * 0.5);
    for (let repeat = -1; repeat <= 3; repeat += 1) {
      const baseX = repeat * this.width * 0.5 - mountainOffset;
      const points = [
        { x: baseX - 30, y: horizonY + 40 },
        { x: baseX + this.width * 0.08, y: horizonY + 18 },
        { x: baseX + this.width * 0.18, y: horizonY - 8 },
        { x: baseX + this.width * 0.28, y: horizonY + 12 },
        { x: baseX + this.width * 0.42, y: horizonY - 16 },
        { x: baseX + this.width * 0.54, y: horizonY + 8 },
        { x: baseX + this.width * 0.64, y: horizonY + 28 },
      ];
      roughPolyline(context, points, {
        strokeStyle: "rgba(53, 49, 45, 0.26)",
        lineWidth: 1.2,
        wobble: 2.8,
      });
    }

    const mesaScroll = (worldMotion.backgroundScroll ?? 0) * 0.28;
    const mesaOffset =
      ((mesaScroll % (this.width * 0.66)) + this.width * 0.66) %
      (this.width * 0.66);
    for (let repeat = -1; repeat <= 2; repeat += 1) {
      const baseX = repeat * this.width * 0.66 - mesaOffset;
      const mesa = [
        { x: baseX - 24, y: horizonY + 88 },
        { x: baseX + this.width * 0.1, y: horizonY + 68 },
        { x: baseX + this.width * 0.14, y: horizonY + 26 },
        { x: baseX + this.width * 0.24, y: horizonY + 18 },
        { x: baseX + this.width * 0.3, y: horizonY + 58 },
        { x: baseX + this.width * 0.4, y: horizonY + 72 },
      ];
      roughPolyline(context, mesa, {
        strokeStyle: "rgba(58, 53, 47, 0.18)",
        lineWidth: 1.5,
        wobble: 2.3,
      });
    }

    roughLine(
      context,
      { x: 0, y: horizonY + 54 },
      { x: this.width, y: horizonY + 46 },
      {
        strokeStyle: "rgba(48, 45, 41, 0.2)",
        lineWidth: 1.1,
        wobble: 2.4,
      },
    );

    const cactusScroll = (worldMotion.backgroundScroll ?? 0) * 0.48;
    const cactusSpacing = 220;
    for (let index = -1; index < Math.ceil(this.width / cactusSpacing) + 2; index += 1) {
      const x =
        ((index * cactusSpacing - cactusScroll) % (this.width + cactusSpacing)) -
        cactusSpacing * 0.5;
      const seed = index * 11.37;
      const y = horizonY + 74 + Math.sin(seed) * 16;
      const scale = 0.34 + (Math.sin(seed * 0.7) + 1) * 0.18;
      this.drawCactus(x, y, scale);
    }

    for (let index = 0; index < 11; index += 1) {
      const startX =
        ((index * 140 - (worldMotion.backgroundScroll ?? 0) * 0.9) % (this.width + 180)) -
        90;
      roughLine(
        context,
        { x: startX, y: this.height * 0.72 + index * 2.4 },
        { x: startX + this.width * 0.12, y: this.height * 0.69 + index * 1.2 },
        {
          strokeStyle: "rgba(76, 67, 60, 0.08)",
          lineWidth: 1,
          wobble: 2.2,
        },
      );
    }

    for (let index = 0; index < 5; index += 1) {
      const dustX =
        ((index * 280 - (worldMotion.backgroundScroll ?? 0) * 0.62) %
          (this.width + 320)) -
        120;
      const dustY = this.height * (0.62 + index * 0.04);
      this.drawDustCloud({ x: dustX, y: dustY }, 22 + index * 4, 0.14);
    }
  }

  drawCactus(x, y, scale = 1) {
    const height = 56 * scale;
    roughLine(
      this.context,
      { x, y },
      { x, y: y - height },
      {
        strokeStyle: "rgba(44, 42, 38, 0.34)",
        lineWidth: 2,
        wobble: 1.2,
      },
    );
    roughLine(
      this.context,
      { x, y: y - height * 0.45 },
      { x: x - 12 * scale, y: y - height * 0.56 },
      {
        strokeStyle: "rgba(44, 42, 38, 0.34)",
        lineWidth: 2,
        wobble: 1.2,
      },
    );
    roughLine(
      this.context,
      { x: x - 12 * scale, y: y - height * 0.56 },
      { x: x - 12 * scale, y: y - height * 0.3 },
      {
        strokeStyle: "rgba(44, 42, 38, 0.34)",
        lineWidth: 2,
        wobble: 1.2,
      },
    );
    roughLine(
      this.context,
      { x, y: y - height * 0.62 },
      { x: x + 11 * scale, y: y - height * 0.76 },
      {
        strokeStyle: "rgba(44, 42, 38, 0.34)",
        lineWidth: 2,
        wobble: 1.2,
      },
    );
    roughLine(
      this.context,
      { x: x + 11 * scale, y: y - height * 0.76 },
      { x: x + 11 * scale, y: y - height * 0.48 },
      {
        strokeStyle: "rgba(44, 42, 38, 0.34)",
        lineWidth: 2,
        wobble: 1.2,
      },
    );
  }

  drawTracks(geometry) {
    this.drawTrack(geometry.enemyTrack, geometry.worldPhase + 0.4, 0.82);
    this.drawTrack(geometry.playerTrack, geometry.worldPhase + 0.86, 1);
  }

  drawTrack(track, phase, alpha) {
    const context = this.context;
    const upperRail = sampleTrackPolyline(this.width, {
      ...track,
      baseY: track.baseY - track.railGap * 0.42,
    }, phase);
    const lowerRail = sampleTrackPolyline(this.width, {
      ...track,
      baseY: track.baseY + track.railGap * 0.42,
    }, phase);

    roughPolyline(context, upperRail, {
      strokeStyle: `rgba(36, 35, 33, ${0.44 * alpha})`,
      lineWidth: 2.2,
      wobble: 1.3,
    });
    roughPolyline(context, lowerRail, {
      strokeStyle: `rgba(36, 35, 33, ${0.44 * alpha})`,
      lineWidth: 2.2,
      wobble: 1.3,
    });

    const centerline = sampleTrackPolyline(
      this.width,
      {
        ...track,
        baseY: track.baseY + track.railGap * 1.08,
      },
      phase,
    );
    roughPolyline(context, centerline, {
      strokeStyle: `rgba(40, 36, 32, ${0.12 * alpha})`,
      lineWidth: 1.2,
      wobble: 1.2,
    });

    const spacing = 44;
    const scroll = ((phase * 140) % spacing + spacing) % spacing;
    for (let x = -spacing; x <= this.width + spacing; x += spacing) {
      const sleeperX = x - scroll;
      const sleeperY = computeTrackY(track.baseY, sleeperX, phase, track.amplitude);
      roughLine(
        context,
        { x: sleeperX, y: sleeperY - track.railGap * 1.05 },
        { x: sleeperX, y: sleeperY + track.sleeperHeight },
        {
          strokeStyle: `rgba(52, 47, 41, ${0.18 * alpha})`,
          lineWidth: 1.4,
          wobble: 1.3,
        },
      );
    }
  }

  drawEnemy(frameState) {
    const layout = computeEnemyLayout(this.width, this.height, frameState.enemyCartPose);
    const context = this.context;

    this.drawCartShadow(layout.cartRect, layout.scale);

    context.save();
    context.fillStyle = "rgba(255, 255, 255, 0.8)";
    context.fillRect(
      layout.cartRect.x,
      layout.cartRect.y,
      layout.cartRect.width,
      layout.cartRect.height,
    );
    context.restore();

    roughRect(context, layout.cartRect.x, layout.cartRect.y, layout.cartRect.width, layout.cartRect.height, {
      strokeStyle: "rgba(33, 31, 29, 0.82)",
      lineWidth: 2.1,
      wobble: 2.2,
    });
    hatchRect(
      context,
      layout.cartRect.x,
      layout.cartRect.y,
      layout.cartRect.width,
      layout.cartRect.height,
      {
        spacing: 10 * layout.scale,
        strokeStyle: "rgba(50, 45, 40, 0.16)",
      },
    );

    roughLine(
      context,
      { x: layout.cartRect.x + 4, y: layout.cartRect.y + 4 },
      { x: layout.cartRect.x + layout.cartRect.width - 6, y: layout.cartRect.y + 8 },
      {
        strokeStyle: "rgba(33, 31, 29, 0.42)",
        lineWidth: 1.4,
        wobble: 2,
      },
    );
    roughLine(
      context,
      { x: layout.rearWheel.x, y: layout.wheelY - layout.wheelRadius * 0.24 },
      { x: layout.frontWheel.x, y: layout.wheelY - layout.wheelRadius * 0.24 },
      {
        strokeStyle: "rgba(34, 31, 28, 0.56)",
        lineWidth: 1.8,
        wobble: 1.2,
      },
    );

    roughCircle(context, layout.frontWheel, layout.wheelRadius, {
      strokeStyle: "rgba(31, 29, 27, 0.8)",
      lineWidth: 2,
      wobble: 1.4,
    });
    roughCircle(context, layout.rearWheel, layout.wheelRadius, {
      strokeStyle: "rgba(31, 29, 27, 0.8)",
      lineWidth: 2,
      wobble: 1.4,
    });
    this.drawWheelSpokes(layout.frontWheel, layout.wheelRadius);
    this.drawWheelSpokes(layout.rearWheel, layout.wheelRadius);

    roughLine(context, layout.torsoBottom, layout.torsoTop, {
      strokeStyle: "rgba(30, 28, 27, 0.9)",
      lineWidth: 4.6 * layout.scale,
      wobble: 1.7,
    });
    roughCircle(context, layout.headCenter, layout.headRadius, {
      strokeStyle: "rgba(30, 28, 27, 0.9)",
      lineWidth: 2.1,
      wobble: 1.5,
    });
    roughLine(
      context,
      {
        x: layout.torsoTop.x - 10 * layout.scale,
        y: layout.torsoTop.y + 12 * layout.scale,
      },
      {
        x: layout.torsoTop.x - 24 * layout.scale,
        y: layout.torsoTop.y + 26 * layout.scale,
      },
      {
        strokeStyle: "rgba(30, 28, 27, 0.82)",
        lineWidth: 2.6 * layout.scale,
        wobble: 1.4,
      },
    );
    roughLine(context, layout.shoulder, layout.gunHand, {
      strokeStyle: "rgba(30, 28, 27, 0.88)",
      lineWidth: 2.8 * layout.scale,
      wobble: 1.4,
    });
    roughLine(context, layout.gunHand, layout.muzzle, {
      strokeStyle: "rgba(28, 26, 24, 0.92)",
      lineWidth: 3.2 * layout.scale,
      wobble: 1.2,
    });
    roughLine(
      context,
      { x: layout.torsoBottom.x + 2 * layout.scale, y: layout.torsoBottom.y + 4 * layout.scale },
      { x: layout.torsoBottom.x + 10 * layout.scale, y: layout.torsoBottom.y + 28 * layout.scale },
      {
        strokeStyle: "rgba(30, 28, 27, 0.78)",
        lineWidth: 2.5 * layout.scale,
        wobble: 1.4,
      },
    );
    this.drawDustCloud(
      {
        x: layout.rearWheel.x - 28 * layout.scale,
        y: layout.wheelY + 10 * layout.scale,
      },
      18 * layout.scale,
      0.18,
    );

    if (frameState.enemyMuzzleFlashAlpha > 0.01) {
      this.drawMuzzleFlash(layout.muzzle, 22 * layout.scale, frameState.enemyMuzzleFlashAlpha);
    }
  }

  drawPlayerCart(geometry, worldMotion) {
    const lip = getPlayerCartLip(this.width, this.height, worldMotion);
    fillPolygon(this.context, lip, "rgba(255, 255, 255, 0.86)");
    roughPolyline(this.context, [...lip, lip[0]], {
      strokeStyle: "rgba(34, 31, 29, 0.82)",
      lineWidth: 2.2,
      wobble: 2.2,
    });

    roughLine(
      this.context,
      { x: lip[0].x, y: lip[0].y + 18 },
      { x: lip[1].x, y: lip[1].y + 18 },
      {
        strokeStyle: "rgba(34, 31, 29, 0.24)",
        lineWidth: 1.2,
        wobble: 1.4,
      },
    );

    const topInsetLeft = {
      x: lip[0].x + 28,
      y: lip[0].y + 8,
    };
    const topInsetRight = {
      x: lip[1].x - 24,
      y: lip[1].y + 8,
    };
    roughLine(
      this.context,
      topInsetLeft,
      topInsetRight,
      {
        strokeStyle: "rgba(34, 31, 29, 0.3)",
        lineWidth: 1.2,
        wobble: 1.4,
      },
    );
    for (let index = 0; index < 6; index += 1) {
      const t = index / 5;
      roughLine(
        this.context,
        {
          x: lerp(lip[0].x + 16, lip[1].x - 18, t),
          y: lerp(lip[0].y + 14, lip[1].y + 10, t),
        },
        {
          x: lerp(lip[3].x + 18, lip[2].x - 18, t),
          y: lerp(lip[3].y - 8, lip[2].y - 12, t),
        },
        {
          strokeStyle: "rgba(43, 39, 35, 0.09)",
          lineWidth: 1,
          wobble: 1.2,
        },
      );
    }
  }

  drawPlayerWeapon(frameState, worldMotion) {
    const context = this.context;
    const anchor = getPlayerWeaponAnchor(this.width, this.height, worldMotion);
    const kick = frameState.playerHitFx.kick * 12;
    const reloadLift = frameState.playerWeaponFx.reloadProgress * 28;
    const grip = {
      x: anchor.grip.x + kick,
      y: anchor.grip.y + reloadLift,
    };
    const muzzle = {
      x: anchor.muzzle.x + kick,
      y: anchor.muzzle.y + reloadLift * 0.55,
    };
    const barrelTip = {
      x: muzzle.x - 16,
      y: muzzle.y - 8,
    };

    roughLine(
      context,
      { x: grip.x - 18, y: grip.y - 52 },
      { x: grip.x - 2, y: grip.y - 102 },
      {
        strokeStyle: "rgba(27, 25, 23, 0.92)",
        lineWidth: 8,
        wobble: 1.8,
      },
    );
    roughLine(
      context,
      { x: grip.x - 2, y: grip.y - 102 },
      barrelTip,
      {
        strokeStyle: "rgba(27, 25, 23, 0.94)",
        lineWidth: 7,
        wobble: 1.3,
      },
    );
    roughCircle(
      context,
      { x: grip.x - 1, y: grip.y - 88 },
      18,
      {
        strokeStyle: "rgba(27, 25, 23, 0.94)",
        lineWidth: 3,
        wobble: 1.5,
      },
    );
    roughLine(
      context,
      { x: grip.x - 16, y: grip.y - 88 },
      { x: grip.x + 14, y: grip.y - 88 },
      {
        strokeStyle: "rgba(27, 25, 23, 0.58)",
        lineWidth: 1.4,
        wobble: 1.1,
      },
    );
    roughCircle(
      context,
      { x: grip.x - 1, y: grip.y - 88 },
      8.5,
      {
        strokeStyle: "rgba(27, 25, 23, 0.6)",
        lineWidth: 1.3,
        wobble: 1.3,
      },
    );

    roughLine(
      context,
      { x: grip.x + 10, y: grip.y + 14 },
      { x: grip.x - 10, y: grip.y - 14 },
      {
        strokeStyle: "rgba(34, 30, 27, 0.82)",
        lineWidth: 18,
        wobble: 1.2,
      },
    );
    roughLine(
      context,
      { x: grip.x + 5, y: grip.y + 34 },
      { x: grip.x - 8, y: grip.y - 8 },
      {
        strokeStyle: "rgba(34, 30, 27, 0.74)",
        lineWidth: 22,
        wobble: 1.2,
      },
    );
    roughLine(
      context,
      { x: grip.x + 2, y: grip.y - 10 },
      { x: grip.x + 18, y: grip.y + 16 },
      {
        strokeStyle: "rgba(24, 22, 20, 0.56)",
        lineWidth: 2.2,
        wobble: 1.1,
      },
    );
    roughLine(
      context,
      { x: grip.x + 18, y: grip.y + 8 },
      { x: grip.x + 56, y: grip.y + 60 },
      {
        strokeStyle: "rgba(58, 50, 44, 0.54)",
        lineWidth: 27,
        wobble: 1.4,
      },
    );
    roughLine(
      context,
      { x: grip.x - 12, y: grip.y - 106 },
      { x: barrelTip.x + 6, y: barrelTip.y - 4 },
      {
        strokeStyle: "rgba(41, 36, 32, 0.38)",
        lineWidth: 1.2,
        wobble: 1.1,
      },
    );

    if (frameState.playerWeaponFx.muzzleFlashAlpha > 0.01) {
      this.drawMuzzleFlash(barrelTip, 26, frameState.playerWeaponFx.muzzleFlashAlpha);
    }
  }

  drawShotTraces(frameState, worldMotion) {
    const now = frameState.timestampMs;
    const enemyLayout = computeEnemyLayout(this.width, this.height, frameState.enemyCartPose);
    const playerAnchor = getPlayerWeaponAnchor(this.width, this.height, worldMotion);

    for (const shot of frameState.recentShots) {
      const age = now - shot.createdAt;
      const alpha = clamp(1 - age / 160, 0, 1);
      const from = shot.team === "player" ? playerAnchor.muzzle : enemyLayout.muzzle;
      roughLine(this.context, from, shot.to, {
        strokeStyle:
          shot.team === "player"
            ? `rgba(245, 181, 88, ${0.36 + alpha * 0.36})`
            : `rgba(62, 58, 54, ${0.18 + alpha * 0.24})`,
        lineWidth: shot.team === "player" ? 2.2 : 1.5,
        wobble: 1.1,
      });
    }
  }

  drawImpacts(frameState) {
    const now = frameState.timestampMs;

    for (const mark of frameState.recentImpacts) {
      const age = now - mark.createdAt;
      const alpha = clamp(1 - age / 560, 0, 1);
      const radius =
        mark.kind === "enemy-hit"
          ? 18
          : mark.kind === "player-hit"
            ? 22
            : 12;

      this.context.save();
      this.context.strokeStyle =
        mark.kind === "enemy-hit"
          ? `rgba(218, 93, 52, ${alpha})`
          : mark.kind === "player-hit"
            ? `rgba(45, 45, 45, ${alpha * 0.84})`
            : `rgba(73, 68, 62, ${alpha * 0.8})`;
      this.context.fillStyle =
        mark.kind === "enemy-hit"
          ? `rgba(247, 193, 98, ${alpha * 0.3})`
          : `rgba(62, 59, 55, ${alpha * 0.12})`;
      this.context.lineWidth = mark.kind === "enemy-hit" ? 2.4 : 1.4;
      this.context.beginPath();
      this.context.arc(mark.x, mark.y, radius * 0.42, 0, Math.PI * 2);
      this.context.fill();
      this.context.stroke();

      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8;
        const inner = radius * 0.5;
        const outer = radius * (mark.kind === "player-hit" ? 1.5 : 1.1);
        roughLine(
          this.context,
          {
            x: mark.x + Math.cos(angle) * inner,
            y: mark.y + Math.sin(angle) * inner,
          },
          {
            x: mark.x + Math.cos(angle) * outer,
            y: mark.y + Math.sin(angle) * outer,
          },
          {
            strokeStyle: this.context.strokeStyle,
            lineWidth: mark.kind === "enemy-hit" ? 1.8 : 1.1,
            wobble: 1.2,
          },
        );
      }

      this.context.restore();
    }
  }

  drawCrosshair(crosshair) {
    const context = this.context;
    context.save();
    context.strokeStyle = "rgba(42, 39, 36, 0.82)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(crosshair.x, crosshair.y, 15, 0, Math.PI * 2);
    context.stroke();
    roughLine(context, { x: crosshair.x - 28, y: crosshair.y }, { x: crosshair.x - 8, y: crosshair.y }, {
      strokeStyle: "rgba(42, 39, 36, 0.82)",
      lineWidth: 2,
      wobble: 1,
    });
    roughLine(context, { x: crosshair.x + 8, y: crosshair.y }, { x: crosshair.x + 28, y: crosshair.y }, {
      strokeStyle: "rgba(42, 39, 36, 0.82)",
      lineWidth: 2,
      wobble: 1,
    });
    roughLine(context, { x: crosshair.x, y: crosshair.y - 28 }, { x: crosshair.x, y: crosshair.y - 8 }, {
      strokeStyle: "rgba(42, 39, 36, 0.82)",
      lineWidth: 2,
      wobble: 1,
    });
    roughLine(context, { x: crosshair.x, y: crosshair.y + 8 }, { x: crosshair.x, y: crosshair.y + 28 }, {
      strokeStyle: "rgba(42, 39, 36, 0.82)",
      lineWidth: 2,
      wobble: 1,
    });
    context.restore();
  }

  drawEnemyHealthBar(frameState) {
    if (!frameState.maxHealth) {
      return;
    }

    const layout = computeEnemyLayout(
      this.width,
      this.height,
      frameState.enemyCartPose,
    );
    const ratio = clamp(frameState.enemyHealth / frameState.maxHealth, 0, 1);
    const barWidth = 118 * layout.scale;
    const barHeight = 12 * layout.scale;
    const x = layout.headCenter.x - barWidth * 0.5;
    const y = layout.headCenter.y - layout.headRadius - 32 * layout.scale;
    const fillWidth = barWidth * ratio;
    const context = this.context;

    context.save();
    context.fillStyle = "rgba(247, 242, 232, 0.9)";
    context.fillRect(x - 8, y - 18, barWidth + 16, barHeight + 28);
    context.strokeStyle = "rgba(55, 50, 45, 0.32)";
    context.lineWidth = 1.2;
    context.strokeRect(x - 8, y - 18, barWidth + 16, barHeight + 28);
    context.fillStyle = "rgba(49, 44, 39, 0.76)";
    context.font = `700 ${Math.max(11, 11 * layout.scale)}px 'Avenir Next', 'Trebuchet MS', sans-serif`;
    context.textAlign = "center";
    context.fillText("CPU", x + barWidth * 0.5, y - 7);
    context.fillStyle = "rgba(70, 61, 53, 0.18)";
    context.fillRect(x, y, barWidth, barHeight);
    context.fillStyle = "rgba(165, 82, 58, 0.92)";
    context.fillRect(x, y, fillWidth, barHeight);
    context.strokeStyle = "rgba(61, 54, 48, 0.56)";
    context.strokeRect(x, y, barWidth, barHeight);
    context.restore();
  }

  drawPlayerHealthBar(frameState) {
    if (!frameState.maxHealth) {
      return;
    }

    const ratio = clamp(frameState.playerHealth / frameState.maxHealth, 0, 1);
    const width = Math.min(280, this.width * 0.34);
    const height = 16;
    const x = this.width * 0.5 - width * 0.5;
    const y = this.height - 104;
    const context = this.context;

    context.save();
    context.fillStyle = "rgba(248, 243, 234, 0.92)";
    context.fillRect(x - 12, y - 28, width + 24, height + 44);
    context.strokeStyle = "rgba(55, 50, 45, 0.28)";
    context.lineWidth = 1.2;
    context.strokeRect(x - 12, y - 28, width + 24, height + 44);
    context.fillStyle = "rgba(44, 39, 35, 0.82)";
    context.font = "700 13px 'Avenir Next', 'Trebuchet MS', sans-serif";
    context.textAlign = "left";
    context.fillText("YOU", x, y - 10);
    context.textAlign = "right";
    context.fillText(
      `${frameState.playerHealth} / ${frameState.maxHealth}`,
      x + width,
      y - 10,
    );
    context.fillStyle = "rgba(70, 61, 53, 0.18)";
    context.fillRect(x, y, width, height);
    context.fillStyle = "rgba(101, 132, 84, 0.92)";
    context.fillRect(x, y, width * ratio, height);
    context.strokeStyle = "rgba(61, 54, 48, 0.56)";
    context.strokeRect(x, y, width, height);
    context.restore();
  }

  drawReloadPrompt(frameState) {
    const context = this.context;
    if (frameState.enemyReloading) {
      const bannerWidth = Math.min(320, this.width * 0.42);
      const bannerX = this.width * 0.5 - bannerWidth * 0.5;
      const bannerY = 34;
      context.save();
      context.fillStyle = "rgba(248, 242, 233, 0.62)";
      context.fillRect(bannerX, bannerY, bannerWidth, 46);
      context.strokeStyle = "rgba(57, 50, 44, 0.18)";
      context.lineWidth = 1.2;
      context.strokeRect(bannerX, bannerY, bannerWidth, 46);
      context.textAlign = "center";
      context.fillStyle = "rgba(43, 37, 33, 0.92)";
      context.font = "700 18px 'Avenir Next', 'Trebuchet MS', sans-serif";
      context.fillText("상대 장전중 / CPU Reloading", this.width * 0.5, bannerY + 29);
      context.restore();
    }

    if (!frameState.reloadPromptVisible) {
      return;
    }

    const width = Math.min(360, this.width * 0.58);
    const height = 92;
    const x = this.width * 0.5 - width * 0.5;
    const y = this.height * 0.5 - height * 0.5;
    const mode = frameState.reloadPromptMode ?? "needed";

    context.save();
    context.fillStyle = "rgba(248, 242, 233, 0.56)";
    context.fillRect(x, y, width, height);
    context.strokeStyle = "rgba(57, 50, 44, 0.18)";
    context.lineWidth = 1.5;
    context.strokeRect(x, y, width, height);
    context.textAlign = "center";
    context.fillStyle = "rgba(43, 37, 33, 0.92)";
    context.font = "700 18px 'Avenir Next', 'Trebuchet MS', sans-serif";
    context.fillText(
      mode === "reloading" ? "장전중" : "재장전",
      this.width * 0.5,
      y + 34,
    );
    context.font = "700 30px 'Avenir Next', 'Trebuchet MS', sans-serif";
    context.fillText(
      mode === "reloading" ? "Reloading" : "Reload",
      this.width * 0.5,
      y + 66,
    );
    context.restore();
  }

  drawPlayerHitFx(frameState) {
    if (frameState.playerHitFx.flash <= 0.01) {
      return;
    }

    const alpha = frameState.playerHitFx.flash;
    const context = this.context;
    context.save();
    context.fillStyle = `rgba(34, 31, 29, ${alpha * 0.12})`;
    context.fillRect(0, 0, this.width, this.height);

    const vignette = context.createRadialGradient(
      this.width * 0.52,
      this.height * 0.56,
      this.width * 0.08,
      this.width * 0.52,
      this.height * 0.56,
      this.width * 0.72,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, `rgba(31, 28, 26, ${alpha * 0.28})`);
    context.fillStyle = vignette;
    context.fillRect(0, 0, this.width, this.height);
    context.restore();
  }

  drawOverlay(frameState) {
    if (frameState.phase !== "countdown" && frameState.phase !== "round_over") {
      return;
    }

    const context = this.context;
    context.save();
    context.fillStyle = "rgba(246, 241, 231, 0.72)";
    context.fillRect(0, 0, this.width, this.height);
    context.textAlign = "center";
    context.fillStyle = "rgba(31, 29, 27, 0.9)";
    context.font = "700 64px 'Avenir Next', 'Trebuchet MS', sans-serif";
    const mainText =
      frameState.phase === "countdown"
        ? String(frameState.countdownValue)
        : frameState.winner === "player"
          ? "YOU WIN"
          : "CPU WINS";
    context.fillText(mainText, this.width / 2, this.height * 0.42);
    context.font = "600 22px 'Avenir Next', 'Trebuchet MS', sans-serif";
    context.fillText(
      frameState.phase === "countdown"
        ? "Steady your aim"
        : "Press Enter or Restart Duel",
      this.width / 2,
      this.height * 0.49,
    );
    context.restore();
  }

  drawMuzzleFlash(center, radius, alpha) {
    this.context.save();
    this.context.strokeStyle = `rgba(243, 182, 96, ${0.28 + alpha * 0.5})`;
    this.context.lineWidth = 2;
    for (let index = 0; index < 8; index += 1) {
      const angle = (Math.PI * 2 * index) / 8;
      const inner = radius * 0.3;
      const outer = radius * (0.7 + (index % 2) * 0.35);
      roughLine(
        this.context,
        {
          x: center.x + Math.cos(angle) * inner,
          y: center.y + Math.sin(angle) * inner,
        },
        {
          x: center.x + Math.cos(angle) * outer,
          y: center.y + Math.sin(angle) * outer,
        },
        {
          strokeStyle: this.context.strokeStyle,
          lineWidth: 1.8,
          wobble: 1,
        },
      );
    }
    this.context.restore();
  }

  drawWheelSpokes(center, radius) {
    for (let index = 0; index < 4; index += 1) {
      const angle = (Math.PI * index) / 2 + 0.2;
      roughLine(
        this.context,
        {
          x: center.x + Math.cos(angle) * radius * 0.12,
          y: center.y + Math.sin(angle) * radius * 0.12,
        },
        {
          x: center.x + Math.cos(angle) * radius * 0.74,
          y: center.y + Math.sin(angle) * radius * 0.74,
        },
        {
          strokeStyle: "rgba(31, 29, 27, 0.48)",
          lineWidth: 1,
          wobble: 0.9,
        },
      );
    }
  }

  drawCartShadow(cartRect, scale) {
    this.context.save();
    this.context.fillStyle = "rgba(55, 48, 42, 0.07)";
    this.context.beginPath();
    this.context.ellipse(
      cartRect.x + cartRect.width * 0.52,
      cartRect.y + cartRect.height + 12 * scale,
      cartRect.width * 0.42,
      10 * scale,
      -0.04,
      0,
      Math.PI * 2,
    );
    this.context.fill();
    this.context.restore();
  }

  drawDustCloud(center, radius, alpha) {
    this.context.save();
    this.context.strokeStyle = `rgba(78, 71, 63, ${alpha})`;
    this.context.lineWidth = 1.1;
    for (let index = 0; index < 3; index += 1) {
      roughCircle(
        this.context,
        {
          x: center.x + (index - 1) * radius * 0.36,
          y: center.y - index * radius * 0.12,
        },
        radius * (0.52 + index * 0.16),
        {
          strokeStyle: this.context.strokeStyle,
          lineWidth: 1.1,
          wobble: 1.6,
        },
      );
    }
    this.context.restore();
  }
}
