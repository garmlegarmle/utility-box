export const CALIBRATION_POINTS = [
  { id: "center", label: "Center", x: 0.5, y: 0.5 },
  { id: "top-left", label: "Top Left", x: 0.14, y: 0.18 },
  { id: "top-right", label: "Top Right", x: 0.88, y: 0.18 },
  { id: "bottom-left", label: "Bottom Left", x: 0.14, y: 0.82 },
  { id: "bottom-right", label: "Bottom Right", x: 0.88, y: 0.82 },
];

const LEGACY_EPSILON = 1e-8;
const TRIANGLE_TOLERANCE = -0.08;

function buildLegacyBasis(point) {
  const radiusSquared = point.x * point.x + point.y * point.y;
  return [1, point.x, point.y, point.x * point.y, radiusSquared];
}

function solveLinearSystem(matrix, vector) {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);

  for (let pivot = 0; pivot < size; pivot += 1) {
    let maxRow = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) {
        maxRow = row;
      }
    }

    if (Math.abs(augmented[maxRow][pivot]) < LEGACY_EPSILON) {
      throw new Error("Calibration solve failed due to unstable samples.");
    }

    if (maxRow !== pivot) {
      [augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]];
    }

    const pivotValue = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) {
      augmented[pivot][column] /= pivotValue;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === pivot) {
        continue;
      }

      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function defaultScreenLookup() {
  return Object.fromEntries(
    CALIBRATION_POINTS.map((point) => [point.id, { x: point.x, y: point.y }]),
  );
}

function buildAnchorLookup(samples) {
  const fallbackScreen = defaultScreenLookup();
  const anchors = {};

  for (const sample of samples) {
    if (!sample?.id || !sample.raw) {
      continue;
    }

    const screen = sample.screen ?? fallbackScreen[sample.id];
    if (!screen) {
      continue;
    }

    anchors[sample.id] = {
      raw: {
        x: sample.raw.x,
        y: sample.raw.y,
      },
      screen: {
        x: screen.x,
        y: screen.y,
      },
    };
  }

  for (const point of CALIBRATION_POINTS) {
    if (!anchors[point.id]) {
      throw new Error("Calibration requires all five reference points.");
    }
  }

  return anchors;
}

function createTriangle(rawA, rawB, rawC, screenA, screenB, screenC) {
  return {
    raw: [rawA, rawB, rawC],
    screen: [screenA, screenB, screenC],
  };
}

function buildTriangles(anchors) {
  return [
    createTriangle(
      anchors.center.raw,
      anchors["top-left"].raw,
      anchors["top-right"].raw,
      anchors.center.screen,
      anchors["top-left"].screen,
      anchors["top-right"].screen,
    ),
    createTriangle(
      anchors.center.raw,
      anchors["top-right"].raw,
      anchors["bottom-right"].raw,
      anchors.center.screen,
      anchors["top-right"].screen,
      anchors["bottom-right"].screen,
    ),
    createTriangle(
      anchors.center.raw,
      anchors["bottom-right"].raw,
      anchors["bottom-left"].raw,
      anchors.center.screen,
      anchors["bottom-right"].screen,
      anchors["bottom-left"].screen,
    ),
    createTriangle(
      anchors.center.raw,
      anchors["bottom-left"].raw,
      anchors["top-left"].raw,
      anchors.center.screen,
      anchors["bottom-left"].screen,
      anchors["top-left"].screen,
    ),
  ];
}

function barycentric(point, triangle) {
  const [a, b, c] = triangle.raw;
  const denominator =
    (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);

  if (Math.abs(denominator) < LEGACY_EPSILON) {
    throw new Error("Calibration triangle became unstable.");
  }

  const weightA =
    ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) /
    denominator;
  const weightB =
    ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) /
    denominator;
  const weightC = 1 - weightA - weightB;

  return {
    weightA,
    weightB,
    weightC,
  };
}

