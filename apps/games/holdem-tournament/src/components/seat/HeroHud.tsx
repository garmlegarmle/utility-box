import { CardView } from 'holdem/components/cards/CardView';
import type { Seat } from 'holdem/types/engine';
import styles from 'holdem/components/seat/HeroHud.module.css';

interface HeroHudProps {
  seat?: Seat;
  handNumber: number;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
}

export function HeroHud({ seat, handNumber, isButton, isSmallBlind, isBigBlind }: HeroHudProps) {
  if (!seat || seat.status !== 'active') {
    return null;
  }

  return (
    <section className={styles.hud}>
      <div className={styles.infoRow}>
        <div className={styles.identity}>
          <span className={styles.name}>{seat.name}</span>
          <span className={styles.stack}>{seat.stack.toLocaleString()} 칩</span>
        </div>
        <div className={styles.badges}>
          {isButton && <span className={styles.badge}>D</span>}
          {isSmallBlind && <span className={styles.badge}>SB</span>}
          {isBigBlind && <span className={styles.badge}>BB</span>}
          {seat.hasFolded && <span className={styles.state}>폴드</span>}
          {seat.isAllIn && <span className={styles.state}>올인</span>}
        </div>
      </div>

      <div className={styles.cards}>
        {seat.holeCards.length > 0 ? (
          seat.holeCards.map((card, index) => (
            <CardView
              key={`${handNumber}-${seat.playerId}-hero-${card.code}-${index}`}
              card={card}
              hero
              animate
              delayMs={160 + index * 100}
              motion="hole"
            />
          ))
        ) : (
          <>
            <CardView hidden hero />
            <CardView hidden hero />
          </>
        )}
      </div>

      <div className={styles.betLine}>{seat.currentBet > 0 ? `현재 베팅: ${seat.currentBet.toLocaleString()}` : ' '}</div>
    </section>
  );
}
