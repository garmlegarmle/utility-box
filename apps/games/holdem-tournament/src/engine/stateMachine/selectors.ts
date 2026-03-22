import { getAmountToCall, getLegalActions } from 'holdem/engine/rules/legalActions';
import { getBigBlindSeatIndex, getSmallBlindSeatIndex } from 'holdem/engine/rules/positions';
import type { GameState, Seat } from 'holdem/types/engine';

export function selectHumanSeat(state: GameState): Seat | undefined {
  return state.seats.find((seat) => seat.isHuman);
}

export function selectActingSeat(state: GameState): Seat | undefined {
  return state.seats.find((seat) => seat.seatIndex === state.betting.actingSeatIndex);
}

export function selectTotalPot(state: GameState): number {
  return state.seats.reduce((sum, seat) => sum + seat.totalCommitted, 0);
}

export function selectMainPot(state: GameState): number {
  if (state.hand.pots.length > 0) {
    return state.hand.pots.filter((pot) => pot.isMain).reduce((sum, pot) => sum + pot.amount, 0);
  }

  return selectTotalPot(state);
}

export function selectSidePots(state: GameState): number[] {
  return state.hand.pots.filter((pot) => !pot.isMain).map((pot) => pot.amount);
}

export function selectHumanLegalActions(state: GameState) {
  const humanSeat = selectHumanSeat(state);
  return humanSeat ? getLegalActions(state, humanSeat.playerId) : [];
}

export function selectHumanAmountToCall(state: GameState): number {
  const humanSeat = selectHumanSeat(state);
  return humanSeat ? getAmountToCall(state, humanSeat) : 0;
}

export function selectHumanMinRaiseTo(state: GameState): number | null {
  const action = selectHumanLegalActions(state).find(
    (candidate): candidate is Extract<ReturnType<typeof selectHumanLegalActions>[number], { min: number }> =>
      'min' in candidate,
  );

  return action?.min ?? null;
}

export function selectHandsUntilLevelUp(state: GameState): number {
  return Math.max(0, state.config.handsPerLevel - state.handsPlayedAtCurrentLevel);
}

export function selectSmallBlindSeatIndex(state: GameState): number | null {
  return getSmallBlindSeatIndex(state.seats, state.buttonSeatIndex);
}

export function selectBigBlindSeatIndex(state: GameState): number | null {
  return getBigBlindSeatIndex(state.seats, state.buttonSeatIndex);
}

export function selectHasWinner(state: GameState): boolean {
  return state.phase === 'tournament_complete' && state.tournamentWinnerId !== null;
}
