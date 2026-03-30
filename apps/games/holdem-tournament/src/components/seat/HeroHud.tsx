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
  countdownSeconds?: number | null;
  canRevealCards?: boolean;
  onRevealCards?: () => void;
  revealHint?: string | null;
  winnerTitle?: string | null;
  winnerSubtitle?: string | null;
  lang: HoldemLang;
}

export function HeroHud({
  seat,
  handNumber,
  isWinner = false,
  isButton,
  isSmallBlind,
  isBigBlind,
  countdownSeconds = null,
  canRevealCards = false,
  onRevealCards,
  revealHint = null,
  winnerTitle = null,
  winnerSubtitle = null,
  lang,
}: HeroHudProps) {
  const copy = getGameUiText(lang);

  if (!seat) {
    return null;
  }

  const cardNodes = seat.holeCards.length > 0 ? (
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
  );

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
          {seat.status === 'busted' && <span className={styles.state}>{copy.busted}</span>}
        </div>
      </div>

      {countdownSeconds !== null ? <div className={styles.timer}>{countdownSeconds}s</div> : null}

      {isWinner && (winnerTitle || winnerSubtitle) ? (
        <div className={styles.winnerBanner}>
          {winnerTitle ? <div className={styles.winnerTitle}>{winnerTitle}</div> : null}
          {winnerSubtitle ? <div className={styles.winnerSubtitle}>{winnerSubtitle}</div> : null}
        </div>
      ) : null}

      {canRevealCards ? (
        <button type="button" className={styles.cardsButton} onClick={onRevealCards}>
          <div className={styles.cards}>{cardNodes}</div>
        </button>
      ) : (
        <div className={styles.cards}>{cardNodes}</div>
      )}

      {canRevealCards && revealHint ? <div className={styles.revealHint}>{revealHint}</div> : null}

      <div className={styles.betLine}>{seat.currentBet > 0 ? copy.currentBet(seat.currentBet) : ' '}</div>
    </section>
  );
}
