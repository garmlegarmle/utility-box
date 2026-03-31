import {
  BLIND_LEVELS,
  advanceBlindLevel,
  appendLogEntry,
  applyPlayerAction,
  assignTablePositions,
  countRemainingPlayers,
  createLogEntry,
  drawCards,
  getBlindLevel,
  getNextOccupiedSeatIndex,
  getPlayersAbleToAct,
  getSmallBlindSeatIndex,
  getBigBlindSeatIndex,
  getFirstToActPostflop,
  postAntes,
  postBlinds,
  resolveShowdown,
  shuffleDeck,
} from './shared/holdem-engine.generated.js';
import {
  HOLDEM_ONLINE_HANDS_PER_LEVEL,
  HOLDEM_ONLINE_STARTING_STACK,
  HOLDEM_ONLINE_TABLE_SEAT_ORDER,
} from './constants.js';

function sanitizeOnlineState(state) {
  if (!state) {
    return state;
  }

  if (Array.isArray(state.log) && state.log.length > 0) {
    state.log = [];
  }

  if (state.ui && Array.isArray(state.ui.toastQueue) && state.ui.toastQueue.length > 0) {
    state.ui.toastQueue = [];
  }

  return state;
}

function createInitialBettingState(bigBlind) {
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

function createEmptyHandState() {
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

function resetSeatForNewHand(seat) {
  if (seat.status === 'busted') {
    return {
      ...seat,
      holeCards: [],
      hasFolded: true,
      isAllIn: false,
      hasShownCards: false,
      revealedCardCount: 0,
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
    revealedCardCount: 0,
    currentBet: 0,
    totalCommitted: 0,
    actedThisStreet: false,
    lastFullRaiseSeen: 0,
    lastAction: null,
    lastActionAmount: 0,
    winningsThisHand: 0,
  };
}

function shouldSkipPostflopAction(state) {
  return getPlayersAbleToAct(state.seats).length < 2;
}

function nextPhaseAfterStreet(street) {
  switch (street) {
    case 'flop':
      return 'deal_turn';
    case 'turn':
      return 'deal_river';
    case 'river':
    case 'showdown':
      return 'showdown';
    case 'preflop':
    default:
      return 'deal_flop';
  }
}

function createSeatConfigs(players) {
  return players.map((player, index) => ({
    seatIndex: HOLDEM_ONLINE_TABLE_SEAT_ORDER[index] ?? index,
    playerId: player.playerId,
    name: player.displayName,
    isHuman: false,
  }));
}

export function createOnlineGameState(players, seed, lang = 'en') {
  const config = {
    startingStack: HOLDEM_ONLINE_STARTING_STACK,
    handsPerLevel: HOLDEM_ONLINE_HANDS_PER_LEVEL,
    blindLevels: BLIND_LEVELS,
    seats: createSeatConfigs(players),
    betSizingBuckets: [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.5],
    initialButtonSeatIndex: createSeatConfigs(players)[0]?.seatIndex ?? 0,
    actionDelayMs: 850,
    autoProgress: false,
  };
  const currentLevel = getBlindLevel(config, 0);
  const seats = assignTablePositions(
    config.seats.map((seatConfig) => ({
      seatIndex: seatConfig.seatIndex,
      playerId: seatConfig.playerId,
      name: seatConfig.name,
      isHuman: false,
      profileId: undefined,
      stack: config.startingStack,
      status: 'active',
      eliminationOrder: null,
      holeCards: [],
      hasFolded: false,
      isAllIn: false,
      hasShownCards: false,
      revealedCardCount: 0,
      currentBet: 0,
      totalCommitted: 0,
      actedThisStreet: false,
      lastFullRaiseSeen: 0,
      lastAction: null,
      lastActionAmount: 0,
      winningsThisHand: 0,
      position: null,
    })),
    config.initialButtonSeatIndex,
  );

  return sanitizeOnlineState({
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
      started: true,
      playerName: '',
      lang,
      raiseInput: currentLevel.bigBlind * 2,
      actionSpeed: config.actionDelayMs,
      autoProgress: false,
      overlayPanel: null,
      selectedSeatIndex: config.initialButtonSeatIndex,
      toastQueue: [],
      lastSeed: seed >>> 0,
    },
    tournamentWinnerId: null,
    tournamentCompletionReason: null,
  });
}

function setupNewHand(state) {
  const nextState = structuredClone(state);

  if (countRemainingPlayers(nextState.seats) <= 1) {
    nextState.tournamentWinnerId = nextState.seats.find((seat) => seat.status === 'active')?.playerId ?? null;
    nextState.tournamentCompletionReason = 'winner';
    nextState.phase = 'tournament_complete';
    return sanitizeOnlineState(nextState);
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
      'Table',
      'preflop',
      'info',
      0,
      `Hand #${nextState.hand.handNumber} starts. Blinds ${nextState.currentLevel.smallBlind}/${nextState.currentLevel.bigBlind}, ante ${nextState.currentLevel.ante}.`,
    ),
  );

  return sanitizeOnlineState(nextState);
}

function dealHoleCards(state) {
  const nextState = structuredClone(state);
  const activeSeatIndices = nextState.seats
    .filter((seat) => seat.status === 'active')
    .map((seat) => seat.seatIndex);
  const smallBlindSeatIndex = getSmallBlindSeatIndex(nextState.seats, nextState.buttonSeatIndex) ?? nextState.buttonSeatIndex;
  const orderedSeatIndices =
    activeSeatIndices.length === 2
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
      seat.holeCards.push(draw.cards[0]);
    }
  }

  nextState.hand.deck = deck;
  nextState.phase = 'preflop_action';

  return sanitizeOnlineState(nextState);
}

