// apps/games/holdem-tournament/src/config/blindLevels.ts
var BLIND_LEVELS = [
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
  { level: 12, smallBlind: 51200, bigBlind: 102400, ante: 6400 }
];

// apps/games/holdem-tournament/src/types/cards.ts
var SUITS = ["clubs", "diamonds", "hearts", "spades"];
var RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

// apps/games/holdem-tournament/src/engine/core/cards.ts
var RANK_LABELS = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "T",
  11: "J",
  12: "Q",
  13: "K",
  14: "A"
};
var SUIT_LABELS = {
  clubs: "c",
  diamonds: "d",
  hearts: "h",
  spades: "s"
};
function createCard(rank, suit) {
  return {
    rank,
    suit,
    code: `${RANK_LABELS[rank]}${SUIT_LABELS[suit]}`
  };
}
function createStandardDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => createCard(rank, suit)));
}
function rankLabel(rank) {
  if (rank === 14) {
    return "A";
  }
  if (rank === 13) {
    return "K";
  }
  if (rank === 12) {
    return "Q";
  }
  if (rank === 11) {
    return "J";
  }
  if (rank === 10) {
    return "T";
  }
  return String(rank);
}
function sortCardsDescending(cards) {
  return [...cards].sort((left, right) => right.rank - left.rank || left.suit.localeCompare(right.suit));
}

// apps/games/holdem-tournament/src/engine/core/rng.ts
function normalizeSeed(seed) {
  return seed >>> 0;
}
function randomFloat(state) {
  let nextState = normalizeSeed(state + 1831565813);
  nextState = Math.imul(nextState ^ nextState >>> 15, nextState | 1);
  nextState ^= nextState + Math.imul(nextState ^ nextState >>> 7, nextState | 61);
  const value = ((nextState ^ nextState >>> 14) >>> 0) / 4294967296;
  return {
    value,
    nextState: normalizeSeed(nextState)
  };
}
function randomInt(state, maxExclusive) {
  if (maxExclusive <= 0) {
    return { value: 0, nextState: normalizeSeed(state) };
  }
  const { value, nextState } = randomFloat(state);
  return {
    value: Math.floor(value * maxExclusive),
    nextState
  };
}

// apps/games/holdem-tournament/src/engine/core/deck.ts
function shuffleDeck(seed) {
  const cards = createStandardDeck();
  let nextSeed = seed;
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const result = randomInt(nextSeed, index + 1);
    const swapIndex = result.value;
    nextSeed = result.nextState;
    const current = cards[index];
    cards[index] = cards[swapIndex];
    cards[swapIndex] = current;
  }
  return {
    deck: {
      cards,
      nextIndex: 0
    },
    nextSeed
  };
}
function drawCards(deck, count) {
  const start = deck.nextIndex;
  const end = start + count;
  return {
    deck: {
      cards: deck.cards,
      nextIndex: end
    },
    cards: deck.cards.slice(start, end)
  };
}

// apps/games/holdem-tournament/src/engine/core/seating.ts
function getTournamentActiveSeats(seats) {
  return seats.filter((seat) => seat.status === "active");
}
function getTournamentActiveSeatIndices(seats) {
  return getTournamentActiveSeats(seats).map((seat) => seat.seatIndex);
}
function getHandContenders(seats) {
  return seats.filter((seat) => seat.status === "active" && !seat.hasFolded);
}
function getPlayersAbleToAct(seats) {
  return seats.filter((seat) => seat.status === "active" && !seat.hasFolded && !seat.isAllIn);
}
function getCircularSeatOrder(seatIndices, fromSeatIndex) {
  const sorted = [...seatIndices].sort((left, right) => left - right);
  const firstGreaterIndex = sorted.findIndex((seatIndex) => seatIndex > fromSeatIndex);
  if (firstGreaterIndex === -1) {
    return [...sorted];
  }
  return [...sorted.slice(firstGreaterIndex), ...sorted.slice(0, firstGreaterIndex)];
}
function getNextOccupiedSeatIndex(fromSeatIndex, seats) {
  const occupied = getTournamentActiveSeatIndices(seats);
  if (occupied.length === 0) {
    return null;
  }
  return getCircularSeatOrder(occupied, fromSeatIndex)[0] ?? null;
}
function countRemainingPlayers(seats) {
  return getTournamentActiveSeats(seats).length;
}

// apps/games/holdem-tournament/src/engine/log/logEvents.ts
var logSequence = 0;
function createLogEntry(state, seatIndex, playerId, name, street, type, amount, text) {
  logSequence += 1;
  return {
    id: `log-${logSequence}`,
    handNumber: state.hand.handNumber,
    level: state.currentLevel.level,
    street,
    seatIndex,
    playerId,
    name,
    type,
    amount,
    text
  };
}
function appendLogEntry(state, entry) {
  state.log.push(entry);
}

// apps/games/holdem-tournament/src/engine/pots/buildPots.ts
function buildPots(seats) {
  const contributors = seats.filter((seat) => seat.totalCommitted > 0).sort((left, right) => left.totalCommitted - right.totalCommitted);
  if (contributors.length === 0) {
    return [];
  }
  const uniqueLevels = [...new Set(contributors.map((seat) => seat.totalCommitted))];
  let previousLevel = 0;
  const pots = [];
  uniqueLevels.forEach((level, index) => {
    const involved = contributors.filter((seat) => seat.totalCommitted >= level);
    const layerContribution = level - previousLevel;
    const amount = layerContribution * involved.length;
    const eligiblePlayers = involved.filter((seat) => !seat.hasFolded).map((seat) => seat.playerId);
    if (amount > 0 && eligiblePlayers.length > 0) {
      const contributions = Object.fromEntries(
        involved.map((seat) => [seat.playerId, layerContribution])
      );
      pots.push({
        id: index === 0 ? "main" : `side-${index}`,
        amount,
        eligiblePlayerIds: eligiblePlayers,
        contributions,
        isMain: index === 0
      });
    }
    previousLevel = level;
  });
  return pots;
}

