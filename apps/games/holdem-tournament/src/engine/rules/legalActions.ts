import type { GameState, LegalAction, Seat } from 'holdem/types/engine';

function canRaise(state: GameState, seat: Seat, amountToCall: number): boolean {
  if (seat.stack <= amountToCall) {
    return false;
  }

  if (!seat.actedThisStreet) {
    return true;
  }

  return seat.lastFullRaiseSeen < state.betting.fullRaiseCount;
}

export function getAmountToCall(state: GameState, seat: Seat): number {
  return Math.max(0, state.betting.currentBet - seat.currentBet);
}

export function getLegalActions(state: GameState, playerId: string): LegalAction[] {
  const seat = state.seats.find((candidate) => candidate.playerId === playerId);

  if (!seat || seat.status !== 'active' || seat.hasFolded || seat.isAllIn) {
    return [];
  }

  if (state.betting.actingSeatIndex !== seat.seatIndex) {
    return [];
  }

  const actions: LegalAction[] = [];
  const amountToCall = getAmountToCall(state, seat);
  const maxBet = seat.currentBet + seat.stack;
  const hasUnopenedPot = state.betting.currentBet === 0;

  if (amountToCall > 0) {
    actions.push({ type: 'fold' });
  } else {
    actions.push({ type: 'check' });
  }

  if (amountToCall > 0 && seat.stack > amountToCall) {
    actions.push({
      type: 'call',
      amount: amountToCall,
      toCall: amountToCall,
    });
  }

  if (hasUnopenedPot) {
    if (seat.stack >= state.betting.minBringIn) {
      actions.push({
        type: 'bet',
        min: state.betting.minBringIn,
        max: seat.stack,
      });
    }
  } else if (canRaise(state, seat, amountToCall) && maxBet >= state.betting.minRaiseTo) {
    actions.push({
      type: 'raise',
      min: state.betting.minRaiseTo,
      max: maxBet,
      toCall: amountToCall,
    });
  }

  if (seat.stack > 0) {
    actions.push({
      type: 'all-in',
      amount: maxBet,
      toCall: amountToCall,
      isRaise: maxBet > state.betting.currentBet,
    });
  }

  return actions;
}

export function isActionLegal(state: GameState, playerId: string, type: LegalAction['type'], amount?: number): boolean {
  return getLegalActions(state, playerId).some((action) => {
    if (action.type !== type) {
      return false;
    }

    if ((action.type === 'bet' || action.type === 'raise') && amount !== undefined) {
      return amount >= action.min && amount <= action.max;
    }

    return true;
  });
}