function clampWeights(weights) {
  const clamped = [
    Math.max(0, weights.weightA),
    Math.max(0, weights.weightB),
    Math.max(0, weights.weightC),
  ];
  const totalWeight = clamped[0] + clamped[1] + clamped[2];

  if (totalWeight < LEGACY_EPSILON) {
    return [1, 0, 0];
  }

  return clamped.map((weight) => weight / totalWeight);
}

function scoreTriangleFit(weights) {
  const negatives = [weights.weightA, weights.weightB, weights.weightC]
    .filter((weight) => weight < 0)
    .map((weight) => Math.abs(weight));

  const penalty = negatives.reduce((sum, value) => sum + value, 0);
  const inside =
    weights.weightA >= TRIANGLE_TOLERANCE &&
    weights.weightB >= TRIANGLE_TOLERANCE &&
    weights.weightC >= TRIANGLE_TOLERANCE;

  return {
    inside,
    penalty,
  };
}

function projectTriangle(point, triangle) {
  const weights = barycentric(point, triangle);
  const score = scoreTriangleFit(weights);
  const [weightA, weightB, weightC] = clampWeights(weights);
  const [screenA, screenB, screenC] = triangle.screen;

  return {
    inside: score.inside,
    penalty: score.penalty,
    mapped: {
      x: screenA.x * weightA + screenB.x * weightB + screenC.x * weightC,
      y: screenA.y * weightA + screenB.y * weightB + screenC.y * weightC,
    },
  };
}

function applyPiecewiseCalibration(point, calibration) {
  const anchors = calibration.anchors ?? buildAnchorLookup(calibration.samples ?? []);
  const triangles = buildTriangles(anchors);

  let bestProjection = null;
  for (const triangle of triangles) {
    const projection = projectTriangle(point, triangle);
    if (
      !bestProjection ||
      (projection.inside && !bestProjection.inside) ||
      (projection.inside === bestProjection.inside &&
        projection.penalty < bestProjection.penalty)
    ) {
      bestProjection = projection;
    }
  }

  return bestProjection?.mapped ?? { ...point };
}

function applyLegacyCalibration(point, calibration) {
  const basis = buildLegacyBasis(point);
  const mappedX = calibration.coeffX.reduce(
    (sum, coefficient, index) => sum + coefficient * basis[index],
    0,
  );
  const mappedY = calibration.coeffY.reduce(
    (sum, coefficient, index) => sum + coefficient * basis[index],
    0,
  );

  return {
    x: mappedX,
    y: mappedY,
  };
}

export function createCalibration(samples) {
  if (samples.length !== CALIBRATION_POINTS.length) {
    throw new Error("Calibration requires exactly five captured points.");
  }

  const anchors = buildAnchorLookup(samples);

  return {
    type: "piecewise-v2",
    anchors,
    samples: CALIBRATION_POINTS.map((point) => ({
      id: point.id,
      raw: anchors[point.id].raw,
      screen: anchors[point.id].screen,
    })),
  };
}

export function applyCalibration(point, calibration) {
  if (!calibration) {
    return { ...point };
  }

  if (
    calibration.type === "piecewise-v2" ||
    calibration.anchors ||
    calibration.samples?.some((sample) => sample?.id)
  ) {
    return {
      ...point,
      ...applyPiecewiseCalibration(point, calibration),
    };
  }

  if (Array.isArray(calibration.coeffX) && Array.isArray(calibration.coeffY)) {
    return {
      ...point,
      ...applyLegacyCalibration(point, calibration),
    };
  }

  return { ...point };
}

export function createLegacyCalibration(samples) {
  if (samples.length !== CALIBRATION_POINTS.length) {
    throw new Error("Calibration requires exactly five captured points.");
  }

  const basisMatrix = samples.map((sample) => buildLegacyBasis(sample.raw));
  const coeffX = solveLinearSystem(
    basisMatrix.map((row) => [...row]),
    samples.map((sample) => sample.screen.x),
  );
  const coeffY = solveLinearSystem(
    basisMatrix.map((row) => [...row]),
    samples.map((sample) => sample.screen.y),
  );

  return {
    coeffX,
    coeffY,
    samples,
  };
}
