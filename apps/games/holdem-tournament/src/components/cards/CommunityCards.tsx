import { CardView } from 'holdem/components/cards/CardView';
import type { Card } from 'holdem/types/cards';
import styles from 'holdem/components/table/TableScreen.module.css';

interface CommunityCardsProps {
  cards: Card[];
  handNumber: number;
}

export function CommunityCards({ cards, handNumber }: CommunityCardsProps) {
  return (
    <div className={styles.communityRow}>
      {Array.from({ length: 5 }).map((_, index) => (
        <CardView
          key={`${handNumber}-${cards[index]?.code ?? `slot-${index}`}`}
          card={cards[index]}
          large
          placeholder={!cards[index]}
          animate={Boolean(cards[index])}
          delayMs={index < 3 ? index * 160 : 260 + (index - 3) * 260}
          motion="board"
        />
      ))}
    </div>
  );
}
