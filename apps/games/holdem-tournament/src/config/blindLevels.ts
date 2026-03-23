import type { BlindLevel } from 'holdem/types/tournament';

export const BLIND_LEVELS: BlindLevel[] = [
  { level: 1, smallBlind: 25, bigBlind: 50, ante: 0 },
  { level: 2, smallBlind: 50, bigBlind: 100, ante: 0 },
  { level: 3, smallBlind: 100, bigBlind: 200, ante: 0 },
  { level: 4, smallBlind: 200, bigBlind: 400, ante: 25 },
  { level: 5, smallBlind: 400, bigBlind: 800, ante: 50 },
  { level: 6, smallBlind: 800, bigBlind: 1600, ante: 100 },
  { level: 7, smallBlind: 1600, bigBlind: 3200, ante: 200 },
  { level: 8, smallBlind: 3200, bigBlind: 6400, ante: 400 },
  { level: 9, smallBlind: 6400, bigBlind: 12800, ante: 800 },
  { level: 10, smallBlind: 12800, bigBlind: 25600, ante: 1600 },
  { level: 11, smallBlind: 25600, bigBlind: 51200, ante: 3200 },
  { level: 12, smallBlind: 51200, bigBlind: 102400, ante: 6400 },
];
