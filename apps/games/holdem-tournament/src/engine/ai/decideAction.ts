import { AI_PROFILES } from 'holdem/config/aiProfiles';
import { normalizeSeed, randomFloat, randomInt } from 'holdem/engine/core/rng';
import { buildBotDecisionContext } from 'holdem/engine/ai/context';
import { getPostflopCandidates } from 'holdem/engine/ai/postflop';
import { getPreflopCandidates } from 'holdem/engine/ai/preflop';
import { pickWeightedAction } from 'holdem/engine/ai/sizing';
import type { BotDecision, BotProfileId } from 'holdem/types/ai';
import type { GameState } from 'holdem/types/engine';

const HAND_STYLE_DRIFT_OPTIONS: Record<BotProfileId, BotProfileId[]> = {
  'tight-passive': ['nit', 'tight-aggressive'],
  'tight-aggressive': ['tight-passive', 'balanced-regular'],
  'loose-passive': ['calling-station', 'loose-aggressive'],
  'loose-aggressive': ['balanced-regular', 'maniac'],
  'calling-station': ['loose-passive', 'tight-passive'],
  nit: ['tight-passive', 'tight-aggressive'],
  maniac: ['loose-aggressive', 'balanced-regular'],
  'balanced-regular': ['tight-aggressive', 'loose-aggressive'],
};

function getHandProfileId(state: GameState, playerId: string, baseProfileId: BotProfileId): BotProfileId {
  const seat = state.seats.find((candidate) => candidate.playerId === playerId);

  if (!seat || seat.isHuman) {
    return baseProfileId;
  }

  let derivedSeed = normalizeSeed(
    state.ui.lastSeed ^
      Math.imul(state.hand.handNumber + 1, 0x9e3779b1) ^
      Math.imul(seat.seatIndex + 1, 0x85ebca6b),
  );
  const driftRoll = randomFloat(derivedSeed);
  derivedSeed = driftRoll.nextState;

  if (driftRoll.value >= 0.13) {
    return baseProfileId;
  }

  const options = HAND_STYLE_DRIFT_OPTIONS[baseProfileId];

  if (!options || options.length === 0) {
    return baseProfileId;
  }

  const selected = randomInt(derivedSeed, options.length);
  return options[selected.value] ?? baseProfileId;
}

export function decideBotAction(state: GameState, playerId: string): BotDecision {
  const seat = state.seats.find((candidate) => candidate.playerId === playerId)!;
  const baseProfileId = seat.profileId ?? 'balanced-regular';
  const handProfileId = getHandProfileId(state, playerId, baseProfileId);
  const profile = AI_PROFILES[handProfileId] ?? AI_PROFILES['balanced-regular'];
  const context = buildBotDecisionContext(state, playerId);
  const candidates =
    context.street === 'preflop' ? getPreflopCandidates(context, profile) : getPostflopCandidates(context, profile);
  const filtered = candidates.filter((candidate) => candidate.weight > 0);
  const { candidate, nextSeed } = pickWeightedAction(state.rngState, filtered.length > 0 ? filtered : candidates);

  return {
    action: {
      playerId,
      type: candidate.type,
      amount: candidate.amount,
    },
    candidates,
    nextRngState: nextSeed,
  };
}
