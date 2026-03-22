import type { BlindLevel, TournamentConfig } from 'holdem/types/tournament';

export function getBlindLevel(config: TournamentConfig, levelIndex: number): BlindLevel {
  return config.blindLevels[Math.min(levelIndex, config.blindLevels.length - 1)]!;
}

export function advanceBlindLevel(levelIndex: number, config: TournamentConfig): number {
  return Math.min(levelIndex + 1, config.blindLevels.length - 1);
}
