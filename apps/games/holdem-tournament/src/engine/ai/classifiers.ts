import { evaluateBestHand } from 'holdem/engine/evaluators/handEvaluator';
import type {
  BoardTexture,
  DrawStrengthTier,
  MadeHandTier,
  StackDepthTier,
  StartingHandTier,
  TournamentPressureTier,
} from 'holdem/types/ai';
import type { Card } from 'holdem/types/cards';

function sortRanksDesc(cards: Card[]): number[] {
  return [...cards.map((card) => card.rank)].sort((left, right) => right - left);
}

export function classifyStartingHand(holeCards: [Card, Card]): StartingHandTier {
  const ranks = sortRanksDesc(holeCards);
  const left = ranks[0]!;
  const right = ranks[1]!;
  const suited = holeCards[0].suit === holeCards[1].suit;
  const paired = left === right;
  const gap = left - right;
  const bothBroadway = left >= 10 && right >= 10;

  if (paired && left >= 11) {
    return 'premium-pair';
  }

  if (paired && left >= 7) {
    return 'medium-pair';
  }

  if (paired) {
    return 'small-pair';
  }

  if (
    (left === 14 && right >= 12) ||
    (left === 13 && right >= 11) ||
    (left === 12 && right === 11)
  ) {
    return 'strong-broadway';
  }

  if (bothBroadway && suited) {
    return 'suited-broadway';
  }

  if (left === 14 && suited) {
    return 'suited-ace';
  }

  if (suited && gap <= 1 && left >= 6) {
    return 'suited-connector';
  }

  if (bothBroadway) {
    return 'weak-broadway';
  }

  if (left === 14) {
    return 'ace-x';
  }

  if (left === 13) {
    return 'king-x';
  }

  return 'trash';
}

export function classifyMadeHand(holeCards: [Card, Card], board: Card[]): MadeHandTier {
  const hand = evaluateBestHand([...holeCards, ...board]);

  switch (hand.category) {
    case 8:
      return 'straight-flush';
    case 7:
      return 'quads';
    case 6:
      return 'full-house';
    case 5:
      return 'flush';
    case 4:
      return 'straight';
    case 3:
      return 'trips';
    case 2:
      return 'two-pair';
    case 1:
      return 'pair';
    default:
      return 'high-card';
  }
}

function hasFlushDraw(allCards: Card[]): boolean {
  const suitCounts = new Map<string, number>();

  allCards.forEach((card) => {
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
  });

  return [...suitCounts.values()].some((count) => count === 4);
}

function straightDrawTier(cards: Card[]): DrawStrengthTier {
  const uniqueRanks = [...new Set(cards.map((card) => card.rank))];
  const normalized = uniqueRanks.includes(14) ? [...uniqueRanks, 1] : uniqueRanks;
  const sorted = normalized.sort((left, right) => left - right);
  let bestMissing = Number.POSITIVE_INFINITY;
  let bestLength = 0;

  for (let start = 1; start <= 10; start += 1) {
    const target = [start, start + 1, start + 2, start + 3, start + 4];
    const matches = target.filter((rank) => sorted.includes(rank)).length;
    const missing = 5 - matches;

    if (matches > bestLength || (matches === bestLength && missing < bestMissing)) {
      bestLength = matches;
      bestMissing = missing;
    }
  }

  if (bestLength < 4) {
    return 'none';
  }

  return bestMissing === 1 ? 'open-ended' : 'gutshot';
}

export function classifyDrawStrength(holeCards: [Card, Card], board: Card[]): DrawStrengthTier {
  if (board.length < 3) {
    return 'none';
  }

  const allCards = [...holeCards, ...board];
  const flushDraw = hasFlushDraw(allCards);
  const straightDraw = straightDrawTier(allCards);

  if (flushDraw && (straightDraw === 'open-ended' || straightDraw === 'gutshot')) {
    return 'combo-draw';
  }

  if (flushDraw) {
    return 'flush-draw';
  }

  return straightDraw;
}

export function classifyBoardTexture(board: Card[]): BoardTexture {
  if (board.length < 3) {
    return 'dry';
  }

  const ranks = sortRanksDesc(board);
  const suitCounts = new Map<string, number>();
  const rankCounts = new Map<number, number>();

  board.forEach((card) => {
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
    rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1);
  });

  const isMonotone = [...suitCounts.values()].some((count) => count >= 3);
  const isTwoTone = [...suitCounts.values()].some((count) => count === 2);
  const isPaired = [...rankCounts.values()].some((count) => count >= 2);
  const top = ranks[0]!;
  const bottom = ranks[ranks.length - 1]!;

  if (isMonotone) {
    return 'monotone';
  }

  if (isPaired) {
    return 'paired';
  }

  if (top - bottom <= 4) {
    return board.length >= 4 ? 'wet' : 'coordinated';
  }

  if (isTwoTone) {
    return 'two-tone';
  }

  return 'dry';
}

export function getStackDepthTier(stackInBigBlinds: number): StackDepthTier {
  if (stackInBigBlinds <= 12) {
    return 'short';
  }

  if (stackInBigBlinds <= 40) {
    return 'medium';
  }

  return 'deep';
}

export function getTournamentPressureTier(playersRemaining: number): TournamentPressureTier {
  if (playersRemaining <= 2) {
    return 'heads-up';
  }

  if (playersRemaining === 4) {
    return 'bubble';
  }

  if (playersRemaining <= 3) {
    return 'late';
  }

  if (playersRemaining <= 6) {
    return 'middle';
  }

  return 'early';
}
