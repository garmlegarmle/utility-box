import { CardView } from 'holdem/components/cards/CardView';
import { formatChipStack, getGameUiText, type HoldemLang } from 'holdem/config/localization';
import type { Seat } from 'holdem/types/engine';
import styles from 'holdem/components/seat/HeroHud.module.css';

interface HeroHudProps {
  seat?: Seat;
  handNumber: number;
  isWinner?: boolean;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  lang: HoldemLang;
}

export function HeroHud({ seat, handNumber, isWinner = false, isButton, isSmallBlind, isBigBlind, lang }: HeroHudProps) {
  const copy = getGameUiText(lang);

  if (!seat || seat.status !== 'active') {
    return null;
  }

  return (
    <section className={[styles.hud, isWinner ? styles.winner : ''].join(' ')}>
      <div className={styles.infoRow}>
        <div className={styles.identity}>
          <span className={styles.name}>{seat.name}</span>
          <span className={styles.stack}>{formatChipStack(seat.stack, lang)}</span>
        </div>
        <div className={styles.badges}>
          {isButton && <span className={styles.badge}>D</span>}
          {isSmallBlind && <span className={styles.badge}>SB</span>}
          {isBigBlind && <span className={styles.badge}>BB</span>}
          {seat.hasFolded && <span className={styles.state}>{copy.folded}</span>}
          {seat.isAllIn && <span className={styles.state}>{copy.allIn}</span>}
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

      <div className={styles.betLine}>{seat.currentBet > 0 ? copy.currentBet(seat.currentBet) : ' '}</div>
    </section>
  );
}
