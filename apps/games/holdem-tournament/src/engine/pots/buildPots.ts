import type { Pot, Seat } from 'holdem/types/engine';

export function buildPots(seats: Seat[]): Pot[] {
  const contributors = seats
    .filter((seat) => seat.totalCommitted > 0)
    .sort((left, right) => left.totalCommitted - right.totalCommitted);

  if (contributors.length === 0) {
    return [];
  }

  const uniqueLevels = [...new Set(contributors.map((seat) => seat.totalCommitted))];
  let previousLevel = 0;
  const pots: Pot[] = [];

  uniqueLevels.forEach((level, index) => {
    const involved = contributors.filter((seat) => seat.totalCommitted >= level);
    const layerContribution = level - previousLevel;
    const amount = layerContribution * involved.length;
    const eligiblePlayers = involved.filter((seat) => !seat.hasFolded).map((seat) => seat.playerId);

    if (amount > 0 && eligiblePlayers.length > 0) {
      const contributions = Object.fromEntries(
        involved.map((seat) => [seat.playerId, layerContribution]),
      ) as Record<string, number>;

      pots.push({
        id: index === 0 ? 'main' : `side-${index}`,
        amount,
        eligiblePlayerIds: eligiblePlayers,
        contributions,
        isMain: index === 0,
      });
    }

    previousLevel = level;
  });

  return pots;
}