// apps/games/holdem-tournament/src/engine/evaluators/handCategories.ts
var HAND_CATEGORY_NAMES = [
  "High Card",
  "One Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush"
];

// apps/games/holdem-tournament/src/engine/evaluators/handEvaluator.ts
function combinations(items, choose) {
  if (choose === 0) {
    return [[]];
  }
  if (items.length < choose) {
    return [];
  }
  if (items.length === choose) {
    return [items];
  }
  const first = items[0];
  const rest = items.slice(1);
  const withFirst = combinations(rest, choose - 1).map((combo) => [first, ...combo]);
  const withoutFirst = combinations(rest, choose);
  return [...withFirst, ...withoutFirst];
}
function getStraightHigh(ranks) {
  const unique = [...new Set(ranks)].sort((left, right) => right - left);
  if (unique[0] === 14) {
    unique.push(1);
  }
  let streak = 1;
  for (let index = 1; index < unique.length; index += 1) {
    const previous = unique[index - 1];
    const current = unique[index];
    if (previous - 1 === current) {
      streak += 1;
      if (streak >= 5) {
        return previous + 3;
      }
    } else if (previous !== current) {
      streak = 1;
    }
  }
  return null;
}
function compareTiebreakers(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
function evaluateFiveCardHand(cards) {
  const sorted = sortCardsDescending(cards);
  const ranks = sorted.map((card) => card.rank);
  const rankCounts = /* @__PURE__ */ new Map();
  for (const rank of ranks) {
    rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
  }
  const groups = [...rankCounts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return right[0] - left[0];
  });
  const isFlush = sorted.every((card) => card.suit === sorted[0].suit);
  const straightHigh = getStraightHigh(ranks);
  const isStraight = straightHigh !== null;
  if (isFlush && isStraight) {
    const highCard = straightHigh;
    return {
      category: 8,
      tiebreakers: [highCard],
      label: highCard === 14 ? "Royal Flush" : `${rankLabel(highCard)}-high Straight Flush`,
      cards: sorted
    };
  }
  if (groups[0]?.[1] === 4) {
    const fourRank = groups[0][0];
    const kicker = groups[1][0];
    return {
      category: 7,
      tiebreakers: [fourRank, kicker],
      label: `Four of a Kind, ${rankLabel(fourRank)}s`,
      cards: sorted
    };
  }
  if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) {
    const trips = groups[0][0];
    const pair = groups[1][0];
    return {
      category: 6,
      tiebreakers: [trips, pair],
      label: `Full House, ${rankLabel(trips)}s full of ${rankLabel(pair)}s`,
      cards: sorted
    };
  }
  if (isFlush) {
    const highCard = ranks[0];
    return {
      category: 5,
      tiebreakers: ranks,
      label: `${rankLabel(highCard)}-high Flush`,
      cards: sorted
    };
  }
  if (isStraight) {
    const highCard = straightHigh;
    return {
      category: 4,
      tiebreakers: [highCard],
      label: `${rankLabel(highCard)}-high Straight`,
      cards: sorted
    };
  }
  if (groups[0]?.[1] === 3) {
    const kickers = groups.slice(1).map(([rank]) => rank).sort((left, right) => right - left);
    const trips = groups[0][0];
    return {
      category: 3,
      tiebreakers: [trips, ...kickers],
      label: `Three of a Kind, ${rankLabel(trips)}s`,
      cards: sorted
    };
  }
  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) {
    const topPair = Math.max(groups[0][0], groups[1][0]);
    const lowerPair = Math.min(groups[0][0], groups[1][0]);
    const kicker = groups[2][0];
    return {
      category: 2,
      tiebreakers: [topPair, lowerPair, kicker],
      label: `Two Pair, ${rankLabel(topPair)}s and ${rankLabel(lowerPair)}s`,
      cards: sorted
    };
  }
  if (groups[0]?.[1] === 2) {
    const kickers = groups.slice(1).map(([rank]) => rank).sort((left, right) => right - left);
    const pair = groups[0][0];
    return {
      category: 1,
      tiebreakers: [pair, ...kickers],
      label: `Pair of ${rankLabel(pair)}s`,
      cards: sorted
    };
  }
  return {
    category: 0,
    tiebreakers: ranks,
    label: `${rankLabel(ranks[0])}-high`,
    cards: sorted
  };
}
function evaluateBestHand(cards) {
  const combos = combinations(cards, 5);
  let best = evaluateFiveCardHand(combos[0] ?? cards.slice(0, 5));
  for (const combo of combos.slice(1)) {
    const candidate = evaluateFiveCardHand(combo);
    if (candidate.category > best.category || candidate.category === best.category && compareTiebreakers(candidate.tiebreakers, best.tiebreakers) > 0) {
      best = candidate;
    }
  }
  return {
    category: best.category,
    categoryName: HAND_CATEGORY_NAMES[best.category],
    tiebreakers: best.tiebreakers,
    bestFive: best.cards,
    label: best.label
  };
}
function compareHands(left, right) {
  if (left.category !== right.category) {
    return left.category - right.category;
  }
  return compareTiebreakers(left.tiebreakers, right.tiebreakers);
}

