import { getPreflopStrength, scoreBetOrRaise, scoreCall, scoreFold } from 'holdem/engine/ai/scoring';
import { chooseBetSize } from 'holdem/engine/ai/sizing';
import type { BotDecisionContext, BotProfile, WeightedActionCandidate } from 'holdem/types/ai';

function shouldConsiderPreflopJam(context: BotDecisionContext, profile: BotProfile, strength: number): boolean {
  const desperateShortStack = context.stackInBigBlinds <= Math.max(5, profile.ranges.shoveBelowBb - 3);
  const shortStackPressure =
    context.stackInBigBlinds <= profile.ranges.shoveBelowBb &&
    (context.amountToCallInBigBlinds >= 2 || context.pressureTier === 'heads-up');
  const premiumReshove =
    context.startingHandTier === 'premium-pair' &&
    context.facingRaise &&
    context.effectiveStackInBigBlinds <= 24;
  const strongShortStack =
    strength >= 0.9 &&
    context.effectiveStackInBigBlinds <= 14 &&
    (context.facingRaise || context.playersRemainingInHand <= 3);

  return desperateShortStack || shortStackPressure || premiumReshove || strongShortStack;
}

function getPreflopReraisePenalty(context: BotDecisionContext, profile: BotProfile, strength: number): number {
  if (!context.facingRaise) {
    return 1;
  }

  let penalty = 0.82;

  if (context.aggressionFaced >= 1) {
    penalty *= 0.58;
  }

  if (context.aggressionFaced >= 2) {
    penalty *= 0.44;
  }

  if (context.effectiveStackInBigBlinds >= 28 && strength < 0.9) {
    penalty *= 0.72;
  }

  if (context.potIsBloated && strength < 0.92) {
    penalty *= 0.68;
  }

  if (context.startingHandTier === 'premium-pair') {
    penalty *= 1.28;
  } else if (context.startingHandTier === 'strong-broadway' || context.startingHandTier === 'medium-pair') {
    penalty *= 0.92;
  } else if (strength < 0.72) {
    penalty *= 0.76;
  }

  if (context.stackInBigBlinds <= profile.ranges.shoveBelowBb + 2) {
    penalty *= 1.18;
  }

  const floor = profile.id === 'maniac' ? 0.12 : profile.id === 'loose-aggressive' ? 0.08 : 0.03;
  return Math.max(floor, penalty);
}

export function getPreflopCandidates(context: BotDecisionContext, profile: BotProfile): WeightedActionCandidate[] {
  const candidates: WeightedActionCandidate[] = [];
  const strength = getPreflopStrength(context);
  const reraisePenalty = getPreflopReraisePenalty(context, profile, strength);
  const pressuredCallBoost =
    context.facingRaise && context.aggressionFaced > 0
      ? 1.08 + profile.callDownLooseness * 0.2 - Math.max(0, context.amountToCallInBigBlinds - 6) * 0.02
      : 1;
  const pressuredFoldBoost =
    context.facingRaise && context.aggressionFaced >= 2 && strength < 0.74
      ? 1.22 + profile.foldToRaise * 0.14
      : 1;
  const jamCallPenalty =
    context.facingAllInPressure && strength < 0.94
      ? Math.max(0.08, 0.46 - context.callPortionOfStack * 0.18 + profile.callDownLooseness * 0.08)
      : 1;
  const jamFoldBoost = context.facingAllInPressure && strength < 0.94 ? 1.44 : 1;
  const jamRaisePenalty =
    context.facingAllInPressure && context.stackDepthTier !== 'short' && context.startingHandTier !== 'premium-pair'
      ? 0.06
      : 1;

  for (const legalAction of context.legalActions) {
    switch (legalAction.type) {
      case 'fold':
        candidates.push({
          type: 'fold',
          weight:
            scoreFold(context, profile) *
            (1 - strength + profile.foldToRaise * 0.4) *
            pressuredFoldBoost *
            jamFoldBoost,
          reason: 'preflop fold weight',
        });
        break;
      case 'check':
        candidates.push({
          type: 'check',
          weight: Math.max(0.04, 0.52 - profile.pfr * 0.15 + profile.potControl * 0.2),
          reason: 'preflop check option',
        });
        break;
      case 'call':
        candidates.push({
          type: 'call',
          weight:
            scoreCall(context, profile) *
            (profile.ranges.callOpen[context.positionGroup] + profile.callDownLooseness * 0.3) *
            pressuredCallBoost *
            jamCallPenalty,
          amount: legalAction.amount,
          reason: 'preflop call range',
        });
        break;
      case 'bet':
        candidates.push({
          type: 'bet',
          weight: scoreBetOrRaise(context, profile) * (profile.ranges.open[context.positionGroup] + profile.pfr * 0.6),
          amount: chooseBetSize(context, profile, 'bet'),
          reason: 'preflop opening raise',
        });
        break;
      case 'raise':
        candidates.push({
          type: 'raise',
          weight:
            scoreBetOrRaise(context, profile) *
            (context.facingRaise ? profile.ranges.threeBet[context.positionGroup] + profile.threeBet : profile.pfr) *
            reraisePenalty *
            jamRaisePenalty,
          amount: chooseBetSize(context, profile, 'raise'),
          reason: 'preflop raise pressure',
        });
        break;
      case 'all-in': {
        if (!shouldConsiderPreflopJam(context, profile, strength)) {
          break;
        }

        const shortStackBonus =
          context.stackInBigBlinds <= profile.ranges.shoveBelowBb
            ? profile.shortStackDesperation * 0.34 + 0.08
            : context.startingHandTier === 'premium-pair'
              ? 0.22
              : 0.06;

        candidates.push({
          type: 'all-in',
          weight: Math.max(0.01, scoreBetOrRaise(context, profile) * 0.18 + shortStackBonus),
          amount: legalAction.amount,
          reason: 'preflop jam logic',
        });
        break;
      }
    }
  }

  return candidates;
}
