import type { Seat } from 'holdem/types/engine';

export function getTournamentActiveSeats(seats: Seat[]): Seat[] {
  return seats.filter((seat) => seat.status === 'active');
}

export function getTournamentActiveSeatIndices(seats: Seat[]): number[] {
  return getTournamentActiveSeats(seats).map((seat) => seat.seatIndex);
}

export function getHandContenders(seats: Seat[]): Seat[] {
  return seats.filter((seat) => seat.status === 'active' && !seat.hasFolded);
}

export function getHandContenderIndices(seats: Seat[]): number[] {
  return getHandContenders(seats).map((seat) => seat.seatIndex);
}

export function getPlayersAbleToAct(seats: Seat[]): Seat[] {
  return seats.filter((seat) => seat.status === 'active' && !seat.hasFolded && !seat.isAllIn);
}

export function getCircularSeatOrder(seatIndices: number[], fromSeatIndex: number): number[] {
  const sorted = [...seatIndices].sort((left, right) => left - right);
  const firstGreaterIndex = sorted.findIndex((seatIndex) => seatIndex > fromSeatIndex);

  if (firstGreaterIndex === -1) {
    return [...sorted];
  }

  return [...sorted.slice(firstGreaterIndex), ...sorted.slice(0, firstGreaterIndex)];
}

export function getNextOccupiedSeatIndex(fromSeatIndex: number, seats: Seat[]): number | null {
  const occupied = getTournamentActiveSeatIndices(seats);

  if (occupied.length === 0) {
    return null;
  }

  return getCircularSeatOrder(occupied, fromSeatIndex)[0] ?? null;
}

export function countRemainingPlayers(seats: Seat[]): number {
  return getTournamentActiveSeats(seats).length;
}
