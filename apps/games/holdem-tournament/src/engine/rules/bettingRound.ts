import { getCircularSeatOrder, getHandContenders } from 'holdem/engine/core/seating';
import { appendLogEntry, createLogEntry } from 'holdem/engine/log/logEvents';
import { getAmountToCall, getLegalActions, isActionLegal } from 'holdem/engine/rules/legalActions';
import type { GameState, PlayerAction, Seat } from 'holdem/types/engine';

function findSeat(state: GameState, playerId: string): Seat | undefined {
  return state.seats.find((seat) => seat.playerId === playerId);
}

function commitChips(seat: Seat, targetBet: number): number {
  const desiredAdditional = Math.max(0, targetBet - seat.currentBet);
  const committed = Math.min(desiredAdditional, seat.stack);

  seat.stack -= committed;
  seat.currentBet += committed;
  seat.totalCommitted += committed;

  if (seat.stack === 0) {
    seat.isAllIn = true;
  }

  return committed;
}

function isOnlyOneContenderLeft(state: GameState): boolean {
  return getHandContenders(state.seats).length === 1;
}

function getNextStreetPhase(street: GameState['betting']['street']): GameState['phase'] {
  switch (street) {
    case 'preflop':
      return 'deal_flop';
    case 'flop':
      return 'deal_turn';
    case 'turn':
      return 'deal_river';
    case 'river':
    case 'showdown':
      return 'showdown';
  }
}

function findNextActingSeatIndex(state: GameState, fromSeatIndex: number): number | null {
  const activeSeatIndices = state.seats
    .filter((seat) => seat.status === 'active')
    .map((seat) => seat.seatIndex);
  const ordered = getCircularSeatOrder(activeSeatIndices, fromSeatIndex);

  for (const seatIndex of ordered) {
    const seat = state.seats.find((candidate) => candidate.seatIndex === seatIndex);

    if (!seat || seat.hasFolded || seat.isAllIn) {
      continue;
    }

    if (!seat.actedThisStreet || seat.currentBet !== state.betting.currentBet) {
      return seat.seatIndex;
    }
  }

  return null;
}

function logAction(state: GameState, seat: Seat, amount: number, text: string): void {
  appendLogEntry(
    state,
    createLogEntry(
      state,
      seat.seatIndex,
      seat.playerId,
      seat.name,
      state.betting.street,
      seat.lastAction ?? 'check',
      amount,
      text,
    ),
  );
}

export function applyPlayerAction(state: GameState, action: PlayerAction): GameState {
  const nextState = structuredClone(state);
  const seat = findSeat(nextState, action.playerId);

  if (!seat || seat.status !== 'active' || seat.hasFolded || seat.isAllIn) {
    return state;
  }

  if (nextState.betting.actingSeatIndex !== seat.seatIndex) {
    return state;
  }

  if (!isActionLegal(nextState, action.playerId, action.type, action.amount)) {
    return state;
  }

  const amountToCall = getAmountToCall(nextState, seat);
  const previousBet = nextState.betting.currentBet;

  switch (action.type) {
    case 'fold': {
      seat.hasFolded = true;
      seat.lastAction = 'fold';
      seat.lastActionAmount = 0;
      seat.actedThisStreet = true;
      seat.lastFullRaiseSeen = nextState.betting.fullRaiseCount;
      logAction(nextState, seat, 0, `${seat.name} 폴드`);
      break;
    }
    case 'check': {
      seat.lastAction = 'check';
      seat.lastActionAmount = 0;
      seat.actedThisStreet = true;
      seat.lastFullRaiseSeen = nextState.betting.fullRaiseCount;
      logAction(nextState, seat, 0, `${seat.name} 체크`);
      break;
    }
    case 'call': {
      const committed = commitChips(seat, seat.currentBet + amountToCall);
      seat.lastAction = 'call';
      seat.lastActionAmount = committed;
      seat.actedThisStreet = true;
      seat.lastFullRaiseSeen = nextState.betting.fullRaiseCount;
      logAction(nextState, seat, committed, `${seat.name} 콜 ${committed}`);
      break;
    }
    case 'bet':
    case 'raise':
    case 'all-in': {
      const legalActions = getLegalActions(nextState, action.playerId);
      const requestedAmount =
        action.type === 'all-in'
          ? seat.currentBet + seat.stack
          : action.amount ??
            (legalActions.find(
              (legalAction): legalAction is Extract<(typeof legalActions)[number], { min: number }> =>
                legalAction.type === action.type && 'min' in legalAction,
            )?.min ??
              (seat.currentBet + seat.stack));
      const targetBet = Math.max(seat.currentBet, requestedAmount);
      const committed = commitChips(seat, targetBet);
      const raiseSize = seat.currentBet - previousBet;
      const isOpeningBet = previousBet === 0 && seat.currentBet > 0;
      const isFullRaise =
        isOpeningBet ? seat.currentBet >= nextState.betting.minBringIn : raiseSize >= nextState.betting.lastFullRaiseSize;

      nextState.betting.currentBet = Math.max(nextState.betting.currentBet, seat.currentBet);
      nextState.betting.lastAggressorSeatIndex = seat.seatIndex;

      if (isOpeningBet) {
        nextState.betting.fullRaiseCount = 1;
        if (isFullRaise) {
          nextState.betting.lastFullRaiseSize = seat.currentBet;
        }
      } else if (seat.currentBet > previousBet && isFullRaise) {
        nextState.betting.fullRaiseCount += 1;
        nextState.betting.lastFullRaiseSize = raiseSize;
      }

      nextState.betting.minRaiseTo = nextState.betting.currentBet + nextState.betting.lastFullRaiseSize;
      seat.lastAction = action.type;
      seat.lastActionAmount = committed;
      seat.actedThisStreet = true;
      seat.lastFullRaiseSeen = nextState.betting.fullRaiseCount;

      const text =
        action.type === 'bet'
          ? `${seat.name} 베팅 ${seat.currentBet}`
          : action.type === 'raise'
            ? `${seat.name} 레이즈 ${seat.currentBet}`
            : `${seat.name} 올인 ${seat.currentBet}`;
      logAction(nextState, seat, committed, text);
      break;
    }
  }

  nextState.ui.raiseInput = nextState.betting.minRaiseTo;

  if (isOnlyOneContenderLeft(nextState)) {
    nextState.betting.actingSeatIndex = null;
    nextState.phase = 'award_pots';
    return nextState;
  }

  const nextActor = findNextActingSeatIndex(nextState, seat.seatIndex);

  if (nextActor !== null) {
    nextState.betting.actingSeatIndex = nextActor;
    return nextState;
  }

  nextState.betting.actingSeatIndex = null;
  nextState.phase = getNextStreetPhase(nextState.betting.street);

  return nextState;
}
