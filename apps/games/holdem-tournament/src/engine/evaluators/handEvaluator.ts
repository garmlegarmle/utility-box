import { rankLabel, sortCardsDescending } from 'holdem/engine/core/cards';
import { HAND_CATEGORY_NAMES } from 'holdem/engine/evaluators/handCategories';
import type { Card } from 'holdem/types/cards';
import type { HandRankResult } from 'holdem/types/engine';

interface EvaluatedFiveCardHand {
  category: number;
  tiebreakers: number[];
  label: string;
  cards: Card[];
}

function combinations<T>(items: T[], choose: number): T[][] {
  if (choose === 0) {
    return [[]];
  }

  if (items.length < choose) {
    return [];
  }

  if (items.length === choose) {
    return [items];
  }

  const first = items[0]!;
  const rest = items.slice(1);
  const withFirst = combinations(rest, choose - 1).map((combo) => [first, ...combo]);
  const withoutFirst = combinations(rest, choose);

  return [...withFirst, ...withoutFirst];
}

function getStraightHigh(ranks: number[]): number | null {
  const unique = [...new Set(ranks)].sort((left, right) => right - left);

  if (unique[0] === 14) {
    unique.push(1);
  }

  let streak = 1;

  for (let index = 1; index < unique.length; index += 1) {
    const previous = unique[index - 1]!;
    const current = unique[index]!;

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

function compareTiebreakers(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function evaluateFiveCardHand(cards: Card[]): EvaluatedFiveCardHand {
  const sorted = sortCardsDescending(cards);
  const ranks = sorted.map((card) => card.rank);
  const rankCounts = new Map<number, number>();

  for (const rank of ranks) {
    rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
  }

  const groups = [...rankCounts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }

    return right[0] - left[0];
  });

  const isFlush = sorted.every((card) => card.suit === sorted[0]!.suit);
  const straightHigh = getStraightHigh(ranks);
  const isStraight = straightHigh !== null;

  if (isFlush && isStraight) {
    const highCard = straightHigh!;
    return {
      category: 8,
      tiebreakers: [highCard],
      label: highCard === 14 ? 'Royal Flush' : `${rankLabel(highCard)}-high Straight Flush`,
      cards: sorted,
    };
  }

  if (groups[0]?.[1] === 4) {
    const fourRank = groups[0]![0];
    const kicker = groups[1]![0];

    return {
      category: 7,
      tiebreakers: [fourRank, kicker],
      label: `Four of a Kind, ${rankLabel(fourRank)}s`,
      cards: sorted,
    };
  }

  if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) {
    const trips = groups[0]![0];
    const pair = groups[1]![0];
    return {
      category: 6,
      tiebreakers: [trips, pair],
      label: `Full House, ${rankLabel(trips)}s full of ${rankLabel(pair)}s`,
      cards: sorted,
    };
  }

  if (isFlush) {
    const highCard = ranks[0]!;
    return {
      category: 5,
      tiebreakers: ranks,
      label: `${rankLabel(highCard)}-high Flush`,
      cards: sorted,
    };
  }

  if (isStraight) {
    const highCard = straightHigh!;
    return {
      category: 4,
      tiebreakers: [highCard],
      label: `${rankLabel(highCard)}-high Straight`,
      cards: sorted,
    };
  }

  if (groups[0]?.[1] === 3) {
    const kickers = groups.slice(1).map(([rank]) => rank).sort((left, right) => right - left);
    const trips = groups[0]![0];

    return {
      category: 3,
      tiebreakers: [trips, ...kickers],
      label: `Three of a Kind, ${rankLabel(trips)}s`,
      cards: sorted,
    };
  }

  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) {
    const topPair = Math.max(groups[0]![0], groups[1]![0]);
    const lowerPair = Math.min(groups[0]![0], groups[1]![0]);
    const kicker = groups[2]![0];

    return {
      category: 2,
      tiebreakers: [topPair, lowerPair, kicker],
      label: `Two Pair, ${rankLabel(topPair)}s and ${rankLabel(lowerPair)}s`,
      cards: sorted,
    };
  }

  if (groups[0]?.[1] === 2) {
    const kickers = groups.slice(1).map(([rank]) => rank).sort((left, right) => right - left);
    const pair = groups[0]![0];

    return {
      category: 1,
      tiebreakers: [pair, ...kickers],
      label: `Pair of ${rankLabel(pair)}s`,
      cards: sorted,
    };
  }

  return {
    category: 0,
    tiebreakers: ranks,
    label: `${rankLabel(ranks[0]!)}-high`,
    cards: sorted,
  };
}

export function evaluateBestHand(cards: Card[]): HandRankResult {
  const combos = combinations(cards, 5);
  let best = evaluateFiveCardHand(combos[0] ?? cards.slice(0, 5));

  for (const combo of combos.slice(1)) {
    const candidate = evaluateFiveCardHand(combo);

    if (
      candidate.category > best.category ||
      (candidate.category === best.category && compareTiebreakers(candidate.tiebreakers, best.tiebreakers) > 0)
    ) {
      best = candidate;
    }
  }

  return {
    category: best.category,
    categoryName: HAND_CATEGORY_NAMES[best.category]!,
    tiebreakers: best.tiebreakers,
    bestFive: best.cards,
    label: best.label,
  };
}

export function compareHands(left: HandRankResult, right: HandRankResult): number {
  if (left.category !== right.category) {
    return left.category - right.category;
  }

  return compareTiebreakers(left.tiebreakers, right.tiebreakers);
}
