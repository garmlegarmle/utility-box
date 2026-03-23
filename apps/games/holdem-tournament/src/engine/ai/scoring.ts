import type { BotDecisionContext, BotProfile, MadeHandTier, StartingHandTier } from 'holdem/types/ai';

const STARTING_HAND_SCORES: Record<StartingHandTier, number> = {
  'premium-pair': 1,
  'strong-broadway': 0.9,
  'medium-pair': 0.8,
  'small-pair': 0.64,
  'suited-broadway': 0.68,
  'suited-ace': 0.58,
  'suited-connector': 0.52,
  'weak-broadway': 0.44,
  'ace-x': 0.34,
  'king-x': 0.26,
  trash: 0.08,
};

const MADE_HAND_SCORES: Record<MadeHandTier, number> = {
  'high-card': 0.08,
  pair: 0.36,
  'two-pair': 0.62,
  trips: 0.74,
  straight: 0.82,
  flush: 0.88,
  'full-house': 0.94,
  quads: 0.98,
  'straight-flush': 1,
};

export function getPreflopStrength(context: BotDecisionContext): number {
  const base = STARTING_HAND_SCORES[context.startingHandTier];
  const positionBonus =
    context.positionGroup === 'BTN' ? 0.08 : context.positionGroup === 'CO' ? 0.04 : context.positionGroup === 'BB' ? 0.02 : 0;
  const pressurePenalty = context.pressureTier === 'bubble' ? 0.04 : 0;

  return Math.min(1, Math.max(0, base + positionBonus - pressurePenalty));
}

export function getPostflopStrength(context: BotDecisionContext): number {
  const madeHand = MADE_HAND_SCORES[context.madeHandTier];
  const drawBonus =
    context.drawTier === 'combo-draw'
      ? 0.28
      : context.drawTier === 'flush-draw' || context.drawTier === 'open-ended'
        ? 0.18
        : context.drawTier === 'gutshot'
          ? 0.08
          : 0;
  const positionBonus = context.isInPosition ? 0.04 : 0;

  return Math.min(1, madeHand + drawBonus + positionBonus);
}

export function scoreFold(context: BotDecisionContext, profile: BotProfile): number {
  const pressurePenalty =
    context.pressureTier === 'bubble'
      ? profile.bubblePressureFactor * 0.18
      : context.pressureTier === 'late'
        ? 0.08
        : 0;
  const strength = context.street === 'preflop' ? getPreflopStrength(context) : getPostflopStrength(context);
  const stackPressure = context.amountToCall > 0 ? context.callPortionOfStack * 0.55 : 0;
  const jamPressure = context.facingAllInPressure ? 0.28 : 0;

  return Math.max(0.01, 0.62 - strength + pressurePenalty + context.amountToCallInBigBlinds * 0.03 + stackPressure + jamPressure);
}

export function scoreCall(context: BotDecisionContext, profile: BotProfile): number {
  const strength = context.street === 'preflop' ? getPreflopStrength(context) : getPostflopStrength(context);
  const drawBonus =
    context.drawTier === 'combo-draw'
      ? 0.22
      : context.drawTier === 'flush-draw'
        ? 0.14
        : context.drawTier === 'open-ended'
          ? 0.1
          : 0;
  const potOddsBonus = Math.max(0, 0.22 - context.potOdds);
  const stackPenalty = context.callPortionOfStack * (context.stackDepthTier === 'short' ? 0.3 : 0.52);
  const jamPenalty = context.facingAllInPressure ? (context.street === 'preflop' ? 0.28 : 0.18) : 0;

  return Math.max(
    0.01,
    strength * 0.76 +
      profile.callDownLooseness * 0.3 +
      drawBonus +
      potOddsBonus -
      context.amountToCallInBigBlinds * 0.026 -
      stackPenalty -
      jamPenalty,
  );
}

export function scoreBetOrRaise(context: BotDecisionContext, profile: BotProfile): number {
  const strength = context.street === 'preflop' ? getPreflopStrength(context) : getPostflopStrength(context);
  const aggressionFactor =
    context.street === 'preflop'
      ? profile.pfr + profile.threeBet * 0.5
      : profile.cbetFrequency * 0.5 + profile.barrelFrequency * 0.3 + profile.bluffFrequency * 0.2;
  const drawBonus = context.drawTier === 'combo-draw' ? 0.16 : context.drawTier === 'flush-draw' ? 0.08 : 0;
  const bluffWindow =
    !context.hasStrongShowdownValue && context.isInPosition ? profile.bluffFrequency * 0.32 : profile.bluffFrequency * 0.12;
  const jamDiscipline =
    context.facingAllInPressure && !context.hasStrongShowdownValue && context.startingHandTier !== 'premium-pair' ? 0.28 : 0;

  return Math.max(0.01, strength * 0.86 + aggressionFactor * 0.6 + drawBonus + bluffWindow - jamDiscipline);
}
