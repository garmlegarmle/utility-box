import { buildPots } from 'holdem/engine/pots/buildPots';
import { distributePots } from 'holdem/engine/pots/distributePots';
import type { GameState, Payout } from 'holdem/types/engine';

export function resolveShowdown(state: GameState): Pick<GameState['hand'], 'pots' | 'payouts' | 'showdown' | 'winnerMessage'> {
  const contenders = state.seats.filter((seat) => seat.status === 'active' && seat.totalCommitted > 0);
  const pots = buildPots(state.seats);

  if (contenders.filter((seat) => !seat.hasFolded).length === 1) {
    const winner = contenders.find((seat) => !seat.hasFolded)!;
    const totalPot = state.seats.reduce((sum, seat) => sum + seat.totalCommitted, 0);
    const payouts: Payout[] = [
      {
        potId: 'main',
        playerId: winner.playerId,
        amount: totalPot,
        isOddChip: false,
      },
    ];

    return {
      pots,
      payouts,
      showdown: [],
      winnerMessage: `${winner.name}이(가) 승부 없이 ${totalPot} 칩을 가져갑니다.`,
    };
  }

  const { payouts, showdown } = distributePots(
    pots,
    state.seats.filter((seat) => !seat.hasFolded),
    state.hand.communityCards,
    state.buttonSeatIndex,
  );
  const winnerNames = [...new Set(payouts.map((payout) => state.seats.find((seat) => seat.playerId === payout.playerId)?.name ?? payout.playerId))];

  return {
    pots,
    payouts,
    showdown,
    winnerMessage:
      winnerNames.length === 1
        ? `${winnerNames[0]}이(가) 핸드를 가져갑니다.`
        : `${winnerNames.join(', ')}이(가) 팟을 나눠 가집니다.`,
  };
}