// apps/games/holdem-tournament/src/engine/pots/distributePots.ts
function getOddChipOrder(buttonSeatIndex, seats, winnerIds) {
  const winners = seats.filter((seat) => winnerIds.includes(seat.playerId));
  const orderedSeatIndices = getCircularSeatOrder(
    winners.map((seat) => seat.seatIndex),
    buttonSeatIndex
  );
  return orderedSeatIndices.map((seatIndex) => winners.find((seat) => seat.seatIndex === seatIndex)).filter((seat) => Boolean(seat));
}
function distributePots(pots, seats, communityCards, buttonSeatIndex) {
  const activeSeats = seats.filter((seat) => !seat.hasFolded && seat.holeCards.length === 2);
  const evaluatedHands = new Map(
    activeSeats.map((seat) => [
      seat.playerId,
      evaluateBestHand([...seat.holeCards, ...communityCards])
    ])
  );
  const payouts = [];
  const showdown = [];
  for (const pot of pots) {
    const contenders = pot.eligiblePlayerIds.map((playerId) => activeSeats.find((seat) => seat.playerId === playerId)).filter((seat) => Boolean(seat));
    if (contenders.length === 0) {
      continue;
    }
    let bestSeat = contenders[0];
    let bestHand = evaluatedHands.get(bestSeat.playerId);
    const winners = [bestSeat];
    for (const contender of contenders.slice(1)) {
      const contenderHand = evaluatedHands.get(contender.playerId);
      const comparison = compareHands(contenderHand, bestHand);
      if (comparison > 0) {
        bestSeat = contender;
        bestHand = contenderHand;
        winners.splice(0, winners.length, contender);
      } else if (comparison === 0) {
        winners.push(contender);
      }
    }
    const evenShare = Math.floor(pot.amount / winners.length);
    let oddChips = pot.amount % winners.length;
    const oddChipOrder = getOddChipOrder(buttonSeatIndex, contenders, winners.map((winner) => winner.playerId));
    for (const winner of winners) {
      payouts.push({
        potId: pot.id,
        playerId: winner.playerId,
        amount: evenShare,
        isOddChip: false,
        handLabel: evaluatedHands.get(winner.playerId)?.label
      });
    }
    for (const oddChipWinner of oddChipOrder) {
      if (oddChips <= 0) {
        break;
      }
      payouts.push({
        potId: pot.id,
        playerId: oddChipWinner.playerId,
        amount: 1,
        isOddChip: true,
        handLabel: evaluatedHands.get(oddChipWinner.playerId)?.label
      });
      oddChips -= 1;
    }
    showdown.push({
      potId: pot.id,
      contenders: contenders.map((seat) => ({
        playerId: seat.playerId,
        seatIndex: seat.seatIndex,
        hand: evaluatedHands.get(seat.playerId)
      })),
      winners: winners.map((winner) => winner.playerId)
    });
  }
  return { payouts, showdown };
}