function resetForPostflop(state, street) {
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
    nextState.phase = street === 'flop' ? 'flop_action' : street === 'turn' ? 'turn_action' : 'river_action';
  }

  return nextState;
}

function dealBoardCards(state, street, count) {
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
      'Table',
      street,
      'info',
      0,
      `${street === 'flop' ? 'Flop' : street === 'turn' ? 'Turn' : 'River'}: ${nextState.hand.communityCards
        .map((card) => card.code)
        .join(' ')}`,
    ),
  );

  return sanitizeOnlineState(resetForPostflop(nextState, street));
}

function runShowdown(state) {
  const nextState = structuredClone(state);
  const resolved = resolveShowdown(nextState);
  const shouldAutoRevealShowdownCards = Array.isArray(resolved.showdown) && resolved.showdown.length > 0;

  nextState.hand.pots = resolved.pots;
  nextState.hand.payouts = resolved.payouts;
  nextState.hand.showdown = resolved.showdown;
  nextState.hand.winnerMessage = resolved.winnerMessage;
  nextState.seats.forEach((seat) => {
    seat.hasShownCards = !seat.hasFolded && seat.holeCards.length === 2;
    seat.revealedCardCount = seat.hasShownCards && shouldAutoRevealShowdownCards ? seat.holeCards.length : 0;
  });
  nextState.phase = 'award_pots';

  return sanitizeOnlineState(nextState);
}

function awardPots(state) {
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
        `${seat.name} collects ${payout.amount.toLocaleString()} chips (${payout.potId}${payout.isOddChip ? ', odd chip' : ''})`,
      ),
    );
  });
  nextState.hand.completed = true;
  nextState.phase = 'eliminate_players';

  return sanitizeOnlineState(nextState);
}

function eliminatePlayers(state) {
  const nextState = structuredClone(state);
  const activeBefore = nextState.seats.filter((seat) => seat.status === 'active').length;

  nextState.seats.forEach((seat) => {
    if (seat.status === 'active' && seat.stack === 0) {
      seat.status = 'busted';
      seat.eliminationOrder = activeBefore;
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
          `${seat.name} is eliminated (${activeBefore})`,
        ),
      );
    }
  });

  if (countRemainingPlayers(nextState.seats) <= 1) {
    nextState.tournamentWinnerId = nextState.seats.find((seat) => seat.status === 'active')?.playerId ?? null;
    nextState.tournamentCompletionReason = 'winner';
    nextState.phase = 'tournament_complete';
    return sanitizeOnlineState(nextState);
  }

  nextState.phase = 'move_button';
  return sanitizeOnlineState(nextState);
}

function moveButton(state) {
  const nextState = structuredClone(state);
  nextState.buttonSeatIndex = getNextOccupiedSeatIndex(nextState.buttonSeatIndex, nextState.seats) ?? nextState.buttonSeatIndex;
  nextState.phase = 'level_up_check';
  return sanitizeOnlineState(nextState);
}

function levelUpCheck(state) {
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
  return sanitizeOnlineState(nextState);
}

export function advanceOnlineState(state) {
  switch (state.phase) {
    case 'tournament_init':
      return sanitizeOnlineState({ ...state, phase: 'hand_setup' });
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
      return state;
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
      return sanitizeOnlineState({ ...state, phase: 'hand_setup' });
    case 'tournament_complete':
    default:
      return sanitizeOnlineState(state);
  }
}

export function applyOnlinePlayerAction(state, action) {
  return sanitizeOnlineState(applyPlayerAction(state, action));
}
