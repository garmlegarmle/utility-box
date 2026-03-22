import { getPotLabel } from 'holdem/config/localization';
import { drawCards, shuffleDeck } from 'holdem/engine/core/deck';
import { countRemainingPlayers, getNextOccupiedSeatIndex, getPlayersAbleToAct } from 'holdem/engine/core/seating';
import { decideBotAction } from 'holdem/engine/ai/decideAction';
import { appendLogEntry, createLogEntry } from 'holdem/engine/log/logEvents';
import { postAntes, postBlinds } from 'holdem/engine/rules/blindPosting';
import { applyPlayerAction } from 'holdem/engine/rules/bettingRound';
import { resolveShowdown } from 'holdem/engine/rules/showdown';
import {
  assignTablePositions,
  getFirstToActPostflop,
  getSmallBlindSeatIndex,
} from 'holdem/engine/rules/positions';
import { advanceBlindLevel, getBlindLevel } from 'holdem/engine/tournament/levelProgression';
import type { GameState, Phase, Seat, Street } from 'holdem/types/engine';

function resetSeatForNewHand(seat: Seat): Seat {
  if (seat.status === 'busted') {
    return {
      ...seat,
      holeCards: [],
      hasFolded: true,
      isAllIn: false,
      hasShownCards: false,
      currentBet: 0,
      totalCommitted: 0,
      actedThisStreet: false,
      lastFullRaiseSeen: 0,
      lastAction: null,
      lastActionAmount: 0,
      winningsThisHand: 0,
    };
  }

  return {
    ...seat,
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
  };
}

function shouldSkipPostflopAction(state: GameState): boolean {
  return getPlayersAbleToAct(state.seats).length < 2;
}

function nextPhaseAfterStreet(street: Street): Phase {
  switch (street) {
    case 'flop':
      return 'deal_turn';
    case 'turn':
      return 'deal_river';
    case 'river':
    case 'showdown':
      return 'showdown';
    case 'preflop':
      return 'deal_flop';
  }
}

function setupNewHand(state: GameState): GameState {
  const nextState = structuredClone(state);

  if (countRemainingPlayers(nextState.seats) <= 1) {
    nextState.tournamentWinnerId = nextState.seats.find((seat) => seat.status === 'active')?.playerId ?? null;
    nextState.tournamentCompletionReason = 'winner';
    nextState.phase = 'tournament_complete';
    return nextState;
  }

  const { deck, nextSeed } = shuffleDeck(nextState.rngState);

  nextState.rngState = nextSeed;
  nextState.seats = assignTablePositions(nextState.seats.map(resetSeatForNewHand), nextState.buttonSeatIndex);
  nextState.currentLevel = getBlindLevel(nextState.config, nextState.levelIndex);
  nextState.hand = {
    handNumber: nextState.hand.handNumber + 1,
    deck,
    communityCards: [],
    pots: [],
    payouts: [],
    showdown: [],
    winnerMessage: null,
    completed: false,
  };
  nextState.betting = {
    street: 'preflop',
    actingSeatIndex: null,
    currentBet: 0,
    minBringIn: nextState.currentLevel.bigBlind,
    lastFullRaiseSize: nextState.currentLevel.bigBlind,
    fullRaiseCount: 0,
    minRaiseTo: nextState.currentLevel.bigBlind,
    previousAggressorSeatIndex: null,
    lastAggressorSeatIndex: null,
  };
  nextState.ui.raiseInput = nextState.currentLevel.bigBlind * 2;
  nextState.phase = 'post_antes';
  appendLogEntry(
    nextState,
    createLogEntry(
      nextState,
      nextState.buttonSeatIndex,
      'table',
      '테이블',
      'preflop',
      'info',
      0,
      `핸드 #${nextState.hand.handNumber} 시작. 버튼: ${nextState.seats.find((seat) => seat.seatIndex === nextState.buttonSeatIndex)?.name}. 블라인드 ${nextState.currentLevel.smallBlind}/${nextState.currentLevel.bigBlind}, 앤티 ${nextState.currentLevel.ante}`,
    ),
  );

  return nextState;
}

