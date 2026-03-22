import {
  classifyBoardTexture,
  classifyDrawStrength,
  classifyMadeHand,
  classifyStartingHand,
  getStackDepthTier,
  getTournamentPressureTier,
} from 'holdem/engine/ai/classifiers';
import { getPlayersAbleToAct } from 'holdem/engine/core/seating';
import { getAmountToCall, getLegalActions } from 'holdem/engine/rules/legalActions';
import type { BotDecisionContext, RangePositionGroup } from 'holdem/types/ai';
import type { Card } from 'holdem/types/cards';
import type { GameState, PositionName, Seat } from 'holdem/types/engine';

function toPositionGroup(position: PositionName, playerCount: number, street: GameState['betting']['street']): RangePositionGroup {
  if (position === 'BB') {
    return 'BB';
  }

  if (position === 'SB') {
    return 'SB';
  }

  if (position === 'BTN') {
    return playerCount === 2 && street === 'preflop' ? 'SB' : 'BTN';
  }

  if (position === 'CO' || position === 'HJ') {
    return 'CO';
  }

  if (position === 'MP' || position === 'LJ') {
    return 'MP';
  }

  return 'UTG';
}

function getEffectiveStackInBigBlinds(state: GameState, seat: Seat): number {
  const opponents = state.seats.filter((candidate) => candidate.status === 'active' && candidate.playerId !== seat.playerId && !candidate.hasFolded);
  const effectiveStack = opponents.reduce((minimum, opponent) => Math.min(minimum, opponent.stack + opponent.currentBet), seat.stack + seat.currentBet);
  return effectiveStack / state.currentLevel.bigBlind;
}

function hasStrongShowdownValue(madeHandTier: BotDecisionContext['madeHandTier']): boolean {
  return !['high-card'].includes(madeHandTier);
}

function getAggressionFaced(state: GameState, seat: Seat): number {
  return state.log.filter(
    (entry) =>
      entry.handNumber === state.hand.handNumber &&
      entry.street === state.betting.street &&
      entry.seatIndex !== seat.seatIndex &&
      ['bet', 'raise', 'all-in'].includes(entry.type),
  ).length;
}

export function buildBotDecisionContext(state: GameState, playerId: string): BotDecisionContext {
  const seat = state.seats.find((candidate) => candidate.playerId === playerId)!;
  const holeCards = seat.holeCards as [Card, Card];
  const legalActions = getLegalActions(state, playerId);
  const amountToCall = getAmountToCall(state, seat);
  const callPortionOfStack = amountToCall / Math.max(1, seat.stack);
  const amountToCallInBigBlinds = amountToCall / state.currentLevel.bigBlind;
  const potSize = state.seats.reduce((sum, candidate) => sum + candidate.totalCommitted, 0);
  const stackInBigBlinds = seat.stack / state.currentLevel.bigBlind;
  const effectiveStackInBigBlinds = getEffectiveStackInBigBlinds(state, seat);
  const playerCount = state.seats.filter((candidate) => candidate.status === 'active').length;
  const position = seat.position ?? 'UTG';
  const positionGroup = toPositionGroup(position, playerCount, state.betting.street);
  const madeHandTier = classifyMadeHand(holeCards, state.hand.communityCards);
  const drawTier = classifyDrawStrength(holeCards, state.hand.communityCards);
  const boardTexture = classifyBoardTexture(state.hand.communityCards);

  return {
    playerId,
    seatIndex: seat.seatIndex,
    street: state.betting.street,
    position,
    positionGroup,
    playersRemainingInHand: state.seats.filter((candidate) => candidate.status === 'active' && !candidate.hasFolded).length,
    playersRemainingInTournament: state.seats.filter((candidate) => candidate.status === 'active').length,
    stack: seat.stack,
    bigBlind: state.currentLevel.bigBlind,
    stackInBigBlinds,
    effectiveStackInBigBlinds,
    potSize,
    amountToCall,
    amountToCallInBigBlinds,
    callPortionOfStack,
    potOdds: amountToCall > 0 ? amountToCall / Math.max(1, potSize + amountToCall) : 0,
    minRaiseTo:
      legalActions.find((action) => action.type === 'raise' && 'min' in action)?.min ??
      legalActions.find((action) => action.type === 'bet' && 'min' in action)?.min ??
      null,
    isInPosition:
      getPlayersAbleToAct(state.seats).slice(-1)[0]?.playerId === seat.playerId || position === 'BTN',
    previousAggressorSeatIndex: state.betting.previousAggressorSeatIndex ?? state.betting.lastAggressorSeatIndex,
    board: state.hand.communityCards,
    holeCards,
    legalActions,
    startingHandTier: classifyStartingHand(holeCards),
    madeHandTier,
    drawTier,
    boardTexture,
    stackDepthTier: getStackDepthTier(stackInBigBlinds),
    pressureTier: getTournamentPressureTier(playerCount),
    hasStrongShowdownValue: hasStrongShowdownValue(madeHandTier),
    potIsBloated: potSize >= state.currentLevel.bigBlind * 12,
    aggressionFaced: getAggressionFaced(state, seat),
    spr: effectiveStackInBigBlinds / Math.max(1, potSize / state.currentLevel.bigBlind),
    pairedBoard: boardTexture === 'paired',
    monotoneBoard: boardTexture === 'monotone',
    facingRaise: state.betting.lastAggressorSeatIndex !== null || state.betting.currentBet > state.currentLevel.bigBlind,
    facingAllInPressure:
      amountToCall > 0 && (callPortionOfStack >= 0.5 || amountToCallInBigBlinds >= Math.max(12, stackInBigBlinds * 0.55)),
    isPreflopUnopened: state.betting.street === 'preflop' && state.betting.lastAggressorSeatIndex === null,
    canCheck: legalActions.some((action) => action.type === 'check'),
  };
}
