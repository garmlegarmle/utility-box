import { createStandardDeck } from 'holdem/engine/core/cards';
import { randomInt } from 'holdem/engine/core/rng';
import type { Card } from 'holdem/types/cards';
import type { DeckState } from 'holdem/types/engine';

export function shuffleDeck(seed: number): { deck: DeckState; nextSeed: number } {
  const cards = createStandardDeck();
  let nextSeed = seed;

  for (let index = cards.length - 1; index > 0; index -= 1) {
    const result = randomInt(nextSeed, index + 1);
    const swapIndex = result.value;
    nextSeed = result.nextState;

    const current = cards[index]!;
    cards[index] = cards[swapIndex]!;
    cards[swapIndex] = current;
  }

  return {
    deck: {
      cards,
      nextIndex: 0,
    },
    nextSeed,
  };
}

export function drawCards(deck: DeckState, count: number): { deck: DeckState; cards: Card[] } {
  const start = deck.nextIndex;
  const end = start + count;

  return {
    deck: {
      cards: deck.cards,
      nextIndex: end,
    },
    cards: deck.cards.slice(start, end),
  };
}
