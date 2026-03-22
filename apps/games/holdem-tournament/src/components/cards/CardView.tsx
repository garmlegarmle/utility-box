import type { CSSProperties } from 'react';
import type { Card } from 'holdem/types/cards';
import styles from 'holdem/components/cards/CardView.module.css';

interface CardViewProps {
  card?: Card;
  hidden?: boolean;
  large?: boolean;
  hero?: boolean;
  placeholder?: boolean;
  animate?: boolean;
  delayMs?: number;
  motion?: 'hole' | 'board';
}

export function CardView({
  card,
  hidden = false,
  large = false,
  hero = false,
  placeholder = false,
  animate = false,
  delayMs = 0,
  motion = 'hole',
}: CardViewProps) {
  const isRed = card?.suit === 'hearts' || card?.suit === 'diamonds';
  const suitGlyph =
    card?.suit === 'hearts' ? '♥' : card?.suit === 'diamonds' ? '♦' : card?.suit === 'spades' ? '♠' : '♣';

  return (
    <div
      className={[
        styles.card,
        hidden ? styles.hidden : '',
        large ? styles.large : '',
        hero ? styles.hero : '',
        placeholder ? styles.placeholder : '',
        animate ? styles.animate : '',
        animate && motion === 'board' ? styles.boardMotion : '',
        isRed ? styles.red : '',
      ].join(' ')}
      style={animate ? ({ animationDelay: `${delayMs}ms` } as CSSProperties) : undefined}
    >
      {placeholder ? null : card && !hidden ? (
        <>
          <span className={styles.rank}>{card.code[0]}</span>
          <span className={styles.suit}>{suitGlyph}</span>
        </>
      ) : (
        <span className={styles.backPattern} />
      )}
    </div>
  );
}
