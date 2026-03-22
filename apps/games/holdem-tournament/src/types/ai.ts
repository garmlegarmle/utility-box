import type { Card } from 'holdem/types/cards';
import type { LegalAction, PositionName, Street } from 'holdem/types/engine';

export type BotProfileId =
  | 'tight-passive'
  | 'tight-aggressive'
  | 'loose-passive'
  | 'loose-aggressive'
  | 'calling-station'
  | 'nit'
  | 'maniac'
  | 'balanced-regular';

export type RangePositionGroup = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

export type StartingHandTier =
  | 'premium-pair'
  | 'strong-broadway'
  | 'medium-pair'
  | 'small-pair'
  | 'suited-broadway'
  | 'suited-ace'
  | 'suited-connector'
  | 'weak-broadway'
  | 'ace-x'
  | 'king-x'
  | 'trash';

export type MadeHandTier =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'trips'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'quads'
  | 'straight-flush';

export type DrawStrengthTier = 'none' | 'gutshot' | 'open-ended' | 'flush-draw' | 'combo-draw';

export type BoardTexture =
  | 'dry'
  | 'paired'
  | 'two-tone'
  | 'monotone'
  | 'coordinated'
  | 'wet';

export type StackDepthTier = 'short' | 'medium' | 'deep';
export type TournamentPressureTier = 'early' | 'middle' | 'late' | 'bubble' | 'heads-up';

export interface ProfileRangeTendencies {
  open: Record<RangePositionGroup, number>;
  callOpen: Record<RangePositionGroup, number>;
  threeBet: Record<RangePositionGroup, number>;
  defendBigBlind: number;
  shoveBelowBb: number;
}

export interface BotProfile {
  id: BotProfileId;
  name: string;
  description: string;
  color: string;
  vpip: number;
  pfr: number;
  threeBet: number;
  foldToRaise: number;
  cbetFrequency: number;
  barrelFrequency: number;
  bluffFrequency: number;
  checkRaiseFrequency: number;
  limpFrequency: number;
  shoveThresholdShort: number;
  callDownLooseness: number;
  drawChasingBias: number;
  potControl: number;
  bubblePressureFactor: number;
  shortStackDesperation: number;
  ranges: ProfileRangeTendencies;
  betSizeWeights: Record<string, number>;
}

export interface BotDecisionContext {
  playerId: string;
  seatIndex: number;
  street: Street;
  position: PositionName;
  positionGroup: RangePositionGroup;
  playersRemainingInHand: number;
  playersRemainingInTournament: number;
  stack: number;
  bigBlind: number;
  stackInBigBlinds: number;
  effectiveStackInBigBlinds: number;
  potSize: number;
  amountToCall: number;
  amountToCallInBigBlinds: number;
  callPortionOfStack: number;
  potOdds: number;
  minRaiseTo: number | null;
  isInPosition: boolean;
  previousAggressorSeatIndex: number | null;
  board: Card[];
  holeCards: [Card, Card];
  legalActions: LegalAction[];
  startingHandTier: StartingHandTier;
  madeHandTier: MadeHandTier;
  drawTier: DrawStrengthTier;
  boardTexture: BoardTexture;
  stackDepthTier: StackDepthTier;
  pressureTier: TournamentPressureTier;
  hasStrongShowdownValue: boolean;
  potIsBloated: boolean;
  aggressionFaced: number;
  spr: number;
  pairedBoard: boolean;
  monotoneBoard: boolean;
  facingRaise: boolean;
  facingAllInPressure: boolean;
  isPreflopUnopened: boolean;
  canCheck: boolean;
}

export interface WeightedActionCandidate {
  type: LegalAction['type'];
  weight: number;
  amount?: number;
  reason: string;
}

export interface BotDecision {
  action: {
    playerId: string;
    type: LegalAction['type'];
    amount?: number;
  };
  candidates: WeightedActionCandidate[];
  nextRngState: number;
}
