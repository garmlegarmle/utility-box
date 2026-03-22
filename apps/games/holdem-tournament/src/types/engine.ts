import type { BotProfileId } from 'holdem/types/ai';
import type { Card } from 'holdem/types/cards';
import type { BlindLevel, TournamentConfig } from 'holdem/types/tournament';
import type { UIState } from 'holdem/types/ui';

export type Phase =
  | 'tournament_init'
  | 'hand_setup'
  | 'post_antes'
  | 'post_blinds'
  | 'deal_hole_cards'
  | 'preflop_action'
  | 'deal_flop'
  | 'flop_action'
  | 'deal_turn'
  | 'turn_action'
  | 'deal_river'
  | 'river_action'
  | 'showdown'
  | 'award_pots'
  | 'eliminate_players'
  | 'move_button'
  | 'level_up_check'
  | 'next_hand'
  | 'tournament_complete';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type PlayerStatus = 'active' | 'busted';
export type TournamentCompletionReason = 'winner' | 'human-busted';

export type PositionName =
  | 'BTN'
  | 'SB'
  | 'BB'
  | 'UTG'
  | 'UTG+1'
  | 'MP'
  | 'LJ'
  | 'HJ'
  | 'CO';

export type PlayerActionType =
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'all-in'
  | 'post-ante'
  | 'post-small-blind'
  | 'post-big-blind'
  | 'info'
  | 'win'
  | 'showdown'
  | 'eliminated';

export interface Seat {
  seatIndex: number;
  playerId: string;
  name: string;
  isHuman: boolean;
  profileId?: BotProfileId;
  stack: number;
  status: PlayerStatus;
  eliminationOrder: number | null;
  holeCards: Card[];
  hasFolded: boolean;
  isAllIn: boolean;
  hasShownCards: boolean;
  currentBet: number;
  totalCommitted: number;
  actedThisStreet: boolean;
  lastFullRaiseSeen: number;
  lastAction: PlayerActionType | null;
  lastActionAmount: number;
  winningsThisHand: number;
  position: PositionName | null;
}

export interface DeckState {
  cards: Card[];
  nextIndex: number;
}

export interface BettingState {
  street: Street;
  actingSeatIndex: number | null;
  currentBet: number;
  minBringIn: number;
  lastFullRaiseSize: number;
  fullRaiseCount: number;
  minRaiseTo: number;
  previousAggressorSeatIndex: number | null;
  lastAggressorSeatIndex: number | null;
}

export interface Pot {
  id: string;
  amount: number;
  eligiblePlayerIds: string[];
  contributions: Record<string, number>;
  isMain: boolean;
}

export interface Payout {
  potId: string;
  playerId: string;
  amount: number;
  isOddChip: boolean;
  handLabel?: string;
}

export interface ActionLogEntry {
  id: string;
  handNumber: number;
  level: number;
  street: Street;
  seatIndex: number;
  playerId: string;
  name: string;
  type: PlayerActionType;
  amount: number;
  text: string;
}

export interface HandRankResult {
  category: number;
  categoryName: string;
  tiebreakers: number[];
  bestFive: Card[];
  label: string;
}

export interface ShowdownEntry {
  playerId: string;
  seatIndex: number;
  hand: HandRankResult;
}

export interface ShowdownResult {
  potId: string;
  contenders: ShowdownEntry[];
  winners: string[];
}

export interface HandState {
  handNumber: number;
  deck: DeckState;
  communityCards: Card[];
  pots: Pot[];
  payouts: Payout[];
  showdown: ShowdownResult[];
  winnerMessage: string | null;
  completed: boolean;
}

export interface LegalActionBase {
  type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';
}

export interface FoldAction extends LegalActionBase {
  type: 'fold';
}

export interface CheckAction extends LegalActionBase {
  type: 'check';
}

export interface CallAction extends LegalActionBase {
  type: 'call';
  amount: number;
  toCall: number;
}

export interface BetAction extends LegalActionBase {
  type: 'bet';
  min: number;
  max: number;
}

export interface RaiseAction extends LegalActionBase {
  type: 'raise';
  min: number;
  max: number;
  toCall: number;
}

export interface AllInAction extends LegalActionBase {
  type: 'all-in';
  amount: number;
  toCall: number;
  isRaise: boolean;
}

export type LegalAction = FoldAction | CheckAction | CallAction | BetAction | RaiseAction | AllInAction;

export interface PlayerAction {
  playerId: string;
  type: LegalAction['type'];
  amount?: number;
}

export interface GameState {
  phase: Phase;
  rngState: number;
  config: TournamentConfig;
  levelIndex: number;
  handsPlayedAtCurrentLevel: number;
  buttonSeatIndex: number;
  seats: Seat[];
  currentLevel: BlindLevel;
  betting: BettingState;
  hand: HandState;
  log: ActionLogEntry[];
  ui: UIState;
  tournamentWinnerId: string | null;
  tournamentCompletionReason: TournamentCompletionReason | null;
}
