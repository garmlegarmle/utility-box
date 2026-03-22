import { appendLogEntry, createLogEntry } from 'holdem/engine/log/logEvents';
import { getBigBlindSeatIndex, getFirstToActPreflop, getSmallBlindSeatIndex } from 'holdem/engine/rules/positions';
import type { GameState, Seat } from 'holdem/types/engine';

function postForcedBet(
  state: GameState,
  seat: Seat,
  amount: number,
  type: 'post-ante' | 'post-small-blind' | 'post-big-blind',
  label: string,
): void {
  const posted = Math.min(amount, seat.stack);
  seat.stack -= posted;
  seat.currentBet += type === 'post-ante' ? 0 : posted;
  seat.totalCommitted += posted;
  seat.lastAction = type;
  seat.lastActionAmount = posted;

  if (seat.stack === 0) {
    seat.isAllIn = true;
  }

  appendLogEntry(
    state,
    createLogEntry(
      state,
      seat.seatIndex,
      seat.playerId,
      seat.name,
      state.betting.street,
      type,
      posted,
      `${seat.name} - ${label} ${posted}`,
    ),
  );
}

export function postAntes(state: GameState): GameState {
  const nextState = structuredClone(state);

  if (nextState.currentLevel.ante <= 0) {
    nextState.phase = 'post_blinds';
    return nextState;
  }

  nextState.seats
    .filter((seat) => seat.status === 'active')
    .forEach((seat) => postForcedBet(nextState, seat, nextState.currentLevel.ante, 'post-ante', '앤티'));

  nextState.phase = 'post_blinds';
  return nextState;
}

export function postBlinds(state: GameState): GameState {
  const nextState = structuredClone(state);
  const smallBlindSeatIndex = getSmallBlindSeatIndex(nextState.seats, nextState.buttonSeatIndex);
  const bigBlindSeatIndex = getBigBlindSeatIndex(nextState.seats, nextState.buttonSeatIndex);

  if (smallBlindSeatIndex === null || bigBlindSeatIndex === null) {
    nextState.tournamentWinnerId = nextState.seats.find((seat) => seat.status === 'active')?.playerId ?? null;
    nextState.tournamentCompletionReason = 'winner';
    nextState.phase = 'tournament_complete';
    return nextState;
  }

  const smallBlindSeat = nextState.seats.find((seat) => seat.seatIndex === smallBlindSeatIndex)!;
  const bigBlindSeat = nextState.seats.find((seat) => seat.seatIndex === bigBlindSeatIndex)!;

  postForcedBet(nextState, smallBlindSeat, nextState.currentLevel.smallBlind, 'post-small-blind', '스몰 블라인드');
  postForcedBet(nextState, bigBlindSeat, nextState.currentLevel.bigBlind, 'post-big-blind', '빅 블라인드');

  nextState.betting.street = 'preflop';
  nextState.betting.currentBet = nextState.currentLevel.bigBlind;
  nextState.betting.minBringIn = nextState.currentLevel.bigBlind;
  nextState.betting.lastFullRaiseSize = nextState.currentLevel.bigBlind;
  nextState.betting.fullRaiseCount = 1;
  nextState.betting.minRaiseTo = nextState.currentLevel.bigBlind * 2;
  nextState.betting.previousAggressorSeatIndex = null;
  nextState.betting.lastAggressorSeatIndex = null;
  nextState.betting.actingSeatIndex = getFirstToActPreflop(nextState.seats, nextState.buttonSeatIndex);
  nextState.phase = 'deal_hole_cards';

  return nextState;
}
