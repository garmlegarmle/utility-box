import { getCircularSeatOrder } from 'holdem/engine/core/seating';
import { compareHands, evaluateBestHand } from 'holdem/engine/evaluators/handEvaluator';
import type { Card } from 'holdem/types/cards';
import type { Payout, Pot, Seat, ShowdownResult } from 'holdem/types/engine';

function getOddChipOrder(buttonSeatIndex: number, seats: Seat[], winnerIds: string[]): Seat[] {
  const winners = seats.filter((seat) => winnerIds.includes(seat.playerId));
  const orderedSeatIndices = getCircularSeatOrder(
    winners.map((seat) => seat.seatIndex),
    buttonSeatIndex,
  );

  return orderedSeatIndices
    .map((seatIndex) => winners.find((seat) => seat.seatIndex === seatIndex))
    .filter((seat): seat is Seat => Boolean(seat));
}

export function distributePots(
  pots: Pot[],
  seats: Seat[],
  communityCards: Card[],
  buttonSeatIndex: number,
): { payouts: Payout[]; showdown: ShowdownResult[] } {
  const activeSeats = seats.filter((seat) => !seat.hasFolded && seat.holeCards.length === 2);
  const evaluatedHands = new Map(
    activeSeats.map((seat) => [
      seat.playerId,
      evaluateBestHand([...seat.holeCards, ...communityCards]),
    ]),
  );

  const payouts: Payout[] = [];
  const showdown: ShowdownResult[] = [];

  for (const pot of pots) {
    const contenders = pot.eligiblePlayerIds
      .map((playerId) => activeSeats.find((seat) => seat.playerId === playerId))
      .filter((seat): seat is Seat => Boolean(seat));

    if (contenders.length === 0) {
      continue;
    }

    let bestSeat = contenders[0]!;
    let bestHand = evaluatedHands.get(bestSeat.playerId)!;
    const winners: Seat[] = [bestSeat];

    for (const contender of contenders.slice(1)) {
      const contenderHand = evaluatedHands.get(contender.playerId)!;
      const comparison = compareHands(contenderHand, bestHand);

      if (comparison > 0) {
        bestSeat = contender;
        bestHand = contenderHand;
        winners.splice(0, winners.length, contender);
      } else if (comparison === 0) {
        winners.push(contender);
      }
    }

    const evenShare = Math.floor(pot.amount / winners.length);
    let oddChips = pot.amount % winners.length;
    const oddChipOrder = getOddChipOrder(buttonSeatIndex, contenders, winners.map((winner) => winner.playerId));

    for (const winner of winners) {
      payouts.push({
        potId: pot.id,
        playerId: winner.playerId,
        amount: evenShare,
        isOddChip: false,
        handLabel: evaluatedHands.get(winner.playerId)?.label,
      });
    }

    for (const oddChipWinner of oddChipOrder) {
      if (oddChips <= 0) {
        break;
      }

      payouts.push({
        potId: pot.id,
        playerId: oddChipWinner.playerId,
        amount: 1,
        isOddChip: true,
        handLabel: evaluatedHands.get(oddChipWinner.playerId)?.label,
      });
      oddChips -= 1;
    }

    showdown.push({
      potId: pot.id,
      contenders: contenders.map((seat) => ({
        playerId: seat.playerId,
        seatIndex: seat.seatIndex,
        hand: evaluatedHands.get(seat.playerId)!,
      })),
      winners: winners.map((winner) => winner.playerId),
    });
  }

  return { payouts, showdown };
}