function dealHoleCards(state: GameState): GameState {
  const nextState = structuredClone(state);
  const activeSeatIndices = nextState.seats
    .filter((seat) => seat.status === 'active')
    .map((seat) => seat.seatIndex);
  const smallBlindSeatIndex = getSmallBlindSeatIndex(nextState.seats, nextState.buttonSeatIndex) ?? nextState.buttonSeatIndex;
  const orderedSeatIndices = activeSeatIndices.length === 2
    ? [smallBlindSeatIndex, ...activeSeatIndices.filter((seatIndex) => seatIndex !== smallBlindSeatIndex)]
    : [
        ...activeSeatIndices.filter((seatIndex) => seatIndex >= smallBlindSeatIndex),
        ...activeSeatIndices.filter((seatIndex) => seatIndex < smallBlindSeatIndex),
      ];
  let deck = nextState.hand.deck;

  for (let round = 0; round < 2; round += 1) {
    for (const seatIndex of orderedSeatIndices) {
      const seat = nextState.seats.find((candidate) => candidate.seatIndex === seatIndex);

      if (!seat || seat.status !== 'active') {
        continue;
      }

      const draw = drawCards(deck, 1);
      deck = draw.deck;
      seat.holeCards.push(draw.cards[0]!);
    }
  }

  nextState.hand.deck = deck;
  nextState.phase = 'preflop_action';

  return nextState;
}

function resetForPostflop(state: GameState, street: Street): GameState {
  const nextState = structuredClone(state);
  const firstToAct = getFirstToActPostflop(nextState.seats, nextState.buttonSeatIndex);

  nextState.seats = nextState.seats.map((seat) => ({
    ...seat,
    currentBet: 0,
    actedThisStreet: false,
    lastFullRaiseSeen: 0,
    lastAction: null,
    lastActionAmount: 0,
  }));
  nextState.betting = {
    street,
    actingSeatIndex: firstToAct,
    currentBet: 0,
    minBringIn: nextState.currentLevel.bigBlind,
    lastFullRaiseSize: nextState.currentLevel.bigBlind,
    fullRaiseCount: 0,
    minRaiseTo: nextState.currentLevel.bigBlind,
    previousAggressorSeatIndex: nextState.betting.lastAggressorSeatIndex,
    lastAggressorSeatIndex: null,
  };
  nextState.ui.raiseInput = nextState.currentLevel.bigBlind;

  if (shouldSkipPostflopAction(nextState)) {
    nextState.betting.actingSeatIndex = null;
    nextState.phase = nextPhaseAfterStreet(street);
  } else {
    nextState.phase =
      street === 'flop' ? 'flop_action' : street === 'turn' ? 'turn_action' : 'river_action';
  }

  return nextState;
}

function dealBoardCards(state: GameState, street: Street, count: number): GameState {
  const nextState = structuredClone(state);
  let deck = nextState.hand.deck;

  if (street !== 'preflop') {
    deck = drawCards(deck, 1).deck;
  }

  const draw = drawCards(deck, count);
  nextState.hand.deck = draw.deck;
  nextState.hand.communityCards.push(...draw.cards);
  appendLogEntry(
    nextState,
    createLogEntry(
      nextState,
      nextState.buttonSeatIndex,
      'table',
      '테이블',
      street,
      'info',
      0,
      `${street === 'flop' ? '플랍' : street === 'turn' ? '턴' : '리버'}: ${nextState.hand.communityCards
        .map((card) => card.code)
        .join(' ')}`,
    ),
  );

  return resetForPostflop(nextState, street);
}

function runShowdown(state: GameState): GameState {
  const nextState = structuredClone(state);
  const resolved = resolveShowdown(nextState);

  nextState.hand.pots = resolved.pots;
  nextState.hand.payouts = resolved.payouts;
  nextState.hand.showdown = resolved.showdown;
  nextState.hand.winnerMessage = resolved.winnerMessage;

  nextState.seats.forEach((seat) => {
    if (!seat.hasFolded) {
      seat.hasShownCards = seat.holeCards.length === 2;

      if (seat.hasShownCards) {
        appendLogEntry(
          nextState,
          createLogEntry(
            nextState,
            seat.seatIndex,
            seat.playerId,
            seat.name,
            'showdown',
            'showdown',
            0,
            `${seat.name} 오픈 ${seat.holeCards.map((card) => card.code).join(' ')}`,
          ),
        );
      }
    }
  });
  nextState.phase = 'award_pots';

  return nextState;
}

