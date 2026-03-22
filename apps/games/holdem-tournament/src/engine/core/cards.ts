import { RANKS, SUITS, type Card, type Rank, type Suit } from 'holdem/types/cards';

const RANK_LABELS: Record<Rank, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'T',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

const SUIT_LABELS: Record<Suit, string> = {
  clubs: 'c',
  diamonds: 'd',
  hearts: 'h',
  spades: 's',
};

export function createCard(rank: Rank, suit: Suit): Card {
  return {
    rank,
    suit,
    code: `${RANK_LABELS[rank]}${SUIT_LABELS[suit]}`,
  };
}

export function createStandardDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => createCard(rank, suit)));
}

export function cardLabel(card: Card): string {
  return card.code;
}

export function rankLabel(rank: number): string {
  if (rank === 14) {
    return 'A';
  }

  if (rank === 13) {
    return 'K';
  }

  if (rank === 12) {
    return 'Q';
  }

  if (rank === 11) {
    return 'J';
  }

  if (rank === 10) {
    return 'T';
  }

  return String(rank);
}

export function sortCardsDescending(cards: Card[]): Card[] {
  return [...cards].sort((left, right) => right.rank - left.rank || left.suit.localeCompare(right.suit));
}
