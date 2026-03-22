import { CardView } from 'holdem/components/cards/CardView';
import type { Seat } from 'holdem/types/engine';
import styles from 'holdem/components/seat/HeroMiniTray.module.css';

interface HeroMiniTrayProps {
  seat?: Seat;
  handNumber: number;
}

export function HeroMiniTray({ seat, handNumber }: HeroMiniTrayProps) {
  if (!seat || seat.status !== 'active') {
    return null;
  }

  return (
    <section className={styles.tray}>
      <div className={styles.cards}>
        {seat.holeCards.length > 0 ? (
          seat.holeCards.map((card, index) => (
            <CardView
              key={`${handNumber}-${seat.playerId}-mini-${card.code}-${index}`}
              card={card}
              large
              animate
              delayMs={90 + index * 100}
              motion="hole"
            />
          ))
        ) : (
          <>
            <CardView hidden large />
            <CardView hidden large />
          </>
        )}
      </div>
    </section>
  );
}
