export interface RandomResult<T> {
  value: T;
  nextState: number;
}

export function normalizeSeed(seed: number): number {
  return seed >>> 0;
}

export function randomFloat(state: number): RandomResult<number> {
  let nextState = normalizeSeed(state + 0x6d2b79f5);
  nextState = Math.imul(nextState ^ (nextState >>> 15), nextState | 1);
  nextState ^= nextState + Math.imul(nextState ^ (nextState >>> 7), nextState | 61);
  const value = ((nextState ^ (nextState >>> 14)) >>> 0) / 4294967296;

  return {
    value,
    nextState: normalizeSeed(nextState),
  };
}

export function randomInt(state: number, maxExclusive: number): RandomResult<number> {
  if (maxExclusive <= 0) {
    return { value: 0, nextState: normalizeSeed(state) };
  }

  const { value, nextState } = randomFloat(state);

  return {
    value: Math.floor(value * maxExclusive),
    nextState,
  };
}

export function pickWeightedIndex(state: number, weights: number[]): RandomResult<number> {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);

  if (total <= 0) {
    return randomInt(state, weights.length);
  }

  const { value, nextState } = randomFloat(state);
  const target = value * total;
  let running = 0;

  for (let index = 0; index < weights.length; index += 1) {
    running += Math.max(0, weights[index] ?? 0);

    if (target <= running) {
      return { value: index, nextState };
    }
  }

  return { value: Math.max(0, weights.length - 1), nextState };
}
