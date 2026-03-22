import { scoreBetOrRaise, scoreCall, scoreFold } from 'holdem/engine/ai/scoring';
import { chooseBetSize } from 'holdem/engine/ai/sizing';
import type { BotDecisionContext, BotProfile, WeightedActionCandidate } from 'holdem/types/ai';

function hasPremiumMadeHand(context: BotDecisionContext): boolean {
  return ['two-pair', 'trips', 'straight', 'flush', 'full-house', 'quads', 'straight-flush'].includes(context.madeHandTier);
}

function shouldConsiderPostflopJam(context: BotDecisionContext): boolean {
  const strongMadeHand = hasPremiumMadeHand(context);
  const drawHeavySpot = context.drawTier === 'combo-draw' || (context.drawTier !== 'none' && context.stackInBigBlinds <= 8);
  const shortStack = context.stackInBigBlinds <= 7;
  const lowSpr = context.spr <= 1.15;
  const valueJam = strongMadeHand && context.spr <= 2.1;
  const overAggressiveSpot = context.aggressionFaced >= 2 && context.stackInBigBlinds > 10 && !strongMadeHand;

  if (overAggressiveSpot) {
    return false;
  }

  return (shortStack && (strongMadeHand || drawHeavySpot)) || (lowSpr && (strongMadeHand || drawHeavySpot)) || valueJam;
}

function getPostflopRaisePenalty(context: BotDecisionContext, profile: BotProfile): number {
  let penalty = 1;
  const premiumMadeHand = hasPremiumMadeHand(context);
  const semiBluffReady = context.drawTier === 'combo-draw' || (context.drawTier !== 'none' && context.isInPosition);

  if (context.aggressionFaced >= 1) {
    penalty *= premiumMadeHand ? 0.92 : semiBluffReady ? 0.62 : 0.34;
  }

  if (context.aggressionFaced >= 2) {
    penalty *= premiumMadeHand ? 0.76 : semiBluffReady ? 0.48 : 0.18;
  }

  if (context.potIsBloated && !premiumMadeHand && context.drawTier === 'none') {
    penalty *= 0.52;
  }

  if (context.hasStrongShowdownValue && !premiumMadeHand && context.aggressionFaced >= 1) {
    penalty *= 0.62;
  }

  if (context.stackInBigBlinds <= profile.shoveThresholdShort && (premiumMadeHand || semiBluffReady)) {
    penalty *= 1.16;
  }

  const floor = profile.id === 'maniac' ? 0.14 : profile.id === 'loose-aggressive' ? 0.08 : 0.03;
  return Math.max(floor, penalty);
}

export function getPostflopCandidates(context: BotDecisionContext, profile: BotProfile): WeightedActionCandidate[] {
  const candidates: WeightedActionCandidate[] = [];
  const raisePenalty = getPostflopRaisePenalty(context, profile);
  const pressuredCallBoost =
    context.aggressionFaced > 0
      ? context.hasStrongShowdownValue || context.drawTier !== 'none'
        ? 1.12 + profile.callDownLooseness * 0.16
        : 0.88
      : 1;
  const pressuredFoldBoost =
    context.aggressionFaced >= 2 && !context.hasStrongShowdownValue && context.drawTier === 'none'
      ? 1.24
      : 1;
  const jamCallPenalty =
    context.facingAllInPressure && !hasPremiumMadeHand(context)
      ? Math.max(0.12, 0.52 - context.callPortionOfStack * 0.2 + profile.callDownLooseness * 0.1)
      : 1;
  const jamFoldBoost = context.facingAllInPressure && !hasPremiumMadeHand(context) ? 1.36 : 1;
  const jamRaisePenalty = context.facingAllInPressure && !hasPremiumMadeHand(context) ? 0.08 : 1;

  for (const legalAction of context.legalActions) {
    switch (legalAction.type) {
      case 'fold':
        candidates.push({
          type: 'fold',
          weight:
            scoreFold(context, profile) *
            (context.hasStrongShowdownValue ? 0.4 : 1) *
            (context.drawTier === 'combo-draw' ? 0.7 : 1) *
            pressuredFoldBoost *
            jamFoldBoost,
          reason: 'postflop fold logic',
        });
        break;
      case 'check':
        candidates.push({
          type: 'check',
          weight:
            Math.max(0.04, profile.potControl * 0.6 + (context.hasStrongShowdownValue ? 0.24 : 0.08)) *
            (context.isInPosition ? 1.08 : 1),
          reason: 'postflop check line',
        });
        break;
      case 'call':
        candidates.push({
          type: 'call',
          weight:
            scoreCall(context, profile) *
            (context.drawTier !== 'none' ? 1 + profile.drawChasingBias * 0.35 : 1) *
            (context.amountToCallInBigBlinds > 10 ? 0.72 : 1) *
            pressuredCallBoost *
            jamCallPenalty,
          amount: legalAction.amount,
          reason: 'postflop call and bluff-catch',
        });
        break;
      case 'bet':
        candidates.push({
          type: 'bet',
          weight:
            scoreBetOrRaise(context, profile) *
            (context.hasStrongShowdownValue
              ? 1.2
              : context.drawTier !== 'none'
                ? 0.86 + profile.bluffFrequency * 0.2
                : 0.44 + profile.bluffFrequency * 0.4),
          amount: chooseBetSize(context, profile, 'bet'),
          reason: 'postflop value or stab',
        });
        break;
      case 'raise':
        candidates.push({
          type: 'raise',
          weight:
            scoreBetOrRaise(context, profile) *
            (context.hasStrongShowdownValue
              ? 1.24
              : context.drawTier !== 'none'
                ? 0.92 + profile.checkRaiseFrequency * 0.4
              : 0.34 + profile.bluffFrequency * 0.42) *
            raisePenalty *
            jamRaisePenalty,
          amount: chooseBetSize(context, profile, 'raise'),
          reason: 'postflop raise pressure',
        });
        break;
      case 'all-in': {
        if (!shouldConsiderPostflopJam(context)) {
          break;
        }

        const jamBoost =
          context.stackDepthTier === 'short'
            ? profile.shortStackDesperation * 0.28 + 0.12
            : context.hasStrongShowdownValue
              ? 0.24
              : 0.05 + profile.bluffFrequency * 0.06;

        candidates.push({
          type: 'all-in',
          weight: Math.max(0.01, scoreBetOrRaise(context, profile) * 0.14 + jamBoost),
          amount: legalAction.amount,
          reason: 'postflop shove logic',
        });
        break;
      }
    }
  }

  return candidates;
}