function awardPots(state: GameState): GameState {
  const nextState = state.hand.payouts.length === 0 ? runShowdown(state) : structuredClone(state);

  nextState.hand.payouts.forEach((payout) => {
    const seat = nextState.seats.find((candidate) => candidate.playerId === payout.playerId);

    if (!seat) {
      return;
    }

    seat.stack += payout.amount;
    seat.winningsThisHand += payout.amount;
    appendLogEntry(
      nextState,
      createLogEntry(
        nextState,
        seat.seatIndex,
        seat.playerId,
        seat.name,
        'showdown',
        'win',
        payout.amount,
        `${seat.name} ${payout.amount}칩 획득 (${getPotLabel(payout.potId)}${payout.isOddChip ? ', 나머지 1칩 포함' : ''})`,
      ),
    );
  });
  nextState.hand.completed = true;
  nextState.phase = 'eliminate_players';

  return nextState;
}

function eliminatePlayers(state: GameState): GameState {
  const nextState = structuredClone(state);
  const activeBefore = nextState.seats.filter((seat) => seat.status === 'active').length;
  let humanBusted = false;

  nextState.seats.forEach((seat) => {
    if (seat.status === 'active' && seat.stack === 0) {
      seat.status = 'busted';
      seat.eliminationOrder = activeBefore;
      humanBusted ||= seat.isHuman;
      appendLogEntry(
        nextState,
        createLogEntry(
          nextState,
          seat.seatIndex,
          seat.playerId,
          seat.name,
          'showdown',
          'eliminated',
          0,
          `${seat.name} 탈락 (${activeBefore}위)`,
        ),
      );
    }
  });

  if (humanBusted) {
    nextState.tournamentWinnerId = null;
    nextState.tournamentCompletionReason = 'human-busted';
    nextState.phase = 'tournament_complete';
    return nextState;
  }

  if (countRemainingPlayers(nextState.seats) <= 1) {
    nextState.tournamentWinnerId = nextState.seats.find((seat) => seat.status === 'active')?.playerId ?? null;
    nextState.tournamentCompletionReason = 'winner';
    nextState.phase = 'tournament_complete';
    return nextState;
  }

  nextState.phase = 'move_button';
  return nextState;
}

function moveButton(state: GameState): GameState {
  const nextState = structuredClone(state);
  nextState.buttonSeatIndex = getNextOccupiedSeatIndex(nextState.buttonSeatIndex, nextState.seats) ?? nextState.buttonSeatIndex;
  nextState.phase = 'level_up_check';
  return nextState;
}

function levelUpCheck(state: GameState): GameState {
  const nextState = structuredClone(state);
  nextState.handsPlayedAtCurrentLevel += 1;

  if (
    nextState.handsPlayedAtCurrentLevel >= nextState.config.handsPerLevel &&
    nextState.levelIndex < nextState.config.blindLevels.length - 1
  ) {
    nextState.levelIndex = advanceBlindLevel(nextState.levelIndex, nextState.config);
    nextState.currentLevel = getBlindLevel(nextState.config, nextState.levelIndex);
    nextState.handsPlayedAtCurrentLevel = 0;
  }

  nextState.phase = 'next_hand';
  return nextState;
}

function advanceActionPhase(state: GameState): GameState {
  const actingSeat = state.seats.find((seat) => seat.seatIndex === state.betting.actingSeatIndex);

  if (!actingSeat) {
    return state;
  }

  if (actingSeat.isHuman) {
    return state;
  }

  const decision = decideBotAction(state, actingSeat.playerId);
  const nextState = structuredClone(state);
  nextState.rngState = decision.nextRngState;
  return applyPlayerAction(nextState, decision.action);
}

export function advanceState(state: GameState): GameState {
  switch (state.phase) {
    case 'tournament_init':
      return { ...state, phase: 'hand_setup' };
    case 'hand_setup':
      return setupNewHand(state);
    case 'post_antes':
      return postAntes(state);
    case 'post_blinds':
      return postBlinds(state);
    case 'deal_hole_cards':
      return dealHoleCards(state);
    case 'preflop_action':
    case 'flop_action':
    case 'turn_action':
    case 'river_action':
      return advanceActionPhase(state);
    case 'deal_flop':
      return dealBoardCards(state, 'flop', 3);
    case 'deal_turn':
      return dealBoardCards(state, 'turn', 1);
    case 'deal_river':
      return dealBoardCards(state, 'river', 1);
    case 'showdown':
      return runShowdown(state);
    case 'award_pots':
      return awardPots(state);
    case 'eliminate_players':
      return eliminatePlayers(state);
    case 'move_button':
      return moveButton(state);
    case 'level_up_check':
      return levelUpCheck(state);
    case 'next_hand':
      return { ...state, phase: 'hand_setup' };
    case 'tournament_complete':
      return state;
  }
}
