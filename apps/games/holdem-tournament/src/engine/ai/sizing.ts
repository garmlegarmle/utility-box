import { pickWeightedIndex } from 'holdem/engine/core/rng';
import type { BotDecisionContext, BotProfile, WeightedActionCandidate } from 'holdem/types/ai';

function clampAmount(amount: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(amount)));
}

export function chooseBetSize(
  context: BotDecisionContext,
  profile: BotProfile,
  kind: 'bet' | 'raise' | 'all-in',
): number | undefined {
  if (kind === 'all-in') {
    return undefined;
  }

  if (context.street === 'preflop') {
    if (kind === 'bet') {
      const openSize = context.positionGroup === 'BTN' ? 2.2 : context.positionGroup === 'SB' ? 3 : 2.4;
      const raw = openSize * context.bigBlind;
      return context.minRaiseTo ? clampAmount(raw, context.minRaiseTo, context.stack + context.amountToCall) : raw;
    }

    const multiplier = context.isInPosition ? 2.7 : 3.2;
    const raw = Math.max(context.minRaiseTo ?? 0, (context.amountToCall + context.bigBlind) * multiplier);
    return context.minRaiseTo
      ? clampAmount(raw, context.minRaiseTo, context.stack + context.amountToCall)
      : raw;
  }

  const weights = profile.betSizeWeights;
  const pot = Math.max(context.potSize, context.bigBlind);
  const buckets = [
    { label: 'small', value: 0.33 },
    { label: 'medium', value: 0.5 },
    { label: 'large', value: 0.75 },
    { label: 'overbet', value: 1.5 },
  ];
  const preferred =
    context.madeHandTier === 'straight' || context.madeHandTier === 'flush'
      ? 'large'
      : context.boardTexture === 'dry'
        ? 'small'
        : 'medium';
  const chosen = buckets.find((bucket) => bucket.label === preferred) ?? buckets[1];
  const blendedValue =
    chosen!.value * 0.7 + buckets.reduce((sum, bucket) => sum + bucket.value * (weights[bucket.label] ?? 0), 0) * 0.3;
  const raw = context.amountToCall + pot * blendedValue;

  if (!context.minRaiseTo) {
    return clampAmount(raw, context.bigBlind, context.stack + context.amountToCall);
  }

  return clampAmount(raw, context.minRaiseTo, context.stack + context.amountToCall);
}

export function pickWeightedAction(
  seed: number,
  candidates: WeightedActionCandidate[],
): { candidate: WeightedActionCandidate; nextSeed: number } {
  const sorted = [...candidates].sort((left, right) => right.weight - left.weight);
  const capped = sorted.slice(0, Math.min(3, sorted.length));
  const result = pickWeightedIndex(seed, capped.map((candidate) => candidate.weight));

  return {
    candidate: capped[result.value] ?? sorted[0]!,
    nextSeed: result.nextState,
  };
}