// apps/games/holdem-tournament/src/engine/rules/positions.ts
var POSITION_LABELS = {
  2: ["BTN", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["BTN", "SB", "BB", "UTG"],
  5: ["BTN", "SB", "BB", "UTG", "CO"],
  6: ["BTN", "SB", "BB", "UTG", "HJ", "CO"],
  7: ["BTN", "SB", "BB", "UTG", "LJ", "HJ", "CO"],
  8: ["BTN", "SB", "BB", "UTG", "MP", "LJ", "HJ", "CO"],
  9: ["BTN", "SB", "BB", "UTG", "UTG+1", "MP", "LJ", "HJ", "CO"]
};
function assignTablePositions(seats, buttonSeatIndex) {
  const occupiedSeatIndices = seats.filter((seat) => seat.status === "active").map((seat) => seat.seatIndex);
  const ordered = getCircularSeatOrder(occupiedSeatIndices, buttonSeatIndex - 1);
  const labels = POSITION_LABELS[ordered.length] ?? POSITION_LABELS[9];
  return seats.map((seat) => {
    const positionIndex = ordered.findIndex((seatIndex) => seatIndex === seat.seatIndex);
    const positionLabels = labels ?? POSITION_LABELS[9];
    return {
      ...seat,
      position: positionIndex === -1 ? null : positionLabels[positionIndex] ?? null
    };
  });
}
function getSmallBlindSeatIndex(seats, buttonSeatIndex) {
  const occupied = seats.filter((seat) => seat.status === "active").map((seat) => seat.seatIndex);
  if (occupied.length < 2) {
    return null;
  }
  if (occupied.length === 2) {
    return buttonSeatIndex;
  }
  return getCircularSeatOrder(occupied, buttonSeatIndex)[0] ?? null;
}
function getBigBlindSeatIndex(seats, buttonSeatIndex) {
  const occupied = seats.filter((seat) => seat.status === "active").map((seat) => seat.seatIndex);
  if (occupied.length < 2) {
    return null;
  }
  if (occupied.length === 2) {
    return getCircularSeatOrder(occupied, buttonSeatIndex)[0] ?? null;
  }
  const ordered = getCircularSeatOrder(occupied, buttonSeatIndex);
  return ordered[1] ?? null;
}
function getFirstToActPreflop(seats, buttonSeatIndex) {
  const occupied = seats.filter((seat) => seat.status === "active").map((seat) => seat.seatIndex);
  const eligible = seats.filter((seat) => seat.status === "active" && !seat.hasFolded && !seat.isAllIn).map((seat) => seat.seatIndex);
  if (occupied.length < 2) {
    return null;
  }
  if (occupied.length === 2) {
    return eligible.includes(buttonSeatIndex) ? buttonSeatIndex : getCircularSeatOrder(eligible, buttonSeatIndex)[0] ?? null;
  }
  const bigBlindSeat = getBigBlindSeatIndex(seats, buttonSeatIndex);
  if (bigBlindSeat === null) {
    return null;
  }
  return getCircularSeatOrder(eligible, bigBlindSeat)[0] ?? null;
}
function getFirstToActPostflop(seats, buttonSeatIndex) {
  const occupied = seats.filter((seat) => seat.status === "active").map((seat) => seat.seatIndex);
  const eligible = seats.filter((seat) => seat.status === "active" && !seat.hasFolded && !seat.isAllIn).map((seat) => seat.seatIndex);
  if (occupied.length < 2) {
    return null;
  }
  return getCircularSeatOrder(eligible, buttonSeatIndex)[0] ?? null;
}

// apps/games/holdem-tournament/src/engine/rules/legalActions.ts
function canRaise(state, seat, amountToCall) {
  if (seat.stack <= amountToCall) {
    return false;
  }
  if (!seat.actedThisStreet) {
    return true;
  }
  return seat.lastFullRaiseSeen < state.betting.fullRaiseCount;
}
function getAmountToCall(state, seat) {
  return Math.max(0, state.betting.currentBet - seat.currentBet);
}
function getLegalActions(state, playerId) {
  const seat = state.seats.find((candidate) => candidate.playerId === playerId);
  if (!seat || seat.status !== "active" || seat.hasFolded || seat.isAllIn) {
    return [];
  }
  if (state.betting.actingSeatIndex !== seat.seatIndex) {
    return [];
  }
  const actions = [];
  const amountToCall = getAmountToCall(state, seat);
  const maxBet = seat.currentBet + seat.stack;
  const hasUnopenedPot = state.betting.currentBet === 0;
  if (amountToCall > 0) {
    actions.push({ type: "fold" });
  } else {
    actions.push({ type: "check" });
  }
  if (amountToCall > 0 && seat.stack > amountToCall) {
    actions.push({
      type: "call",
      amount: amountToCall,
      toCall: amountToCall
    });
  }
  if (hasUnopenedPot) {
    if (seat.stack >= state.betting.minBringIn) {
      actions.push({
        type: "bet",
        min: state.betting.minBringIn,
        max: seat.stack
      });
    }
  } else if (canRaise(state, seat, amountToCall) && maxBet >= state.betting.minRaiseTo) {
    actions.push({
      type: "raise",
      min: state.betting.minRaiseTo,
      max: maxBet,
      toCall: amountToCall
    });
  }
  if (seat.stack > 0) {
    actions.push({
      type: "all-in",
      amount: maxBet,
      toCall: amountToCall,
      isRaise: maxBet > state.betting.currentBet
    });
  }
  return actions;
}
function isActionLegal(state, playerId, type, amount) {
  return getLegalActions(state, playerId).some((action) => {
    if (action.type !== type) {
      return false;
    }
    if ((action.type === "bet" || action.type === "raise") && amount !== void 0) {
      return amount >= action.min && amount <= action.max;
    }
    return true;
  });
}

// apps/games/holdem-tournament/src/config/localization.ts
var GAME_UI_TEXT = {
  en: {
    tournament: "Tournament",
    level: "Level",
    ante: "Ante",
    hand: "Hand",
    pot: "Pot",
    waiting: "Waiting",
    nextLevelInHands: (value) => `Next level in ${value} hands`,
    settings: "Settings",
    handHistory: "Hand history",
    mainPot: "Main pot",
    sidePot: (index) => `Side pot ${index}`,
    round: "Hand",
    actingTurn: (name, street) => `${name} to act \xB7 ${street}`,
    nextHandReady: "The current hand is complete. Start the next hand when you are ready.",
    nextHandStart: "Start next hand",
    aiSpeed: "AI action speed",
    autoProgress: "Auto progress",
    on: "On",
    off: "Off",
    stepOnce: "Step once",
    restartTournament: "Restart tournament",
    seed: "Seed",
    opponentProfiles: "Opponent profiles",
    tournamentEntrants: "Tournament field",
    tournamentEntrantsCopy: "These eight bot tendencies are in the field. Their exact identity stays hidden during play.",
    back: "Back",
    confirmStart: "Confirm and start",
    gameOver: "Game over",
    tournamentWin: "Tournament winner!",
    unknownPlayer: "Unknown player",
    playerBusted: "Player eliminated",
    tournamentComplete: "Tournament complete",
    restartRun: "Start a new tournament",
    chips: "chips",
    folded: "Folded",
    allIn: "All-in",
    busted: "Busted",
    currentBet: (value) => `Current bet: ${value.toLocaleString()}`,
    fold: "Fold",
    check: "Check",
    call: (value) => `Call ${value.toLocaleString()}`,
    bet: (value) => `Bet ${value.toLocaleString()}`,
    raise: (value) => `Raise ${value.toLocaleString()}`,
    allInAction: (value) => `All-in ${value.toLocaleString()}`,
    actionLogFold: (name) => `${name} folds`,
    actionLogCheck: (name) => `${name} checks`,
    actionLogCall: (name, amount) => `${name} calls ${amount.toLocaleString()}`,
    actionLogBet: (name, amount) => `${name} bets ${amount.toLocaleString()}`,
    actionLogRaise: (name, amount) => `${name} raises to ${amount.toLocaleString()}`,
    actionLogAllIn: (name, amount) => `${name} is all-in for ${amount.toLocaleString()}`,
    betAmount: "Bet size",
    raiseAmount: "Raise size",
    potShortcut: (ratioPercent) => `Pot ${ratioPercent}%`,
    noWagerAvailable: "Betting or raising is not available in this spot.",
    eliminatedMessage: "You are out of the tournament.",
    close: "Close",
    noContestWinner: (name, totalPot) => `${name} wins ${totalPot.toLocaleString()} chips uncontested.`,
    showdownWinner: (name) => `${name} wins the hand.`,
    splitPotWinner: (names) => `${names.join(", ")} split the pot.`,
    forcedBetLabel: {
      "post-ante": "Ante",
      "post-small-blind": "Small blind",
      "post-big-blind": "Big blind"
    },
    forcedBetLog: (name, label, posted) => `${name} - ${label} ${posted.toLocaleString()}`,
    handStartLog: (handNumber, buttonName, smallBlind, bigBlind, ante) => `Hand #${handNumber} starts. Button: ${buttonName ?? "Unknown"}. Blinds ${smallBlind}/${bigBlind}, ante ${ante}.`,
    boardRevealLog: (street, cards) => `${street === "flop" ? "Flop" : street === "turn" ? "Turn" : "River"}: ${cards.join(" ")}`,
    openCardsLog: (name, cards) => `${name} shows ${cards.join(" ")}`,
    winLog: (name, amount, potLabel, isOddChip) => `${name} collects ${amount.toLocaleString()} chips (${potLabel}${isOddChip ? ", including the odd chip" : ""})`,
    eliminationLog: (name, place) => `${name} is eliminated (${formatPlacement(place, "en")})`,
    levelToast: (level, smallBlind, bigBlind) => `Level ${level} begins: ${smallBlind}/${bigBlind}`,
    winnerToast: (name) => `${name} wins the tournament`,
    winnerModalBusted: (place) => `You busted in ${place}. Start a new tournament and take another shot.`,
    winnerModalHuman: (stack, level) => `You took every chip on the table and finished 1st. You closed the tournament on level ${level} with ${stack.toLocaleString()} chips.`,
    winnerModalBot: (name, stack, level) => `${name} finished with every chip in play. The tournament ended on level ${level} with ${stack.toLocaleString()} chips.`
  },
  ko: {
    tournament: "\uD1A0\uB108\uBA3C\uD2B8",
    level: "\uB808\uBCA8",
    ante: "\uC564\uD2F0",
    hand: "\uD578\uB4DC",
    pot: "\uD31F",
    waiting: "\uB300\uAE30 \uC911",
    nextLevelInHands: (value) => `\uB2E4\uC74C \uB808\uBCA8 ${value}\uD578\uB4DC`,
    settings: "\uC124\uC815",
    handHistory: "\uD578\uB4DC \uD788\uC2A4\uD1A0\uB9AC",
    mainPot: "\uBA54\uC778 \uD31F",
    sidePot: (index) => `\uC0AC\uC774\uB4DC \uD31F ${index}`,
    round: "\uB77C\uC6B4\uB4DC",
    actingTurn: (name, street) => `${name} \uCC28\uB840 \xB7 ${street}`,
    nextHandReady: "\uD604\uC7AC \uD578\uB4DC\uAC00 \uC885\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC900\uBE44\uB418\uBA74 \uB2E4\uC74C \uD578\uB4DC\uB97C \uC2DC\uC791\uD558\uC138\uC694.",
    nextHandStart: "\uB2E4\uC74C \uD578\uB4DC \uC2DC\uC791",
    aiSpeed: "AI \uC561\uC158 \uC18D\uB3C4",
    autoProgress: "\uC790\uB3D9 \uC9C4\uD589",
    on: "\uCF1C\uC9D0",
    off: "\uAEBC\uC9D0",
    stepOnce: "\uD55C \uB2E8\uACC4 \uC9C4\uD589",
    restartTournament: "\uD1A0\uB108\uBA3C\uD2B8 \uB2E4\uC2DC \uC2DC\uC791",
    seed: "\uC2DC\uB4DC",
    opponentProfiles: "\uC0C1\uB300 \uD504\uB85C\uD544",
    tournamentEntrants: "\uC774\uBC88 \uD1A0\uB108\uBA3C\uD2B8 \uCC38\uAC00\uC790",
    tournamentEntrantsCopy: "\uC774\uBC88 \uAC8C\uC784\uC5D0\uB294 \uC544\uB798 8\uAC00\uC9C0 \uC131\uD5A5\uC774 \uB4F1\uC7A5\uD569\uB2C8\uB2E4. \uB204\uAC00 \uC5B4\uB5A4 \uC131\uD5A5\uC778\uC9C0\uB294 \uD50C\uB808\uC774 \uC911 \uACF5\uAC1C\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
    back: "\uB4A4\uB85C",
    confirmStart: "\uD655\uC778 \uD6C4 \uC2DC\uC791",
    gameOver: "\uAC8C\uC784 \uC624\uBC84",
    tournamentWin: "\uD1A0\uB108\uBA3C\uD2B8 \uC6B0\uC2B9!",
    unknownPlayer: "\uC54C \uC218 \uC5C6\uC74C",
    playerBusted: "\uD50C\uB808\uC774\uC5B4 \uD0C8\uB77D",
    tournamentComplete: "\uD1A0\uB108\uBA3C\uD2B8 \uC885\uB8CC",
    restartRun: "\uC0C8 \uD1A0\uB108\uBA3C\uD2B8 \uC2DC\uC791",
    chips: "\uCE69",
    folded: "\uD3F4\uB4DC",
    allIn: "\uC62C\uC778",
    busted: "\uD0C8\uB77D",
    currentBet: (value) => `\uD604\uC7AC \uBCA0\uD305: ${value.toLocaleString()}`,
    fold: "\uD3F4\uB4DC",
    check: "\uCCB4\uD06C",
    call: (value) => `\uCF5C ${value.toLocaleString()}`,
    bet: (value) => `\uBCA0\uD305 ${value.toLocaleString()}`,
    raise: (value) => `\uB808\uC774\uC988 ${value.toLocaleString()}`,
    allInAction: (value) => `\uC62C\uC778 ${value.toLocaleString()}`,
    actionLogFold: (name) => `${name} \uD3F4\uB4DC`,
    actionLogCheck: (name) => `${name} \uCCB4\uD06C`,
    actionLogCall: (name, amount) => `${name} \uCF5C ${amount.toLocaleString()}`,
    actionLogBet: (name, amount) => `${name} \uBCA0\uD305 ${amount.toLocaleString()}`,
    actionLogRaise: (name, amount) => `${name} \uB808\uC774\uC988 ${amount.toLocaleString()}`,
    actionLogAllIn: (name, amount) => `${name} \uC62C\uC778 ${amount.toLocaleString()}`,
    betAmount: "\uBCA0\uD305 \uAE08\uC561",
    raiseAmount: "\uB808\uC774\uC988 \uAE08\uC561",
    potShortcut: (ratioPercent) => `\uD31F ${ratioPercent}%`,
    noWagerAvailable: "\uD604\uC7AC \uBCA0\uD305 \uB610\uB294 \uB808\uC774\uC988\uB294 \uBD88\uAC00\uB2A5\uD569\uB2C8\uB2E4.",
    eliminatedMessage: "\uD1A0\uB108\uBA3C\uD2B8\uC5D0\uC11C \uD0C8\uB77D\uD588\uC2B5\uB2C8\uB2E4.",
    close: "\uB2EB\uAE30",
    noContestWinner: (name, totalPot) => `${name}\uC774(\uAC00) \uC2B9\uBD80 \uC5C6\uC774 ${totalPot.toLocaleString()} \uCE69\uC744 \uAC00\uC838\uAC11\uB2C8\uB2E4.`,
    showdownWinner: (name) => `${name}\uC774(\uAC00) \uD578\uB4DC\uB97C \uAC00\uC838\uAC11\uB2C8\uB2E4.`,
    splitPotWinner: (names) => `${names.join(", ")}\uC774(\uAC00) \uD31F\uC744 \uB098\uB220 \uAC00\uC9D1\uB2C8\uB2E4.`,
    forcedBetLabel: {
      "post-ante": "\uC564\uD2F0",
      "post-small-blind": "\uC2A4\uBAB0 \uBE14\uB77C\uC778\uB4DC",
      "post-big-blind": "\uBE45 \uBE14\uB77C\uC778\uB4DC"
    },
    forcedBetLog: (name, label, posted) => `${name} - ${label} ${posted.toLocaleString()}`,
    handStartLog: (handNumber, buttonName, smallBlind, bigBlind, ante) => `\uD578\uB4DC #${handNumber} \uC2DC\uC791. \uBC84\uD2BC: ${buttonName ?? "\uC54C \uC218 \uC5C6\uC74C"}. \uBE14\uB77C\uC778\uB4DC ${smallBlind}/${bigBlind}, \uC564\uD2F0 ${ante}`,
    boardRevealLog: (street, cards) => `${street === "flop" ? "\uD50C\uB78D" : street === "turn" ? "\uD134" : "\uB9AC\uBC84"}: ${cards.join(" ")}`,
    openCardsLog: (name, cards) => `${name} \uC624\uD508 ${cards.join(" ")}`,
    winLog: (name, amount, potLabel, isOddChip) => `${name} ${amount.toLocaleString()}\uCE69 \uD68D\uB4DD (${potLabel}${isOddChip ? ", \uB098\uBA38\uC9C0 1\uCE69 \uD3EC\uD568" : ""})`,
    eliminationLog: (name, place) => `${name} \uD0C8\uB77D (${formatPlacement(place, "ko")})`,
    levelToast: (level, smallBlind, bigBlind) => `\uB808\uBCA8 ${level} \uC2DC\uC791: ${smallBlind}/${bigBlind}`,
    winnerToast: (name) => `${name} \uC6B0\uC2B9`,
    winnerModalBusted: (place) => `\uB2F9\uC2E0\uC740 ${place}\uB85C \uD0C8\uB77D\uD588\uC2B5\uB2C8\uB2E4. \uC0C8 \uD1A0\uB108\uBA3C\uD2B8\uB97C \uC2DC\uC791\uD574 \uB2E4\uC2DC \uB3C4\uC804\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.`,
    winnerModalHuman: (stack, level) => `\uB2F9\uC2E0\uC774 \uBAA8\uB4E0 \uCE69\uC744 \uAC00\uC838\uAC00\uBA70 1\uC704\uB97C \uCC28\uC9C0\uD588\uC2B5\uB2C8\uB2E4. \uCD1D ${stack.toLocaleString()}\uCE69\uC73C\uB85C \uB808\uBCA8 ${level}\uC5D0\uC11C \uD1A0\uB108\uBA3C\uD2B8\uB97C \uB05D\uB0C8\uC2B5\uB2C8\uB2E4.`,
    winnerModalBot: (name, stack, level) => `${name}\uC774(\uAC00) \uBAA8\uB4E0 \uCE69\uC744 \uAC00\uC838\uAC00\uBA70 \uC6B0\uC2B9\uD588\uC2B5\uB2C8\uB2E4. \uCD1D ${stack.toLocaleString()}\uCE69\uC73C\uB85C \uB808\uBCA8 ${level}\uC5D0\uC11C \uD1A0\uB108\uBA3C\uD2B8\uB97C \uB05D\uB0C8\uC2B5\uB2C8\uB2E4.`
  }
};
function getGameUiText(lang = "ko") {
  return GAME_UI_TEXT[lang];
}
function formatPlacement(value, lang = "ko") {
  if (lang === "ko") {
    return `${value}\uC704`;
  }
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value}st`;
  if (mod10 === 2 && mod100 !== 12) return `${value}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${value}rd`;
  return `${value}th`;
}

// apps/games/holdem-tournament/src/engine/rules/blindPosting.ts
function postForcedBet(state, seat, amount, type, label) {
  const copy = getGameUiText(state.ui.lang);
  const posted = Math.min(amount, seat.stack);
  seat.stack -= posted;
  seat.currentBet += type === "post-ante" ? 0 : posted;
  seat.totalCommitted += posted;
  seat.lastAction = type;
  seat.lastActionAmount = posted;
  if (seat.stack === 0) {
    seat.isAllIn = true;
  }
  appendLogEntry(
    state,
    createLogEntry(
      state,
      seat.seatIndex,
      seat.playerId,
      seat.name,
      state.betting.street,
      type,
      posted,
      copy.forcedBetLog(seat.name, label, posted)
    )
  );
}
function postAntes(state) {
  const nextState = structuredClone(state);
  if (nextState.currentLevel.ante <= 0) {
    nextState.phase = "post_blinds";
    return nextState;
  }
  nextState.seats.filter((seat) => seat.status === "active").forEach(
    (seat) => postForcedBet(
      nextState,
      seat,
      nextState.currentLevel.ante,
      "post-ante",
      getGameUiText(nextState.ui.lang).forcedBetLabel["post-ante"]
    )
  );
  nextState.phase = "post_blinds";
  return nextState;
}
function postBlinds(state) {
  const nextState = structuredClone(state);
  const smallBlindSeatIndex = getSmallBlindSeatIndex(nextState.seats, nextState.buttonSeatIndex);
  const bigBlindSeatIndex = getBigBlindSeatIndex(nextState.seats, nextState.buttonSeatIndex);
  if (smallBlindSeatIndex === null || bigBlindSeatIndex === null) {
    nextState.tournamentWinnerId = nextState.seats.find((seat) => seat.status === "active")?.playerId ?? null;
    nextState.tournamentCompletionReason = "winner";
    nextState.phase = "tournament_complete";
    return nextState;
  }
  const smallBlindSeat = nextState.seats.find((seat) => seat.seatIndex === smallBlindSeatIndex);
  const bigBlindSeat = nextState.seats.find((seat) => seat.seatIndex === bigBlindSeatIndex);
  const copy = getGameUiText(nextState.ui.lang);
  postForcedBet(
    nextState,
    smallBlindSeat,
    nextState.currentLevel.smallBlind,
    "post-small-blind",
    copy.forcedBetLabel["post-small-blind"]
  );
  postForcedBet(
    nextState,
    bigBlindSeat,
    nextState.currentLevel.bigBlind,
    "post-big-blind",
    copy.forcedBetLabel["post-big-blind"]
  );
  nextState.betting.street = "preflop";
  nextState.betting.currentBet = nextState.currentLevel.bigBlind;
  nextState.betting.minBringIn = nextState.currentLevel.bigBlind;
  nextState.betting.lastFullRaiseSize = nextState.currentLevel.bigBlind;
  nextState.betting.fullRaiseCount = 1;
  nextState.betting.minRaiseTo = nextState.currentLevel.bigBlind * 2;
  nextState.betting.previousAggressorSeatIndex = null;
  nextState.betting.lastAggressorSeatIndex = null;
  nextState.betting.actingSeatIndex = getFirstToActPreflop(nextState.seats, nextState.buttonSeatIndex);
  nextState.phase = "deal_hole_cards";
  return nextState;
}

// apps/games/holdem-tournament/src/engine/rules/bettingRound.ts
function findSeat(state, playerId) {
  return state.seats.find((seat) => seat.playerId === playerId);
}
function commitChips(seat, targetBet) {
  const desiredAdditional = Math.max(0, targetBet - seat.currentBet);
  const committed = Math.min(desiredAdditional, seat.stack);
  seat.stack -= committed;
  seat.currentBet += committed;
  seat.totalCommitted += committed;
  if (seat.stack === 0) {
    seat.isAllIn = true;
  }
  return committed;
}
function isOnlyOneContenderLeft(state) {
  return getHandContenders(state.seats).length === 1;
}
function getNextStreetPhase(street) {
  switch (street) {
    case "preflop":
      return "deal_flop";
    case "flop":
      return "deal_turn";
    case "turn":
      return "deal_river";
    case "river":
    case "showdown":
      return "showdown";
  }
}
function findNextActingSeatIndex(state, fromSeatIndex) {
  const activeSeatIndices = state.seats.filter((seat) => seat.status === "active").map((seat) => seat.seatIndex);
  const ordered = getCircularSeatOrder(activeSeatIndices, fromSeatIndex);
  for (const seatIndex of ordered) {
    const seat = state.seats.find((candidate) => candidate.seatIndex === seatIndex);
    if (!seat || seat.hasFolded || seat.isAllIn) {
      continue;
    }
    if (!seat.actedThisStreet || seat.currentBet !== state.betting.currentBet) {
      return seat.seatIndex;
    }
  }
  return null;
}
function logAction(state, seat, amount, text) {
  appendLogEntry(
    state,
    createLogEntry(
      state,
      seat.seatIndex,
      seat.playerId,
      seat.name,
      state.betting.street,
      seat.lastAction ?? "check",
      amount,
      text
    )
  );
}
function applyPlayerAction(state, action) {
  const nextState = structuredClone(state);
  const copy = getGameUiText(nextState.ui.lang);
  const seat = findSeat(nextState, action.playerId);
  if (!seat || seat.status !== "active" || seat.hasFolded || seat.isAllIn) {
    return state;
  }
  if (nextState.betting.actingSeatIndex !== seat.seatIndex) {
    return state;
  }
  if (!isActionLegal(nextState, action.playerId, action.type, action.amount)) {
    return state;
  }
  const amountToCall = getAmountToCall(nextState, seat);
  const previousBet = nextState.betting.currentBet;
  switch (action.type) {
    case "fold": {
      seat.hasFolded = true;
      seat.lastAction = "fold";
      seat.lastActionAmount = 0;
      seat.actedThisStreet = true;
      seat.lastFullRaiseSeen = nextState.betting.fullRaiseCount;
      logAction(nextState, seat, 0, copy.actionLogFold(seat.name));
      break;
    }
    case "check": {
      seat.lastAction = "check";
      seat.lastActionAmount = 0;
      seat.actedThisStreet = true;
      seat.lastFullRaiseSeen = nextState.betting.fullRaiseCount;
      logAction(nextState, seat, 0, copy.actionLogCheck(seat.name));
      break;
    }
    case "call": {
      const committed = commitChips(seat, seat.currentBet + amountToCall);
      seat.lastAction = "call";
      seat.lastActionAmount = committed;
      seat.actedThisStreet = true;
      seat.lastFullRaiseSeen = nextState.betting.fullRaiseCount;
      logAction(nextState, seat, committed, copy.actionLogCall(seat.name, committed));
      break;
    }
    case "bet":
    case "raise":
    case "all-in": {
      const legalActions = getLegalActions(nextState, action.playerId);
      const requestedAmount = action.type === "all-in" ? seat.currentBet + seat.stack : action.amount ?? (legalActions.find(
        (legalAction) => legalAction.type === action.type && "min" in legalAction
      )?.min ?? seat.currentBet + seat.stack);
      const targetBet = Math.max(seat.currentBet, requestedAmount);
      const committed = commitChips(seat, targetBet);
      const raiseSize = seat.currentBet - previousBet;
      const isOpeningBet = previousBet === 0 && seat.currentBet > 0;
      const isFullRaise = isOpeningBet ? seat.currentBet >= nextState.betting.minBringIn : raiseSize >= nextState.betting.lastFullRaiseSize;
      nextState.betting.currentBet = Math.max(nextState.betting.currentBet, seat.currentBet);
      nextState.betting.lastAggressorSeatIndex = seat.seatIndex;
      if (isOpeningBet) {
        nextState.betting.fullRaiseCount = 1;
        if (isFullRaise) {
          nextState.betting.lastFullRaiseSize = seat.currentBet;
        }
      } else if (seat.currentBet > previousBet && isFullRaise) {
        nextState.betting.fullRaiseCount += 1;
        nextState.betting.lastFullRaiseSize = raiseSize;
      }
      nextState.betting.minRaiseTo = nextState.betting.currentBet + nextState.betting.lastFullRaiseSize;
      seat.lastAction = action.type;
      seat.lastActionAmount = committed;
      seat.actedThisStreet = true;
      seat.lastFullRaiseSeen = nextState.betting.fullRaiseCount;
      const text = action.type === "bet" ? copy.actionLogBet(seat.name, seat.currentBet) : action.type === "raise" ? copy.actionLogRaise(seat.name, seat.currentBet) : copy.actionLogAllIn(seat.name, seat.currentBet);
      logAction(nextState, seat, committed, text);
      break;
    }
  }
  nextState.ui.raiseInput = nextState.betting.minRaiseTo;
  if (isOnlyOneContenderLeft(nextState)) {
    nextState.betting.actingSeatIndex = null;
    nextState.phase = "award_pots";
    return nextState;
  }
  const nextActor = findNextActingSeatIndex(nextState, seat.seatIndex);
  if (nextActor !== null) {
    nextState.betting.actingSeatIndex = nextActor;
    return nextState;
  }
  nextState.betting.actingSeatIndex = null;
  nextState.phase = getNextStreetPhase(nextState.betting.street);
  return nextState;
}

// apps/games/holdem-tournament/src/engine/rules/showdown.ts
function resolveShowdown(state) {
  const copy = getGameUiText(state.ui.lang);
  const contenders = state.seats.filter((seat) => seat.status === "active" && seat.totalCommitted > 0);
  const pots = buildPots(state.seats);
  if (contenders.filter((seat) => !seat.hasFolded).length === 1) {
    const winner = contenders.find((seat) => !seat.hasFolded);
    const totalPot = state.seats.reduce((sum, seat) => sum + seat.totalCommitted, 0);
    const payouts2 = [
      {
        potId: "main",
        playerId: winner.playerId,
        amount: totalPot,
        isOddChip: false
      }
    ];
    return {
      pots,
      payouts: payouts2,
      showdown: [],
      winnerMessage: copy.noContestWinner(winner.name, totalPot)
    };
  }
  const { payouts, showdown } = distributePots(
    pots,
    state.seats.filter((seat) => !seat.hasFolded),
    state.hand.communityCards,
    state.buttonSeatIndex
  );
  const winnerNames = [...new Set(payouts.map((payout) => state.seats.find((seat) => seat.playerId === payout.playerId)?.name ?? payout.playerId))];
  return {
    pots,
    payouts,
    showdown,
    winnerMessage: winnerNames.length === 1 ? copy.showdownWinner(winnerNames[0]) : copy.splitPotWinner(winnerNames)
  };
}

// apps/games/holdem-tournament/src/engine/tournament/levelProgression.ts
function getBlindLevel(config, levelIndex) {
  return config.blindLevels[Math.min(levelIndex, config.blindLevels.length - 1)];
}
function advanceBlindLevel(levelIndex, config) {
  return Math.min(levelIndex + 1, config.blindLevels.length - 1);
}
export {
  BLIND_LEVELS,
  advanceBlindLevel,
  appendLogEntry,
  applyPlayerAction,
  assignTablePositions,
  buildPots,
  countRemainingPlayers,
  createLogEntry,
  distributePots,
  drawCards,
  getAmountToCall,
  getBigBlindSeatIndex,
  getBlindLevel,
  getCircularSeatOrder,
  getFirstToActPostflop,
  getHandContenders,
  getLegalActions,
  getNextOccupiedSeatIndex,
  getPlayersAbleToAct,
  getSmallBlindSeatIndex,
  postAntes,
  postBlinds,
  resolveShowdown,
  shuffleDeck
};
