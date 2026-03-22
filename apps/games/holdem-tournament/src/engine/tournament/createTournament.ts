import { assignTablePositions } from 'holdem/engine/rules/positions';
import { getBlindLevel } from 'holdem/engine/tournament/levelProgression';
import type { BettingState, GameState, HandState, Seat } from 'holdem/types/engine';
import type { TournamentConfig } from 'holdem/types/tournament';

function createInitialSeats(config: TournamentConfig): Seat[] {
  return config.seats.map((seatConfig) => ({
    seatIndex: seatConfig.seatIndex,
    playerId: seatConfig.playerId,
    name: seatConfig.name,
    isHuman: seatConfig.isHuman,
    profileId: seatConfig.profileId,
    stack: config.startingStack,
    status: 'active',
    eliminationOrder: null,
    holeCards: [],
    hasFolded: false,
    isAllIn: false,
    hasShownCards: false,
    currentBet: 0,
    totalCommitted: 0,
    actedThisStreet: false,
    lastFullRaiseSeen: 0,
    lastAction: null,
    lastActionAmount: 0,
    winningsThisHand: 0,
    position: null,
  }));
}

function createEmptyHandState(): HandState {
  return {
    handNumber: 0,
    deck: {
      cards: [],
      nextIndex: 0,
    },
    communityCards: [],
    pots: [],
    payouts: [],
    showdown: [],
    winnerMessage: null,
    completed: false,
  };
}

function createInitialBettingState(bigBlind: number): BettingState {
  return {
    street: 'preflop',
    actingSeatIndex: null,
    currentBet: 0,
    minBringIn: bigBlind,
    lastFullRaiseSize: bigBlind,
    fullRaiseCount: 0,
    minRaiseTo: bigBlind,
    previousAggressorSeatIndex: null,
    lastAggressorSeatIndex: null,
  };
}

export function createInitialGameState(config: TournamentConfig, seed: number): GameState {
  const currentLevel = getBlindLevel(config, 0);
  const seats = assignTablePositions(createInitialSeats(config), config.initialButtonSeatIndex);

  return {
    phase: 'tournament_init',
    rngState: seed >>> 0,
    config,
    levelIndex: 0,
    handsPlayedAtCurrentLevel: 0,
    buttonSeatIndex: config.initialButtonSeatIndex,
    seats,
    currentLevel,
    betting: createInitialBettingState(currentLevel.bigBlind),
    hand: createEmptyHandState(),
    log: [],
    ui: {
      started: false,
      raiseInput: currentLevel.bigBlind * 2,
      actionSpeed: config.actionDelayMs,
      autoProgress: config.autoProgress,
      overlayPanel: null,
      selectedSeatIndex: 0,
      toastQueue: [],
      lastSeed: seed >>> 0,
    },
    tournamentWinnerId: null,
    tournamentCompletionReason: null,
  };
}
