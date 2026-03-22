import type { BotProfileId } from 'holdem/types/ai';

export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

export interface TournamentSeatConfig {
  seatIndex: number;
  playerId: string;
  name: string;
  isHuman: boolean;
  profileId?: BotProfileId;
}

export interface TournamentConfig {
  startingStack: number;
  handsPerLevel: number;
  blindLevels: BlindLevel[];
  seats: TournamentSeatConfig[];
  betSizingBuckets: number[];
  initialButtonSeatIndex: number;
  actionDelayMs: number;
  autoProgress: boolean;
}
