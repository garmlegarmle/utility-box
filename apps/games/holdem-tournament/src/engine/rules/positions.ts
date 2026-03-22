import { getCircularSeatOrder } from 'holdem/engine/core/seating';
import type { PositionName, Seat } from 'holdem/types/engine';

const POSITION_LABELS: Record<number, PositionName[]> = {
  2: ['BTN', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'UTG'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'LJ', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'],
};

export function assignTablePositions(seats: Seat[], buttonSeatIndex: number): Seat[] {
  const occupiedSeatIndices = seats
    .filter((seat) => seat.status === 'active')
    .map((seat) => seat.seatIndex);
  const ordered = getCircularSeatOrder(occupiedSeatIndices, buttonSeatIndex - 1);
  const labels = POSITION_LABELS[ordered.length] ?? POSITION_LABELS[9];

  return seats.map((seat) => {
    const positionIndex = ordered.findIndex((seatIndex) => seatIndex === seat.seatIndex);
    const positionLabels = labels ?? POSITION_LABELS[9]!;

    return {
      ...seat,
      position: positionIndex === -1 ? null : positionLabels[positionIndex] ?? null,
    };
  });
}

export function getSmallBlindSeatIndex(seats: Seat[], buttonSeatIndex: number): number | null {
  const occupied = seats.filter((seat) => seat.status === 'active').map((seat) => seat.seatIndex);

  if (occupied.length < 2) {
    return null;
  }

  if (occupied.length === 2) {
    return buttonSeatIndex;
  }

  return getCircularSeatOrder(occupied, buttonSeatIndex)[0] ?? null;
}

export function getBigBlindSeatIndex(seats: Seat[], buttonSeatIndex: number): number | null {
  const occupied = seats.filter((seat) => seat.status === 'active').map((seat) => seat.seatIndex);

  if (occupied.length < 2) {
    return null;
  }

  if (occupied.length === 2) {
    return getCircularSeatOrder(occupied, buttonSeatIndex)[0] ?? null;
  }

  const ordered = getCircularSeatOrder(occupied, buttonSeatIndex);
  return ordered[1] ?? null;
}

export function getFirstToActPreflop(seats: Seat[], buttonSeatIndex: number): number | null {
  const occupied = seats.filter((seat) => seat.status === 'active').map((seat) => seat.seatIndex);
  const eligible = seats
    .filter((seat) => seat.status === 'active' && !seat.hasFolded && !seat.isAllIn)
    .map((seat) => seat.seatIndex);

  if (occupied.length < 2) {
    return null;
  }

  if (occupied.length === 2) {
    return eligible.includes(buttonSeatIndex)
      ? buttonSeatIndex
      : getCircularSeatOrder(eligible, buttonSeatIndex)[0] ?? null;
  }

  const bigBlindSeat = getBigBlindSeatIndex(seats, buttonSeatIndex);

  if (bigBlindSeat === null) {
    return null;
  }

  return getCircularSeatOrder(eligible, bigBlindSeat)[0] ?? null;
}

export function getFirstToActPostflop(seats: Seat[], buttonSeatIndex: number): number | null {
  const occupied = seats.filter((seat) => seat.status === 'active').map((seat) => seat.seatIndex);
  const eligible = seats
    .filter((seat) => seat.status === 'active' && !seat.hasFolded && !seat.isAllIn)
    .map((seat) => seat.seatIndex);

  if (occupied.length < 2) {
    return null;
  }

  return getCircularSeatOrder(eligible, buttonSeatIndex)[0] ?? null;
}
