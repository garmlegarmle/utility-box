import type { BlindLevel } from 'holdem/types/tournament';

export const BLIND_LEVELS: BlindLevel[] = [
  { level: 1, smallBlind: 25, bigBlind: 50, ante: 0 },
  { level: 2, smallBlind: 50, bigBlind: 100, ante: 0 },
  { level: 3, smallBlind: 75, bigBlind: 150, ante: 0 },
  { level: 4, smallBlind: 100, bigBlind: 200, ante: 0 },
  { level: 5, smallBlind: 125, bigBlind: 250, ante: 25 },
  { level: 6, smallBlind: 150, bigBlind: 300, ante: 25 },
  { level: 7, smallBlind: 200, bigBlind: 400, ante: 50 },
  { level: 8, smallBlind: 300, bigBlind: 600, ante: 75 },
  { level: 9, smallBlind: 400, bigBlind: 800, ante: 100 },
  { level: 10, smallBlind: 500, bigBlind: 1000, ante: 100 },
  { level: 11, smallBlind: 600, bigBlind: 1200, ante: 200 },
  { level: 12, smallBlind: 800, bigBlind: 1600, ante: 200 },
  { level: 13, smallBlind: 1000, bigBlind: 2000, ante: 300 },
  { level: 14, smallBlind: 1500, bigBlind: 3000, ante: 400 },
  { level: 15, smallBlind: 2000, bigBlind: 4000, ante: 500 },
];
